"""
Copy a single user's data from one environment to another.

Copies:
  1. Postgres rows (users + game_storage_refs)
  2. R2 objects (profile.sqlite, user.sqlite, media files)

Requirements:
  - Fly proxy running for BOTH source and destination Postgres:
      fly proxy 15432:5432 --app reel-ballers-db-staging
      fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env files at project root (.env, .env.staging, .env.prod)

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\copy_user_between_envs.py \
        --email imankh@gmail.com --from production --to staging
"""

import argparse
import hashlib
import logging
import sys
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# T8630 round 2: run as `cd src/backend && python ../../scripts/copy_user_between_envs.py`;
# a script FILE puts scripts/ on sys.path, not cwd, so add src/backend ourselves
# (like scripts/backfill_payments_ledger.py) and import the audit/stamp helpers
# at module load so a broken import aborts before any deletion.
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))

from app.analytics import deidentify_user_segments
from app.services.account_clone import (  # noqa: F401 - re-exported: tests and callers resolve cu.verify_media_refs etc.
    _MEDIA_REF_TABLES,
    AccountCloneError,
    _db_version,
    _list_keys,
    _profile_id_from_key,
    copy_game_storage_refs,
    copy_user_objects,
    verify_media_refs,
    verify_r2_copy,
)
from app.services.account_deletions import (
    DeletionActor,
    DeletionPath,
    record_account_deletion,
)
from app.services.bug_reports import anonymize_bug_reports
from app.services.payments_ledger import stamp_account_deleted

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("copy-user")


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    env_file = PROJECT_ROOT / f".env{suffix}"
    if not env_file.exists():
        log.error(f"{env_file} not found")
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
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=60,
        ),
        region_name="auto",
    )


def get_pg_conn(config: dict):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def alias_user_id(src_user_id: str, dst_email: str) -> str:
    """Deterministic user_id for an ALIAS clone (--to-email), so re-runs converge
    on the same destination identity instead of accreting new users.

    NOTE: the id derives from the SOURCE user_id -- if the source account is ever
    recreated with a new user_id (dev DB reset), the alias id changes too; the old
    alias's Postgres rows get cleaned up by the existing-email branch below, but its
    R2 prefix ({env}/users/{old_alias_id}/) is orphaned and needs a manual purge."""
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"rb-alias:{src_user_id}:{dst_email}"))


def _table_present(cur, table_name: str) -> bool:
    """to_regclass tolerance so a pre-migration destination doesn't crash on an
    UndefinedTable (same pattern as delete_user.py)."""
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{table_name}",))
    return cur.fetchone()["ok"]


def delete_destination_user(dst_cur, old_id: str, dst_email: str) -> list[str]:
    """Remove a pre-existing destination account (same email, different user_id)
    before seeding the copied one, in the caller's transaction.

    T8630 round 2: this genuinely deletes a `users` row on the destination env,
    so -- unlike a NUF reset -- the account is REALLY gone there. Write an
    `account_deletions` audit row (actor 'script', path 'copy_user_between_envs')
    AND stamp that user_id's `payments.account_deleted_at`, since the account
    does not come back on this env. Analytics-only `user_usage_daily` buckets are
    purged with the user. All in the same transaction as the DELETE FROM users.

    T8630 round 3: also anonymize the destination account's `bug_reports` (keep
    the text, clear PII) and delete its own `share_claims` links. Returns the
    bug-report R2 attachment keys the caller must delete AFTER committing this
    transaction (R2 deletion is not transactional).
    """
    # Stamp + audit BEFORE the deletes below, same transaction. The stamp uses
    # the app's single-writer helper; the audit reads `payments` for
    # had_payments/net_cents (payments are never deleted).
    if _table_present(dst_cur, "payments"):
        stamp_account_deleted(dst_cur, old_id)
    record_account_deletion(
        dst_cur, user_id=old_id, actor=DeletionActor.SCRIPT,
        path=DeletionPath.COPY_USER_BETWEEN_ENVS, email=dst_email,
    )
    bug_r2_keys = anonymize_bug_reports(dst_cur, dst_email)
    for table in ("game_storage_refs", "sessions",
                  "credit_transactions", "credit_reservations", "credits"):
        dst_cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (old_id,))
    dst_cur.execute("DELETE FROM pending_teammate_shares WHERE sharer_user_id = %s", (old_id,))
    dst_cur.execute("DELETE FROM shares WHERE sharer_user_id = %s", (old_id,))
    # share_claims.claimer_user_id is NOT NULL -> delete the row (T8630 round 3).
    dst_cur.execute("DELETE FROM share_claims WHERE claimer_user_id = %s", (old_id,))
    dst_cur.execute("DELETE FROM otp_codes WHERE email = %s", (dst_email,))
    # T8630 round 5: snapshot is_test_account onto the kept segment row (read
    # BEFORE the DELETE FROM users below) so the admin test-exclusion views still
    # know this deleted destination account was a test one.
    dst_cur.execute("SELECT is_test_account FROM users WHERE user_id = %s", (old_id,))
    _u = dst_cur.fetchone()
    was_test_account = bool(_u["is_test_account"]) if _u else None
    # T8630 round 4 (REVERSES round 2/3 analytics purge): KEEP user_segments
    # (identity stripped), user_actions, user_usage_daily and referrals under the
    # same opaque old_id so channel/cohort revenue still attributes. Their FKs to
    # `users` are dropped in v032, so these rows survive the DELETE FROM users.
    deidentify_user_segments(dst_cur, old_id, was_test_account=was_test_account)
    dst_cur.execute("DELETE FROM users WHERE user_id = %s", (old_id,))
    return bug_r2_keys


