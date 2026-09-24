"""
Cross-tab star rating against export status: for every raw_clip, was it ever
exported (a working_clips row for it has exported_at NOT NULL)?

Read-only: for staging/prod it downloads auth.sqlite + every profile.sqlite from
R2 to a temp directory (removed on exit); for dev it reads user_data/ directly.
Mirrors scripts/audit_rating_distribution.py's env loading, R2 download, tempdir
cleanup, and read-only `mode=ro` connections rather than reinventing that
boilerplate.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_export_correlation.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_export_correlation.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_rating_export_correlation.py --env prod

"Exported" = at least one working_clips row for the raw_clip has exported_at
NOT NULL (the same predicate clip_phases.py uses for "focused" -- a raw_clip
can have multiple working_clips versions across re-framings, so this is an
EXISTS check per raw_clip, never a raw join that would double count).

rating is nullable since v054 (profile_db); NULL = unrated, reported as its
own bucket rather than folded into any star value.
"""

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

RATING_VALUES = (5, 4, 3, 2, 1)
RATING_ADJECTIVES = {5: "Brilliant", 4: "Good", 3: "Interesting", 2: "Technical Lapse", 1: "Mental Lapse"}


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


def download_remote_dbs(r2_client, bucket: str, app_env: str, dest: Path) -> list[Path]:
    profiles: list[Path] = []
    paginator = r2_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{app_env}/users/"):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith("profile.sqlite"):
                continue
            parts = key.split("/")
            if len(parts) < 6:
                continue
            local = dest / "/".join(parts[2:])
            local.parent.mkdir(parents=True, exist_ok=True)
            r2_client.download_file(bucket, key, str(local))
            profiles.append(local)
    return profiles


def collect_local_dbs() -> list[Path]:
    profiles: list[Path] = []
    if not USER_DATA.exists():
        return profiles
    for user_dir in USER_DATA.iterdir():
        if not user_dir.is_dir() or user_dir.name == "auth.sqlite":
            continue
        prof_root = user_dir / "profiles"
        if not prof_root.exists():
            continue
        for db in prof_root.glob("*/profile.sqlite"):
            profiles.append(db)
    return profiles


def tally(db_path: Path) -> list[tuple]:
    """Return [(rating_or_None, exported_bool), ...] one row per raw_clip."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_table:
            return []
        rows = conn.execute(
            """
            SELECT rc.rating,
                   EXISTS(
                       SELECT 1 FROM working_clips wc
                       WHERE wc.raw_clip_id = rc.id AND wc.exported_at IS NOT NULL
                   ) AS exported
            FROM raw_clips rc
            """
        ).fetchall()
        return [(r, bool(e)) for r, e in rows]
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Cross-tab raw_clips.rating against working_clips export status"
    )
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    args = parser.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")

    tmpdir_ctx = None
    if args.env == "dev":
        profiles = collect_local_dbs()
        print(f"Reading local user_data/ - {len(profiles)} profile DB(s)")
    else:
        tmpdir_ctx = tempfile.TemporaryDirectory(prefix="audit_rating_export_")
        dest = Path(tmpdir_ctx.name)
        print(f"Downloading profile DBs from R2 to {dest} ...")
        r2 = get_r2_client(config)
        profiles = download_remote_dbs(r2, bucket, app_env, dest)
        print(f"Downloaded {len(profiles)} profile DB(s)")

    # (rating_or_None, exported_bool) -> count
    cross: dict = {}

    try:
        for db_path in profiles:
            for rating, exported in tally(db_path):
                key = (rating, exported)
                cross[key] = cross.get(key, 0) + 1
    finally:
        if tmpdir_ctx:
            tmpdir_ctx.cleanup()

    def count(rating, exported):
        return cross.get((rating, exported), 0)

    all_ratings = list(RATING_VALUES) + [None]
    total_exported = sum(count(r, True) for r in all_ratings)
    total_not_exported = sum(count(r, False) for r in all_ratings)
    total_clips = total_exported + total_not_exported

    print()
    print(f"=== Rating x Export cross-tab ({args.env}) ===")
    print(f"  total raw_clips:     {total_clips}")
    print(f"  total exported:      {total_exported}")
    print(f"  total not exported:  {total_not_exported}")

    print()
    print("--- % of EXPORTED clips at each rating (of exported clips, what star was it?) ---")
    for r in all_ratings:
        n = count(r, True)
        pct = (n / total_exported * 100) if total_exported else 0
        label = f"{r} star ({RATING_ADJECTIVES[r]})" if r in RATING_ADJECTIVES else "unrated (NULL)"
        print(f"  {label:<28} {n:>7}  {pct:5.1f}%")

    print()
    print("--- % of clips AT EACH RATING that were exported (of that star, how many got exported?) ---")
    for r in all_ratings:
        exported_n = count(r, True)
        not_exported_n = count(r, False)
        rating_total = exported_n + not_exported_n
        pct = (exported_n / rating_total * 100) if rating_total else 0
        label = f"{r} star ({RATING_ADJECTIVES[r]})" if r in RATING_ADJECTIVES else "unrated (NULL)"
        print(f"  {label:<28} {exported_n:>6}/{rating_total:<6}  {pct:5.1f}% exported")

    sys.exit(0)


if __name__ == "__main__":
    main()
