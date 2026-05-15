#!/usr/bin/env python3
"""
Post-migration verification tests for staging.

Runs after migrate_staging.py to confirm all schema changes and data
migrations are correct. Exits 0 if all tests pass, 1 if any fail.

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrations/test_migration.py --env staging

Requires fly proxy running for staging:
    fly proxy 15432:5432 --app reel-ballers-db-staging
"""

import sys
import json
import sqlite3
import argparse
import tempfile
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATIONS_DIR.parent.parent / "src" / "backend"
sys.path.insert(0, str(MIGRATIONS_DIR))
sys.path.insert(0, str(BACKEND_DIR))

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv


class MigrationTest:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.failures = []

    def check(self, name: str, condition: bool, detail: str = ""):
        if condition:
            self.passed += 1
            print(f"  PASS  {name}")
        else:
            self.failed += 1
            msg = f"{name}: {detail}" if detail else name
            self.failures.append(msg)
            print(f"  FAIL  {msg}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"Results: {self.passed}/{total} passed, {self.failed} failed")
        if self.failures:
            print(f"\nFailures:")
            for f in self.failures:
                print(f"  - {f}")
        print(f"{'='*60}")
        return self.failed == 0


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "prod": ".prod"}[env_name]
    env_file = BACKEND_DIR.parent.parent / f".env{suffix}"
    if not env_file.exists():
        print(f"ERROR: {env_file} not found"); sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config: dict):
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto",
    )


def get_pg_conn(config: dict):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


# ---------------------------------------------------------------------------
# Postgres tests
# ---------------------------------------------------------------------------

def test_postgres_schema(pg_conn, t: MigrationTest):
    """Verify all required Postgres tables and columns exist."""
    print("\n--- Postgres Schema Tests ---")
    cur = pg_conn.cursor()

    # New tables must exist
    for table in ("shares", "share_videos", "share_games", "pending_teammate_shares"):
        cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name = %s", (table,))
        t.check(f"table {table} exists", cur.fetchone() is not None)

    # Dead table must be gone
    cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'shared_videos'")
    t.check("dead table shared_videos dropped", cur.fetchone() is None)

    # shares table columns
    for col in ("share_token", "share_type", "sharer_user_id", "sharer_profile_id",
                "recipient_email", "shared_at", "revoked_at", "watched_at"):
        cur.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'shares' AND column_name = %s",
            (col,),
        )
        t.check(f"shares.{col} exists", cur.fetchone() is not None)

    # share_type CHECK constraint
    cur.execute("""
        SELECT constraint_name FROM information_schema.check_constraints
        WHERE constraint_name LIKE '%%shares%%' OR constraint_name LIKE '%%share_type%%'
    """)
    # Also check by trying the constraint directly
    cur.execute("SELECT DISTINCT share_type FROM shares")
    types = {r["share_type"] for r in cur.fetchall()}
    t.check(
        "shares.share_type values valid",
        types.issubset({"video", "game"}),
        f"got {types}" if not types.issubset({"video", "game"}) else "",
    )

    # share_games metadata columns
    for col, expected_type in [
        ("game_name", "text"),
        ("game_blake3", "text"),
        ("first_clip_start", "real"),
        ("clip_names", "jsonb"),
    ]:
        cur.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'share_games' AND column_name = %s",
            (col,),
        )
        row = cur.fetchone()
        t.check(
            f"share_games.{col} exists ({expected_type})",
            row is not None and row["data_type"] == expected_type,
            f"got {row['data_type']}" if row else "missing",
        )

    # pending_teammate_shares.clip_data must be BYTEA
    cur.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = 'pending_teammate_shares' AND column_name = 'clip_data'"
    )
    row = cur.fetchone()
    t.check(
        "pending_teammate_shares.clip_data is bytea",
        row is not None and row["data_type"] == "bytea",
        f"got {row['data_type']}" if row else "missing",
    )

    # Key indexes exist
    for idx in ("idx_shares_token", "idx_shares_sharer", "idx_shares_recipient",
                "idx_share_videos_video", "idx_share_games_game",
                "idx_pending_shares_email", "idx_pending_shares_share"):
        cur.execute("SELECT 1 FROM pg_indexes WHERE indexname = %s", (idx,))
        t.check(f"index {idx} exists", cur.fetchone() is not None)


