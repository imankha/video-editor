#!/usr/bin/env python3
"""
Unified staging migration: runs all pending migrations for all users.

Performs in order:
  1. Postgres DDL: create new tables (shares, share_videos, share_games, pending_teammate_shares)
  2. Postgres DDL: add share_games metadata columns
  3. Postgres cleanup: drop dead shared_videos table, migrate clip_data JSONB->BYTEA
  4. Per-user SQLite: T2847 backfill clip_teammates + add_shared_clip_ids (all users)
  5. Postgres backfill: share_games metadata from sharer SQLite
  6. Verification: check all tables exist, columns present, data consistent

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging
    .venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging --dry-run
    .venv/Scripts/python.exe ../../scripts/migrations/migrate_staging.py --env staging --verify-only

Requires fly proxy running for staging:
    fly proxy 15432:5432 --app reel-ballers-db-staging
"""

import sys
import os
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


def checkpoint_and_upload(db_path, r2_client, bucket, r2_key):
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    r2_client.upload_file(str(db_path), bucket, r2_key)


# ---------------------------------------------------------------------------
# Step 1-3: Postgres migrations
# ---------------------------------------------------------------------------

# Full DDL from pg.py init_pg_schema -- only the new sharing tables
_NEW_TABLES_DDL = """
CREATE TABLE IF NOT EXISTS shares (
    id SERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    share_type TEXT NOT NULL CHECK (share_type IN ('video', 'game')),
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    watched_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(share_token);
CREATE INDEX IF NOT EXISTS idx_shares_sharer ON shares(sharer_user_id);
CREATE INDEX IF NOT EXISTS idx_shares_recipient ON shares(recipient_email);

CREATE TABLE IF NOT EXISTS share_videos (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL,
    video_filename TEXT NOT NULL,
    video_name TEXT,
    video_duration REAL,
    is_public BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_share_videos_video ON share_videos(video_id);

CREATE TABLE IF NOT EXISTS share_games (
    share_id INTEGER PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL,
    tag_name TEXT,
    recipient_profile_id TEXT,
    materialized_at TIMESTAMPTZ,
    game_name TEXT,
    game_blake3 TEXT,
    first_clip_start REAL,
    clip_names JSONB
);
CREATE INDEX IF NOT EXISTS idx_share_games_game ON share_games(game_id);
CREATE INDEX IF NOT EXISTS idx_share_games_recipient_profile ON share_games(recipient_profile_id);

CREATE TABLE IF NOT EXISTS pending_teammate_shares (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    sharer_user_id TEXT NOT NULL,
    sharer_profile_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    tag_name TEXT,
    clip_data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_profile_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_shares_email ON pending_teammate_shares(recipient_email);
CREATE INDEX IF NOT EXISTS idx_pending_shares_share ON pending_teammate_shares(share_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_shares_unique
ON pending_teammate_shares(share_id, game_id, tag_name)
WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_shares_email_unresolved
ON pending_teammate_shares(recipient_email) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shares_sharer_active
ON shares(sharer_user_id) WHERE revoked_at IS NULL;
"""


