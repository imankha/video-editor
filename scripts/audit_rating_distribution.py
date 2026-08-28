"""
Audit the star-rating distribution of annotations (raw_clips) across all accounts.

Read-only: for staging/prod it downloads auth.sqlite + every profile.sqlite from
R2 to a temp directory (removed on exit); for dev it reads user_data/ directly.
It tallies COUNT(*) GROUP BY rating over every profile's raw_clips table and
reports the environment-wide 1-5 distribution, plus a per-account breakdown.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_distribution.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_distribution.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_distribution.py --env prod

Why this exists (T7930):
- A user asked how many annotations exist at each star rating. `raw_clips.rating`
  (1-5, application-default 4, `INTEGER NOT NULL` per database.py's profile_db
  schema) lives ONLY in each account's per-profile SQLite (raw_clips table), never
  in the aggregate Postgres analytics tables — so no dashboard can answer this and
  a cross-account script is required.
- `rating` is NOT NULL in the schema, so a NULL/unrated bucket is schema-impossible.
  The script still counts and reports NULLs SEPARATELY if any are found, as a
  schema-drift signal — it never silently folds them into a rating bucket.

Mirrors scripts/audit_clip_dimensions.py (env loading, R2 download, tempdir
cleanup, read-only `mode=ro` connections) rather than reinventing that boilerplate.
"""

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

# raw_clips.rating is a 1-5 star scale (database.py profile_db schema).
RATING_VALUES = (1, 2, 3, 4, 5)


def load_env(env_name: str) -> dict:
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
    for k in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        if k not in config:
            print(f"ERROR: {k} missing from {env_file}")
            sys.exit(1)
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


def download_remote_dbs(r2_client, bucket: str, app_env: str, dest: Path) -> tuple[Path, list[tuple[str, Path]]]:
    """Download auth.sqlite + all profile.sqlite from R2.

    Returns (auth_db_path, [(user_id, profile_db_path), ...]).
    """
    auth_local = dest / "auth.sqlite"
    auth_local.parent.mkdir(parents=True, exist_ok=True)
    r2_client.download_file(bucket, f"{app_env}/auth/auth.sqlite", str(auth_local))

    profiles: list[tuple[str, Path]] = []
    paginator = r2_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{app_env}/users/"):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith("profile.sqlite"):
                continue
            # key = {app_env}/users/{uid}/profiles/{pid}/profile.sqlite
            parts = key.split("/")
            if len(parts) < 6:
                continue
            user_id = parts[2]
            local = dest / "/".join(parts[2:])
            local.parent.mkdir(parents=True, exist_ok=True)
            r2_client.download_file(bucket, key, str(local))
            profiles.append((user_id, local))
    return auth_local, profiles


def collect_local_dbs() -> tuple[Path, list[tuple[str, Path]]]:
    """Walk user_data/ and return (auth_db, [(user_id, profile_db), ...])."""
    auth_db = USER_DATA / "auth.sqlite"
    profiles: list[tuple[str, Path]] = []
    if not USER_DATA.exists():
        return auth_db, profiles
    for user_dir in USER_DATA.iterdir():
        if not user_dir.is_dir() or user_dir.name == "auth.sqlite":
            continue
        prof_root = user_dir / "profiles"
        if not prof_root.exists():
            continue
        for db in prof_root.glob("*/profile.sqlite"):
            profiles.append((user_dir.name, db))
    return auth_db, profiles


