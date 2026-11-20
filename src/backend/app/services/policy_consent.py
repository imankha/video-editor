"""T18040: the privacy-policy notice and the internal-testing opt-out.

Two facts on the users row (Postgres v051), each written by its own gesture:

- `policy_version_acknowledged`: the policy version the account last acknowledged.
  "Got it" on the in-app notice writes it; a new account gets the current version at
  sign-up (auth_db.create_user, account_clone). An account whose value is not
  CURRENT_POLICY_VERSION sees the notice once.
- `testing_opted_out_at`: when the account turned off the use of its footage for
  internal testing (the switch under "Your privacy rights"). NULL = allowed.

may_use_for_testing() is the single rule for "may this account's footage be used to
test ReelBallers": only once the account has acknowledged the current version and has
not opted out. Scripts that pull footage for tests call it and refuse otherwise
(scripts/copy_user_between_envs.py require_testing_consent).

Bumping the version: change CURRENT_POLICY_VERSION to the new policy's date, together
with LAST_UPDATED in PrivacyPolicy.jsx. Every existing account then sees the notice again
and is not used for testing until it has.
"""

import logging

from app.services.auth_db import forget_user_sessions, get_auth_db

logger = logging.getLogger(__name__)

# The date of the policy the notice announces (PrivacyPolicy.jsx LAST_UPDATED).
CURRENT_POLICY_VERSION = "2026-11-20"


def acknowledge_policy(user_id: str) -> None:
    """Record that the user acknowledged CURRENT_POLICY_VERSION ("Got it")."""
    with get_auth_db() as conn:
        conn.cursor().execute(
            "UPDATE users SET policy_version_acknowledged = %s WHERE user_id = %s",
            (CURRENT_POLICY_VERSION, user_id),
        )
    forget_user_sessions(user_id)  # the remembered session row carries this field
    logger.info(f"[PolicyConsent] acknowledged: user={user_id} version={CURRENT_POLICY_VERSION}")


def set_use_for_testing(user_id: str, allowed: bool) -> None:
    """The "Use my videos to help test and improve ReelBallers" switch.

    Turning it off records the time; turning it back on clears it.
    """
    with get_auth_db() as conn:
        if allowed:
            conn.cursor().execute(
                "UPDATE users SET testing_opted_out_at = NULL WHERE user_id = %s", (user_id,)
            )
        else:
            conn.cursor().execute(
                "UPDATE users SET testing_opted_out_at = now() WHERE user_id = %s", (user_id,)
            )
    forget_user_sessions(user_id)  # the remembered session row carries this field
    logger.info(f"[PolicyConsent] use_for_testing={allowed}: user={user_id}")


def may_use_for_testing(cur, user_id: str) -> bool:
    """May this account's footage be used for internal testing?

    Takes a cursor so a script can ask any environment's database. Raises LookupError
    for an unknown account: "no such user" is never a yes.
    """
    cur.execute(
        "SELECT policy_version_acknowledged, testing_opted_out_at FROM users WHERE user_id = %s",
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise LookupError(f"no users row for {user_id}")
    return (
        row["policy_version_acknowledged"] == CURRENT_POLICY_VERSION
        and row["testing_opted_out_at"] is None
    )
