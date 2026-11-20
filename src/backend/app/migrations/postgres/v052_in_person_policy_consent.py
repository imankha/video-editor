"""v052 (T18040): record the accounts whose owners agreed in person to testing use.

Before the in-app notice existed, internal testing used only the footage of accounts whose
owners had agreed in person: the owner and two partners (owner ruling, 2026-11-20). This
records them as having acknowledged the 2026-11-20 policy, so may_use_for_testing() is true
for them and they do not see the notice. A missing email on an environment is skipped.
An account that already acknowledged a version is left as it is.
"""

from ..base import BaseMigration

IN_PERSON_EMAILS = ("imankh@gmail.com", "sarkarati@gmail.com", "arshia.kalentari@gmail.com")

# The policy version they agreed to. A literal, not policy_consent.CURRENT_POLICY_VERSION:
# a later policy bump must not change what this migration recorded.
AGREED_POLICY_VERSION = "2026-11-20"


class V052InPersonPolicyConsent(BaseMigration):
    version = 52
    description = "Record the in-person testing-consent accounts as acknowledged (T18040)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET policy_version_acknowledged = %s "
            "WHERE email = ANY(%s) AND policy_version_acknowledged IS NULL",
            (AGREED_POLICY_VERSION, list(IN_PERSON_EMAILS)),
        )