def run_postgres_migrations(pg_conn, dry_run: bool) -> list[str]:
    """Run all Postgres DDL + cleanup. Returns list of actions taken."""
    cur = pg_conn.cursor()
    actions = []

    # Step 1: Create new tables (IF NOT EXISTS -- safe to run always)
    print("\n=== Step 1: Postgres DDL -- create new sharing tables ===")
    if dry_run:
        for tbl in ("shares", "share_videos", "share_games", "pending_teammate_shares"):
            cur.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_name = %s", (tbl,)
            )
            exists = cur.fetchone() is not None
            status = "exists" if exists else "WILL CREATE"
            print(f"  {tbl}: {status}")
            if not exists:
                actions.append(f"create table {tbl}")
    else:
        cur.execute(_NEW_TABLES_DDL)
        pg_conn.commit()
        actions.append("created new sharing tables (IF NOT EXISTS)")
        print("  Done (CREATE TABLE IF NOT EXISTS for all sharing tables)")

    # Step 2: Add share_games metadata columns
    print("\n=== Step 2: Postgres DDL -- share_games metadata columns ===")
    for col, col_type in [
        ("game_name", "TEXT"),
        ("game_blake3", "TEXT"),
        ("first_clip_start", "REAL"),
        ("clip_names", "JSONB"),
    ]:
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'share_games' AND column_name = %s",
            (col,),
        )
        if cur.fetchone():
            print(f"  share_games.{col}: already exists")
        elif dry_run:
            print(f"  share_games.{col}: WILL ADD")
            actions.append(f"add column share_games.{col}")
        else:
            cur.execute(f"ALTER TABLE share_games ADD COLUMN {col} {col_type}")
            print(f"  share_games.{col}: added")
            actions.append(f"added column share_games.{col}")
    if not dry_run:
        pg_conn.commit()

    # Step 3a: Migrate pending_teammate_shares.clip_data JSONB -> BYTEA
    print("\n=== Step 3a: Postgres -- pending_teammate_shares clip_data JSONB->BYTEA ===")
    cur.execute("""
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'pending_teammate_shares' AND column_name = 'clip_data'
    """)
    row = cur.fetchone()
    if not row:
        print("  pending_teammate_shares.clip_data: column doesn't exist (table is new, already BYTEA)")
    elif row["data_type"] == "jsonb":
        if dry_run:
            cur.execute("SELECT COUNT(*) as cnt FROM pending_teammate_shares")
            cnt = cur.fetchone()["cnt"]
            print(f"  clip_data is JSONB -- WILL convert to BYTEA (deletes {cnt} rows)")
            actions.append("convert pending_teammate_shares.clip_data JSONB->BYTEA")
        else:
            cur.execute("DELETE FROM pending_teammate_shares")
            cur.execute("ALTER TABLE pending_teammate_shares ALTER COLUMN clip_data TYPE BYTEA USING ''::bytea")
            pg_conn.commit()
            print("  Converted clip_data from JSONB to BYTEA")
            actions.append("converted pending_teammate_shares.clip_data JSONB->BYTEA")
    else:
        print(f"  clip_data is already {row['data_type']}")

    # Step 3b: Drop dead shared_videos table
    print("\n=== Step 3b: Postgres -- drop dead shared_videos table ===")
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'shared_videos'"
    )
    if cur.fetchone():
        if dry_run:
            cur.execute("SELECT COUNT(*) as cnt FROM shared_videos")
            cnt = cur.fetchone()["cnt"]
            print(f"  shared_videos exists ({cnt} rows) -- WILL DROP")
            actions.append(f"drop table shared_videos ({cnt} rows)")
        else:
            cur.execute("DROP TABLE shared_videos")
            pg_conn.commit()
            print("  Dropped shared_videos table")
            actions.append("dropped dead shared_videos table")
    else:
        print("  shared_videos: already gone")

    return actions


# ---------------------------------------------------------------------------
# Step 4: Per-user SQLite migrations
# ---------------------------------------------------------------------------

def run_sqlite_migrations(pg_conn, r2_client, bucket, app_env, dry_run: bool) -> list[str]:
    """Run T2847 + add_shared_clip_ids for every user's SQLite. Returns actions."""
    from T2847_backfill_clip_teammates import backfill_clip_teammates
    from add_shared_clip_ids import migrate_shared_clip_ids

    cur = pg_conn.cursor()
    cur.execute("SELECT user_id, email FROM users ORDER BY email")
    users = cur.fetchall()

    if not users:
        print("\n=== Step 4: No users found -- skipping SQLite migrations ===")
        return []

    print(f"\n=== Step 4: SQLite migrations for {len(users)} user(s) ===")
    actions = []

    for user in users:
        user_id = user["user_id"]
        email = user["email"]
        print(f"\n  --- {email} ({user_id}) ---")

        prefix = f"{app_env}/users/{user_id}/profiles/"
        resp = r2_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        profile_dbs = [
            obj["Key"] for obj in resp.get("Contents", [])
            if obj["Key"].endswith("profile.sqlite")
        ]

        if not profile_dbs:
            print(f"    No profile.sqlite found in R2 -- skipping")
            actions.append(f"{email}: no profile DBs")
            continue

        with tempfile.TemporaryDirectory() as tmpdir:
            for r2_key in profile_dbs:
                parts = r2_key.split("/")
                profile_id = parts[-2]
                local_path = Path(tmpdir) / f"{profile_id}_profile.sqlite"

                print(f"    Profile {profile_id}: downloading...")
                r2_client.download_file(bucket, r2_key, str(local_path))

                # T2847: backfill clip_teammates (includes prerequisite column adds + msgpack conversion)
                print(f"    Profile {profile_id}: T2847 clip_teammates backfill...")
                t2847_count = backfill_clip_teammates(str(local_path), dry_run=dry_run)

                # add_shared_clip_ids (includes T2847 as prerequisite but it's idempotent)
                print(f"    Profile {profile_id}: add_shared_clip_ids...")
                clip_ids_count = migrate_shared_clip_ids(str(local_path), dry_run=dry_run)

                if not dry_run:
                    print(f"    Profile {profile_id}: uploading...")
                    checkpoint_and_upload(local_path, r2_client, bucket, r2_key)

                actions.append(
                    f"{email}/{profile_id}: "
                    f"clip_teammates={t2847_count}, shared_clip_ids={clip_ids_count}"
                )

    return actions


