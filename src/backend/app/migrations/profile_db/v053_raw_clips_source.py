"""
v053 (T10300): raw_clips gains `source TEXT NOT NULL DEFAULT 'game'`.

Discriminates a directly-uploaded clip ('upload') from an annotate-cut game clip
('game'), so that (per T10300-design.md):
  - D2 idempotency keys on `filename AND source='upload'` (immutable), not the
    now-mutable `game_id IS NULL` -- a re-upload finds the row even after it has
    been linked to a game.
  - D1 the game-cut natural key (game_id + end_time + video_sequence) is scoped to
    source='game', so a linked upload clip never collides with an annotate cut.
  - D3 game deletion UNLINKS source='upload' clips (keeps them) while the FK still
    CASCADE-deletes source='game' clips.

Backfill is SOUND on the pre-T10300 invariant that direct uploads are the ONLY
clips created with game_id IS NULL: `save_raw_clip` requires a real game_id (and
404s a ghost game), and share-materialization always inserts with the copied
game_id. Both direct-upload insert sites (batch /clips/upload and
/clips/.../upload-with-metadata) wrote game_id NULL. So `source='upload' WHERE
game_id IS NULL` labels exactly the upload clips; every other existing row keeps
the 'game' default.

Additive + idempotent (PRAGMA table_info guard). Self-sufficient: needs no raw R2
data -- it re-derives source purely from the existing game_id column.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V053RawClipsSource(BaseMigration):
    version = 53
    description = "Add raw_clips.source ('game'/'upload') for T10300 upload-clip linking"

    def up(self, conn) -> None:
        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
        if "source" in cols:
            return

        conn.execute("ALTER TABLE raw_clips ADD COLUMN source TEXT NOT NULL DEFAULT 'game'")
        # Backfill: the only pre-T10300 rows with a NULL game_id are direct uploads.
        updated = conn.execute(
            "UPDATE raw_clips SET source = 'upload' WHERE game_id IS NULL"
        ).rowcount
        logger.info("[v053] added raw_clips.source; backfilled %s upload rows", updated)
