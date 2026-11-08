"""T8630: the deletion audit trail — one row per users-row deletion event,
answering "who deleted this account, when, through which path, and did it
have money attached" without any personal data. See EPIC.md's 2026-09-03
incident: after a real prod deletion, those four questions were unanswerable
from any table.

Sole writer of the ``account_deletions`` table. Every real delete path (the
ones that actually remove a `users` row — `privacy.delete_account`,
`auth._reset_test_account`, `scripts/delete_user.py::delete_one`) calls
`record_account_deletion` inside the SAME transaction as its `DELETE FROM
users`, so the audit row and the deletion always commit or roll back
together. `_purge_user_data` and `DELETE /api/auth/user` never call this —
neither deletes the `users` row (design §Non-goals).

One row per DELETION EVENT, not one row per user: `id BIGSERIAL PRIMARY KEY`
(design Approved ruling A) — `_reset_test_account` re-creates the same
`user_id`, so a second reset of the same test account must write a SECOND
row, not collide on a duplicate key.
"""

import hashlib
import hmac
import logging
import os
from enum import Enum

logger = logging.getLogger(__name__)

_EMAIL_HASH_SECRET_ENV = "ACCOUNT_DELETION_EMAIL_HASH_SECRET"
# Dev/test convenience only -- a real deployment MUST set the env var or every
# deleted email hashes under this well-known string, which is not a secret at
# all. Guarded loudly in hash_email below.
_INSECURE_DEV_SECRET = "dev-insecure-account-deletion-hash-secret"


def hash_email(email: str) -> str:
    """Keyed (HMAC-SHA256) hash of a normalised email, for `account_deletions.email_hash`
    and the returning-after-deletion lookup at signup (T15290 owner ruling).

    KEYED, never a bare `sha256(email)` -- a bare hash is reversed by a dictionary
    of emails in seconds, defeating the point of hashing it. The key is
    ACCOUNT_DELETION_EMAIL_HASH_SECRET; missing it in staging/production is a
    config error (CRITICAL log, falls back to the insecure dev secret rather than
    crashing a deletion request -- the hash is for recognising a returning person,
    never for restoring data or blocking the request).
    """
    secret = os.getenv(_EMAIL_HASH_SECRET_ENV)
    if not secret:
        app_env = os.getenv("APP_ENV", "dev")
        if app_env in ("staging", "production"):
            logger.critical(
                "[AccountDeletions] %s is not set in APP_ENV=%s -- using the "
                "insecure dev secret. Set it before this reaches real users.",
                _EMAIL_HASH_SECRET_ENV, app_env,
            )
        secret = _INSECURE_DEV_SECRET
    normalized = email.strip().lower().encode("utf-8")
    return hmac.new(secret.encode("utf-8"), normalized, hashlib.sha256).hexdigest()


_email_hash_column_present = False


def _account_deletions_has_email_hash(cur) -> bool:
    """Migration-window guard, same pattern as analytics.segment_has_country: v045
    adds account_deletions.email_hash, and Postgres migrations run after deploy."""
    global _email_hash_column_present
    if not _email_hash_column_present:
        cur.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
            "AND table_name = 'account_deletions' AND column_name = 'email_hash'"
        )
        _email_hash_column_present = cur.fetchone() is not None
    return _email_hash_column_present


class DeletionActor(str, Enum):
    """Closed vocabulary for `account_deletions.actor` (design §3.2).

    ADMIN is reserved but unused (Approved ruling 5) — no code path in T8630
    deletes a `users` row as an admin (impersonation does not delete).
    """

    SELF = "self"
    ADMIN = "admin"
    SCRIPT = "script"