# ---------------------------------------------------------------------------
# Step 5: Postgres backfill (share_games metadata from sharer SQLite)
# ---------------------------------------------------------------------------

def run_share_games_backfill(pg_conn, r2_client, bucket, app_env, dry_run: bool) -> list[str]:
    """Backfill share_games metadata from sharer SQLite. Returns actions."""
    from add_share_games_metadata import backfill, add_columns

    cur = pg_conn.cursor()

    print("\n=== Step 5: Postgres backfill -- share_games metadata ===")
    cur.execute(
        "SELECT COUNT(*) as cnt FROM share_games WHERE game_name IS NULL"
    )
    null_count = cur.fetchone()["cnt"]

    if null_count == 0:
        print("  No share_games rows need backfill")
        return []

    print(f"  {null_count} share_games rows with NULL game_name")

    if dry_run:
        cur.execute(
            """SELECT sg.share_id, sg.game_id, sg.tag_name,
                      s.sharer_user_id, s.recipient_email
               FROM share_games sg
               JOIN shares s ON s.id = sg.share_id
               WHERE sg.game_name IS NULL"""
        )
        rows = cur.fetchall()
        for row in rows:
            print(f"    WILL backfill: share_id={row['share_id']} "
                  f"game_id={row['game_id']} tag={row['tag_name']} "
                  f"sharer={row['sharer_user_id'][:8]}... -> {row['recipient_email']}")
        return [f"would backfill {null_count} share_games rows"]

    backfill(cur, r2_client, bucket, app_env)
    pg_conn.commit()
    return [f"backfilled {null_count} share_games rows"]


# ---------------------------------------------------------------------------
# Step 6: Verification
# ---------------------------------------------------------------------------

def verify_postgres(pg_conn) -> list[str]:
    """Verify Postgres schema is correct. Returns list of issues."""
    cur = pg_conn.cursor()
    issues = []

    print("\n=== Verification: Postgres ===")

    # Check required tables exist
    required_tables = ["shares", "share_videos", "share_games", "pending_teammate_shares"]
    for tbl in required_tables:
        cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name = %s", (tbl,))
        if cur.fetchone():
            cur.execute(f"SELECT COUNT(*) as cnt FROM {tbl}")
            cnt = cur.fetchone()["cnt"]
            print(f"  {tbl}: OK ({cnt} rows)")
        else:
            print(f"  {tbl}: MISSING")
            issues.append(f"table {tbl} missing")

    # Check dead table is gone
    cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'shared_videos'")
    if cur.fetchone():
        print(f"  shared_videos: STILL EXISTS (should be dropped)")
        issues.append("dead table shared_videos still exists")
    else:
        print(f"  shared_videos: gone (OK)")

    # Check share_games metadata columns
    for col in ("game_name", "game_blake3", "first_clip_start", "clip_names"):
        cur.execute(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'share_games' AND column_name = %s",
            (col,),
        )
        row = cur.fetchone()
        if row:
            print(f"  share_games.{col}: OK ({row['data_type']})")
        else:
            print(f"  share_games.{col}: MISSING")
            issues.append(f"share_games.{col} column missing")

    # Check pending_teammate_shares.clip_data type
    cur.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = 'pending_teammate_shares' AND column_name = 'clip_data'"
    )
    row = cur.fetchone()
    if row:
        if row["data_type"] == "bytea":
            print(f"  pending_teammate_shares.clip_data: OK (bytea)")
        else:
            print(f"  pending_teammate_shares.clip_data: WRONG TYPE ({row['data_type']})")
            issues.append(f"pending_teammate_shares.clip_data is {row['data_type']}, expected bytea")
    else:
        print(f"  pending_teammate_shares.clip_data: MISSING")
        issues.append("pending_teammate_shares.clip_data column missing")

    # Check NULL metadata in share_games
    cur.execute("SELECT COUNT(*) as cnt FROM share_games WHERE game_name IS NULL")
    null_count = cur.fetchone()["cnt"]
    if null_count > 0:
        print(f"  share_games with NULL game_name: {null_count} (backfill incomplete)")
        issues.append(f"{null_count} share_games rows still have NULL game_name")
    else:
        cur.execute("SELECT COUNT(*) as cnt FROM share_games")
        total = cur.fetchone()["cnt"]
        print(f"  share_games metadata: all {total} rows backfilled")

    return issues


