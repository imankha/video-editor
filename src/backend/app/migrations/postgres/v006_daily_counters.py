from ..base import BaseMigration


class V006DailyCounters(BaseMigration):
    version = 6
    description = "Create daily_counters table and backfill signups from user_milestones"

    def up(self, conn):
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_counters (
                counter_date DATE NOT NULL DEFAULT CURRENT_DATE,
                origin_type TEXT NOT NULL DEFAULT 'all',
                signups INTEGER NOT NULL DEFAULT 0,
                games_created INTEGER NOT NULL DEFAULT 0,
                clips_created INTEGER NOT NULL DEFAULT 0,
                exports_completed INTEGER NOT NULL DEFAULT 0,
                exports_failed INTEGER NOT NULL DEFAULT 0,
                shares_completed INTEGER NOT NULL DEFAULT 0,
                credit_purchases INTEGER NOT NULL DEFAULT 0,
                credits_consumed INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (counter_date, origin_type)
            )
        """)

        cur.execute("""
            INSERT INTO daily_counters (counter_date, origin_type, signups)
            SELECT install_day, origin_type, COUNT(*)
            FROM user_milestones
            GROUP BY install_day, origin_type
            ON CONFLICT (counter_date, origin_type)
            DO UPDATE SET signups = EXCLUDED.signups
        """)

        cur.execute("""
            INSERT INTO daily_counters (counter_date, origin_type, signups)
            SELECT install_day, 'all', COUNT(*)
            FROM user_milestones
            GROUP BY install_day
            ON CONFLICT (counter_date, origin_type)
            DO UPDATE SET signups = EXCLUDED.signups
        """)