def test_postgres_data(pg_conn, t: MigrationTest):
    """Verify Postgres data integrity."""
    print("\n--- Postgres Data Tests ---")
    cur = pg_conn.cursor()

    # Every share has a valid type extension row
    cur.execute("""
        SELECT s.id, s.share_type,
               sv.share_id AS has_video,
               sg.share_id AS has_game
        FROM shares s
        LEFT JOIN share_videos sv ON sv.share_id = s.id
        LEFT JOIN share_games sg ON sg.share_id = s.id
    """)
    orphaned = []
    mismatched = []
    for row in cur.fetchall():
        if row["share_type"] == "video" and row["has_video"] is None:
            orphaned.append(f"share {row['id']}: type=video but no share_videos row")
        if row["share_type"] == "game" and row["has_game"] is None:
            orphaned.append(f"share {row['id']}: type=game but no share_games row")
        if row["share_type"] == "video" and row["has_game"] is not None:
            mismatched.append(f"share {row['id']}: type=video but has share_games row")
        if row["share_type"] == "game" and row["has_video"] is not None:
            mismatched.append(f"share {row['id']}: type=game but has share_videos row")

    t.check("all shares have matching extension row", len(orphaned) == 0,
            "; ".join(orphaned[:3]))
    t.check("no cross-type extension rows", len(mismatched) == 0,
            "; ".join(mismatched[:3]))

    # share_games metadata should be fully backfilled
    cur.execute("SELECT COUNT(*) as total FROM share_games")
    total = cur.fetchone()["total"]
    cur.execute("SELECT COUNT(*) as cnt FROM share_games WHERE game_name IS NULL")
    null_names = cur.fetchone()["cnt"]
    t.check(
        f"share_games metadata backfilled ({total} total, {null_names} null)",
        null_names == 0,
        f"{null_names} rows still have NULL game_name",
    )

    # share_games.clip_names should be valid JSON arrays where present
    cur.execute("SELECT share_id, clip_names FROM share_games WHERE clip_names IS NOT NULL")
    invalid_json = []
    for row in cur.fetchall():
        cn = row["clip_names"]
        if not isinstance(cn, list):
            invalid_json.append(f"share_id={row['share_id']}: {type(cn).__name__}")
    t.check("share_games.clip_names are JSON arrays", len(invalid_json) == 0,
            "; ".join(invalid_json[:3]))

    # FK integrity: shares.sharer_user_id references existing users
    cur.execute("""
        SELECT s.id, s.sharer_user_id FROM shares s
        LEFT JOIN users u ON u.user_id = s.sharer_user_id
        WHERE u.user_id IS NULL
    """)
    orphaned_shares = cur.fetchall()
    t.check(
        "all shares reference existing users",
        len(orphaned_shares) == 0,
        f"{len(orphaned_shares)} orphaned shares",
    )


# ---------------------------------------------------------------------------
# SQLite tests (per-user)
# ---------------------------------------------------------------------------

