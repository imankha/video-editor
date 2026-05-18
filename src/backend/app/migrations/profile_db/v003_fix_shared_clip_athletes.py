import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V003FixSharedClipAthletes(BaseMigration):
    version = 3
    description = "Backfill my_athlete=0 and tagged_teammates for shared clips"

    def up(self, conn):
        from app.services.pg import get_pg
        from app.utils.encoding import encode_data

        # Fix 1: Set my_athlete=0 for all materialized (shared) clips
        cur = conn.cursor()
        cur.execute(
            "UPDATE raw_clips SET my_athlete = 0 WHERE shared_by IS NOT NULL AND my_athlete = 1"
        )
        fixed_my_athlete = cur.rowcount

        # Fix 2: Backfill tagged_teammates with sharer's profile name
        cur.execute(
            "SELECT DISTINCT shared_by FROM raw_clips WHERE shared_by IS NOT NULL AND tagged_teammates IS NULL"
        )
        sharer_emails = [row[0] for row in cur.fetchall()]

        if not sharer_emails:
            if fixed_my_athlete:
                logger.info(f"[Migration v003] Fixed my_athlete on {fixed_my_athlete} shared clips")
            return

        # Look up sharer profile names from Postgres + user.sqlite
        email_to_name = {}
        with get_pg() as pg_conn:
            pg_cur = pg_conn.cursor()
            for email in sharer_emails:
                pg_cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
                row = pg_cur.fetchone()
                if not row:
                    continue
                user_id = row["user_id"]
                try:
                    from app.services.user_db import get_profiles
                    profiles = get_profiles(user_id)
                    default = next((p for p in profiles if p.get("is_default")), None)
                    profile = default or (profiles[0] if profiles else None)
                    if profile and profile.get("name"):
                        email_to_name[email] = profile["name"]
                except Exception:
                    pass

        backfilled = 0
        for email, name in email_to_name.items():
            athletes_blob = encode_data([name])
            cur.execute(
                "UPDATE raw_clips SET tagged_teammates = ? WHERE shared_by = ? AND tagged_teammates IS NULL",
                (athletes_blob, email),
            )
            backfilled += cur.rowcount

        logger.info(
            f"[Migration v003] Fixed my_athlete on {fixed_my_athlete} clips, "
            f"backfilled tagged_teammates on {backfilled} clips "
            f"({len(email_to_name)}/{len(sharer_emails)} sharer names resolved)"
        )
