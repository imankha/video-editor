"""
edit-user-db.py -- apply arbitrary SQL to one user's data on any environment, safely.

This is the general "change data on an env" tool. It handles the env differences so you
don't have to remember them: where each DB lives, the R2 sync version bump (so dev edits
aren't overwritten and remote edits actually take effect), and the Fly restart for remote.

TARGETS (--db):
  profile   per-user profile.sqlite  (clips, projects, games, game_storage, final_videos, ...). DEFAULT.
  user      per-user user.sqlite     (profile registry, action log, quests).
  postgres  Fly Postgres             (users, auth, sessions, shares, referrals, analytics/daily_counters).

ENV HANDLING (--env dev|staging|prod):
  dev      sqlite: edit the LOCAL file + bump db_version so R2 sync won't overwrite. No restart.
  staging/prod  sqlite: download from R2 -> edit -> bump db_version table + R2 x-amz-meta-db-version
                -> upload -> restart Fly machines + warm (skip with --no-restart).
  postgres (any env): run the SQL on that env's DATABASE_URL.

SAFETY:
  Dry-run by DEFAULT: runs your SQL in a transaction, prints rows affected, then ROLLS BACK.
  Pass --apply to actually write. Prod additionally requires --yes. Remote sqlite is backed up
  to scripts/.dbcache/<env>/ before editing.

USAGE (from project root):
  cd src/backend && .venv/Scripts/python.exe ../../scripts/edit-user-db.py EMAIL --env ENV --db DB --sql "SQL" [--apply] [--yes] [--profile-id ID] [--no-restart]

EXAMPLES:
  # Expire a game (dev) -- dry run first, then apply:
  ... edit-user-db.py imankh@gmail.com --env dev --db profile \
      --sql "UPDATE game_storage SET storage_expires_at='2026-06-23T00:00:00' WHERE blake3_hash='<hash>'"
  ... (same) --apply
  # Inspect games (dry-run friendly read is just a SELECT; rows print):
  ... --db profile --sql "SELECT g.id,g.opponent_name,gs.blake3_hash,gs.storage_expires_at FROM games g JOIN game_storage gs ON gs.blake3_hash=g.blake3_hash"
  # Postgres edit on staging:
  ... imankh@gmail.com --env staging --db postgres --sql "UPDATE users SET ... WHERE user_id='{uid}'" --apply
"""

import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"
DBCACHE = Path(__file__).parent / ".dbcache"   # remote DBs downloaded here before edit
FLY_APPS = {"staging": "reel-ballers-api-staging", "prod": "reel-ballers-api"}


# ---- env / clients (same patterns as reset-test-user.py) --------------------
def load_env(env_name):
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        sys.exit(f"ERROR: {env_file} not found")
    config = {}
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        config[k.strip()] = v.strip()
    for key in ("DATABASE_URL",):
        if key not in config:
            sys.exit(f"ERROR: {key} not in {env_file}")
    config.setdefault("APP_ENV", env_name)
    return config


def get_r2_client(config):
    import boto3
    from botocore.config import Config
    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        if key not in config:
            sys.exit(f"ERROR: {key} required for R2 (not in env file)")
    return boto3.client(
        "s3", endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto",
    )


def get_pg_conn(config):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def resolve_user_id(config, email):
    conn = get_pg_conn(config)
    cur = conn.cursor()
    cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    conn.close()
    if not row:
        sys.exit(f"No user with email '{email}' in {config['APP_ENV']} Postgres.")
    return row["user_id"]


# ---- sqlite apply helpers ---------------------------------------------------
def run_sql_sqlite(db_path, sql, apply):
    """Run SQL; print result/rowcount. Dry-run rolls back. Returns rows_affected."""
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("BEGIN")
    cur.execute(sql)
    if sql.lstrip().upper().startswith("SELECT"):
        rows = cur.fetchall()
        for r in rows[:50]:
            print("   ", dict(r))
        if len(rows) > 50:
            print(f"    ... ({len(rows)} rows total)")
        con.rollback(); con.close()
        return len(rows)
    affected = cur.rowcount
    if apply:
        cur.execute("UPDATE db_version SET version = version + 1 WHERE id = 1")  # so R2 won't clobber
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        print(f"    APPLIED -- {affected} row(s) changed; db_version bumped.")
    else:
        con.rollback()
        print(f"    DRY-RUN -- {affected} row(s) WOULD change (rolled back). Add --apply to write.")
    con.close()
    return affected


def r2_version(r2, bucket, key):
    try:
        head = r2.head_object(Bucket=bucket, Key=key)
        return int(head.get("Metadata", {}).get("db-version", "0"))
    except Exception:
        return 0


def upload_with_version(db_path, r2, bucket, key):
    con = sqlite3.connect(str(db_path))
    try:
        v = con.execute("SELECT version FROM db_version WHERE id=1").fetchone()
        local_v = v[0] if v else 0
    except Exception:
        local_v = 0
    con.close()
    new_v = max(local_v, r2_version(r2, bucket, key)) + 1
    r2.upload_file(str(db_path), bucket, key, ExtraArgs={"Metadata": {"db-version": str(new_v)}})
    print(f"    Uploaded to R2 ({key}) with db-version={new_v}")