def copy_postgres_rows(
    src_config: dict, dst_config: dict, email: str, dry_run: bool, dst_email: str | None = None
) -> tuple[str, str]:
    """Copy user + game_storage_refs from source to destination Postgres.

    With dst_email set (T7800 --to-email), the destination identity is an ALIAS:
    a different email + a deterministic derived user_id, so the clone can coexist
    with a straight copy of the source account in the same destination env (two
    users can't share a user_id, and R2 prefixes are keyed by user_id).
    Every globally-UNIQUE users column (google_id, invite_code,
    email_unsubscribe_token) is neutralized on the alias so it can't collide with
    the straight copy. Intended for e2e fixture accounts, not real users.

    Returns (src_user_id, dst_user_id) — equal for a straight copy.
    """
    src_conn = get_pg_conn(src_config)
    dst_conn = get_pg_conn(dst_config)

    try:
        src_cur = src_conn.cursor()
        src_cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        user_row = src_cur.fetchone()
        if not user_row:
            log.error(f"User {email} not found in source Postgres")
            sys.exit(1)

        user_id = user_row["user_id"]
        is_alias = bool(dst_email) and dst_email != email
        dst_email = dst_email or email
        dst_user_id = alias_user_id(user_id, dst_email) if is_alias else user_id
        log.info(f"Found user_id: {user_id}" + (f" -> alias {dst_user_id} ({dst_email})" if is_alias else ""))

        deleted_bug_r2_keys: list[str] = []
        if dry_run:
            log.info(f"[DRY RUN] Would copy users row for {user_id} as {dst_user_id}")
        else:
            dst_cur = dst_conn.cursor()

            # Remove any existing user with this email but different user_id
            dst_cur.execute("SELECT user_id FROM users WHERE email = %s", (dst_email,))
            existing = dst_cur.fetchone()
            if existing and existing["user_id"] != dst_user_id:
                old_id = existing["user_id"]
                log.info(f"Removing existing dev user {old_id} (same email, different user_id)")
                deleted_bug_r2_keys = delete_destination_user(dst_cur, old_id, dst_email)

            # Upsert user row (identity rewritten for an alias clone).
            # GLOBALLY-UNIQUE columns must not collide with the straight copy of the
            # same source account: google_id (users DDL) is nulled; invite_code
            # (idx_users_invite_code, migration v004) is re-derived the same way the
            # app derives it (routers/users.py: sha256(user_id)[:8]) so the stored
            # value matches what the alias's own /api/me/invite-code would mint;
            # email_unsubscribe_token (UNIQUE, migration v037) gets a fresh uuid4 like
            # the column default -- it is the unsubscribe link's only credential, so
            # the alias must never share the source's (T14400). email is rewritten
            # above. Audit (T14400): those four are every UNIQUE column on users.
            # If a future migration adds another global unique to users, it must be
            # neutralized here too -- the ON CONFLICT target is user_id only, so any
            # other unique collision aborts the seed.
            user_row = dict(user_row)
            if is_alias:
                user_row["user_id"] = dst_user_id
                user_row["email"] = dst_email
                if "google_id" in user_row:
                    user_row["google_id"] = None
                if user_row.get("invite_code"):
                    user_row["invite_code"] = hashlib.sha256(dst_user_id.encode()).hexdigest()[:8]
                if "email_unsubscribe_token" in user_row:
                    user_row["email_unsubscribe_token"] = str(uuid.uuid4())
            cols = list(user_row.keys())
            vals = [user_row[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "user_id")
            dst_cur.execute(
                f"INSERT INTO users ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT (user_id) DO UPDATE SET {update_set}",
                vals,
            )
            log.info(f"Copied users row for {dst_user_id}")

            refs_copied = copy_game_storage_refs(src_cur, dst_cur, user_id, dst_user_id)
            log.info(f"Copied {refs_copied} game_storage_refs rows")

            # Copy user_segments — the analytics row the admin dashboard INNER JOINs
            # on (users ⋈ user_segments). Without it the copied account never shows in
            # the dashboard. referrer_id has a FK to users(user_id); null it if the
            # referrer isn't present at the destination so the insert can't fail.
            dst_cur.execute("DELETE FROM user_segments WHERE user_id = %s", (dst_user_id,))
            src_cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
            seg = src_cur.fetchone()
            if seg:
                seg = dict(seg)
                seg["user_id"] = dst_user_id
                ref = seg.get("referrer_id")
                if ref:
                    dst_cur.execute("SELECT 1 FROM users WHERE user_id = %s", (ref,))
                    if not dst_cur.fetchone():
                        log.info(f"  referrer {ref} not at destination -- nulling referrer_id")
                        seg["referrer_id"] = None
                cols = list(seg.keys())
                placeholders = ", ".join(["%s"] * len(cols))
                dst_cur.execute(
                    f"INSERT INTO user_segments ({', '.join(cols)}) VALUES ({placeholders})",
                    [seg[c] for c in cols],
                )
                log.info("Copied user_segments row")
            else:
                log.info("No user_segments row at source")

            # Copy user_actions — drives the dashboard's funnel, last-step, session and
            # usage columns. Clear the destination first for a faithful mirror.
            dst_cur.execute("DELETE FROM user_actions WHERE user_id = %s", (dst_user_id,))
            src_cur.execute("SELECT * FROM user_actions WHERE user_id = %s", (user_id,))
            action_rows = src_cur.fetchall()
            for a in action_rows:
                a = dict(a)
                a["user_id"] = dst_user_id
                cols = list(a.keys())
                placeholders = ", ".join(["%s"] * len(cols))
                dst_cur.execute(
                    f"INSERT INTO user_actions ({', '.join(cols)}) VALUES ({placeholders})",
                    [a[c] for c in cols],
                )
            log.info(f"Copied {len(action_rows)} user_actions rows")

            # T5840: copy the credit ledger + balance -- credits live in Postgres
            # now (NOT in the copied user.sqlite), so without this a copied
            # account would arrive with a zero balance. Clear destination first
            # for a faithful mirror; re-derive balance from the copied ledger
            # rather than copying the `credits` row verbatim (never trust a
            # copied balance over the ledger it should equal).
            # N5: also clear credit_reservations -- reservations are ephemeral
            # in-flight state (an export job id from the SOURCE env means
            # nothing on the destination), never copied, but a STALE
            # destination-side reservation from a prior copy of this same
            # user_id must not linger and silently offset the re-derived balance.
            # A SOURCE env that has not yet run postgres v019 has no credit ledger
            # at all -- credits still live in the copied user.sqlite, and v019 is
            # exactly what moves them into Postgres. That is an environment-version
            # difference between two real deployments, not missing internal data,
            # so skip the ledger copy loudly instead of crashing the whole copy.
            # The destination's own migrate is what will populate the ledger.
            src_cur.execute("SELECT to_regclass('public.credit_transactions') IS NOT NULL AS ok")
            if not src_cur.fetchone()["ok"]:
                log.warning(
                    "SOURCE has no credit_transactions table (pre-v019) -- skipping ledger "
                    "copy. Credits ride along inside user.sqlite; run the destination "
                    "migrate to move them into Postgres."
                )
            else:
                dst_cur.execute("DELETE FROM credit_reservations WHERE user_id = %s", (dst_user_id,))
                dst_cur.execute("DELETE FROM credit_transactions WHERE user_id = %s", (dst_user_id,))
                src_cur.execute(
                    "SELECT amount, source, idempotency_key, reference_id, video_seconds, created_at "
                    "FROM credit_transactions WHERE user_id = %s", (user_id,),
                )
                tx_rows = src_cur.fetchall()
                for tx in tx_rows:
                    tx = dict(tx)
                    cols = ["user_id", *list(tx.keys())]
                    placeholders = ", ".join(["%s"] * len(cols))
                    dst_cur.execute(
                        f"INSERT INTO credit_transactions ({', '.join(cols)}) VALUES ({placeholders})",
                        [dst_user_id, *[tx[c] for c in tx]],
                    )
                dst_cur.execute(
                    """INSERT INTO credits (user_id, balance)
                       VALUES (%s, (SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE user_id = %s))
                       ON CONFLICT (user_id) DO UPDATE SET
                           balance = (SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE user_id = %s),
                           updated_at = now()""",
                    (dst_user_id, dst_user_id, dst_user_id),
                )
                log.info(f"Copied {len(tx_rows)} credit_transactions rows, re-derived balance")

            dst_conn.commit()

            # T8630 round 3: the deleted destination account's bug-report R2
            # attachments (global keys, not under a user prefix) are purged AFTER
            # the commit -- R2 deletion is not transactional and the rows are
            # already anonymized. Best-effort: a failure is logged, never fatal.
            if deleted_bug_r2_keys:
                r2 = get_r2_client(dst_config)
                bucket = dst_config["R2_BUCKET"]
                for key in deleted_bug_r2_keys:
                    try:
                        r2.delete_object(Bucket=bucket, Key=key)
                        log.info(f"Deleted destination bug attachment: {key}")
                    except Exception as e:  # noqa: BLE001 - best-effort post-commit purge, never fatal
                        log.warning(f"Bug attachment purge failed for {key}: {e}")

        return user_id, dst_user_id

    finally:
        src_conn.close()
        dst_conn.close()


def copy_r2_objects(config: dict, user_id: str, src_prefix: str, dst_prefix: str, dry_run: bool,
                    dst_user_id: str | None = None):
    """Mirror all R2 objects for a user (thin wrapper over the T11500 service).

    See app/services/account_clone.copy_user_objects. After the copy, verifies the
    object set and the media refs (skipped on --dry-run)."""
    dst_user_id = dst_user_id or user_id
    r2 = get_r2_client(config)
    bucket = config["R2_BUCKET"]
    src_keys = copy_user_objects(r2, bucket, user_id, src_prefix, dst_prefix, dry_run, dst_user_id)
    if not dry_run:
        verify_r2_copy(r2, bucket, user_id, src_prefix, dst_prefix, src_keys, dst_user_id)
        verify_media_refs(r2, bucket, dst_user_id, dst_prefix)



def main():
    parser = argparse.ArgumentParser(description="Copy a user between environments")
    parser.add_argument("--email", required=True)
    parser.add_argument("--from", dest="from_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--to", dest="to_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument(
        "--to-email",
        default=None,
        help="T7800: clone the source account to this ALIAS email at the destination "
        "(distinct deterministic user_id, google_id nulled) so it can coexist with a "
        "straight copy of the same source account. For e2e fixture accounts only — the "
        "cloned SQLite DBs still carry source-internal data (e.g. display email); "
        "backend routing keys on Postgres email -> user_id, so the fixture works.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--dest-machines-stopped",
        action="store_true",
        help="Acknowledge the destination backend's Fly machines are STOPPED. A LIVE "
        "destination silently reverts the copied profile.sqlite (first-access-only "
        "restore + local-ahead re-upload guard), landing the R2 object half without the "
        "DB half -- the T6150 dangling-media half-apply. Required for --to staging/production.",
    )
    args = parser.parse_args()

    if args.from_env == args.to_env:
        log.error("Source and destination must be different")
        sys.exit(1)

    # A live destination backend holds its own profile.sqlite open and will
    # discard/revert the copied one -- the copy then half-applies silently (the
    # R2 objects land, the DB does not). Stopping the destination machines FIRST
    # makes R2 the sole authority so the copy is atomic and verify_media_refs is
    # meaningful. Refuse rather than silently produce dangling refs.
    if args.to_env in ("staging", "production") and not args.dry_run and not args.dest_machines_stopped:
        log.error(
            f"Refusing to copy into LIVE '{args.to_env}': its backend machines must be STOPPED "
            f"first, or they revert the copied profile.sqlite and leave dangling media refs "
            f"(T6150). Stop the destination machines (fly machine stop / scale to 0), then re-run "
            f"with --dest-machines-stopped."
        )
        sys.exit(1)

    src_config = load_env(args.from_env)
    dst_config = load_env(args.to_env)

    dst_email = args.to_email or args.email
    log.info(f"Copying {args.email}: {args.from_env} -> {args.to_env}"
             + (f" as {dst_email}" if dst_email != args.email else ""))

    # 1. Copy Postgres rows (users + game_storage_refs)
    user_id, dst_user_id = copy_postgres_rows(src_config, dst_config, args.email, args.dry_run, args.to_email)

    # 2. Copy R2 objects (T11500: the service raises AccountCloneError; the CLI maps it to exit 1)
    src_prefix = src_config["APP_ENV"]
    dst_prefix = dst_config["APP_ENV"]
    try:
        copy_r2_objects(src_config, user_id, src_prefix, dst_prefix, args.dry_run, dst_user_id)
    except AccountCloneError as e:
        log.error(f"Account copy FAILED ({e.reason}): {e}")
        sys.exit(1)

    log.info(f"Done. User {args.email} ({user_id}) copied from {args.from_env} to {args.to_env}"
             + (f" as {dst_email} ({dst_user_id})" if dst_user_id != user_id else ""))


if __name__ == "__main__":
    main()
