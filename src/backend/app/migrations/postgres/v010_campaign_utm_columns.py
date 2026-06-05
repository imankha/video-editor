from ..base import BaseMigration


class V010CampaignUtmColumns(BaseMigration):
    version = 10
    description = "Add UTM and click_source columns to user_segments for campaign attribution"

    def up(self, conn):
        cur = conn.cursor()
        for col in ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "click_source"]:
            cur.execute(f"ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS {col} TEXT")
