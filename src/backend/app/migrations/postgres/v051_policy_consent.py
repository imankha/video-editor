"""v051 (T18040): the privacy-policy notice and the internal-testing opt-out, on `users`.

- `policy_version_acknowledged` TEXT: the policy version (its date) the account last
  acknowledged, by "Got it" on the in-app notice or by signing up. NULL = never told.
- `testing_opted_out_at` TIMESTAMPTZ: when the account turned off the use of its footage
  for internal testing. NULL = allowed.

Existing rows stay NULL on both: an existing account has not been told about the
2026-11-20 change, so it sees the notice and its footage is not used for testing until
it has (services/policy_consent.may_use_for_testing). Both values live on the users row,
so deleting the account removes them.

Additive and idempotent.
"""

from ..base import BaseMigration


class V051PolicyConsent(BaseMigration):
    version = 51
    description = "Add users.policy_version_acknowledged + testing_opted_out_at (T18040)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_version_acknowledged TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS testing_opted_out_at TIMESTAMPTZ")
