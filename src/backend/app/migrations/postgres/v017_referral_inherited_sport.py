from ..base import BaseMigration


class V017ReferralInheritedSport(BaseMigration):
    version = 17
    description = "Add referrals.inherited_sport snapshot for sport inheritance through invite (T2915)"

    def up(self, conn):
        conn.cursor().execute(
            "ALTER TABLE referrals ADD COLUMN IF NOT EXISTS inherited_sport TEXT"
        )
