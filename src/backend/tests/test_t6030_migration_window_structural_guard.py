"""T6030 Part 2: the STRUCTURAL guard.

T5970 audited every profile_db `ADD COLUMN` by hand once. The next `ADD COLUMN`
someone writes reopens the exact same deploy->migrate-window hole (a hot read that
names a not-yet-migrated column -> `sqlite3.OperationalError: no such column` -> 500),
and nothing fails to warn them. This test makes the window a *tested property*: it
builds a real profile DB at a below-head schema WITH ROWS and drives every hot-path
read, asserting none raises `OperationalError` for a missing column.

Auto-extension decision (CLAUDE.md refactoring rule 6 -- greppable explicitness over
registry magic):
  The profile_db migrations cannot be run forward in a lightweight test (v002 already
  needs the Postgres pool + user/profile context; v017-v023 need R2), so we cannot
  DERIVE the below-head schema by replaying the registry. Instead we DROP an EXPLICIT,
  greppable set of the realistically-missing columns (`POST_V023_COLUMNS`) off a fresh
  head DB. Per T5970's audit the only columns that can be missing on a live prod DB are
  v024+ (prod is >= v18; profile_db v017-v023 add NO columns), so v023 is the floor.
  This does NOT auto-COVER a future v030 column, but `test_registry_head_is_audited`
  turns the next added migration RED with instructions -- so a new `ADD COLUMN` cannot
  land silently unguarded. That alarm is the durable half; the explicit list is the
  greppable half.
"""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import USER_DATA_BASE, ensure_database, get_database_path, get_db_connection
from app.migrations.profile_db import MIGRATIONS
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "testdefault"

# The floor below which no live prod DB can sit (T5970 audit: prod >= v18, and
# profile_db v017-v023 add NO columns). Everything a pending migration could add is v024+.
FLOOR_VERSION = 23

