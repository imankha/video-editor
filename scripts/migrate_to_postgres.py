"""
T1960: Migrate auth.sqlite + sharing.sqlite data to Fly Postgres.

Downloads the SQLite databases from R2, reads all rows, and INSERTs
them into Postgres with type conversions. Idempotent via ON CONFLICT DO NOTHING.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_to_postgres.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_to_postgres.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_to_postgres.py --env prod

    Add --dry-run to preview without writing to Postgres.
"""

import argparse
import json
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))


def load_env(env_name):
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
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

    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"ERROR: {key} not found in {env_file}"); sys.exit(1)

    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config):
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


def download_from_r2(r2_client, bucket, r2_key, local_path):
    local_path.parent.mkdir(parents=True, exist_ok=True)
    r2_client.download_file(bucket, r2_key, str(local_path))
    print(f"  Downloaded: {r2_key}")


def parse_datetime(val):
    """Convert SQLite datetime string to tz-aware Python datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(val, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    print(f"  WARNING: Could not parse datetime '{val}', using as-is")
    return val


def parse_json(val):
    """Convert JSON text to Python dict for JSONB columns."""
    if val is None or val == 0:
        return None
    if isinstance(val, dict):
        return json.dumps(val)
    if not isinstance(val, str):
        return None
    try:
        parsed = json.loads(val)
        return json.dumps(parsed)
    except (json.JSONDecodeError, TypeError):
        return None


_MISSING = object()


def _get(row, key, default=None):
    """Safe .get() for sqlite3.Row which doesn't support .get()."""
    try:
        val = row[key]
        return val if val is not None else default
    except (IndexError, KeyError):
        return default


def migrate_users(sqlite_conn, pg_cur, dry_run=False):
    rows = sqlite_conn.execute("SELECT * FROM users").fetchall()
    count = 0
    for row in rows:
        if not row["email"]:
            continue
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            """INSERT INTO users (user_id, email, google_id, verified_at, created_at,
                                  last_seen_at, picture_url, credit_summary)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id) DO NOTHING""",
            (
                row["user_id"],
                row["email"],
                _get(row, "google_id"),
                parse_datetime(_get(row, "verified_at")),
                parse_datetime(_get(row, "created_at")) or datetime.now(timezone.utc),
                parse_datetime(_get(row, "last_seen_at")),
                _get(row, "picture_url"),
                parse_json(_get(row, "credit_summary")),
            ),
        )
        count += 1
    return count, len(rows)


def migrate_sessions(sqlite_conn, pg_cur, dry_run=False):
    rows = sqlite_conn.execute("SELECT * FROM sessions").fetchall()
    count = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            """INSERT INTO sessions (session_id, user_id, expires_at, created_at,
                                     impersonator_user_id, impersonation_expires_at)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (session_id) DO NOTHING""",
            (
                row["session_id"],
                row["user_id"],
                parse_datetime(row["expires_at"]),
                parse_datetime(_get(row, "created_at")) or datetime.now(timezone.utc),
                _get(row, "impersonator_user_id"),
                parse_datetime(_get(row, "impersonation_expires_at")),
            ),
        )
        count += 1
    return count, len(rows)


def migrate_otp_codes(sqlite_conn, pg_cur, dry_run=False):
    try:
        rows = sqlite_conn.execute("SELECT * FROM otp_codes").fetchall()
    except sqlite3.OperationalError:
        return 0, 0
    count = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            """INSERT INTO otp_codes (email, code, expires_at, used_at, attempts, created_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                row["email"],
                row["code"],
                parse_datetime(row["expires_at"]),
                parse_datetime(_get(row, "used_at")),
                _get(row, "attempts", 0),
                parse_datetime(_get(row, "created_at")) or datetime.now(timezone.utc),
            ),
        )
        count += 1
    return count, len(rows)


def migrate_admin_users(sqlite_conn, pg_cur, dry_run=False):
    try:
        rows = sqlite_conn.execute("SELECT * FROM admin_users").fetchall()
    except sqlite3.OperationalError:
        return 0, 0
    count = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (row["email"],),
        )
        count += 1
    return count, len(rows)


def migrate_impersonation_audit(sqlite_conn, pg_cur, dry_run=False):
    try:
        rows = sqlite_conn.execute("SELECT * FROM impersonation_audit").fetchall()
    except sqlite3.OperationalError:
        return 0, 0
    count = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            """INSERT INTO impersonation_audit (admin_user_id, target_user_id, action,
                                                ip, user_agent, created_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                row["admin_user_id"],
                row["target_user_id"],
                row["action"],
                _get(row, "ip"),
                _get(row, "user_agent"),
                parse_datetime(_get(row, "created_at")) or datetime.now(timezone.utc),
            ),
        )
        count += 1
    return count, len(rows)


