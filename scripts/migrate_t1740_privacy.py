"""
T1740: Migrate auth DB for privacy compliance columns.

Adds terms_accepted_at and terms_version to the users table.

These columns are also added idempotently by auth_db.init_tables() on server
boot, so this script is only needed for manual pre-deploy verification or
for migrating R2-stored auth DBs without a server restart.

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_t1740_privacy.py
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\migrate_t1740_privacy.py --env prod
"""

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

NEW_COLUMNS = [
    "terms_accepted_at TEXT",
    "terms_version TEXT",
]


def migrate_auth_db(db_path: Path) -> int:
    """Add privacy columns to users table. Returns count of columns added."""
    if not db_path.exists():
        print(f"  Auth DB not found at {db_path}")
        return 0

    conn = sqlite3.connect(str(db_path))
    added = 0
    for col_def in NEW_COLUMNS:
        col_name = col_def.split()[0]
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
            added += 1
            print(f"  + Added column: {col_name}")
        except sqlite3.OperationalError:
            print(f"  = Column already exists: {col_name}")
    conn.commit()
    conn.close()
    return added


def migrate_r2(env_name: str) -> None:
    """Download auth DB from R2, migrate, re-upload."""
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError:
        print("boto3 not installed — skipping R2 migration")
        return

    from dotenv import load_dotenv
    import os

    load_dotenv(PROJECT_ROOT / ".env")

    endpoint = os.getenv("R2_ENDPOINT")
    access_key = os.getenv("R2_ACCESS_KEY_ID")
    secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket = os.getenv("R2_BUCKET", "reel-ballers-users")

    if not all([endpoint, access_key, secret_key]):
        print("R2 credentials not configured — skipping R2 migration")
        return

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 2}),
        region_name="auto",
    )

    env_map = {"prod": "production", "staging": "staging", "dev": "dev"}
    r2_prefix = env_map.get(env_name, env_name)
    r2_key = f"{r2_prefix}/auth/auth.sqlite"
    print(f"\n  Downloading {r2_key} from R2...")

    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        client.download_file(bucket, r2_key, str(tmp_path))
        print(f"  Downloaded to {tmp_path}")

        added = migrate_auth_db(tmp_path)
        if added > 0:
            print(f"  Re-uploading migrated DB to R2...")
            client.upload_file(str(tmp_path), bucket, r2_key)
            print(f"  Done — {added} column(s) added to R2 auth DB")
        else:
            print("  No changes needed — R2 auth DB already up to date")
    except client.exceptions.NoSuchKey:
        print(f"  R2 key {r2_key} not found — skipping")
    except Exception as e:
        print(f"  R2 migration failed: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="T1740: Migrate auth DB for privacy columns")
    parser.add_argument("--env", choices=["dev", "staging", "prod"], default=None,
                        help="Also migrate R2-stored auth DB for this environment")
    args = parser.parse_args()

    print("T1740 Privacy Compliance Migration")
    print("=" * 40)

    # Local auth DB
    print(f"\nLocal auth DB: {AUTH_DB}")
    migrate_auth_db(AUTH_DB)

    # R2 auth DB
    if args.env:
        migrate_r2(args.env)

    print("\nMigration complete.")


if __name__ == "__main__":
    main()