# The exact columns profile_db v024..head add, per table. Explicit + greppable ON PURPOSE
# (see the module docstring). Every entry here is DROPPED off a head DB to synthesize the
# below-head schema. When a new migration adds a column, extend this map AND bump
# HEAD_VERSION_AUDITED -- test_registry_head_is_audited enforces that you do.
POST_V023_COLUMNS = {
    "final_videos": [
        "poster_filename", "slowmo_section_start", "slowmo_section_end",  # v024, v025
        "poster_frame_time", "poster_source",                             # v032
        "intro_card_id",                                                  # v034
    ],
    "games": ["shared_by", "source_profile_id", "source_game_id"],                       # v026, v030
    "working_videos": ["detections_data", "framing_snapshot", "highlight_carry_note"],  # v027, v046
    "export_jobs": ["stage", "output_key"],                                             # v028
    "working_clips": ["rotation", "framing_version"],                                     # v029, v044
    "projects": ["poster_marker_time"],                                                  # v032
    "intro_cards": ["subtitle_text"],                                                    # v035
    "raw_clips": ["reel_source_start_time", "reel_source_end_time"],                  # v049
    # v048 (T7830) delete-only R2 cleanup, adds no columns.
    # v049 (T8070 reel status timestamp staleness) adds raw_clips.reel_source_start_time/
    #   reel_source_end_time (above). Every hot read/write is column_exists-guarded:
    #   clips.py (update_raw_clip write, list_project_clips read -- exercised by
    #   test_clips_lists below), games.py get_game's load_annotations_from_db path
    #   (test_game_detail below), export/overlay.py, export/framing.py, export_worker.py,
    #   export_finalize.py (all seed/refresh writes on export completion -- write-side,
    #   not driven by this read-only fixture; covered by test_t8070_export_refresh.py).
    # v047 (T6770 backfill game_storage_refs from game_storage) adds NO column -> nothing to
    #   guard. It only writes to Postgres game_storage_refs via insert_game_storage_ref; no
    #   profile_db read names a new column.
    # v031 (T5725 reclassify teammate-tagged clips to Team) adds NO column -> nothing to guard.
    # (v030 belongs to the sibling T5800 branch, not present here; audit it on that merge.)
    # v033 (T5830 heal pre-T5810 moved-reel attribution) adds NO column -> nothing to guard.
    #   It rewrites final_videos.game_ids and inserts reference games rows via
    #   ensure_game_reference; every column it touches predates v024.
    # v034 (T5195 intro card library) adds final_videos.intro_card_id (above) AND a new
    #   intro_cards TABLE. The intro-cards list route guards the whole missing TABLE itself
    #   (returns []), a case this column-drop harness does not synthesise, so it is covered
    #   by test_t5195 directly. T5215 (v037, below) is the first task to READ
    #   final_videos.intro_card_id on a hot path (list_downloads, the reel PATCH, the overlay
    #   finalize carry-forward) -- every one of those reads is column_exists-guarded
    #   (test_gallery_downloads below drives list_downloads against this fixture).
    # v035 (T6570 subtitle) adds intro_cards.subtitle_text. Unlike v034's whole-table case,
    #   the column-drop harness DOES synthesise this (table present, column gone), so the
    #   create/list/update hot paths are driven directly below (read + write column-guarded).
    # v036 (T6620 null the dead intro_cards.title_text) adds NO column -> nothing to guard.
    #   It is an UPDATE ... SET title_text = NULL (column-guarded, same PRAGMA check as every
    #   other migration here) over an EXISTING column that has carried data since v034; no
    #   hot read gains a new column name to fail on.
    # v038 (T6640 null the dead intro_cards.text_elements) adds NO column -> nothing to
    #   guard. Same shape as v036: an UPDATE over an EXISTING column that has carried data
    #   since v034, table-guarded, so no hot read gains a new column name to fail on.
    # v040 (T6640 backfill exactly one default intro card) adds NO column -> nothing to
    #   guard. It only UPDATEs intro_cards.is_default, which v034 created alongside the
    #   table, and it is table-guarded; a below-head DB without intro_cards returns early.
    #   No hot read gains a new column name, so the deploy->migrate window is unchanged.
    # v041 (T5215 intro_min_duration_seconds, renumbered from v037 on merging master) added
    #   user_settings.intro_min_duration_seconds -- DROPPED by v043 (T6850) below, so it no
    #   longer appears in POST_V023_COLUMNS at all (nothing to guard: the column doesn't
    #   exist at head anymore).
    # v042 (T6630 text_overlays flat blocks -> regions, renumbered from v039) adds NO column
    #   -> nothing to guard. It rewrites the JSON/msgpack SHAPE inside the existing
    #   working_videos.text_overlays BLOB column; no hot read gains a new column name to fail on.
    # v043 (T6850 drop user_settings.intro_min_duration_seconds) REMOVES a column -> nothing
    #   to guard (this harness only covers ADD-side deploy->migrate windows; a DROP's window
    #   is covered instead by the v043 migration's own idempotent/absent-column-safe tests in
    #   test_t6850_drop_intro_min_duration.py). The two consumer endpoints/helpers this column
    #   used to feed were removed outright in the same T6850 change, not left column-guarded.
    # v044 (T4330 framing action version_conflict) adds working_clips.framing_version.
    #   _get_clip_framing_data (clips.py) guards the SELECT with column_exists and returns
    #   framing_version=None on a below-head DB; the 409 check/bump/response are all skipped
    #   when None (back-compat, no 500) -- covered directly by
    #   test_framing_action_version_conflict.py::TestFramingActionPreMigration. No hot LIST
    #   read (list_project_clips) names the new column, so nothing else in this fixture needs
    #   to change.
    # v045 (T4340 canonicalize working_clips.segments_data.boundaries to full-list) adds NO
    #   column -> nothing to guard. It rewrites the msgpack segments_data BLOB's internal
    #   boundaries shape (splits-only -> full-list) for pre-existing rows, joining the
    #   PRE-EXISTING raw_clips.start_time/end_time columns (not new) to derive duration; no hot
    #   read gains a new column name to fail on. The write-time canonicalization code (clips.py
    #   _get_clip_framing_data / _save_clip_framing_data) reads/writes only pre-existing columns
    #   too.
    # v046 (T4350 carry overlay-edited highlights across a framing re-export) adds
    #   working_videos.framing_snapshot + working_videos.highlight_carry_note (above).
    #   highlight_carry_note is READ on the hot `/overlay-data` GET path
    #   (export/overlay.py get_overlay_data) -- guarded by `column_exists(cursor,
    #   "working_videos", "highlight_carry_note")`, selecting a literal NULL when absent;
    #   exercised directly by test_overlay_data below (unchanged call, now also proves the
    #   v046 guard). framing_snapshot has no LIST-style hot read in this fixture's driven
    #   set -- its only reader/writer is the export finalizer's `upsert_working_video`
    #   (services/export_finalize.py), gated end-to-end by
    #   `_working_videos_has_carry_columns` (a `PRAGMA table_info` check, not a bare column
    #   name): when either v046 column is absent it skips the carry read/decision entirely
    #   and falls back to the pre-T4350 historical INSERT shape (no framing_snapshot /
    #   highlight_carry_note in the statement at all). The multi_clip.py export-complete
    #   toast read (`SELECT highlight_carry_note FROM working_videos WHERE id = ?`) is
    #   wrapped in a bare try/except that swallows OperationalError -> None (best-effort,
    #   never a 500). Verified directly by test_upsert_working_video_v046_window below,
    #   which targets the v046 window specifically. T6780 CLOSED the sibling gap the
    #   T4350 note flagged (upsert_working_video's historical-shape INSERT / resume
    #   UPDATE named v027's detections_data unconditionally): the write now column-omits
    #   detections_data when absent, mirroring T6030's slowmo INSERT guard, so the shared
    #   floor-v23 below_head fixture can now drive upsert_working_video too --
    #   test_upsert_working_video_below_head below. (v027's guarded READ is
    #   test_overlay_data.) The v026/v030 games columns (shared_by, source_profile_id,
    #   source_game_id) have guarded reads above; their write-side sibling is the
    #   cross-profile copy, which REFUSES (RecipientProfileBelowHead) rather than
    #   column-omit -- test_game_copy_below_head_refuses below.
}
HEAD_VERSION_AUDITED = 49  # v049 (T8070): raw_clips.reel_source_start_time/end_time, column_exists-guarded