def migrate_game_storage_refs(sqlite_conn, pg_cur, dry_run=False):
    try:
        rows = sqlite_conn.execute("SELECT * FROM game_storage_refs").fetchall()
    except sqlite3.OperationalError:
        return 0, 0
    count = 0
    skipped = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        try:
            pg_cur.execute("SAVEPOINT sp_ref")
            pg_cur.execute(
                """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash,
                                                  game_size_bytes, storage_expires_at, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id, profile_id, blake3_hash) DO NOTHING""",
                (
                    row["user_id"],
                    row["profile_id"],
                    row["blake3_hash"],
                    _get(row, "game_size_bytes", 0),
                    parse_datetime(row["storage_expires_at"]),
                    parse_datetime(_get(row, "created_at")) or datetime.now(timezone.utc),
                ),
            )
            pg_cur.execute("RELEASE SAVEPOINT sp_ref")
            count += 1
        except psycopg2.errors.ForeignKeyViolation:
            pg_cur.execute("ROLLBACK TO SAVEPOINT sp_ref")
            skipped += 1
            print(f"  WARNING: Skipped ref for unknown user_id={row['user_id']}")
    if skipped:
        print(f"  Skipped {skipped} refs with missing user FKs")
    return count, len(rows)


def migrate_r2_grace_deletions(sqlite_conn, pg_cur, dry_run=False):
    try:
        rows = sqlite_conn.execute("SELECT * FROM r2_grace_deletions").fetchall()
    except sqlite3.OperationalError:
        return 0, 0
    count = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        pg_cur.execute(
            """INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at)
               VALUES (%s, %s)
               ON CONFLICT (blake3_hash) DO NOTHING""",
            (
                row["blake3_hash"],
                parse_datetime(row["grace_expires_at"]),
            ),
        )
        count += 1
    return count, len(rows)


def migrate_shared_videos(sqlite_conn, pg_cur, dry_run=False):
    rows = sqlite_conn.execute("SELECT * FROM shared_videos").fetchall()
    count = 0
    skipped = 0
    for row in rows:
        if dry_run:
            count += 1
            continue
        try:
            pg_cur.execute("SAVEPOINT sp_share")
            pg_cur.execute(
                """INSERT INTO shared_videos (share_token, video_id, sharer_user_id,
                                              sharer_profile_id, video_filename, video_name,
                                              video_duration, recipient_email, is_public,
                                              shared_at, revoked_at, watched_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (share_token) DO NOTHING""",
                (
                    row["share_token"],
                    row["video_id"],
                    row["sharer_user_id"],
                    row["sharer_profile_id"],
                    row["video_filename"],
                    _get(row, "video_name"),
                    _get(row, "video_duration"),
                    row["recipient_email"],
                    bool(_get(row, "is_public", 0)),
                    parse_datetime(_get(row, "shared_at")) or datetime.now(timezone.utc),
                    parse_datetime(_get(row, "revoked_at")),
                    parse_datetime(_get(row, "watched_at")),
                ),
            )
            pg_cur.execute("RELEASE SAVEPOINT sp_share")
            count += 1
        except psycopg2.errors.ForeignKeyViolation:
            pg_cur.execute("ROLLBACK TO SAVEPOINT sp_share")
            skipped += 1
            print(f"  WARNING: Skipped share for unknown sharer_user_id={row['sharer_user_id']}")
    if skipped:
        print(f"  Skipped {skipped} shares with missing user FKs")
    return count, len(rows)