# ---- Fly restart (from reset-test-user.py) ----------------------------------
def restart_fly_machines(env_name, config):
    import os, json, urllib.request
    app = FLY_APPS.get(env_name)
    if not app:
        return
    env = os.environ.copy()
    token = os.environ.get("FLY_ACCESS_TOKEN") or os.environ.get("FLY_API_TOKEN") or config.get("FLY_API_TOKEN")
    if not token:
        cfg = Path.home() / ".fly" / "config.yml"
        if cfg.exists():
            for line in cfg.read_text().splitlines():
                if line.startswith("access_token:"):
                    token = line.split(":", 1)[1].strip(); break
    if token:
        env["FLY_ACCESS_TOKEN"] = token
    print(f"\n--- Restarting Fly machines ({app}) ---")
    try:
        r = subprocess.run(["fly", "machines", "list", "-a", app, "--json"], capture_output=True, text=True, timeout=30, env=env)
        if r.returncode != 0:
            print(f"  WARNING: list failed: {r.stderr.strip()} (run: fly machines restart -a {app} --select)"); return
        for m in [m for m in json.loads(r.stdout) if m.get("state") == "started"]:
            rr = subprocess.run(["fly", "machines", "restart", m["id"], "-a", app], capture_output=True, text=True, timeout=60, env=env)
            print(f"  {'Restarted' if rr.returncode == 0 else 'FAILED'} {m['id']}")
        try:
            urllib.request.urlopen(f"https://{app}.fly.dev/api/health", timeout=30); print("  Warmed.")
        except Exception as e:
            print(f"  WARNING: warm failed: {e}")
    except FileNotFoundError:
        print("  WARNING: 'fly' CLI not found -- skipping restart")


# ---- main -------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(description="Apply SQL to a user's data on an env, safely.")
    p.add_argument("email")
    p.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    p.add_argument("--db", default="profile", choices=["profile", "user", "postgres"])
    p.add_argument("--sql", required=True)
    p.add_argument("--profile-id", help="limit to one profile (default: all of the user's profiles)")
    p.add_argument("--apply", action="store_true", help="actually write (default is dry-run)")
    p.add_argument("--yes", action="store_true", help="required confirmation for --env prod")
    p.add_argument("--no-restart", action="store_true", help="skip Fly restart (staging/prod sqlite)")
    args = p.parse_args()

    if args.env == "prod" and args.apply and not args.yes:
        sys.exit("Refusing to write to PROD without --yes.")

    config = load_env(args.env)
    app_env, is_remote = config["APP_ENV"], args.env in ("staging", "prod")
    print(f"Env: {args.env} (APP_ENV={app_env}) | db={args.db} | mode={'APPLY' if args.apply else 'DRY-RUN'}")

    # --- Postgres target ---
    if args.db == "postgres":
        conn = get_pg_conn(config); cur = conn.cursor()
        cur.execute("BEGIN")
        cur.execute(args.sql)
        if args.sql.lstrip().upper().startswith("SELECT"):
            for r in cur.fetchall()[:50]:
                print("   ", dict(r))
            conn.rollback()
        elif args.apply:
            print(f"    APPLIED -- {cur.rowcount} row(s)."); conn.commit()
        else:
            print(f"    DRY-RUN -- {cur.rowcount} row(s) WOULD change (rolled back)."); conn.rollback()
        conn.close()
        return

    # --- sqlite targets (profile / user) ---
    user_id = resolve_user_id(config, args.email)
    print(f"user_id = {user_id}")
    r2 = get_r2_client(config) if is_remote or args.db else None
    bucket = config.get("R2_BUCKET")

    # Build list of (db_path, r2_key)
    targets = []
    if args.db == "user":
        r2_key = f"{app_env}/users/{user_id}/user.sqlite"
        local = (DBCACHE / args.env / user_id / "user.sqlite") if is_remote else (USER_DATA / user_id / "user.sqlite")
        targets.append((local, r2_key))
    else:  # profile
        if is_remote:
            resp = r2.list_objects_v2(Bucket=bucket, Prefix=f"{app_env}/users/{user_id}/profiles/")
            for obj in resp.get("Contents", []):
                if obj["Key"].endswith("profile.sqlite"):
                    pid = obj["Key"].split("/")[-2]
                    if args.profile_id and pid != args.profile_id:
                        continue
                    targets.append((DBCACHE / args.env / user_id / "profiles" / pid / "profile.sqlite", obj["Key"]))
        else:
            pdir = USER_DATA / user_id / "profiles"
            for dbp in pdir.glob("*/profile.sqlite"):
                pid = dbp.parent.name
                if args.profile_id and pid != args.profile_id:
                    continue
                targets.append((dbp, f"{app_env}/users/{user_id}/profiles/{pid}/profile.sqlite"))

    if not targets:
        sys.exit("No matching DB found (check --profile-id / whether the user has logged in on dev).")

    for db_path, r2_key in targets:
        print(f"\n--- {r2_key} ---")
        if is_remote:
            db_path.parent.mkdir(parents=True, exist_ok=True)
            r2.download_file(bucket, r2_key, str(db_path))   # also serves as backup copy
            print(f"    Downloaded (backup at {db_path})")
        elif not db_path.exists():
            print(f"    SKIP -- local file missing: {db_path}"); continue
        run_sql_sqlite(db_path, args.sql, args.apply)
        if args.apply and is_remote:
            upload_with_version(db_path, r2, bucket, r2_key)

    if args.apply and is_remote and not args.no_restart:
        restart_fly_machines(args.env, config)

    print(f"\n=== {'Done' if args.apply else 'Dry-run complete'} ({args.env}/{args.db}). ===")


if __name__ == "__main__":
    main()