def _cleanup(user_id: str) -> None:
    path = USER_DATA_BASE / user_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _build_below_head_db(user_id: str) -> None:
    """Head schema on disk, then DROP every POST_V023 column and stamp user_version to
    the floor -- a faithful pre-v024 profile DB."""
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    ensure_database()

    import sqlite3

    conn = sqlite3.connect(str(get_database_path()))
    for table, cols in POST_V023_COLUMNS.items():
        for col in cols:
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
    conn.execute(f"PRAGMA user_version = {FLOOR_VERSION}")
    conn.commit()
    conn.close()


def _seed_rows(user_id: str, n: int = 2) -> dict:
    """Seed REAL rows into every table the hot reads touch (schema-only assertions miss
    row-time crashes -- memory reference_migration_runner_rowfactory). Returns key ids."""
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name, blake3_hash, status) VALUES ('Game', 'abc', 'ready')")
        game_id = cur.lastrowid
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
        project_id = cur.lastrowid
        for i in range(n):
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, game_id, video_sequence, end_time) "
                "VALUES (?, 5, ?, ?, ?)",
                (f"clip{i}.mp4", game_id, i, 10.0 + i),
            )
            cur.execute(
                "INSERT INTO working_clips (project_id, sort_order, version) VALUES (?, ?, 1)",
                (project_id, i),
            )
            cur.execute(
                "INSERT INTO working_videos (project_id, filename, version) VALUES (?, ?, 1)",
                (project_id, f"wv{i}.mp4"),
            )
            cur.execute(
                "INSERT INTO final_videos (project_id, filename, version, name, published_at) "
                "VALUES (?, ?, ?, 'Reel', CURRENT_TIMESTAMP)",
                (project_id, f"final{i}.mp4", i + 1),
            )
            cur.execute(
                "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                "VALUES (?, ?, 'overlay', 'complete', ?)",
                (f"job{i}", project_id, b"{}"),
            )
        cur.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('watched_annotate_tutorial')")
        conn.commit()
    return {"game_id": game_id, "project_id": project_id}


