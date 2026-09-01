import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V047BackfillGameStorageRefs(BaseMigration):
    """T6770: rebuild Postgres game_storage_refs from this profile's real
    game_storage rows (the per-profile source of truth).

    Postgres game_ref_counts (the old hand-maintained counter) is retired in
    favor of a derived ref-set: game_storage_refs, one row per
    (user, profile, hash), so ref_count = COUNT(*) can never drift. The
    sibling postgres migration (v025) clears the dead pre-T2930 sediment out
    of game_storage_refs; THIS migration is what actually repopulates it,
    authoritatively, from every profile's SQLite game_storage rows -- this
    doubles as the one-time reconciliation of all existing drift (missing
    rows, negative counts) the 2026-07-23 retrospective flagged as a smaller
    open item, since every row here is derived fresh from the real per-profile
    state rather than carried forward from a possibly-drifted counter.

    Idempotent + safe to re-run: insert_game_storage_ref_pg_only is an
    ON CONFLICT (user_id, profile_id, blake3_hash) DO UPDATE upsert.
    """

    version = 47
    description = "Backfill Postgres game_storage_refs from this profile's game_storage rows"

    def up(self, conn) -> None:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_storage'"
        ).fetchone()
        if not exists:
            return

        # up(conn) gets a TUPLE row factory (migrations/__init__.py), not
        # sqlite3.Row -- index positionally (memory: v017 rowfactory bug hit
        # 4 prod users when this was string-indexed instead).
        rows = conn.execute(
            "SELECT blake3_hash, game_size_bytes, storage_expires_at FROM game_storage"
        ).fetchall()
        if not rows:
            return

        from app.profile_context import get_current_profile_id
        from app.services.auth_db import insert_game_storage_ref_pg_only
        from app.user_context import get_current_user_id

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()

        # T8190: this data came FROM game_storage (the query above), so the
        # SQLite half is a pure no-op -- write Postgres only. NEVER call the
        # full insert_game_storage_ref (or anything else that reaches
        # get_db_connection) from inside a migration: that re-enters the JIT
        # seam lock this thread already holds and deadlocks the process.
        for h, size, expires_str in rows:
            insert_game_storage_ref_pg_only(user_id, profile_id, h, size or 0, expires_str)

        logger.info(
            f"[Migration] v047 backfilled {len(rows)} game_storage_refs row(s) "
            f"for user={user_id[:8]} profile={profile_id[:8]}"
        )
