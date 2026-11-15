"""v048 (T2580): upload_index_checks -- one row per finalized upload saying
whether its MP4 index (moov) sits ahead of the media data, i.e. whether the
file can start playing before it has fully downloaded. Written once at
finalize-upload from a single ranged read of the object's head
(services/upload_index_check.py); read by the admin upload panel. No FK to
users (X-User-ID/e2e users have no users row, same as upload_failures); purged
with the user. Mirrored in services/pg.py _SCHEMA_DDL; the texts must match.
"""

from ..base import BaseMigration


class V048UploadIndexChecks(BaseMigration):
    version = 48
    description = "Add upload_index_checks table (T2580 index-at-front verdict per upload)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS upload_index_checks (
                id             BIGSERIAL PRIMARY KEY,
                checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                user_id        TEXT,
                kind           TEXT NOT NULL,
                blake3_hash    TEXT NOT NULL,
                index_at_front BOOLEAN NOT NULL,
                boxes          TEXT
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_index_checks_checked "
            "ON upload_index_checks(checked_at DESC)"
        )