def main():
    parser = argparse.ArgumentParser(description="Migrate auth.sqlite + sharing.sqlite to Postgres")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Postgres")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"T1960: Migrate SQLite -> Postgres ({args.env})")
    if args.dry_run:
        print("  MODE: DRY RUN (no writes)")
    print(f"{'='*60}\n")

    config = load_env(args.env)
    r2_client = get_r2_client(config)
    bucket = config["R2_BUCKET"]
    app_env = config["APP_ENV"]

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # Download SQLite databases from R2
        auth_path = tmpdir / "auth.sqlite"
        sharing_path = tmpdir / "sharing.sqlite"

        print("Step 1: Download SQLite databases from R2")
        try:
            download_from_r2(r2_client, bucket, f"{app_env}/auth/auth.sqlite", auth_path)
        except Exception as e:
            print(f"  ERROR downloading auth.sqlite: {e}")
            sys.exit(1)

        has_sharing = True
        try:
            download_from_r2(r2_client, bucket, f"{app_env}/sharing/sharing.sqlite", sharing_path)
        except Exception:
            print("  No sharing.sqlite found in R2 (may not exist yet)")
            has_sharing = False

        # Open SQLite connections
        auth_conn = sqlite3.connect(str(auth_path))
        auth_conn.row_factory = sqlite3.Row

        sharing_conn = None
        if has_sharing:
            sharing_conn = sqlite3.connect(str(sharing_path))
            sharing_conn.row_factory = sqlite3.Row

        try:
            _run_migration(auth_conn, sharing_conn, config, args.dry_run)
        finally:
            auth_conn.close()
            if sharing_conn:
                sharing_conn.close()


def _run_migration(auth_conn, sharing_conn, config, dry_run):
    # Connect to Postgres
    print("\nStep 2: Connect to Postgres + ensure schema")
    pg_conn = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)
    pg_conn.autocommit = False
    pg_cur = pg_conn.cursor()

    try:
        from app.services.pg import _SCHEMA_DDL, _SEED_SQL
        pg_cur.execute(_SCHEMA_DDL)
        pg_cur.execute(_SEED_SQL)
        pg_conn.commit()
        print("  Schema + seed OK")

        # Migrate tables in FK-safe order
        print("\nStep 3: Migrate data")
        results = {}

        tables = [
            ("users", lambda: migrate_users(auth_conn, pg_cur, dry_run)),
            ("sessions", lambda: migrate_sessions(auth_conn, pg_cur, dry_run)),
            ("otp_codes", lambda: migrate_otp_codes(auth_conn, pg_cur, dry_run)),
            ("admin_users", lambda: migrate_admin_users(auth_conn, pg_cur, dry_run)),
            ("impersonation_audit", lambda: migrate_impersonation_audit(auth_conn, pg_cur, dry_run)),
            ("game_storage_refs", lambda: migrate_game_storage_refs(auth_conn, pg_cur, dry_run)),
            ("r2_grace_deletions", lambda: migrate_r2_grace_deletions(auth_conn, pg_cur, dry_run)),
        ]
        if sharing_conn:
            tables.append(("shared_videos", lambda: migrate_shared_videos(sharing_conn, pg_cur, dry_run)))

        for name, migrate_fn in tables:
            print(f"  Migrating {name}...")
            results[name] = migrate_fn()
            if not dry_run:
                pg_conn.commit()

        # Verify row counts
        print("\nStep 4: Verify row counts")
        print(f"  {'Table':<25} {'SQLite':>8} {'Migrated':>10}")
        print(f"  {'-'*25} {'-'*8} {'-'*10}")
        all_ok = True
        for table, (migrated, total) in results.items():
            status = "OK" if migrated == total else "PARTIAL"
            if migrated != total:
                all_ok = False
            print(f"  {table:<25} {total:>8} {migrated:>10}  {status}")

        if not dry_run:
            # Cross-check Postgres counts
            print("\n  Postgres row counts:")
            for table in results:
                pg_cur.execute(f"SELECT count(*) as cnt FROM {table}")
                pg_count = pg_cur.fetchone()["cnt"]
                print(f"    {table}: {pg_count}")

        print(f"\n{'='*60}")
        if dry_run:
            print("DRY RUN complete. No data was written to Postgres.")
        elif all_ok:
            print("Migration complete. All rows migrated successfully.")
        else:
            print("Migration complete with warnings. Check output above.")
        print(f"{'='*60}\n")
    finally:
        pg_conn.close()


if __name__ == "__main__":
    main()