class DeletionPath(str, Enum):
    """Closed vocabulary for `account_deletions.path` (design §3.2).

    The five real users-row-deleting paths, each writing exactly one audit row:
      - PRIVACY_ENDPOINT      privacy.delete_account (user's own erasure request)
      - DELETE_USER_SCRIPT    scripts/delete_user.py::delete_one (hard delete)
      - RESET_TEST_ACCOUNT    auth._reset_test_account (login-time NUF reset)
      - RESET_TEST_USER_SCRIPT scripts/reset-test-user.py (operator NUF reset)
      - COPY_USER_BETWEEN_ENVS scripts/copy_user_between_envs.py, when it removes
                              a destination account (same email, different
                              user_id) before seeding the copied one.
    """

    PRIVACY_ENDPOINT = "privacy_endpoint"
    DELETE_USER_SCRIPT = "delete_user_script"
    RESET_TEST_ACCOUNT = "reset_test_account"
    RESET_TEST_USER_SCRIPT = "reset_test_user_script"
    COPY_USER_BETWEEN_ENVS = "copy_user_between_envs"


def record_account_deletion(
    cur, *, user_id: str, actor: DeletionActor, path: DeletionPath, note: str | None = None,
    email: str | None = None,
) -> None:
    """Insert one `account_deletions` row for this deletion event.

    Reads the `payments` ledger for `had_payments`/`net_cents` BEFORE
    inserting — safe even after `_purge_user_data` has already run, since
    that helper never touches `payments` (a different ledger). Tolerates a
    pre-v031 environment where `payments` and/or `account_deletions` do not
    exist yet (`to_regclass` guards, same pattern as `_purge_user_data`'s
    `upload_failures` check and `stamp_account_deleted` above it in
    `payments_ledger.py`):
      - `payments` absent -> `had_payments=False, net_cents=0` (nothing to
        protect yet).
      - `account_deletions` absent -> log CRITICAL and skip the insert
        rather than raise. The erasure request must still succeed; a missing
        audit row in that narrow deployed-but-not-migrated window is an
        operational note, not a ledger-integrity failure (design §5.5).

    T15290 (owner ruling 2026-11-07): `email`, when given, is hashed (keyed,
    `hash_email`) and stored as `email_hash` so a later sign-up with the same
    email can be recognised as `returning_after_deletion` in analytics -- never
    to restore data, never to block the sign-up. Deliberately omitted by
    `_reset_test_account`/`reset-test-user.py`: those paths recreate the SAME
    user_id under the SAME email immediately, so a hash there would just mark
    every post-reset test login as "returning after deletion", which is noise,
    not the real signal this column exists for. v045 adds the column; until it
    runs the insert below probes for it first (same migration-window guard as
    `segment_has_country`), so a deletion request never fails on a missing
    column.
    """
    actor_value = DeletionActor(actor).value
    path_value = DeletionPath(path).value
    email_hash = hash_email(email) if email else None

    cur.execute("SELECT to_regclass('public.payments') IS NOT NULL AS ok")
    payments_present = cur.fetchone()["ok"]
    if payments_present:
        cur.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS net "
            "FROM payments WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        had_payments = row["c"] > 0
        net_cents = row["net"]
    else:
        had_payments = False
        net_cents = 0

    cur.execute("SELECT to_regclass('public.account_deletions') IS NOT NULL AS ok")
    if not cur.fetchone()["ok"]:
        logger.critical(
            "[AccountDeletions] account_deletions table absent -- skipping audit "
            "insert for user=%s actor=%s path=%s (deployed-but-not-migrated window)",
            user_id, actor_value, path_value,
        )
        return

    if email_hash is not None and _account_deletions_has_email_hash(cur):
        cur.execute(
            """
            INSERT INTO account_deletions (user_id, actor, path, had_payments, net_cents, note, email_hash)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (user_id, actor_value, path_value, had_payments, net_cents, note, email_hash),
        )
    else:
        if email_hash is not None:
            logger.error(
                "[AccountDeletions] account_deletions.email_hash missing (v045 not applied; "
                "run POST /api/admin/migrate-postgres) -- deletion for %s recorded without it",
                user_id,
            )
        cur.execute(
            """
            INSERT INTO account_deletions (user_id, actor, path, had_payments, net_cents, note)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (user_id, actor_value, path_value, had_payments, net_cents, note),
        )
    logger.info(
        "[AccountDeletions] recorded deletion: user=%s actor=%s path=%s "
        "had_payments=%s net_cents=%s",
        user_id, actor_value, path_value, had_payments, net_cents,
    )