def verify_sqlite_for_user(r2_client, bucket, app_env, user_id, email) -> list[str]:
    """Download and verify a user's SQLite. Returns issues."""
    issues = []

    prefix = f"{app_env}/users/{user_id}/profiles/"
    resp = r2_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
    profile_dbs = [
        obj["Key"] for obj in resp.get("Contents", [])
        if obj["Key"].endswith("profile.sqlite")
    ]

    if not profile_dbs:
        print(f"    No profile DBs")
        return []

    with tempfile.TemporaryDirectory() as tmpdir:
        for r2_key in profile_dbs:
            parts = r2_key.split("/")
            profile_id = parts[-2]
            local_path = Path(tmpdir) / f"{profile_id}_profile.sqlite"
            r2_client.download_file(bucket, r2_key, str(local_path))

            conn = sqlite3.connect(str(local_path), timeout=10)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # Check clip_teammates table exists
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_teammates'")
            if not cur.fetchone():
                issues.append(f"{email}/{profile_id}: clip_teammates table missing")
                print(f"    {profile_id}: clip_teammates MISSING")
                conn.close()
                continue
            print(f"    {profile_id}: clip_teammates OK", end="")

            # Check clip_teammates has data if raw_clips has tagged_teammates
            cur.execute("SELECT COUNT(*) as cnt FROM raw_clips WHERE tagged_teammates IS NOT NULL")
            tagged_clips = cur.fetchone()["cnt"]
            cur.execute("SELECT COUNT(*) as cnt FROM clip_teammates")
            ct_rows = cur.fetchone()["cnt"]
            print(f" ({ct_rows} rows, {tagged_clips} clips with tags)", end="")

            if tagged_clips > 0 and ct_rows == 0:
                issues.append(f"{email}/{profile_id}: clip_teammates empty but {tagged_clips} tagged clips exist")
                print(" MISMATCH!")
            else:
                print()

            # Check raw_clips has new columns
            clip_cols = {c["name"] for c in cur.execute("PRAGMA table_info(raw_clips)").fetchall()}
            for col in ("tagged_teammates", "my_athlete", "shared_by"):
                if col not in clip_cols:
                    issues.append(f"{email}/{profile_id}: raw_clips.{col} column missing")
                    print(f"    {profile_id}: raw_clips.{col} MISSING")

            # Check teammate_shares has shared_clip_ids
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='teammate_shares'")
            if cur.fetchone():
                ts_cols = {c["name"] for c in cur.execute("PRAGMA table_info(teammate_shares)").fetchall()}
                if "shared_clip_ids" in ts_cols:
                    cur.execute("SELECT COUNT(*) as cnt FROM teammate_shares")
                    ts_count = cur.fetchone()["cnt"]
                    cur.execute("SELECT COUNT(*) as cnt FROM teammate_shares WHERE shared_clip_ids IS NULL OR shared_clip_ids = '[]'")
                    empty_count = cur.fetchone()["cnt"]
                    print(f"    {profile_id}: teammate_shares OK ({ts_count} rows, {empty_count} with empty clip_ids)")
                else:
                    issues.append(f"{email}/{profile_id}: teammate_shares.shared_clip_ids column missing")
                    print(f"    {profile_id}: teammate_shares.shared_clip_ids MISSING")

            # Check JSON->msgpack conversion (tags should be BLOB, not TEXT starting with '[')
            cur.execute("SELECT id, tags FROM raw_clips WHERE tags IS NOT NULL LIMIT 5")
            for row in cur.fetchall():
                val = row["tags"]
                if isinstance(val, str) or (isinstance(val, bytes) and len(val) > 0 and val[0:1] in (b"[", b"{")):
                    issues.append(f"{email}/{profile_id}: raw_clips.tags still JSON text (clip {row['id']})")
                    print(f"    {profile_id}: raw_clips.tags STILL JSON for clip {row['id']}")
                    break

            conn.close()

    return issues


