"""
T9680 follow-up: estimate a real credit budget from a real account's data (READ-ONLY).

Background
----------
T9680 originally asked "does a new account get enough free credits?" as a yes/no
question against the current 88-credit grant. The user reframed it as a real product
question instead: size the free-credit grant so it covers uploading N games and
producing (rendering via Focus) every marked play in the most-annotated of them,
using a REAL account's REAL data as the basis - not a guess.

This script:
  1. Looks up the given account by email in Postgres.
  2. Downloads that account's profile.sqlite(s) from R2 (read-only - never uploads
     anything back).
  3. Lists every 'ready' game with its clip (marked play) count, sorted so the most
     annotated games sort first (a proxy for "fully annotated" - there is no explicit
     flag for it, so eyeball the printed list rather than trusting the top N blindly).
  4. For the top --games games (default 3), computes:
       - upload cost per game: calculate_upload_cost(total video bytes), same formula
         as services/storage_credits.py (duplicated here as a pure function so this
         script has zero app-import dependency)
       - production cost: sum of ceil(end_time - start_time) across every marked play
         in that game (the Focus/AI-render rate - see highlight_transform.py's
         compute_export_credits, also flat ceil(seconds) at 30fps)
  5. Prints a per-game breakdown plus the 3-game total, so a real free-credit number
     can be picked against real usage rather than an assumption.

This is READ-ONLY end to end: SELECT-only Postgres queries, R2 GetObject only (never
PutObject/DeleteObject), and profile.sqlite is opened read-only (`?mode=ro`) after
download so even a bug here cannot write back to the downloaded copy, let alone R2.

Usage
-----
Requires a Fly proxy tunnel to prod Postgres (same convention as
scripts/verify_t9680_credits.py / scripts/copy_user_between_envs.py):

    fly proxy 15433:5432 --app reel-ballers-db-prod

then, from a shell with R2 access + the fly proxy already up:

    cd src/backend && .venv/Scripts/python.exe ../../scripts/estimate_credit_budget_for_user.py \\
        imankh@gmail.com --env production --games 3
"""
import argparse
import math
import sqlite3
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent

# Mirrors services/storage_credits.py exactly (duplicated so this script has no
# app-import dependency - see that module for the authoritative version/comments).
STORAGE_DURATION_DAYS = 30
AUTO_EXPORT_SURCHARGE = 1


def calculate_upload_cost(file_size_bytes: int, days: int = STORAGE_DURATION_DAYS) -> int:
    size_gb = file_size_bytes / (1024 ** 3)
    storage_cost = max(1, math.ceil(size_gb * 0.015 * (days / 30) * 1.10 / 0.05))
    return storage_cost + AUTO_EXPORT_SURCHARGE


def production_cost(start_time: float, end_time: float) -> int:
    """Mirrors highlight_transform.py's compute_export_credits at 30fps: ceil(seconds)."""
    seconds = (end_time or 0) - (start_time or 0)
    if seconds <= 0:
        return 0
    return math.ceil(seconds)


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    env_file = PROJECT_ROOT / f".env{suffix}"
    if not env_file.exists():
        print(f"ERROR: {env_file} not found", file=sys.stderr)
        sys.exit(1)
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
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                       connect_timeout=10, read_timeout=60),
        region_name="auto",
    )


def list_profile_sqlite_keys(r2, bucket: str, env_prefix: str, user_id: str) -> list[str]:
    prefix = f"{env_prefix}/users/{user_id}/profiles/"
    keys = []
    paginator = r2.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith("/profile.sqlite"):
                keys.append(obj["Key"])
    return keys


