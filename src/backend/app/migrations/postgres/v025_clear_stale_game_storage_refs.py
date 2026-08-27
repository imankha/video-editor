import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V025ClearStaleGameStorageRefs(BaseMigration):
    """T6770: clear pre-T2930 sediment out of game_storage_refs before it
    becomes the live derived ref-set again.

    game_storage_refs has had no writer since the v002/T2930 refactor (v002
    aggregated it INTO game_ref_counts and nothing has written it since --
    confirmed prod finding 2026-08-24: 8 rows total, newest 2026-05-15, all one
    team account). Those rows do not reflect any profile's current
    game_storage state, so wipe them here; the profile_db backfill migration
    (v047_backfill_game_storage_refs) repopulates the table authoritatively
    from each profile's real SQLite game_storage rows.

    game_ref_counts is intentionally left in place (declared-but-dead, not
    dropped) so this change stays reversible -- a follow-up migration drops it
    once the derived ref-set is confirmed in prod.
    """

    version = 25
    description = "Clear stale pre-T2930 game_storage_refs rows before reviving it as the derived ref-set"

    def up(self, conn) -> None:
        cur = conn.cursor()
        cur.execute("DELETE FROM game_storage_refs")
        logger.info(f"[Migration] v025 cleared {cur.rowcount} stale game_storage_refs row(s)")
