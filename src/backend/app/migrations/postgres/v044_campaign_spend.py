"""
v044 (T15200): `campaigns` gains paid-ads spend tracking columns.

`channel` is the ad channel the admin picked when entering spend (distinct from `origin`,
which stays the short registry id); `spend_cents`/`landing_views`/`platform_conversions` are
retyped by the admin from the ad platform's own dashboard, so they are user-entered, not
derived. `spend_updated_at` is stamped whenever any of the three numbers (or `channel`)
changes, for the Live campaigns block.

All five columns are nullable: a campaign created before this migration (or before any admin
enters spend) is a benchmark-only row until someone fills them in. Additive and idempotent.
"""

from ..base import BaseMigration

_CHANNELS = ("coach_credits", "coach_gift", "reddit", "meta", "club")


class V044CampaignSpend(BaseMigration):
    version = 44
    description = "Add campaigns spend-tracking columns (T15200 paid-ads registry)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel TEXT "
            f"CHECK (channel IN {_CHANNELS!r})"
        )
        cur.execute(
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spend_cents INTEGER CHECK (spend_cents >= 0)"
        )
        cur.execute(
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS landing_views INTEGER CHECK (landing_views >= 0)"
        )
        cur.execute(
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS platform_conversions INTEGER "
            "CHECK (platform_conversions >= 0)"
        )
        cur.execute(
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spend_updated_at TIMESTAMPTZ"
        )
