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

import logging
from enum import Enum

logger = logging.getLogger(__name__)


class DeletionActor(str, Enum):
    """Closed vocabulary for `account_deletions.actor` (design §3.2).

    ADMIN is reserved but unused (Approved ruling 5) — no code path in T8630
    deletes a `users` row as an admin (impersonation does not delete).
    """

    SELF = "self"
    ADMIN = "admin"
    SCRIPT = "script"


class DeletionPath(str, Enum):
    """Closed vocabulary for `account_deletions.path` (design §3.2)."""

    PRIVACY_ENDPOINT = "privacy_endpoint"
    DELETE_USER_SCRIPT = "delete_user_script"
    RESET_TEST_ACCOUNT = "reset_test_account"


def record_account_deletion(
    cur, *, user_id: str, actor: DeletionActor, path: DeletionPath, note: str | None = None
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
    """
    actor_value = DeletionActor(actor).value
    path_value = DeletionPath(path).value

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
