"""T8630 round 3: anonymize a deleted user's ``bug_reports`` rows.

A real account deletion keeps the *text* of the reports the user submitted (the
``description``, useful to keep fixing the problems they hit) but strips every
identifying / device / attachment column, and deletes the R2 screenshot and
console-log objects the row referenced. Applies to the three REAL deletion paths
(``privacy.delete_account``, ``scripts/delete_user.py``,
``scripts/copy_user_between_envs.py``); NOT the two NUF test-reset paths
(``auth._reset_test_account``, ``scripts/reset-test-user.py``), where the same
email logs straight back in and its own historical reports should stay intact.

``bug_reports`` has NO ``user_id`` column -- rows are keyed by ``reporter_email``
(see ``pg.py`` ``_SCHEMA_DDL``), so anonymization matches on the email and there
is no ``user_id`` link to keep or null.

Column decisions across the WHOLE ``bug_reports`` schema (pg.py):
  KEPT:
    ``id``                     -- primary key
    ``description``            -- the report TEXT, kept to fix problems
    ``build``                  -- app build string (a release tag, not a device
                                  or personal identifier)
    ``status`` / ``duplicate_of`` / ``admin_notes``  -- triage + category state,
                                  our operational data, not the reporter's
    ``client_report_id``       -- opaque idempotency key (a client-minted UUID,
                                  no personal data)
    ``created_at`` / ``updated_at`` / ``resolved_at``  -- timestamps
  CLEARED (set NULL):
    ``reporter_email``         -- the user's email address
    ``page_url``               -- can embed profile / share / session identifiers
                                  in its path or query string
    ``user_agent``             -- device / browser fingerprint
    ``editor_context``         -- the user's editor state (project/game names are
                                  user-authored free text = personal data)
    ``actions``                -- the user's recent action trail (behavioral data)
    ``console_logs``           -- captured client logs (can carry ids / free text)
    ``screenshot_r2_key`` / ``logs_r2_key``  -- references to the R2 attachments
                                  we delete after the transaction commits
"""

import logging

logger = logging.getLogger(__name__)

# Columns cleared on anonymization -- keep this list and the module docstring in
# sync. Each is set to NULL; none is dropped, so admin tooling that SELECTs them
# still works (it just reads NULLs for an anonymized report).
_CLEARED_COLUMNS = (
    "reporter_email",
    "page_url",
    "user_agent",
    "editor_context",
    "actions",
    "console_logs",
    "screenshot_r2_key",
    "logs_r2_key",
)


def anonymize_bug_reports(cur, email: str) -> list[str]:
    """Strip identifying columns from every ``bug_reports`` row for ``email``,
    keeping ``description`` and the triage/category state.

    Runs in the caller's OPEN transaction (cursor passed in), same contract as
    ``account_deletions.record_account_deletion`` and
    ``payments_ledger.stamp_account_deleted`` -- the row edit commits or rolls
    back with the caller's ``DELETE FROM users``.

    Returns the list of R2 object keys (screenshots + console logs) the caller
    must delete AFTER the transaction commits -- R2 deletion is not
    transactional, so it belongs with the other post-commit storage purges, not
    inside this write. Tolerates a pre-v008 environment with no ``bug_reports``
    table (``to_regclass`` guard) and a missing email -> returns ``[]``.
    """
    if not email:
        return []
    cur.execute("SELECT to_regclass('public.bug_reports') IS NOT NULL AS ok")
    if not cur.fetchone()["ok"]:
        return []

    cur.execute(
        "SELECT screenshot_r2_key, logs_r2_key FROM bug_reports WHERE reporter_email = %s",
        (email,),
    )
    r2_keys: list[str] = []
    for row in cur.fetchall():
        for key in (row["screenshot_r2_key"], row["logs_r2_key"]):
            if key:
                r2_keys.append(key)

    set_clause = ", ".join(f"{col} = NULL" for col in _CLEARED_COLUMNS)
    cur.execute(
        f"UPDATE bug_reports SET {set_clause} WHERE reporter_email = %s",
        (email,),
    )
    logger.info(
        "[BugReports] anonymized %s bug_reports row(s) for a deleted account "
        "(kept description/build/status; cleared email/device/logs; %s R2 object(s) to purge)",
        cur.rowcount, len(r2_keys),
    )
    return r2_keys
