"""v034: Intro card library — `intro_cards` table + `final_videos.intro_card_id`
(T5195, Player Intro + Rich Text epic).

Verified 2026-08-04: master profile_db head is v033
(v033_heal_moved_reel_attribution.py); no unmerged sibling branch claims v034
(only `master` exists on the remote). The runner applies ONLY versions GREATER
than the DB's current user_version, so a duplicate number is silently skipped
and this table would never be created (the T6340 class of bug) — re-verify at
implementation time, not just here.

Two additive changes, one deploy window (even though T5215 owns the
`intro_card_id` behaviour, adding the column here keeps it to a single migration):

- CREATE TABLE `intro_cards` — the per-profile card library (epic decision 7: a
  card names one athlete and its media lives under the per-profile R2 prefix, so
  the row belongs beside the media). There is deliberately NO template/layout
  column — composition is DERIVED from `(has_photo, len(shown_fields))` in
  `app/services/intro_cards.derive_composition` (epic decision 2). `focal_x` /
  `focal_y` / `zoom` are NULLABLE = inherit the profile's framing (decision 3b);
  do not default them.

- ALTER TABLE `final_videos` ADD COLUMN `intro_card_id INTEGER` (nullable).
  **NULL and 0 mean DIFFERENT things** (epic decision 8): NULL = inherit the
  profile's default card; 0 = the user explicitly chose NO intro for this reel.
  A later reader WILL try to collapse them — do not. Legacy rows stay NULL
  (correct: "inherit the default").

Idempotent: CREATE TABLE IF NOT EXISTS; the column is added only when missing
(mirrors v024/v030/v032).

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` == column name; the v017 landmine that crashed 4 prod users). This
migration only introspects schema, but the discipline is kept.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# Kept in step with database.py::ensure_database()'s intro_cards DDL — a fresh
# profile gets the table from ensure_database(); an existing profile gets it here.
_INTRO_CARDS_DDL = """
CREATE TABLE IF NOT EXISTS intro_cards (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,        -- library label; NEVER rendered into the video
    shown_fields      TEXT NOT NULL,        -- JSON list, subset of ['position','class','team']
    treatment         TEXT NOT NULL,        -- 'gold' | 'dark' | 'photo-forward'
    title_text        TEXT,                 -- DEAD as of T6620: title = profile Full Name ALWAYS, never read. Was a pre-T6570 override; T6620 removed the read paths + nulls this column (v036). Do NOT reintroduce override semantics.
    image_key         TEXT,                 -- R2 key from T5190
    image_cutout_key  TEXT,                 -- nullable, set by T5200
    focal_x           REAL,                 -- NULL = inherit the profile's framing (decision 3b)
    focal_y           REAL,                 -- NULL = inherit
    zoom              REAL,                 -- NULL = inherit
    text_elements     BLOB,                 -- msgpack: { slot_name: TextSpec }  STYLING ONLY
    duration          REAL NOT NULL DEFAULT 4.0,
    is_default        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
)
"""


class V034IntroCardLibrary(BaseMigration):
    version = 34
    description = "Add intro_cards table + final_videos.intro_card_id (T5195)"

    def up(self, conn) -> None:
        conn.execute(_INTRO_CARDS_DDL)
        logger.info("[v034] ensured intro_cards table")

        has_final_videos = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if has_final_videos:
            # PRAGMA table_info rows are TUPLES under the migration runner's row
            # factory -> index positionally (row[1] == column name; v017 landmine).
            cols = {row[1] for row in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
            if "intro_card_id" not in cols:
                # Nullable, no default -> legacy rows read NULL = "inherit the
                # profile default" (decision 8). NULL != 0; 0 is set explicitly
                # only when the user opts a reel out of intros.
                conn.execute("ALTER TABLE final_videos ADD COLUMN intro_card_id INTEGER")
                logger.info("[v034] added final_videos.intro_card_id")
