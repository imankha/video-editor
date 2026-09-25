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

PROJECT_ROOT = Path(__file__).resolve().parent.parent
USER_DATA = PROJECT_ROOT / "user_data"

# T8630 round 2: this operator script is run as `cd src/backend && python
# ../../scripts/delete_user.py`. Running a script FILE puts the script's own
# directory (scripts/) on sys.path, NOT the cwd, so `import app` fails unless
# we add src/backend ourselves -- exactly as scripts/backfill_payments_ledger.py
# already does. Do it at MODULE LOAD, before any work, and import the app's
# single-writer helpers here too: a missing/broken import then aborts the whole
# run at startup, before the irreversible R2 prefix purge and local rmtree in
# delete_one -- never a half-deleted account (storage gone, users row alive, no
# audit row). The pre-fix bug imported these INSIDE delete_one, so the crash
# landed AFTER storage was already purged.
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))

from app.analytics import deidentify_user_segments
from app.services.account_deletions import (
    DeletionActor,
    DeletionPath,
    record_account_deletion,
)
from app.services.bug_reports import anonymize_bug_reports
from app.services.payments_ledger import stamp_account_deleted

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


def delete_one_postgres(pg_conn, user_id: str, email: str, dry_run: bool,
                        force_paid: bool = False) -> list[str]:
    """Do ALL of a single user's Postgres work (guard side already ran in the
    caller's pre-pass): stamp + audit + anonymize + row deletes, in the caller's
    open transaction. NEVER commits and NEVER touches storage -- the caller
    commits this per user BEFORE the irreversible storage purge (T8630 round 3),
    so a later target's failure can never roll back an already-storage-purged
    earlier target.

    Returns the bug-report R2 object keys (screenshots + console logs) the caller
    must delete after the commit. Returns [] on a dry run.
    """
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
        if table_present(pg_conn, "bug_reports"):
            cur.execute("SELECT COUNT(*) as cnt FROM bug_reports WHERE reporter_email = %s", (email,))
            print(f"    would anonymize {cur.fetchone()['cnt']} bug_reports rows (keep text, clear PII + delete attachments)")
        cur.execute("SELECT COUNT(*) as cnt FROM otp_codes WHERE email = %s", (email,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from otp_codes")
        cur.execute("SELECT COUNT(*) as cnt FROM share_claims WHERE claimer_user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from share_claims")
        # T8630 round 4: analytics are KEPT (de-identified), no longer deleted.
        cur.execute("SELECT COUNT(*) as cnt FROM user_segments WHERE user_id = %s", (user_id,))
        print(f"    would KEEP {cur.fetchone()['cnt']} user_segments row (strip utm/click_source/current_session_start)")
        cur.execute("SELECT COUNT(*) as cnt FROM user_actions WHERE user_id = %s", (user_id,))
        print(f"    would KEEP {cur.fetchone()['cnt']} user_actions rows as-is")
        cur.execute("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
        print(f"    would KEEP {cur.fetchone()['cnt']} referrals rows as-is")
        if table_present(pg_conn, "user_usage_daily"):
            cur.execute("SELECT COUNT(*) as cnt FROM user_usage_daily WHERE user_id = %s", (user_id,))
            print(f"    would KEEP {cur.fetchone()['cnt']} user_usage_daily rows as-is")
        cur.execute("SELECT COUNT(*) as cnt FROM users WHERE user_id = %s", (user_id,))
        print(f"    would delete {cur.fetchone()['cnt']} rows from users")
        return []

    # T8630: stamp + audit BEFORE the DELETE FROM users below -- uses the app's
    # single-writer helpers (imported at module top so a broken import aborts the
    # run before any storage purge) rather than inlining their SQL
    # (payments_ledger.py owns `payments` writes, account_deletions.py owns the
    # audit table).
    if table_present(pg_conn, "payments"):
        stamp_account_deleted(cur, user_id)
    summary = payment_summary(pg_conn, user_id)
    note = "forced past payment guard" if (force_paid and summary["count"] > 0) else None
    record_account_deletion(
        cur, user_id=user_id, actor=DeletionActor.SCRIPT,
        path=DeletionPath.DELETE_USER_SCRIPT, note=note,
    )
    # T8630 round 3: keep bug-report TEXT, clear PII columns; the returned R2
    # keys are purged after this transaction commits (in the storage phase).
    bug_r2_keys = anonymize_bug_reports(cur, email)
    # T8630 round 3: short-lived login OTPs (by email) and the user's own
    # opaque share-claim links, purged on a real deletion. share_claims.
    # claimer_user_id is NOT NULL, so the row is deleted rather than nulled.
    cur.execute("DELETE FROM otp_codes WHERE email = %s", (email,))
    cur.execute("DELETE FROM share_claims WHERE claimer_user_id = %s", (user_id,))
    # T8630 round 4 (REVERSES round 2/3 analytics purge for real deletions): KEEP
    # user_segments (identity stripped), user_actions, user_usage_daily and
    # referrals under the same opaque user_id so channel/cohort revenue still
    # attributes. Their FKs to `users` are dropped in v032, so these rows survive
    # the DELETE FROM users below. referrer_id is NOT nulled -- kept as an opaque
    # id (may point at another deleted-but-retained user); the viral edge stays.
    deidentify_user_segments(cur, user_id)
    cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
    return bug_r2_keys


def purge_user_storage(s3, bucket: str, app_env: str, user_id: str,
                       bug_r2_keys: list[str], dry_run: bool) -> int:
    """The irreversible storage purge for one user, run AFTER that user's
    Postgres transaction has committed (T8630 round 3). Purges the R2 user
    prefix, the anonymized bug reports' global attachment objects, and the local
    user_data folder. Returns the R2 object count for the user prefix."""
    prefix = f"{app_env}/users/{user_id}/"
    print(f"  R2 purge: {prefix}")
    count = purge_r2_prefix(s3, bucket, prefix, dry_run)
    print(f"    {'would delete' if dry_run else 'deleted'} {count} R2 objects")

    # T8630 round 3: bug-report attachments live under global keys
    # ({app_env}/bugs/{id}/...), NOT the user prefix above, so purge them here
    # explicitly. Best-effort: a failure is surfaced by the caller's per-user
    # try/except, never a silent skip.
    for key in bug_r2_keys:
        if dry_run:
            print(f"    would delete bug attachment: {key}")
        else:
            s3.delete_object(Bucket=bucket, Key=key)
            print(f"    deleted bug attachment: {key}")

    local_dir = USER_DATA / user_id
    if local_dir.exists():
        print(f"  local purge: {local_dir}")
        if not dry_run:
            shutil.rmtree(local_dir, ignore_errors=True)
    return count


def delete_one(user_id: str, email: str, app_env: str, bucket: str,
               s3, pg_conn, dry_run: bool, force_paid: bool = False) -> None:
    """Single-user delete used by the DRY-RUN path and by unit tests that supply
    their own connection and commit themselves. It runs the Postgres phase then
    the storage phase back-to-back on the caller's connection WITHOUT committing.
    The real (non-dry) bulk/single run in main() does NOT call this -- it commits
    each user's Postgres phase BEFORE its storage phase so a later failure can
    never undo an earlier, already-storage-purged deletion (T8630 round 3)."""
    print(f"\n=== Deleting user_id={user_id} ({email}) in {app_env} ===")
    bug_r2_keys = delete_one_postgres(pg_conn, user_id, email, dry_run, force_paid)
    purge_user_storage(s3, bucket, app_env, user_id, bug_r2_keys, dry_run)


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

    if args.dry_run:
        for r in rows:
            delete_one(r["user_id"], r["email"], app_env, bucket, s3, pg_conn, dry_run=True,
                       force_paid=args.force_paid)
        pg_conn.close()
        print(f"\n=== Dry run complete. Would delete {len(rows)} user(s) from {args.env}. ===")
        return

    # T8630 round 3: commit EACH user's Postgres work (guard already passed in
    # the pre-pass, then stamp/delete/audit/anonymize) in its own transaction
    # BEFORE that user's irreversible storage purge. The pre-fix code committed
    # once after the whole loop, so a later target failing in Postgres (or a
    # transient R2 error) rolled back every earlier target's DELETE -- after its
    # storage was already gone -- leaving half-deleted accounts. Now each commit
    # is durable the instant it lands, independent of every other target.
    db_deleted = 0
    failures: list[tuple[str, str, str]] = []
    for r in rows:
        uid, email = r["user_id"], r["email"]
        try:
            print(f"\n=== Deleting user_id={uid} ({email}) in {app_env} ===")
            bug_r2_keys = delete_one_postgres(pg_conn, uid, email, dry_run=False,
                                              force_paid=args.force_paid)
            pg_conn.commit()
            db_deleted += 1
        except Exception as e:  # noqa: BLE001 - one target's failure must never abort the batch
            pg_conn.rollback()
            print(f"  ERROR: Postgres deletion FAILED for {email} ({uid}): {e}")
            print("         This account is left FULLY INTACT (nothing committed, no storage touched). Continuing.")
            failures.append((email, uid, f"postgres: {e}"))
            continue
        # DB side is committed and durable now. The storage purge is
        # irreversible but safe to retry -- if it fails AFTER the commit, the DB
        # is already consistent (row gone, audit written) and the leftover
        # storage can be re-purged. Log loudly, record, and continue.
        try:
            purge_user_storage(s3, bucket, app_env, uid, bug_r2_keys, dry_run=False)
        except Exception as e:  # noqa: BLE001 - storage is post-commit; DB is already consistent
            print(f"  ERROR: storage purge FAILED for {email} ({uid}) AFTER its Postgres commit: {e}")
            print("         DB is consistent (row gone, audit written); re-run to re-purge leftover storage. Continuing.")
            failures.append((email, uid, f"storage: {e}"))

    pg_conn.close()

    # Restart only when at least one deletion actually landed -- a run where every
    # target failed in Postgres changed nothing, so a restart would be pointless.
    if args.env in ("staging", "prod") and not args.no_restart and db_deleted > 0:
        restart_fly(args.env)

    print(f"\n=== Done. Deleted {db_deleted}/{len(rows)} user(s) from {args.env}. ===")
    if failures:
        print(f"\n*** {len(failures)} failure(s) -- see above; DB is consistent for every committed target ***")
        for email, uid, reason in failures:
            print(f"  {email} ({uid}): {reason}")
        sys.exit(1)


if __name__ == "__main__":
    main()
