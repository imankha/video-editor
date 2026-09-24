"""
Hard-delete user accounts. Unlike reset-test-user.py (which clears profile data
but leaves the user record + R2 prefix intact for re-login testing), this script:

  1. Deletes the user row from Postgres (+ sessions, game_storage_refs)
  2. Purges the full R2 prefix {app_env}/users/{uid}/ (profile DBs, clips, etc.)
  3. Removes the local user_data/{uid}/ directory
  4. Restarts Fly.io machines (staging/prod) to clear cached state

Games in R2 (games/<hash>.mp4) are NEVER touched -- shared across users.

Usage (from project root):
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env prod --email imankh@gmail.com
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env prod --all-except sarkarati@gmail.com
    cd src/backend && .venv/Scripts/python.exe ../../scripts/delete_user.py \\
        --env dev --all

Add --dry-run to list what would be deleted without touching anything.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

FLY_APPS = {
    "staging": "reel-ballers-api-staging",
    "prod": "reel-ballers-api",
}


def load_env(env_name: str) -> dict:
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found"); sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            config[k.strip()] = v.strip()
    for key in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "DATABASE_URL"):
        if key not in config:
            print(f"ERROR: {key} missing in {env_file}"); sys.exit(1)
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


# T5840: the credit ledger (T6090). All three ship together in postgres v019 --
# checking one is checking all, matching the pattern already used in
# copy_user_between_envs.py.
CREDIT_TABLES = ("credit_transactions", "credit_reservations", "credits")


def credit_tables_present(pg_conn) -> bool:
    """False on a pre-v019 destination (prod today) where the ledger tables
    don't exist yet -- deleting a user there must not crash."""
    cur = pg_conn.cursor()
    cur.execute("SELECT to_regclass('public.credits') IS NOT NULL AS ok")
    return cur.fetchone()["ok"]


def table_present(pg_conn, table_name: str) -> bool:
    """Generic to_regclass tolerance check (T6090 pattern, generalized past
    credit_tables_present's credits-specific check now that a second caller --
    upload_failures, T10270 -- needs the same tolerance)."""
    cur = pg_conn.cursor()
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{table_name}",))
    return cur.fetchone()["ok"]


def sweep_orphans(pg_conn, dry_run: bool) -> int:
    """Remove credit-ledger rows whose user_id has no matching `users` row.

    Orphans are created by pre-fix delete_user.py runs (T6090): the credit
    tables were never cleared, so a deleted user's rows survive with no
    owning users row. Scoped strictly to NOT-IN-users so a live user's rows
    can never be touched.
    """
    cur = pg_conn.cursor()
    if not credit_tables_present(pg_conn):
        print("  credit ledger tables do not exist (pre-v019) -- nothing to sweep")
        return 0

    total = 0
    for table in CREDIT_TABLES:
        cur.execute(
            f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id NOT IN (SELECT user_id FROM users)"
        )
        cnt = cur.fetchone()["cnt"]
        if dry_run:
            print(f"  would delete {cnt} orphaned rows from {table}")
        else:
            cur.execute(
                f"DELETE FROM {table} WHERE user_id NOT IN (SELECT user_id FROM users)"
            )
            print(f"  deleted {cnt} orphaned rows from {table}")
        total += cnt
    return total


def purge_r2_prefix(s3, bucket: str, prefix: str, dry_run: bool) -> int:
    paginator = s3.get_paginator("list_objects_v2")
    total = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        contents = page.get("Contents") or []
        if not contents:
            continue
        keys = [{"Key": o["Key"]} for o in contents]
        total += len(keys)
        if dry_run:
            for k in keys:
                print(f"    would delete: {k['Key']}")
        else:
            for i in range(0, len(keys), 1000):
                s3.delete_objects(Bucket=bucket, Delete={"Objects": keys[i:i+1000]})
    return total