@pytest.fixture
def below_head():
    user_id = f"test_t6030s_{uuid.uuid4().hex[:8]}"
    _build_below_head_db(user_id)
    ids = _seed_rows(user_id)
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    yield {"user_id": user_id, **ids}
    _cleanup(user_id)


# --------------------------------------------------------------------------------------
# The durable alarm: a new migration must be audited into this test.
# --------------------------------------------------------------------------------------

def test_registry_head_is_audited():
    head = max(m.version for m in MIGRATIONS)
    assert head == HEAD_VERSION_AUDITED, (
        f"profile_db head is now v{head:03d}, but this migration-window guard was last "
        f"audited at v{HEAD_VERSION_AUDITED:03d}. If the new migration ADDs a column, add it to "
        f"POST_V023_COLUMNS, confirm every hot read that names it is column_exists-guarded, "
        f"then bump HEAD_VERSION_AUDITED. This is the structural warn T6030 exists to give."
    )


def test_below_head_db_is_actually_below_head(below_head):
    import sqlite3

    conn = sqlite3.connect(str(get_database_path()))
    for table, cols in POST_V023_COLUMNS.items():
        present = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for col in cols:
            assert col not in present, f"{table}.{col} should be dropped"
    assert conn.execute("PRAGMA user_version").fetchone()[0] == FLOOR_VERSION
    conn.close()


# --------------------------------------------------------------------------------------
# Drive every hot-path read against the below-head DB. None may raise OperationalError.
# Each helper returns a coroutine or value; we only care that no missing-column 500 fires.
# --------------------------------------------------------------------------------------

def _run(coro_or_value):
    import asyncio
    import inspect

    if inspect.iscoroutine(coro_or_value):
        return asyncio.run(coro_or_value)
    return coro_or_value


def test_quests_check_all_steps(below_head):
    from app.routers.quests import _check_all_steps

    with get_db_connection() as conn:
        steps = _check_all_steps(below_head["user_id"], conn)
    assert isinstance(steps, dict)  # games.shared_by (v026) tolerated


def test_games_list(below_head):
    from app.routers.games import list_games, list_games_metadata

    _run(list_games_metadata())
    _run(list_games())


def test_game_detail(below_head):
    # v049: get_game's annotation load (load_annotations_from_db) reads
    # raw_clips.reel_source_start_time/end_time -- must not 500 below head.
    from app.routers.games import get_game

    _run(get_game(below_head["game_id"]))


def test_projects_list(below_head):
    from app.routers.projects import list_projects

    _run(list_projects())


def test_clips_lists(below_head):
    from fastapi import BackgroundTasks

    from app.routers.clips import list_project_clips, list_raw_clips

    _run(list_raw_clips())
    _run(list_project_clips(below_head["project_id"], BackgroundTasks()))  # working_clips.rotation (v029)


def test_intro_cards_hot_paths(below_head):
    # v035 drops intro_cards.subtitle_text -> the create/list/update hot paths must
    # column-guard BOTH the read (_serialize) AND the write (create INSERT / update
    # SET; the T6550 lesson) and never fire a missing-column 500.
    from app.routers.intro_cards import (
        CreateIntroCardRequest,
        UpdateIntroCardRequest,
        create_intro_card,
        list_intro_cards,
        update_intro_card,
    )
    from app.services.user_db import set_intro_consent

    set_intro_consent(below_head["user_id"], TEST_PROFILE_ID, "2026-08-08T00:00:00Z")
    created = _run(create_intro_card(CreateIntroCardRequest(
        name="Card", treatment="gold", shown_fields=[], subtitle_text="dropped pre-v035",
    )))
    assert created["subtitle_text"] is None          # read guard -> None, no 500
    listed = _run(list_intro_cards())
    assert isinstance(listed["cards"], list) and len(listed["cards"]) >= 1
    updated = _run(update_intro_card(created["id"], UpdateIntroCardRequest(subtitle_text="still dropped")))
    assert updated["subtitle_text"] is None          # write skipped, still no 500