def email_for_user(auth_db: Path, user_id: str) -> str | None:
    if not auth_db.exists():
        return None
    conn = sqlite3.connect(f"file:{auth_db}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT email FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def tally_ratings(db_path: Path) -> dict:
    """Return {rating_int_or_None: count} for one profile's raw_clips table.

    Read-only. Returns {} for a profile whose schema predates raw_clips (legacy),
    flagged separately by the caller via the 'missing_table' marker.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_table:
            return {"missing_table": True}
        counts: dict = {}
        for rating, n in conn.execute(
            "SELECT rating, COUNT(*) FROM raw_clips GROUP BY rating"
        ):
            counts[rating] = n  # rating may be None if a legacy row drifted NULL
        return counts
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Audit raw_clips star-rating distribution across all accounts"
    )
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    args = parser.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")

    tmpdir_ctx = None
    if args.env == "dev":
        auth_db, profiles = collect_local_dbs()
        print(f"Reading local user_data/ — {len(profiles)} profile DB(s)")
    else:
        tmpdir_ctx = tempfile.TemporaryDirectory(prefix="audit_rating_")
        dest = Path(tmpdir_ctx.name)
        print(f"Downloading DBs from R2 to {dest} ...")
        r2 = get_r2_client(config)
        auth_db, profiles = download_remote_dbs(r2, bucket, app_env, dest)
        print(f"Downloaded {len(profiles)} profile DB(s)")

    # Environment-wide tally.
    global_counts = {r: 0 for r in RATING_VALUES}
    null_count = 0
    unexpected_counts: dict = {}  # any rating value outside 1-5 (schema drift)
    legacy_profiles: list[tuple[str, str | None]] = []
    per_account: list[tuple[str, str | None, int, dict]] = []
    seen_users = set()

    try:
        for user_id, db_path in profiles:
            seen_users.add(user_id)
            counts = tally_ratings(db_path)
            if counts.get("missing_table"):
                legacy_profiles.append((user_id, email_for_user(auth_db, user_id)))
                continue

            account_total = 0
            for rating, n in counts.items():
                account_total += n
                if rating is None:
                    null_count += n
                elif rating in global_counts:
                    global_counts[rating] += n
                else:
                    unexpected_counts[rating] = unexpected_counts.get(rating, 0) + n

            if account_total > 0:
                per_account.append(
                    (user_id, email_for_user(auth_db, user_id), account_total, dict(counts))
                )
    finally:
        if tmpdir_ctx:
            tmpdir_ctx.cleanup()

    total_clips = sum(global_counts.values()) + null_count + sum(unexpected_counts.values())

    print()
    print(f"=== Star-rating distribution ({args.env}) ===")
    print(f"  users:            {len(seen_users)}")
    print(f"  profiles:         {len(profiles)}")
    print(f"  accounts w/clips: {len(per_account)}")
    print(f"  total raw_clips:  {total_clips}")
    print()
    for r in RATING_VALUES:
        n = global_counts[r]
        pct = (n / total_clips * 100) if total_clips else 0
        bar = "#" * int(round(pct / 2))  # each # ~= 2%
        print(f"  {r} star  {n:>7}  {pct:5.1f}%  {bar}")

    if null_count:
        pct = (null_count / total_clips * 100) if total_clips else 0
        print(f"  NULL     {null_count:>7}  {pct:5.1f}%  <-- SCHEMA DRIFT: rating is NOT NULL in schema")
    if unexpected_counts:
        print("  UNEXPECTED ratings outside 1-5 (SCHEMA DRIFT):")
        for rating in sorted(unexpected_counts):
            print(f"    rating={rating!r}: {unexpected_counts[rating]}")
    if legacy_profiles:
        print(f"\n  {len(legacy_profiles)} profile(s) have NO raw_clips table (pre-annotate schema):")
        for user_id, email in legacy_profiles[:20]:
            print(f"    - {user_id} ({email or '<unknown email>'})")
        if len(legacy_profiles) > 20:
            print(f"    ... +{len(legacy_profiles) - 20} more")

    # Per-account breakdown (accounts with clips), most clips first.
    if per_account:
        print("\n=== Per-account breakdown (accounts with clips) ===")
        per_account.sort(key=lambda t: t[2], reverse=True)
        for user_id, email, account_total, counts in per_account:
            label = email or "<unknown email>"
            dist = " ".join(
                f"{r}*:{counts.get(r, 0)}" for r in RATING_VALUES
            )
            extras = ""
            if counts.get(None):
                extras += f" NULL:{counts[None]}"
            print(f"  {account_total:>5}  {dist}{extras}  {label} ({user_id})")

    # Exit non-zero only on genuine schema drift (NULL or out-of-range ratings),
    # so CI/automation can treat a clean run as success.
    if null_count or unexpected_counts:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
