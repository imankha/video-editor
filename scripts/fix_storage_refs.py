"""
Fix orphaned/missing game_storage_refs for a user.

Compares Postgres game_storage_refs against the actual blake3 hashes in
the user's profile SQLite (games + game_videos tables) and reconciles.

Requires:
  - Fly proxy for prod Postgres: fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env.prod at project root

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\fix_storage_refs.py \\
        sarkarati@gmail.com --env prod
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\fix_storage_refs.py \\
        sarkarati@gmail.com --env prod --execute
"""

import argparse
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent


def load_env(env_name):
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)

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
            print(f"ERROR: {key} not found in {env_file}")
            sys.exit(1)

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


def get_pg_conn(config):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def get_sqlite_hashes(db_path: Path) -> dict[str, int]:
    """Return {blake3_hash: video_size} from games + game_videos tables."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    hashes = {}

    # Single-video games: hash is on the games row
    for row in conn.execute(
        "SELECT blake3_hash, video_size FROM games WHERE blake3_hash IS NOT NULL"
    ):
        hashes[row["blake3_hash"]] = row["video_size"] or 0

    # Multi-video games: hash is on game_videos rows
    for row in conn.execute(
        "SELECT blake3_hash, video_size FROM game_videos"
    ):
        hashes[row["blake3_hash"]] = row["video_size"] or 0

    conn.close()
    return hashes


def main():
    parser = argparse.ArgumentParser(description="Fix orphaned/missing game_storage_refs")
    parser.add_argument("email", help="User email")
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--execute", action="store_true",
                        help="Actually modify data (default is dry-run)")
    args = parser.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]

    print(f"Environment: {args.env} (APP_ENV={app_env})")
    if not args.execute:
        print("MODE: DRY RUN (pass --execute to modify)")
    else:
        print("MODE: EXECUTE (will modify Postgres)")

    r2_client = get_r2_client(config)
    pg_conn = get_pg_conn(config)
    cur = pg_conn.cursor()

    # 1. Look up user
    cur.execute("SELECT user_id FROM users WHERE email = %s", (args.email,))
    row = cur.fetchone()
    if not row:
        print(f"No user found with email '{args.email}'")
        pg_conn.close()
        sys.exit(1)

    user_id = row["user_id"]
    print(f"\nUser: {args.email} ({user_id})")

    # 2. Find profiles in R2
    prefix = f"{app_env}/users/{user_id}/profiles/"
    resp = r2_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
    profile_dbs = [
        obj["Key"] for obj in resp.get("Contents", [])
        if obj["Key"].endswith("profile.sqlite")
    ]

    if not profile_dbs:
        print(f"No profile databases found in R2 under {prefix}")
        pg_conn.close()
        sys.exit(1)

    # 3. For each profile, download SQLite and collect hashes
    all_profile_hashes: dict[str, dict[str, int]] = {}  # profile_id -> {hash: size}

    for r2_key in profile_dbs:
        parts = r2_key.split("/")
        profile_id = parts[-2]  # .../profiles/{profile_id}/profile.sqlite

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / "profile.sqlite"
            r2_client.download_file(bucket, r2_key, str(local_path))
            print(f"\nProfile: {profile_id}")
            print(f"  Downloaded: {r2_key}")

            hashes = get_sqlite_hashes(local_path)
            print(f"  Video hashes in SQLite: {len(hashes)}")
            for h, size in sorted(hashes.items()):
                print(f"    {h[:16]}... ({size:,} bytes)")

            all_profile_hashes[profile_id] = hashes

    # 4. Get current game_storage_refs from Postgres
    cur.execute(
        "SELECT id, profile_id, blake3_hash, game_size_bytes, storage_expires_at "
        "FROM game_storage_refs WHERE user_id = %s",
        (user_id,),
    )
    pg_refs = cur.fetchall()
    print(f"\nPostgres game_storage_refs: {len(pg_refs)} rows")
    for ref in pg_refs:
        print(f"  [{ref['id']}] profile={ref['profile_id']} "
              f"hash={ref['blake3_hash'][:16]}... "
              f"size={ref['game_size_bytes']:,} "
              f"expires={ref['storage_expires_at']}")

    # 5. Compute diff per profile
    orphaned = []  # refs in Postgres but not in SQLite
    missing = []   # hashes in SQLite but not in Postgres

    for profile_id, sqlite_hashes in all_profile_hashes.items():
        pg_hashes_for_profile = {
            ref["blake3_hash"] for ref in pg_refs if ref["profile_id"] == profile_id
        }

        for ref in pg_refs:
            if ref["profile_id"] == profile_id and ref["blake3_hash"] not in sqlite_hashes:
                orphaned.append(ref)

        for h, size in sqlite_hashes.items():
            if h not in pg_hashes_for_profile:
                missing.append({"profile_id": profile_id, "blake3_hash": h, "game_size_bytes": size})

    print(f"\n{'='*60}")
    print(f"DIFF SUMMARY")
    print(f"{'='*60}")

    if orphaned:
        print(f"\nORPHANED refs (in Postgres, NOT in SQLite) - will DELETE:")
        for ref in orphaned:
            print(f"  [{ref['id']}] hash={ref['blake3_hash'][:16]}... profile={ref['profile_id']}")
    else:
        print("\nNo orphaned refs.")

    if missing:
        print(f"\nMISSING refs (in SQLite, NOT in Postgres) - will INSERT:")
        for m in missing:
            print(f"  hash={m['blake3_hash'][:16]}... profile={m['profile_id']} size={m['game_size_bytes']:,}")
    else:
        print("\nNo missing refs.")

    if not orphaned and not missing:
        print("\nNothing to fix!")
        pg_conn.close()
        return

    # 6. Apply fixes
    if not args.execute:
        print(f"\nDRY RUN complete. Pass --execute to apply changes.")
        pg_conn.close()
        return

    print(f"\nApplying fixes...")

    expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    expires_str = expires_at.isoformat()

    for ref in orphaned:
        cur.execute("DELETE FROM game_storage_refs WHERE id = %s", (ref["id"],))
        print(f"  DELETED ref {ref['id']} (hash={ref['blake3_hash'][:16]}...)")

    for m in missing:
        cur.execute(
            """INSERT INTO game_storage_refs
                  (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id, profile_id, blake3_hash)
               DO UPDATE SET game_size_bytes = EXCLUDED.game_size_bytes,
                             storage_expires_at = EXCLUDED.storage_expires_at""",
            (user_id, m["profile_id"], m["blake3_hash"], m["game_size_bytes"], expires_str),
        )
        print(f"  INSERTED ref hash={m['blake3_hash'][:16]}... profile={m['profile_id']} expires={expires_str}")

    pg_conn.commit()
    pg_conn.close()

    print(f"\nDone. Fixed {len(orphaned)} orphaned + {len(missing)} missing refs for {args.email}.")


if __name__ == "__main__":
    main()