def analyze_profile_db(db_path: Path) -> list[dict]:
    """Returns one dict per 'ready' game: id, name, total_bytes, clip_count, clip_seconds."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT id, name, video_size FROM games WHERE status = 'ready'")
    games = {row["id"]: dict(row) for row in cur.fetchall()}

    # Prefer game_videos totals (multi-video games); fall back to the legacy
    # single-video games.video_size when a game has no game_videos rows.
    cur.execute("SELECT game_id, SUM(video_size) AS total FROM game_videos GROUP BY game_id")
    for row in cur.fetchall():
        if row["game_id"] in games and row["total"]:
            games[row["game_id"]]["video_size"] = row["total"]

    cur.execute("SELECT game_id, start_time, end_time FROM raw_clips WHERE game_id IS NOT NULL")
    for row in cur.fetchall():
        g = games.get(row["game_id"])
        if g is None:
            continue
        g.setdefault("clip_count", 0)
        g.setdefault("clip_seconds_ceil_sum", 0)
        g["clip_count"] += 1
        g["clip_seconds_ceil_sum"] += production_cost(row["start_time"], row["end_time"])

    conn.close()
    return [
        {
            "id": gid,
            "name": g["name"],
            "video_bytes": g.get("video_size") or 0,
            "clip_count": g.get("clip_count", 0),
            "production_credits": g.get("clip_seconds_ceil_sum", 0),
        }
        for gid, g in games.items()
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("--env", default="production", choices=["dev", "staging", "production"])
    parser.add_argument("--games", type=int, default=3, help="How many top-annotated games to budget for")
    args = parser.parse_args()

    config = load_env(args.env)

    import psycopg2
    from psycopg2.extras import RealDictCursor
    pg = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)
    pg.set_session(readonly=True, autocommit=True)
    cur = pg.cursor()
    cur.execute("SELECT user_id, email FROM users WHERE email = %s", (args.email,))
    user_row = cur.fetchone()
    pg.close()
    if not user_row:
        print(f"ERROR: {args.email} not found in {args.env} Postgres", file=sys.stderr)
        sys.exit(1)
    user_id = user_row["user_id"]
    print(f"User: {args.email} ({user_id})\n")

    r2 = get_r2_client(config)
    bucket = config["R2_BUCKET"]
    profile_keys = list_profile_sqlite_keys(r2, bucket, config["APP_ENV"], user_id)
    if not profile_keys:
        print(f"ERROR: no profile.sqlite found under {config['APP_ENV']}/users/{user_id}/profiles/", file=sys.stderr)
        sys.exit(1)
    print(f"Found {len(profile_keys)} profile(s).\n")

    all_games = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, key in enumerate(profile_keys):
            local = Path(tmp) / f"profile_{i}.sqlite"
            r2.download_file(bucket, key, str(local))
            games = analyze_profile_db(local)
            profile_id = key.split("/profiles/")[1].split("/")[0]
            for g in games:
                g["profile_id"] = profile_id
            all_games.extend(games)

    all_games.sort(key=lambda g: g["clip_count"], reverse=True)

    print("=" * 78)
    print(f"All 'ready' games, sorted by clip (marked play) count - eyeball this list,")
    print(f"the top N is a PROXY for 'fully annotated', not a certainty:")
    print("=" * 78)
    print(f"{'id':>5}  {'profile':>10}  {'clips':>6}  {'MB':>8}  {'name'}")
    for g in all_games:
        mb = g["video_bytes"] / (1024 * 1024)
        print(f"{g['id']:>5}  {g['profile_id']:>10}  {g['clip_count']:>6}  {mb:>8.1f}  {g['name']}")

    top = all_games[: args.games]
    print()
    print("=" * 78)
    print(f"Budget for the top {len(top)} game(s) by clip count")
    print("=" * 78)
    total_upload = 0
    total_production = 0
    total_clips = 0
    for g in top:
        upload_credits = calculate_upload_cost(g["video_bytes"]) if g["video_bytes"] else 0
        total_upload += upload_credits
        total_production += g["production_credits"]
        total_clips += g["clip_count"]
        print(
            f"  game {g['id']:>5}  {g['name']:<40}  "
            f"upload={upload_credits:>3}  clips={g['clip_count']:>3}  "
            f"produce-all={g['production_credits']:>4}  "
            f"subtotal={upload_credits + g['production_credits']:>4}"
        )
    print()
    print(f"  TOTAL upload credits (all {len(top)} games):        {total_upload}")
    print(f"  TOTAL production credits (all {total_clips} clips): {total_production}")
    print(f"  GRAND TOTAL:                                        {total_upload + total_production}")
    print()
    print("This is a READ-ONLY report - nothing was written to Postgres, R2, or the")
    print("downloaded profile copies (opened `?mode=ro`).")


if __name__ == "__main__":
    main()