def restart_fly(env_name: str) -> None:
    app = FLY_APPS.get(env_name)
    if not app:
        return
    print(f"\n--- Restarting Fly machines ({app}) ---")
    try:
        r = subprocess.run(["fly", "machines", "list", "-a", app, "--json"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            print(f"  WARN: list failed: {r.stderr.strip()}"); return
        import json
        for m in [x for x in json.loads(r.stdout) if x.get("state") == "started"]:
            rr = subprocess.run(["fly", "machines", "restart", m["id"], "-a", app],
                                capture_output=True, text=True, timeout=60)
            print(f"  {'restarted' if rr.returncode == 0 else 'FAILED'} {m['id']}")
        import urllib.request
        try:
            urllib.request.urlopen(f"https://{app}.fly.dev/api/health", timeout=30)
            print("  Server warmed")
        except Exception as e:
            print(f"  WARN: warmup failed: {e}")
    except FileNotFoundError:
        print("  WARN: 'fly' CLI not found")
    except Exception as e:
        print(f"  WARN: {e}")


def payment_summary(pg_conn, user_id: str) -> dict:
    """Read-only report of a user's retained `payments` ledger rows, for the
    --force-paid guard (T8630). Script-local: it never WRITES `payments`, so
    it stays out of `payments_ledger.py`'s single-writer scope. Tolerant of a
    pre-v031 destination (no ledger to protect)."""
    if not table_present(pg_conn, "payments"):
        return {"count": 0, "net_cents": 0, "object_ids": []}
    cur = pg_conn.cursor()
    cur.execute(
        "SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) net FROM payments WHERE user_id=%s",
        (user_id,),
    )
    row = cur.fetchone()
    cur.execute(
        "SELECT stripe_object_id FROM payments WHERE user_id=%s ORDER BY id",
        (user_id,),
    )
    return {
        "count": row["c"],
        "net_cents": row["net"],
        "object_ids": [r["stripe_object_id"] for r in cur.fetchall()],
    }


def check_payment_guard(pg_conn, rows, force_paid: bool) -> bool:
    """T8630 AC3: refuse a run that would delete a paying account unless
    --force-paid is passed. Runs as a SINGLE pre-pass over every target
    BEFORE any deletion, so --all/--all-except refuse the whole run before
    the first delete. Returns True if the run may proceed, False if it must
    refuse (the loud block is already printed by the time this returns
    False; the caller is responsible for exiting non-zero)."""
    if force_paid or not table_present(pg_conn, "payments"):
        return True
    paid = [(r, payment_summary(pg_conn, r["user_id"])) for r in rows]
    paid = [(r, s) for (r, s) in paid if s["count"] > 0]
    if not paid:
        return True
    print("\n*** REFUSING: the following target(s) have RETAINED payment records ***")
    for r, s in paid:
        print(f"  {r['email']} ({r['user_id']}): {s['count']} payment(s), "
              f"net ${s['net_cents']/100:.2f} -- ledger will be RETAINED")
        for oid in s["object_ids"]:
            print(f"      {oid}")
    print("\nThe payments ledger is preserved on deletion by design (T8630). "
          "Re-run with --force-paid to delete these account(s) anyway; "
          "their payment records will still be RETAINED and stamped account_deleted_at.")
    return False


def delete_one(user_id: str, email: str, app_env: str, bucket: str,
               s3, pg_conn, dry_run: bool, force_paid: bool = False) -> None:
    print(f"\n=== Deleting user_id={user_id} ({email}) in {app_env} ===")

    prefix = f"{app_env}/users/{user_id}/"
    print(f"  R2 purge: {prefix}")
    count = purge_r2_prefix(s3, bucket, prefix, dry_run)
    print(f"    {'would delete' if dry_run else 'deleted'} {count} R2 objects")

    local_dir = USER_DATA / user_id
    if local_dir.exists():
        print(f"  local purge: {local_dir}")
        if not dry_run:
            shutil.rmtree(local_dir, ignore_errors=True)

    cur = pg_conn.cursor()
    if dry_run:
        cur.execute("SELECT COUNT(*) as cnt FROM pending_teammate_shares WHERE sharer_user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from pending_teammate_shares")
        cur.execute("SELECT COUNT(*) as cnt FROM shares WHERE sharer_user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from shares (+ cascaded extensions)")
    else:
        cur.execute("DELETE FROM pending_teammate_shares WHERE sharer_user_id = %s", (user_id,))
        cur.execute("DELETE FROM shares WHERE sharer_user_id = %s", (user_id,))
    tables = ["game_storage_refs", "sessions"]
    if credit_tables_present(pg_conn):
        tables.extend(CREDIT_TABLES)
    else:
        print("    credit ledger tables do not exist (pre-v019) -- skipping")
    # T10270 F4: purged with the user, same to_regclass tolerance as the credit
    # tables above (a pre-v029 destination doesn't have this table yet).
    if table_present(pg_conn, "upload_failures"):
        tables.append("upload_failures")
    else:
        print("    upload_failures table does not exist (pre-v029) -- skipping")
    for table in tables:
        if dry_run:
            cur.execute(f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id = %s", (user_id,))
            cnt = cur.fetchone()["cnt"]
            print(f"    would delete {cnt} rows from {table}")
        else:
            cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))

    if dry_run:
        cur.execute("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
        print(f"    would delete {cur.fetchone()['cnt']} rows from referrals")
        cur.execute("SELECT COUNT(*) as cnt FROM user_segments WHERE referrer_id = %s", (user_id,))
        print(f"    would null referrer_id on {cur.fetchone()['cnt']} other user_segments rows")
        cur.execute("SELECT COUNT(*) as cnt FROM user_actions WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from user_actions")
        cur.execute("SELECT COUNT(*) as cnt FROM user_segments WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from user_segments")
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from users")
    else:
        # T8630: stamp + audit BEFORE the DELETE FROM users below, on this
        # same pg_conn (committed once in main() at the end of the whole
        # run) -- imports the app's single-writer helpers rather than
        # inlining their SQL (payments_ledger.py owns `payments` writes,
        # account_deletions.py owns the audit table).
        if table_present(pg_conn, "payments"):
            from app.services.payments_ledger import stamp_account_deleted
            stamp_account_deleted(cur, user_id)
        if table_present(pg_conn, "account_deletions"):
            from app.services.account_deletions import (
                DeletionActor,
                DeletionPath,
                record_account_deletion,
            )
            summary = payment_summary(pg_conn, user_id)
            note = "forced past payment guard" if (force_paid and summary["count"] > 0) else None
            record_account_deletion(
                cur, user_id=user_id, actor=DeletionActor.SCRIPT,
                path=DeletionPath.DELETE_USER_SCRIPT, note=note,
            )
        cur.execute("DELETE FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
        cur.execute("UPDATE user_segments SET referrer_id = NULL WHERE referrer_id = %s", (user_id,))
        cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--email", help="Delete a single user by email")
    grp.add_argument("--all", action="store_true", help="Delete ALL users in this env")
    grp.add_argument("--all-except", help="Delete all users EXCEPT this email")
    grp.add_argument("--sweep-orphans", action="store_true",
                      help="Remove credit-ledger rows with no matching users row (T6090 backfill)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-restart", action="store_true")
    p.add_argument("--yes", action="store_true", help="Skip confirmation")
    p.add_argument("--force-paid", action="store_true",
                    help="Delete even accounts that have retained payment records "
                         "(T8630: the ledger is preserved and stamped regardless)")
    args = p.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket}) dry_run={args.dry_run}")

    if args.sweep_orphans:
        pg_conn = get_pg_conn(config)
        print(f"\n=== Sweeping orphaned credit-ledger rows in {args.env} ===")
        if not args.yes and not args.dry_run:
            reply = input(f"\nSweep orphaned credit rows from {args.env}? Type 'yes' to confirm: ")
            if reply.strip() != "yes":
                print("Aborted."); return
        total = sweep_orphans(pg_conn, args.dry_run)
        if not args.dry_run:
            pg_conn.commit()
        pg_conn.close()
        verb = "Would remove" if args.dry_run else "Removed"
        print(f"\n=== Done. {verb} {total} orphaned row(s) from {args.env}. ===")
        return

    s3 = get_r2_client(config)
    pg_conn = get_pg_conn(config)
    cur = pg_conn.cursor()

    if args.email:
        cur.execute("SELECT user_id, email FROM users WHERE email = %s", (args.email,))
    elif args.all_except:
        cur.execute("SELECT user_id, email FROM users WHERE email != %s", (args.all_except,))
    else:
        cur.execute("SELECT user_id, email FROM users")

    rows = cur.fetchall()

    if not rows:
        print("No matching users found.")
        return

    print(f"\nTarget users ({len(rows)}):")
    for r in rows:
        print(f"  - {r['email']} ({r['user_id']})")

    # T8630 AC3: fail BEFORE the first deletion, not halfway through --
    # a single pre-pass over the whole target list, ahead of the
    # confirmation prompt.
    if not args.dry_run and not check_payment_guard(pg_conn, rows, args.force_paid):
        sys.exit(1)

    if not args.yes and not args.dry_run:
        reply = input(f"\nDelete {len(rows)} user(s) from {args.env}? Type 'yes' to confirm: ")
        if reply.strip() != "yes":
            print("Aborted."); return

    for r in rows:
        delete_one(r["user_id"], r["email"], app_env, bucket, s3, pg_conn, args.dry_run,
                   force_paid=args.force_paid)

    if not args.dry_run:
        pg_conn.commit()
    pg_conn.close()

    if args.env in ("staging", "prod") and not args.no_restart and not args.dry_run:
        restart_fly(args.env)

    print(f"\n=== Done. Deleted {len(rows)} user(s) from {args.env}. ===")


if __name__ == "__main__":
    main()
