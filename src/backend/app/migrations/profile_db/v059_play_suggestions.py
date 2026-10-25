"""
T13210 -- v059 profile_db migration: create play_suggestions.

A Veo highlights zip imported onto a game becomes ~35 SUGGESTED plays: rows here, NOT
raw_clips, so they never reach Watch plays, recap, extracts, counts, sharing or Keep Only
Marked Plays. A suggestion becomes a real play only through the user's rate-to-keep tap
(POST /api/suggestions/{id}/accept). Times are in the game video's own timeline
(video_sequence), never the virtual timeline, so offset_seconds edits cannot desync them.

Idempotent (CREATE ... IF NOT EXISTS); fresh DBs get the same DDL from ensure_database().
Applies at the per-user JIT seam on next access. No backfill: the table starts empty.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)

PLAY_SUGGESTIONS_DDL = """
    CREATE TABLE IF NOT EXISTS play_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        import_id TEXT NOT NULL,
        video_sequence INTEGER NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        labels TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        raw_clip_id INTEGER REFERENCES raw_clips(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
"""
PLAY_SUGGESTIONS_INDEX_DDL = (
    "CREATE INDEX IF NOT EXISTS idx_play_suggestions_game ON play_suggestions(game_id, import_id)"
)


class V059PlaySuggestions(BaseMigration):
    version = 59
    description = "Create play_suggestions: Veo moments awaiting a rate-to-keep gesture (T13210)"

    def up(self, conn) -> None:
        conn.execute(PLAY_SUGGESTIONS_DDL)
        conn.execute(PLAY_SUGGESTIONS_INDEX_DDL)
        logger.info("[v059] ensured play_suggestions")
