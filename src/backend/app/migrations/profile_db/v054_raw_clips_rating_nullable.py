"""
v054 (T10690/T10700): raw_clips.rating becomes nullable (INTEGER NOT NULL -> INTEGER).

**Domain widening, not a data correction.** Every existing `rating` value (1..5)
is a real star the product intended; none of it is wrong and none of it is
rewritten. This migration makes NULL a newly LEGAL value so the app can say
"this play has no rating on record" -- a statement it cannot make today. This
is deliberately NOT the CLAUDE.md "correct data via migration" case (see
coding-standards.md Sec "Correct data, not workarounds") -- there is no
backfill here, and there should never be one.

SQLite cannot ALTER COLUMN ... DROP NOT NULL, so this is a full rebuild-and-copy
(SQLite's documented 12-step ALTER procedure) -- the FIRST such rebuild in
profile_db/ (every prior migration here is ADD COLUMN / DROP COLUMN only).

Three tables carry a cascading FK to raw_clips(id) ON DELETE CASCADE:
working_clips (database.py ~1256), modal_tasks (~1519), clip_teammates (~1690).
Under `foreign_keys=ON` (the setting both database.py's get_db_connection() and
materialization.py's opener use), a bare `DROP TABLE raw_clips` is an implicit
cascading DELETE and would silently wipe every working clip in the profile. This
migration forces `PRAGMA foreign_keys=OFF` around the rebuild REGARDLESS of the
caller's setting -- it must not depend on the seam connection's default (which
happens to be OFF today, since migrations/__init__.py's run_profile_seam opens a
plain `sqlite3.connect` with no pragma set).

Also captures and replays the raw_clips indexes (sqlite_master), and captures +
restores sqlite_sequence.seq (MAX(old, new)) so a deleted-then-recreated id is
never reused -- a published reel's frozen final_videos.source_clip_id (T3630)
would otherwise silently re-point at the wrong play.

Crash safety: this is the first profile_db migration that COMMITS inside up().
If the process dies between this migration's own COMMIT and the runner
stamping `PRAGMA user_version = 54`, the DB is left nullable at schema v053.
A re-run of this migration is a safe no-op: guard #1 (table missing) and guard
#2 (rating already nullable) short-circuit before touching anything.

See docs/plans/tasks/T10690-design.md Sec 3.A.1 for the full hazard table and
pseudocode this migration follows verbatim.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# Literal head DDL for raw_clips as of v053 (database.py ~1179-1213), with
# `rating INTEGER NOT NULL` widened to `rating INTEGER`. Kept as an explicit
# column list (never SELECT *) so the copy step is reviewable and a schema
# drift is a loud assertion failure, not a silent data drop.
_EXPECTED_COLUMNS = [
    "id",
    "filename",
    "rating",
    "tags",
    "name",
    "notes",
    "start_time",
    "end_time",
    "game_id",
    "auto_project_id",
    "default_highlight_regions",
    "video_sequence",
    "tagged_teammates",
    "my_athlete",
    "shared_by",
    "boundaries_version",
    "boundaries_updated_at",
    "reel_source_start_time",
    "reel_source_end_time",
    "source",
    "created_at",
]

_COLUMN_LIST_SQL = ", ".join(_EXPECTED_COLUMNS)

_CREATE_TABLE_SQL = """
    CREATE TABLE raw_clips_v054 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        rating INTEGER,
        tags BLOB,
        name TEXT,
        notes TEXT,
        start_time REAL,
        end_time REAL,
        game_id INTEGER,
        auto_project_id INTEGER,
        default_highlight_regions BLOB,
        video_sequence INTEGER,
        tagged_teammates BLOB DEFAULT NULL,
        my_athlete INTEGER DEFAULT 1,
        shared_by TEXT DEFAULT NULL,
        boundaries_version INTEGER DEFAULT 1,
        boundaries_updated_at TIMESTAMP,
        reel_source_start_time REAL,
        reel_source_end_time REAL,
        source TEXT NOT NULL DEFAULT 'game',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY (auto_project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
"""


class V054RawClipsRatingNullable(BaseMigration):
    version = 54
    description = "Make raw_clips.rating nullable (true 'unset' rating state, T10690)"

    def up(self, conn) -> None:
        # 1a. Guard: table missing entirely (minimal test fixture / brand-new
        # profile whose CREATE TABLE path stamps head shape directly) -- same
        # pattern as v049/v053.
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_table:
            return

        # 1b. Guard: PRAGMA table_info rows are TUPLES under the migration
        # runner's connection (plain sqlite3.connect, no row_factory set --
        # confirmed in migrations/__init__.py's run_profile_seam) -- index
        # positionally (row[1]=name, row[3]=notnull; v017 landmine).
        cols = conn.execute("PRAGMA table_info(raw_clips)").fetchall()
        col_by_name = {row[1]: row for row in cols}
        rating_row = col_by_name.get("rating")
        if rating_row is not None and rating_row[3] == 0:
            # Already nullable -- safe no-op re-run (crash-safety case above,
            # or a duplicate seam invocation).
            return

        # 1c. Guard: refuse rather than silently drop an unexpected column.
        actual_columns = set(col_by_name.keys())
        expected_columns = set(_EXPECTED_COLUMNS)
        if actual_columns != expected_columns:
            raise RuntimeError(
                f"[v054] raw_clips column set does not match the expected v053 "
                f"shape; refusing to rebuild (would silently drop data). "
                f"unexpected={actual_columns - expected_columns} "
                f"missing={expected_columns - actual_columns}"
            )

        # 2. Capture what DROP TABLE would destroy, BEFORE any drop.
        index_sqls = [
            row[0]
            for row in conn.execute(
                "SELECT sql FROM sqlite_master "
                "WHERE type='index' AND tbl_name='raw_clips' AND sql IS NOT NULL"
            ).fetchall()
        ]
        seq_row = conn.execute(
            "SELECT seq FROM sqlite_sequence WHERE name='raw_clips'"
        ).fetchone()
        old_seq = seq_row[0] if seq_row is not None else None
        old_count = conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0]

        # 3. FK-safe window. PRAGMA foreign_keys is a no-op inside an open
        # transaction, so commit first; then force OFF regardless of the
        # caller's setting (database.py / materialization.py both open with
        # foreign_keys=ON, and a DROP TABLE under FK-ON cascade-deletes
        # working_clips/modal_tasks/clip_teammates rows).
        if conn.in_transaction:
            conn.commit()
        prior_fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        conn.execute("PRAGMA foreign_keys = OFF")
        try:
            conn.execute("BEGIN IMMEDIATE")

            # 4. New table: byte-identical to the current raw_clips DDL except
            # `rating INTEGER NOT NULL` -> `rating INTEGER`.
            conn.execute(_CREATE_TABLE_SQL)

            # 5. Copy, naming every column explicitly -- never SELECT *.
            conn.execute(
                f"INSERT INTO raw_clips_v054 ({_COLUMN_LIST_SQL}) "
                f"SELECT {_COLUMN_LIST_SQL} FROM raw_clips"
            )
            new_count = conn.execute("SELECT COUNT(*) FROM raw_clips_v054").fetchone()[0]
            if new_count != old_count:
                raise RuntimeError(
                    f"[v054] row count mismatch after copy: raw_clips had "
                    f"{old_count}, raw_clips_v054 has {new_count}; aborting rebuild"
                )

            # 6-7. Swap. FK clauses in OTHER tables reference raw_clips BY NAME
            # (not internal rowid), and foreign_keys is OFF, so this rename
            # does not touch/break those references.
            conn.execute("DROP TABLE raw_clips")
            conn.execute("ALTER TABLE raw_clips_v054 RENAME TO raw_clips")

            # 8. Restore what the drop destroyed.
            for index_sql in index_sqls:
                conn.execute(index_sql)
            if old_seq is not None:
                conn.execute(
                    "UPDATE sqlite_sequence SET seq = MAX(?, seq) WHERE name='raw_clips'",
                    (old_seq,),
                )

            # 9. Verify before committing.
            fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if fk_violations:
                raise RuntimeError(
                    f"[v054] foreign_key_check found {len(fk_violations)} "
                    f"violation(s) after rebuild; aborting"
                )

            conn.commit()
            logger.info(
                "[v054] raw_clips rebuilt with nullable rating; %s rows preserved, "
                "%s indexes replayed", new_count, len(index_sqls),
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute(f"PRAGMA foreign_keys = {prior_fk}")
