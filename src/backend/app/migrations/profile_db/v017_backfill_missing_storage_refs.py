import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V017BackfillMissingStorageRefs(BaseMigration):
    """bug26p: Repair ready games that have no game_storage ref.

    Before bug26p, activate_game wrote storage refs AFTER committing the
    status->ready flip (outside the transaction). A crash / R2 error between the
    commit and the ref inserts left games at status='ready' with NO row in
    game_storage (and no Postgres game_ref_counts entry) — e.g. games 8/9/10 for
    the affected user. Going forward, activate writes refs before the flip and
    self-heals; this migration repairs rows that already reached that bad state.

    Idempotent + safe to re-run: insert_game_storage_ref uses INSERT OR IGNORE on
    game_storage and only increments Postgres game_ref_counts when the SQLite row
    is newly inserted, so hashes that already have a ref are skipped.
    """

    version = 17
    description = "Backfill game_storage refs for ready games missing them (bug26p)"

    def up(self, conn) -> None:
        # Guard: required tables may not exist on a brand-new/empty profile DB.
        for table in ("games", "game_videos", "game_storage"):
            exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if not exists:
                return

        # Find every video hash belonging to a ready game that has no storage ref.
        # Covers both the game_videos rows and the legacy games.blake3_hash column
        # (single-video games created before game_videos existed).
        rows = conn.execute(
            """
            SELECT blake3_hash, video_size FROM (
                SELECT gv.blake3_hash AS blake3_hash, gv.video_size AS video_size
                FROM games g
                JOIN game_videos gv ON gv.game_id = g.id
                WHERE g.status = 'ready' AND gv.blake3_hash IS NOT NULL
                UNION
                SELECT g.blake3_hash AS blake3_hash, g.video_size AS video_size
                FROM games g
                WHERE g.status = 'ready' AND g.blake3_hash IS NOT NULL
            )
            WHERE blake3_hash NOT IN (SELECT blake3_hash FROM game_storage)
            """
        ).fetchall()

        if not rows:
            return

        # Deduplicate by hash (a hash may appear via both sources / multiple games).
        # Keep the largest known size for each hash.
        size_by_hash: dict[str, int] = {}
        for r in rows:
            h = r["blake3_hash"]
            size_by_hash[h] = max(size_by_hash.get(h, 0), r["video_size"] or 0)

        # Delegate to the production write path so Postgres game_ref_counts is
        # incremented too. insert_game_storage_ref opens its OWN connection; this
        # migration's `conn` has only issued reads so far (no open write txn), so
        # there is no SQLite writer-lock contention.
        from app.services.auth_db import insert_game_storage_ref
        from app.services.storage_credits import storage_expires_at
        from app.user_context import get_current_user_id
        from app.profile_context import get_current_profile_id

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()
        expires_str = storage_expires_at().isoformat()

        # Flush any uncommitted writes from earlier migrations in this batch before
        # delegating: insert_game_storage_ref opens its own connection to this same
        # DB file, so an open write transaction here would cause a writer lock.
        conn.commit()

        for h, size in size_by_hash.items():
            insert_game_storage_ref(user_id, profile_id, h, size, expires_str)

        logger.info(
            f"[Migration] bug26p backfilled {len(size_by_hash)} missing storage ref(s) "
            f"for user={user_id[:8]} profile={profile_id[:8]}"
        )
