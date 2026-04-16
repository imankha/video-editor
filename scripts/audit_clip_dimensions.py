"""
Audit clip dimensions across all accounts in an environment.

Read-only: downloads auth.sqlite + every profile.sqlite from R2 to a temp
directory and reports which game_videos / working_clips are missing
width/height/fps. Exits with code 1 if any are missing.

Usage (from project root):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_clip_dimensions.py --env dev
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_clip_dimensions.py --env staging
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\audit_clip_dimensions.py --env prod

For dev, reads directly from user_data/ (no download). For staging/prod,
downloads to a tempdir that is removed on exit.

Why this exists:
- T1500 added width/height/fps to working_clips so the frontend skips
  per-clip moov-box probes. T1531 fixed the project-creation path that
  was silently inserting NULL dims. This script verifies no account is
  still carrying NULL-dim rows after that fix.
"""

import argparse
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"


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


def audit_profile(db_path: Path) -> dict:
    """Return per-table counts and missing rows for one profile DB."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    def count(sql: str) -> int:
        return cur.execute(sql).fetchone()[0]

    result = {
        "game_videos_total": 0,
        "game_videos_missing": [],
        "working_clips_total": 0,
        "working_clips_missing": [],
    }

    # Schema may vary slightly across legacy DBs — guard by checking columns.
    def has_cols(table: str, cols: tuple[str, ...]) -> bool:
        existing = {r[1] for r in cur.execute(f"PRAGMA table_info({table})")}
        return all(c in existing for c in cols)

    if has_cols("game_videos", ("video_width", "video_height", "fps")):
        result["game_videos_total"] = count("SELECT COUNT(*) FROM game_videos")
        for r in cur.execute(
            "SELECT id, game_id, sequence, video_width, video_height, fps "
            "FROM game_videos "
            "WHERE video_width IS NULL OR video_height IS NULL OR fps IS NULL"
        ):
            result["game_videos_missing"].append(dict(r))

    if has_cols("working_clips", ("width", "height", "fps")):
        result["working_clips_total"] = count("SELECT COUNT(*) FROM working_clips")
        for r in cur.execute(
            "SELECT id, project_id, raw_clip_id, version, width, height, fps "
            "FROM working_clips "
            "WHERE width IS NULL OR height IS NULL OR fps IS NULL"
        ):
            result["working_clips_missing"].append(dict(r))
    else:
        # Legacy DB without T1500 schema: every row is "missing" by definition.
        result["working_clips_total"] = count("SELECT COUNT(*) FROM working_clips")
        result["legacy_no_dims_columns"] = True

    conn.close()
    return result


def main():
    parser = argparse.ArgumentParser(description="Audit clip dimensions across all accounts")
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
        tmpdir_ctx = tempfile.TemporaryDirectory(prefix="audit_dims_")
        dest = Path(tmpdir_ctx.name)
        print(f"Downloading DBs from R2 to {dest} ...")
        r2 = get_r2_client(config)
        auth_db, profiles = download_remote_dbs(r2, bucket, app_env, dest)
        print(f"Downloaded {len(profiles)} profile DB(s)")

    total_users = 0
    total_profiles = len(profiles)
    bad_profiles: list[tuple[str, str | None, Path, dict]] = []
    seen_users = set()

    for user_id, db_path in profiles:
        seen_users.add(user_id)
        email = email_for_user(auth_db, user_id)
        report = audit_profile(db_path)
        # An empty profile with the pre-T1500 schema is harmless — no rows means
        # nothing to migrate, and the next boot's migration will add the columns
        # before any insert. Only treat legacy schema as bad if it has rows.
        legacy_with_rows = (
            report.get("legacy_no_dims_columns")
            and report["working_clips_total"] > 0
        )
        is_bad = (
            report["game_videos_missing"]
            or report["working_clips_missing"]
            or legacy_with_rows
        )
        if is_bad:
            bad_profiles.append((user_id, email, db_path, report))

    total_users = len(seen_users)

    print()
    print(f"=== Summary ({args.env}) ===")
    print(f"  users:    {total_users}")
    print(f"  profiles: {total_profiles}")
    print(f"  clean:    {total_profiles - len(bad_profiles)}")
    print(f"  bad:      {len(bad_profiles)}")

    if not bad_profiles:
        print("\nAll accounts have dimensions populated for every game_video and working_clip.")
        if tmpdir_ctx:
            tmpdir_ctx.cleanup()
        sys.exit(0)

    print("\n=== Profiles with missing dims ===")
    for user_id, email, db_path, report in bad_profiles:
        label = email or "<unknown email>"
        print(f"\n- user={user_id} ({label})")
        print(f"  db: {db_path.name} (parent: {db_path.parent.name})")
        if report.get("legacy_no_dims_columns"):
            print(f"  LEGACY SCHEMA: working_clips has no width/height/fps columns")
        gv = report["game_videos_missing"]
        wc = report["working_clips_missing"]
        print(f"  game_videos: {len(gv)}/{report['game_videos_total']} missing")
        for r in gv[:10]:
            print(f"    gv id={r['id']} game={r['game_id']} seq={r['sequence']} "
                  f"({r['video_width']},{r['video_height']},{r['fps']})")
        if len(gv) > 10:
            print(f"    ... +{len(gv) - 10} more")
        print(f"  working_clips: {len(wc)}/{report['working_clips_total']} missing")
        for r in wc[:10]:
            print(f"    wc id={r['id']} project={r['project_id']} raw={r['raw_clip_id']} "
                  f"v={r['version']} ({r['width']},{r['height']},{r['fps']})")
        if len(wc) > 10:
            print(f"    ... +{len(wc) - 10} more")

    if tmpdir_ctx:
        tmpdir_ctx.cleanup()
    sys.exit(1)


if __name__ == "__main__":
    main()
