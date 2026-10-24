"""
v036 (T13330): daily_counters gains `paywall_shown` and `buy_modal_opened`.

The tries side of the purchase funnel: the insufficient-credits modal and the
buy modal opens, so purchases (`credit_purchases`) have a denominator.

Additive, idempotent (IF NOT EXISTS), no backfill: no such events exist before
these columns do, so a zero default is correct history.
"""

from ..base import BaseMigration


class V036DailyCountersPaywall(BaseMigration):
    version = 36
    description = "Add daily_counters.paywall_shown / buy_modal_opened (T13330 purchase-funnel tries)"

    def up(self, conn):
        cur = conn.cursor()
        for col in ("paywall_shown", "buy_modal_opened"):
            cur.execute(
                f"ALTER TABLE daily_counters ADD COLUMN IF NOT EXISTS {col} INTEGER NOT NULL DEFAULT 0"
            )