def verify_all_sqlite(pg_conn, r2_client, bucket, app_env) -> list[str]:
    """Verify SQLite migrations for all users. Returns issues."""
    cur = pg_conn.cursor()
    cur.execute("SELECT user_id, email FROM users ORDER BY email")
    users = cur.fetchall()

    print(f"\n=== Verification: SQLite ({len(users)} users) ===")
    all_issues = []

    for user in users:
        print(f"  {user['email']}:")
        issues = verify_sqlite_for_user(
            r2_client, bucket, app_env, user["user_id"], user["email"]
        )
        all_issues.extend(issues)

    return all_issues


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Unified staging migration: all pending migrations for all users"
    )
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    parser.add_argument("--verify-only", action="store_true", help="Only run verification checks")
    parser.add_argument("--skip-sqlite", action="store_true", help="Skip per-user SQLite migrations")
    parser.add_argument("--skip-backfill", action="store_true", help="Skip share_games metadata backfill")
    args = parser.parse_args()

    if args.env == "prod" and not args.dry_run and not args.verify_only:
        print("*** PRODUCTION MIGRATION ***")
        print("This will modify production Postgres and all user SQLite databases in R2.")
        print("Ensure Fly machines are STOPPED before proceeding.")
        answer = input("Type 'yes' to continue: ").strip()
        if answer != "yes":
            print("Aborted.")
            sys.exit(0)

    config = load_env(args.env)
    load_dotenv(BACKEND_DIR.parent.parent / (".env" if args.env == "dev" else f".env.{args.env}"), override=True)

    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")
    if args.dry_run:
        print("*** DRY RUN -- no changes will be written ***")

    pg_conn = get_pg_conn(config)
    r2_client = get_r2_client(config)

    # Quick connectivity check
    cur = pg_conn.cursor()
    cur.execute("SELECT COUNT(*) as cnt FROM users")
    user_count = cur.fetchone()["cnt"]
    print(f"Connected to Postgres ({user_count} users)")

    all_actions = []
    all_issues = []

    if args.verify_only:
        all_issues.extend(verify_postgres(pg_conn))
        all_issues.extend(verify_all_sqlite(pg_conn, r2_client, bucket, app_env))
    else:
        # Step 1-3: Postgres DDL + cleanup
        pg_actions = run_postgres_migrations(pg_conn, dry_run=args.dry_run)
        all_actions.extend(pg_actions)

        # Step 4: Per-user SQLite migrations
        if not args.skip_sqlite:
            sqlite_actions = run_sqlite_migrations(
                pg_conn, r2_client, bucket, app_env, dry_run=args.dry_run
            )
            all_actions.extend(sqlite_actions)

        # Step 5: Postgres backfill (share_games metadata)
        if not args.skip_backfill:
            backfill_actions = run_share_games_backfill(
                pg_conn, r2_client, bucket, app_env, dry_run=args.dry_run
            )
            all_actions.extend(backfill_actions)

        # Step 6: Verification
        all_issues.extend(verify_postgres(pg_conn))
        if not args.skip_sqlite:
            all_issues.extend(verify_all_sqlite(pg_conn, r2_client, bucket, app_env))

    pg_conn.close()

    # Summary
    print(f"\n{'='*60}")
    if all_actions:
        print(f"Actions ({len(all_actions)}):")
        for a in all_actions:
            print(f"  - {a}")

    if all_issues:
        print(f"\nISSUES ({len(all_issues)}):")
        for issue in all_issues:
            print(f"  !! {issue}")
        print(f"\n{'='*60}")
        print("MIGRATION INCOMPLETE -- resolve issues above")
        sys.exit(1)
    else:
        print(f"\nNo issues found.")
        print(f"{'='*60}")
        if args.dry_run:
            print("DRY RUN complete. Re-run without --dry-run to apply.")
        elif args.verify_only:
            print("VERIFICATION PASSED.")
        else:
            print("MIGRATION COMPLETE.")


if __name__ == "__main__":
    main()
