"""
General-purpose hard-delete tool for bug_reports: removes rows (and their R2
screenshot/log assets) older than N days, optionally restricted to specific
statuses.

Differs from the admin API's DELETE /bugs/purge, which only purges
status='done' bugs by resolved_at. This script matches by created_at (report
date) and accepts any subset of BUG_STATUSES via --status; default (no
--status) is all statuses.

Requires:
  - Fly proxy for prod Postgres: fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env.prod at project root

Usage (dry-run is the default -- lists what would be deleted, deletes nothing):
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\purge_old_bug_reports.py \\
        --env prod --days 7

    # Restrict to specific statuses (valid: new, testing, done, duplicate)
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\purge_old_bug_reports.py \\
        --env prod --days 30 --status done,duplicate --execute
"""

import argparse
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent

BUG_STATUSES = {"new", "testing", "done", "duplicate"}


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
    return config


def r2_client(config):
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


def parse_statuses(value):
    statuses = {s.strip() for s in value.split(",") if s.strip()}
    invalid = statuses - BUG_STATUSES
    if invalid:
        raise argparse.ArgumentTypeError(
            f"invalid status(es): {', '.join(sorted(invalid))}. "
            f"Valid: {', '.join(sorted(BUG_STATUSES))}"
        )
    return statuses


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=["dev", "staging", "prod"], required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument(
        "--status", type=parse_statuses, default=None,
        help=f"Comma-separated statuses to include (default: all). Valid: {', '.join(sorted(BUG_STATUSES))}",
    )
    parser.add_argument("--execute", action="store_true", help="Actually delete. Default is dry-run.")
    args = parser.parse_args()

    if args.days < 1:
        parser.error("--days must be >= 1")

    config = load_env(args.env)
    conn = psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            query = (
                "SELECT id, status, reporter_email, created_at, resolved_at, "
                "screenshot_r2_key, logs_r2_key "
                "FROM bug_reports WHERE created_at < NOW() - INTERVAL '%s days'"
            )
            params = [args.days]
            if args.status:
                query += " AND status = ANY(%s)"
                params.append(list(args.status))
            query += " ORDER BY created_at ASC"
            cur.execute(query, params)
            rows = cur.fetchall()

        if not rows:
            status_note = f" with status in {sorted(args.status)}" if args.status else ""
            print(f"No bug_reports older than {args.days} days{status_note}. Nothing to do.")
            return

        candidate_ids = [r["id"] for r in rows]

        # A candidate still referenced by an OUTSIDE row's duplicate_of would
        # violate the FK on delete (bug_reports.duplicate_of has no ON DELETE
        # clause). Exclude those from this run rather than mutating a row this
        # script wasn't asked to touch.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, duplicate_of FROM bug_reports "
                "WHERE duplicate_of = ANY(%s) AND NOT (id = ANY(%s))",
                (candidate_ids, candidate_ids),
            )
            blockers = cur.fetchall()

        if blockers:
            skipped_ids = sorted({b["duplicate_of"] for b in blockers})
            print(f"Skipping {len(skipped_ids)} bug_report(s) still referenced by a newer "
                  f"duplicate_of (would violate FK on delete):")
            for bid in skipped_ids:
                refs = sorted(b["id"] for b in blockers if b["duplicate_of"] == bid)
                print(f"  id={bid} referenced by duplicate(s) {refs}")
            print()
            rows = [r for r in rows if r["id"] not in skipped_ids]

        if not rows:
            print("Nothing left to purge after excluding referenced rows.")
            return

        by_status = {}
        for r in rows:
            by_status[r["status"]] = by_status.get(r["status"], 0) + 1

        print(f"Found {len(rows)} bug_reports older than {args.days} days ({args.env}):")
        for status, count in sorted(by_status.items()):
            print(f"  {status}: {count}")
        print()
        for r in rows:
            print(f"  id={r['id']:<6} status={r['status']:<10} created_at={r['created_at']} "
                  f"reporter={r['reporter_email']}")

        if not args.execute:
            print("\nDRY RUN -- no changes made. Re-run with --execute to delete.")
            return

        # DB rows are deleted and committed FIRST. R2 assets are only removed
        # once the DB is in its final consistent state, so a DB-side failure
        # never leaves rows pointing at already-deleted R2 keys.
        ids = [r["id"] for r in rows]
        with conn.cursor() as cur:
            cur.execute("DELETE FROM bug_reports WHERE id = ANY(%s)", (ids,))
        conn.commit()

        r2 = r2_client(config)
        bucket = config["R2_BUCKET"]
        deleted_keys = 0
        orphaned_keys = []
        for r in rows:
            for key in (r["screenshot_r2_key"], r["logs_r2_key"]):
                if key:
                    try:
                        r2.delete_object(Bucket=bucket, Key=key)
                        deleted_keys += 1
                    except Exception as exc:
                        orphaned_keys.append((key, str(exc)))

        print(f"\nDeleted {len(ids)} bug_reports rows and {deleted_keys} R2 objects.")
        if orphaned_keys:
            print(f"WARNING: {len(orphaned_keys)} R2 object(s) failed to delete "
                  f"(DB rows already removed -- these are now orphaned R2 objects):")
            for key, err in orphaned_keys:
                print(f"  {key}: {err}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