def test_overlay_data(below_head):
    from app.routers.export.overlay import get_overlay_data

    _run(get_overlay_data(below_head["project_id"]))  # working_videos.detections_data (v027)
    # T5410: projects.poster_marker_time (v032) is read in the SAME response --
    # a below-head DB must not 500 on the new column either.
    #
    # NOTE: _finalize_overlay_export's OWN poster_marker_time guard is NOT
    # exercised here -- that function's INSERT already names other v024+
    # columns (poster_filename) unconditionally and was never a below-head-
    # tolerant "list" read this file's fixture set was built to cover (it's
    # covered by test_t6030_slowmo_migration_window.py's dedicated guard tests
    # instead). test_t5410_poster_selection.py covers the poster_marker_time
    # getter/setter's own column-guard directly.


def test_poster_time_write(below_head):
    # T6550: the poster-marker WRITE (projects.poster_marker_time, v032) is the
    # write-side sibling of test_overlay_data's guarded READ. On a below-head DB
    # the endpoint must NOT raise `sqlite3.OperationalError: no such column`
    # (which would 500 the drag gesture); it must refuse honestly with a 503
    # "not available yet" instead of a lying 200 success.
    import sqlite3

    from fastapi import HTTPException

    from app.routers.export.overlay import PosterTimeRequest, set_poster_time

    try:
        _run(set_poster_time(below_head["project_id"], PosterTimeRequest(time=1.5)))
    except sqlite3.OperationalError as e:  # the pre-T6550 failure mode
        pytest.fail(f"poster-time write hit an unguarded missing column: {e}")
    except HTTPException as exc:
        assert exc.status_code == 503  # honest, retryable "pending migration"
    else:
        pytest.fail("below-head poster-time write should refuse with 503, not succeed")


def test_gallery_downloads(below_head):
    from app.routers.downloads import list_downloads

    _run(list_downloads())


def test_collections_summary(below_head):
    from app.routers.collections import collections_summary

    _run(collections_summary())


def test_exports_lists(below_head):
    from app.routers.exports import list_active_exports, list_recent_exports

    _run(list_active_exports())
    _run(list_recent_exports())  # export_jobs.stage/output_key (v028)


def test_upsert_working_video_v046_window(monkeypatch):
    # T4350: working_videos.framing_snapshot/highlight_carry_note (v046) must not 500
    # the export finalizer during the deploy->migrate window. This targets the v046
    # window SPECIFICALLY (a DB with v027..v045 already applied -- detections_data
    # present -- but not yet v046), not the shared floor-v23 `below_head` fixture:
    # that fixture also strips v027's detections_data, which trips an unrelated,
    # PRE-EXISTING gap in upsert_working_video's historical INSERT (it has always
    # named detections_data unconditionally, since before T4350 -- out of scope
    # here, flagged separately, not a v046 regression).
    #
    # `_working_videos_has_carry_columns` is monkeypatched to report False (mirrors
    # test_framing_action_version_conflict.py's TestFramingActionPreMigration
    # pattern -- SQLite's ALTER TABLE DROP COLUMN support is version-dependent, so
    # simulating the guard's False branch directly is the reliable way to reproduce
    # "not-yet-migrated" for a specific column pair without depending on the
    # sqlite3 build under test).
    import sqlite3
    import uuid

    import app.services.export_finalize as ef
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.services.export_finalize import upsert_working_video
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    from app.utils.encoding import encode_data

    user_id = f"test_t6030_v046w_{uuid.uuid4().hex[:8]}"
    _init_cache[user_id] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('V046 Window', '9:16')")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, uploaded_filename, version) VALUES (?, 'wc.mp4', 1)",
            (project_id,),
        )
        conn.commit()

    monkeypatch.setattr(ef, "_working_videos_has_carry_columns", lambda cursor: False)

    job = {"id": f"job-v046-{project_id}", "project_id": project_id, "output_video_id": None}
    try:
        wv_id = upsert_working_video(
            job,
            filename="v046_window_export.mp4",
            duration=10.0,
            highlights_data=encode_data([]),
            detections_data=encode_data({}),
            new_framing_snapshot={
                "clip_count": 1,
                "video_dims": {"width": 1080, "height": 1920},
                "clips": [],
            },
        )
    except sqlite3.OperationalError as e:
        pytest.fail(f"upsert_working_video hit an unguarded missing v046 column: {e}")
    finally:
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
            cur.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
            cur.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
            cur.execute("DELETE FROM export_jobs WHERE project_id = ?", (project_id,))
            cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.commit()

    assert wv_id  # historical-shape INSERT still succeeds; carry is skipped, not crashed


