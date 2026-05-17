from ..base import BaseMigration


class V002GameRefCounts(BaseMigration):
    version = 2
    description = "Create game_ref_counts, drop deprecated columns"

    def up(self, conn):
        cur = conn.cursor()

        # Create lightweight global ref count table with game-level expiry
        cur.execute("""
            CREATE TABLE IF NOT EXISTS game_ref_counts (
                blake3_hash TEXT PRIMARY KEY,
                ref_count INTEGER NOT NULL DEFAULT 0,
                latest_expiry TIMESTAMPTZ NOT NULL
            )
        """)

        # Populate from existing game_storage_refs data
        cur.execute("""
            INSERT INTO game_ref_counts (blake3_hash, ref_count, latest_expiry)
            SELECT blake3_hash, COUNT(*), MAX(storage_expires_at)
            FROM game_storage_refs
            GROUP BY blake3_hash
            ON CONFLICT (blake3_hash) DO UPDATE
                SET ref_count = EXCLUDED.ref_count,
                    latest_expiry = EXCLUDED.latest_expiry
        """)

        # Drop deprecated columns
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS credit_summary")
        cur.execute("ALTER TABLE shares DROP COLUMN IF EXISTS watched_at")
