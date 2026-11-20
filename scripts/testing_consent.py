"""T18040: the guard every script that pulls a user's footage for testing calls.

The rule itself lives in the backend (app/services/policy_consent.may_use_for_testing):
an account's footage may be used to test ReelBallers only once it has acknowledged the
current privacy policy and has not turned off "Use my videos to help test and improve
ReelBallers". This module turns a "no" into a refusal that stops the script before it
copies anything.

    from testing_consent import require_testing_consent
    require_testing_consent(src_cur, user_id, email)   # exits non-zero when not allowed
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src" / "backend"))

from app.services.policy_consent import CURRENT_POLICY_VERSION, may_use_for_testing


def require_testing_consent(cur, user_id: str, email: str) -> None:
    """Exit (SystemExit) unless may_use_for_testing() is true for this account.

    `cur` is a RealDictCursor on the SOURCE environment's Postgres: consent is recorded
    where the account lives.
    """
    if not may_use_for_testing(cur, user_id):
        sys.exit(
            f"Refusing: the footage of {email} ({user_id}) may not be used for testing. "
            f"The account has turned off 'Use my videos to help test and improve ReelBallers', "
            f"or has not yet acknowledged the privacy policy of {CURRENT_POLICY_VERSION} (T18040)."
        )
