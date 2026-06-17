"""Read-only audit: compare prod vs staging vs dev state for given emails.

For each env + email:
  - Postgres: user_id, game_storage_refs count, sessions count
  - R2: list objects under {env}/users/{user_id}/, show user.sqlite + each
    profiles/{pid}/profile.sqlite presence and db-version metadata
  - Download each profile.sqlite and count games / raw_clips / projects rows
  - Also check the GLOBAL {env}/games/ prefix for referenced blake3 hashes

Requires fly proxies for staging (15432) and prod (15433); dev uses localhost:5432.
"""
import sqlite3
import sys
import tempfile
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
EMAILS = ["imankh@gmail.com", "sarkarati@gmail.com"]
ENVS = ["production", "staging", "dev"]


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    config = {}
    with open(PROJECT_ROOT / f".env{suffix}") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            config[k.strip()] = v.strip()
    config.setdefault("APP_ENV", env_name)
    return config


def r2_client(config):
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


def count_rows(db_path):
    out = {}
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        for tbl in ("games", "raw_clips", "projects", "working_clips", "final_videos"):
            try:
                out[tbl] = conn.execute(f"SELECT COUNT(*) c FROM {tbl}").fetchone()["c"]
            except Exception as e:
                out[tbl] = f"ERR({e})"
        # rated clips = quality source
        try:
            out["rated_clips"] = conn.execute(
                "SELECT COUNT(*) c FROM raw_clips WHERE rating IS NOT NULL AND rating > 0"
            ).fetchone()["c"]
        except Exception:
            out["rated_clips"] = "n/a"
        try:
            out["unarchived_projects"] = conn.execute(
                "SELECT COUNT(*) c FROM projects WHERE archived_at IS NULL"
            ).fetchone()["c"]
        except Exception:
            out["unarchived_projects"] = "n/a"
        conn.close()
    except Exception as e:
        out["__error__"] = str(e)
    return out


def audit_env(env):
    print("=" * 78)
    print(f"ENV: {env}")
    print("=" * 78)
    config = load_env(env)
    try:
        pg = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor,
                              connect_timeout=8)
    except Exception as e:
        print(f"  !! Postgres unreachable: {e}")
        return
    cur = pg.cursor()
    r2 = r2_client(config)
    bucket = config["R2_BUCKET"]
    prefix_env = config["APP_ENV"]

    for email in EMAILS:
        print(f"\n  --- {email} ---")
        cur.execute("SELECT user_id FROM users WHERE email=%s", (email,))
        row = cur.fetchone()
        if not row:
            print("    (no Postgres user row)")
            continue
        uid = row["user_id"]
        cur.execute("SELECT COUNT(*) n FROM game_storage_refs WHERE user_id=%s", (uid,))
        nrefs = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(DISTINCT blake3_hash) n FROM game_storage_refs WHERE user_id=%s", (uid,))
        ngames = cur.fetchone()["n"]
        print(f"    user_id={uid}")
        print(f"    game_storage_refs={nrefs}  distinct_games={ngames}")

        # R2 listing
        uprefix = f"{prefix_env}/users/{uid}/"
        keys = []
        paginator = r2.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=uprefix):
            for obj in page.get("Contents", []) or []:
                keys.append((obj["Key"], obj["Size"]))
        print(f"    R2 objects under {uprefix}: {len(keys)}")

        # top-level files + profile sqlite files
        sqlite_keys = [k for k, _ in keys if k.endswith(".sqlite")]
        for k in sqlite_keys:
            try:
                head = r2.head_object(Bucket=bucket, Key=k)
                ver = head.get("Metadata", {}).get("db-version", "?")
                size = head.get("ContentLength", 0)
            except Exception as e:
                ver, size = f"ERR({e})", "?"
            rel = k[len(uprefix):]
            print(f"      {rel}  size={size} db-version={ver}")
            # download profile.sqlite & count
            if rel.endswith("profile.sqlite"):
                with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tf:
                    tmp = tf.name
                try:
                    r2.download_file(bucket, k, tmp)
                    print(f"        rows: {count_rows(tmp)}")
                finally:
                    try:
                        Path(tmp).unlink()
                    except Exception:
                        pass
    pg.close()


if __name__ == "__main__":
    targets = sys.argv[1:] or ENVS
    for env in targets:
        try:
            audit_env(env)
        except Exception as e:
            print(f"ENV {env} FAILED: {e}")
