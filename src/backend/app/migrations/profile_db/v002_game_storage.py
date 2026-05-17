import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V002GameStorage(BaseMigration):
    version = 2
    description = "Create game_storage table, populate from Postgres"

    def up(self, conn):
        conn.execute("""
            CREATE TABLE IF NOT EXISTS game_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blake3_hash TEXT NOT NULL UNIQUE,
                game_size_bytes INTEGER NOT NULL,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        from app.services.pg import get_pg
        from app.user_context import get_current_user_id
        from app.profile_context import get_current_profile_id

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()

        with get_pg() as pg_conn:
            pg_cur = pg_conn.cursor()
            pg_cur.execute(
                """SELECT blake3_hash, game_size_bytes, storage_expires_at, created_at
                   FROM game_storage_refs
                   WHERE user_id = %s AND profile_id = %s""",
                (user_id, profile_id),
            )
            rows = pg_cur.fetchall()

        for row in rows:
            conn.execute(
                """INSERT OR IGNORE INTO game_storage
                   (blake3_hash, game_size_bytes, storage_expires_at, created_at)
                   VALUES (?, ?, ?, ?)""",
                (
                    row["blake3_hash"],
                    row["game_size_bytes"],
                    row["storage_expires_at"].isoformat(),
                    row["created_at"].isoformat(),
                ),
            )

        count = len(rows)
        if count:
            logger.info(
                f"[Migration] Copied {count} storage refs for "
                f"user={user_id[:8]} profile={profile_id[:8]}"
            )