def test_sqlite_for_user(r2_client, bucket, app_env, user_id, email, t: MigrationTest):
    """Verify SQLite schema and data for one user."""
    prefix = f"{app_env}/users/{user_id}/profiles/"
    resp = r2_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
    profile_dbs = [
        obj["Key"] for obj in resp.get("Contents", [])
        if obj["Key"].endswith("profile.sqlite")
    ]

    if not profile_dbs:
        print(f"    (no profile DBs)")
        return

    with tempfile.TemporaryDirectory() as tmpdir:
        for r2_key in profile_dbs:
            parts = r2_key.split("/")
            profile_id = parts[-2]
            local_path = Path(tmpdir) / f"{profile_id}_profile.sqlite"
            r2_client.download_file(bucket, r2_key, str(local_path))
            label = f"{email}/{profile_id}"

            conn = sqlite3.connect(str(local_path), timeout=10)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # clip_teammates table must exist
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_teammates'")
            has_ct = cur.fetchone() is not None
            t.check(f"{label}: clip_teammates table exists", has_ct)

            if not has_ct:
                conn.close()
                continue

            # clip_teammates index must exist
            cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_clip_teammates_tag'")
            t.check(f"{label}: idx_clip_teammates_tag index exists", cur.fetchone() is not None)

            # raw_clips new columns
            clip_cols = {c["name"] for c in cur.execute("PRAGMA table_info(raw_clips)").fetchall()}
            for col in ("tagged_teammates", "my_athlete", "shared_by"):
                t.check(f"{label}: raw_clips.{col} exists", col in clip_cols)

            # clip_teammates consistency: every tagged clip should have entries
            cur.execute("SELECT COUNT(*) as cnt FROM raw_clips WHERE tagged_teammates IS NOT NULL")
            tagged_count = cur.fetchone()["cnt"]
            cur.execute("SELECT COUNT(DISTINCT clip_id) as cnt FROM clip_teammates")
            ct_clip_count = cur.fetchone()["cnt"]

            if tagged_count > 0:
                t.check(
                    f"{label}: clip_teammates populated ({ct_clip_count}/{tagged_count} clips)",
                    ct_clip_count == tagged_count,
                    f"expected {tagged_count} clips in clip_teammates, got {ct_clip_count}",
                )

                # Cross-check: every clip_teammates row references a valid raw_clips row
                cur.execute("""
                    SELECT ct.clip_id FROM clip_teammates ct
                    LEFT JOIN raw_clips rc ON rc.id = ct.clip_id
                    WHERE rc.id IS NULL
                """)
                orphaned = cur.fetchall()
                t.check(
                    f"{label}: no orphaned clip_teammates rows",
                    len(orphaned) == 0,
                    f"{len(orphaned)} orphaned rows",
                )

                # Cross-check: clip_teammates tags match raw_clips.tagged_teammates
                from app.utils.encoding import decode_data
                cur.execute(
                    "SELECT id, tagged_teammates FROM raw_clips WHERE tagged_teammates IS NOT NULL LIMIT 5"
                )
                mismatches = 0
                for row in cur.fetchall():
                    expected_tags = set(decode_data(row["tagged_teammates"]) or [])
                    cur.execute(
                        "SELECT tag_name FROM clip_teammates WHERE clip_id = ?", (row["id"],)
                    )
                    actual_tags = {r["tag_name"] for r in cur.fetchall()}
                    if expected_tags != actual_tags:
                        mismatches += 1
                t.check(
                    f"{label}: clip_teammates tags match raw_clips (sampled 5)",
                    mismatches == 0,
                    f"{mismatches} mismatches",
                )

            # No JSON text in BLOB columns (msgpack conversion complete)
            cur.execute("SELECT id, tags FROM raw_clips WHERE tags IS NOT NULL LIMIT 10")
            json_remnants = 0
            for row in cur.fetchall():
                val = row["tags"]
                if isinstance(val, str):
                    json_remnants += 1
                elif isinstance(val, bytes) and len(val) > 0 and val[0:1] in (b"[", b"{"):
                    json_remnants += 1
            t.check(
                f"{label}: raw_clips.tags is msgpack (not JSON)",
                json_remnants == 0,
                f"{json_remnants} rows still have JSON text",
            )

            # teammate_shares.shared_clip_ids column
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='teammate_shares'")
            if cur.fetchone():
                ts_cols = {c["name"] for c in cur.execute("PRAGMA table_info(teammate_shares)").fetchall()}
                t.check(f"{label}: teammate_shares.shared_clip_ids exists", "shared_clip_ids" in ts_cols)

                if "shared_clip_ids" in ts_cols:
                    # Validate JSON format
                    cur.execute("SELECT id, shared_clip_ids FROM teammate_shares")
                    bad_json = 0
                    for row in cur.fetchall():
                        try:
                            val = json.loads(row["shared_clip_ids"] or "[]")
                            if not isinstance(val, list):
                                bad_json += 1
                        except json.JSONDecodeError:
                            bad_json += 1
                    t.check(
                        f"{label}: teammate_shares.shared_clip_ids valid JSON",
                        bad_json == 0,
                        f"{bad_json} rows with invalid JSON",
                    )

            conn.close()


def test_all_sqlite(pg_conn, r2_client, bucket, app_env, t: MigrationTest):
    """Run SQLite tests for all users."""
    print("\n--- SQLite Tests ---")
    cur = pg_conn.cursor()
    cur.execute("SELECT user_id, email FROM users ORDER BY email")
    users = cur.fetchall()

    for user in users:
        print(f"  {user['email']}:")
        test_sqlite_for_user(
            r2_client, bucket, app_env,
            user["user_id"], user["email"], t,
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Post-migration verification tests")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    args = parser.parse_args()

    config = load_env(args.env)
    load_dotenv(
        BACKEND_DIR.parent.parent / (".env" if args.env == "dev" else f".env.{args.env}"),
        override=True,
    )

    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Post-migration tests for {args.env} (APP_ENV={app_env})")

    pg_conn = get_pg_conn(config)
    r2_client = get_r2_client(config)

    t = MigrationTest()

    test_postgres_schema(pg_conn, t)
    test_postgres_data(pg_conn, t)
    test_all_sqlite(pg_conn, r2_client, bucket, app_env, t)

    pg_conn.close()

    success = t.summary()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