def test_upsert_working_video_below_head(below_head):
    # T6780: the export finalizer's WRITE (upsert_working_video) is the write-side
    # sibling of test_overlay_data's guarded detections_data (v027) READ. Before T6780
    # its INSERT + resume UPDATE named detections_data unconditionally, so a below-v027
    # DB 500'd the render (the gap the T4350 note flagged). Now the write column-OMITS
    # detections_data when absent (an optional cache the v027 migration backfills), so
    # this drives it against the shared floor-v23 fixture -- which DROPS detections_data
    # -- and asserts no missing-column 500 on either branch.
    import sqlite3

    from app.services.export_finalize import upsert_working_video
    from app.utils.encoding import encode_data

    job = {"id": "t6780-wvguard-job", "project_id": below_head["project_id"], "output_video_id": None}
    try:
        # INSERT branch: carry columns (v046) AND detections_data (v027) both absent.
        wv_id = upsert_working_video(
            job,
            filename="below_head_export.mp4",
            duration=10.0,
            highlights_data=encode_data([]),
            detections_data=encode_data({}),  # supplied -> must be silently omitted
        )
        # Resume the SAME job -> UPDATE branch, also detections-omit.
        resume_job = {
            "id": "t6780-wvguard-job",
            "project_id": below_head["project_id"],
            "output_video_id": wv_id,
        }
        wv_id2 = upsert_working_video(
            resume_job,
            filename="below_head_export_resumed.mp4",
            duration=11.0,
            highlights_data=encode_data([]),
            detections_data=encode_data({}),
        )
    except sqlite3.OperationalError as e:
        pytest.fail(f"upsert_working_video hit an unguarded missing detections_data column: {e}")
    assert wv_id and wv_id2 == wv_id  # resume reuses the row, no second coexisting version


def test_game_copy_below_head_refuses(below_head):
    # T6780: the cross-profile game copy WRITE (_insert_game_with_videos, shared by
    # _copy_game share-materialization AND ensure_game_reference move-reel) is the
    # write-side sibling of the guarded games.shared_by (v026) / source_profile_id +
    # source_game_id (v030) READS. On a below-head recipient it must REFUSE with
    # RecipientProfileBelowHead -- NOT 500 on an OperationalError, NOT write a partial
    # row missing the provenance/reference columns (which would be corrupt, not merely
    # incomplete like detections_data above). Callers map the refusal to defer-to-
    # pending (share) or 503 (move-reel).
    import sqlite3

    from app.services.materialization import RecipientProfileBelowHead, _insert_game_with_videos

    with get_db_connection() as conn:
        game_columns = {
            "name": "Copied Game",
            "blake3_hash": "deadbeef",
            "status": "ready",
            "shared_by": None,  # v026 column dropped on the below_head fixture
        }
        try:
            _insert_game_with_videos(conn, game_columns, [])
        except RecipientProfileBelowHead:
            pass  # correct: refuse loudly, no partial write
        except sqlite3.OperationalError as e:
            pytest.fail(f"game copy hit an unguarded missing column instead of refusing: {e}")
        else:
            pytest.fail("below-head game copy should refuse with RecipientProfileBelowHead")
