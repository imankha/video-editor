"""
T11500: remove accumulated dev-picker accounts (dev env ONLY).

Every dev-account-picker click creates a new `dev+<preset>+<stack>+<ts>-<6hex>@reelballers.local`
account. `task.sh nuke` calls this with --stack for the container being removed;
--older-than reclaims host-stack and leftover accounts.

Selection is deliberately narrow (Data Safety Rules): a LIKE prefilter, then a strict
regex on the full email, AND users.is_test_account. Template accounts
(`dev-template+...`) are NEVER selected and are hard-refused. Dry run unless --yes.

When both --stack and --older-than are given they are ANDed (narrower, safer).

Usage (from project root):
    cd src/backend && python ../../scripts/cleanup_dev_accounts.py --env dev --stack reel-task-foo --yes
    cd src/backend && python ../../scripts/cleanup_dev_accounts.py --env dev --older-than 7d
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import delete_user as du

# Grammar produced by app.routers.dev_accounts.dev_account_email (design D8); a
# backend test pins that a generated email matches this regex.
DEV_ACCOUNT_EMAIL_RE = re.compile(
    r"^dev\+(?P<preset>empty|upload|full)\+(?P<stack>[a-z0-9._-]+)\+"
    r"(?P<ts>\d{8}T\d{6})-[0-9a-f]{6}@reelballers\.local$"
)
TEMPLATE_EMAIL_PREFIX = "dev-template+"
_AGE_RE = re.compile(r"^(\d+)d$")


def parse_older_than(text: str) -> timedelta:
    m = _AGE_RE.match(text)
    if not m:
        raise argparse.ArgumentTypeError(f"--older-than must look like '7d' (got {text!r})")
    return timedelta(days=int(m.group(1)))


def select_accounts(rows, stack: str | None, older_than: timedelta | None, now: datetime):
    """Return (selected, refused). `rows` are dicts with user_id, email,
    is_test_account, created_at. Pure: no I/O, unit-tested."""
    if stack is None and older_than is None:
        raise ValueError("refusing to select without --stack and/or --older-than")
    selected, refused = [], []
    for r in rows:
        email = r["email"] or ""
        if email.startswith(TEMPLATE_EMAIL_PREFIX):
            refused.append(r)
            continue
        m = DEV_ACCOUNT_EMAIL_RE.match(email)
        if not m or not r.get("is_test_account"):
            continue
        if stack is not None and m.group("stack") != stack:
            continue
        if older_than is not None:
            created = r["created_at"]
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if not created < now - older_than:
                continue
        selected.append(r)
    return selected, refused


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Delete dev-picker accounts (dev env only)")
    p.add_argument("--env", required=True, choices=["dev"])
    p.add_argument("--stack", help="exact DEV_STACK_ID (container name or 'host')")
    p.add_argument("--older-than", type=parse_older_than, dest="older_than", help="e.g. 7d")
    p.add_argument("--yes", action="store_true", help="actually delete (default: dry run)")
    args = p.parse_args(argv)
    if args.stack is None and args.older_than is None:
        p.error("need --stack and/or --older-than")

    config = du.load_env(args.env)
    if os.environ.get("DATABASE_URL"):  # in-container runs rewrite the DB host (container-stack.sh)
        config["DATABASE_URL"] = os.environ["DATABASE_URL"]
    app_env, bucket = config["APP_ENV"], config["R2_BUCKET"]
    if app_env != "dev":
        print(f"ERROR: refusing to run: APP_ENV={app_env!r} (dev only)")
        return 1

    pg_conn = du.get_pg_conn(config)
    cur = pg_conn.cursor()
    cur.execute(
        "SELECT user_id, email, is_test_account, created_at FROM users "
        "WHERE email LIKE 'dev+%%@reelballers.local' OR email LIKE 'dev-template+%%'"
    )
    selected, refused = select_accounts(cur.fetchall(), args.stack, args.older_than,
                                        datetime.now(timezone.utc))
    for r in refused:
        print(f"  refused (template, never deleted): {r['email']}")
    print(f"Selected {len(selected)} dev account(s) ({'DELETING' if args.yes else 'dry run'}):")
    for r in selected:
        print(f"  - {r['email']} ({r['user_id']})")
    if not selected or not args.yes:
        pg_conn.close()
        return 0

    s3 = du.get_r2_client(config)
    failures = 0
    for r in selected:
        uid, email = r["user_id"], r["email"]
        try:
            bug_keys = du.delete_one_postgres(pg_conn, uid, email, dry_run=False, force_paid=True)
            pg_conn.commit()  # PG phase durable BEFORE the irreversible storage purge (T8630 r3)
        except Exception as e:  # noqa: BLE001 - one account's failure must not abort the batch
            pg_conn.rollback()
            print(f"  ERROR: Postgres deletion failed for {email}: {e}")
            failures += 1
            continue
        try:
            du.purge_user_storage(s3, bucket, app_env, uid, bug_keys, dry_run=False)
        except Exception as e:  # noqa: BLE001 - post-commit; re-run re-purges
            print(f"  ERROR: storage purge failed for {email} AFTER its PG commit: {e}")
            failures += 1
    pg_conn.close()
    print(f"Done. {len(selected) - failures}/{len(selected)} clean.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
