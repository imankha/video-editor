"""T5970: games.shared_by arrives with the v026 migration, which runs manually (not on
deploy/startup). `_check_all_steps` runs on the bootstrap (app-load) path and derives the
`upload_game` step with `SELECT 1 FROM games WHERE shared_by IS NULL`. On a below-v026
profile DB that names a column the table does not yet have -> `sqlite3.OperationalError:
no such column: shared_by` -> a 500 on EVERY affected user's app load during the
deploy->migrate window (same blast radius as the confirmed v027 detections_data instance).

These tests build a real profile DB at the PRE-v026 schema WITH DATA (not a schema-only
assertion — memory reference_migration_runner_rowfactory records a migration that passed
schema tests and still crashed on real rows) and drive `_check_all_steps` directly:
  - pre-v026 (no shared_by): red without the guard, green with it, and `upload_game` is
    still correctly True when the user owns a game (nothing could be shared-in yet).
  - post-v026 (shared_by present): a shared-in-only game does NOT complete upload_game;
    an own game does — the T5330 semantics are preserved.
"""

import sqlite3

import pytest

from app.routers.quests import _check_all_steps


def _make_profile_db(with_shared_by: bool, games: list[dict]) -> sqlite3.Connection:
    """A minimal profile.sqlite holding only the four tables _check_all_steps reads:
    achievements, export_jobs, raw_clips, games. `games` omits shared_by iff below v026."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE achievements (key TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE export_jobs (type TEXT, status TEXT)")
    conn.execute(
        "CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, auto_project_id INTEGER, shared_by TEXT)"
    )
    games_cols = "id INTEGER PRIMARY KEY, name TEXT"
    if with_shared_by:
        games_cols += ", shared_by TEXT DEFAULT NULL"
    conn.execute(f"CREATE TABLE games ({games_cols})")
    for g in games:
        if with_shared_by:
            conn.execute(
                "INSERT INTO games (id, name, shared_by) VALUES (?, ?, ?)",
                (g["id"], g.get("name", "g"), g.get("shared_by")),
            )
        else:
            conn.execute(
                "INSERT INTO games (id, name) VALUES (?, ?)", (g["id"], g.get("name", "g"))
            )
    conn.commit()
    return conn


def test_below_v026_bootstrap_does_not_500_and_counts_own_game():
    # Deploy->v026 window: games has NO shared_by column. Bootstrap's _check_all_steps
    # must NOT raise, and a game the user owns still completes upload_game (nothing could
    # be shared-in yet — materialization is what adds/sets the column).
    conn = _make_profile_db(with_shared_by=False, games=[{"id": 1}])
    steps = _check_all_steps("u1", conn)
    assert steps["upload_game"] is True


def test_below_v026_hard_select_would_500_without_guard():
    # Pins the failure mode: the pre-fix SELECT (naming shared_by) raises on the below-v026
    # schema. This is what the guard prevents — proving the test DB really is red-capable.
    conn = _make_profile_db(with_shared_by=False, games=[{"id": 1}])
    with pytest.raises(sqlite3.OperationalError, match="no such column: shared_by"):
        conn.execute("SELECT 1 FROM games WHERE shared_by IS NULL LIMIT 1").fetchone()


def test_below_v026_no_games_leaves_upload_incomplete():
    conn = _make_profile_db(with_shared_by=False, games=[])
    steps = _check_all_steps("u1", conn)
    assert steps["upload_game"] is False


def test_at_head_shared_in_only_game_does_not_complete_upload():
    # Post-v026: the T5330 semantics hold — a game that exists only because it was shared
    # in (shared_by set) must NOT complete the "upload a game" step.
    conn = _make_profile_db(
        with_shared_by=True, games=[{"id": 1, "shared_by": "teammate@x.com"}]
    )
    steps = _check_all_steps("u1", conn)
    assert steps["upload_game"] is False


def test_at_head_own_game_completes_upload():
    conn = _make_profile_db(with_shared_by=True, games=[{"id": 1, "shared_by": None}])
    steps = _check_all_steps("u1", conn)
    assert steps["upload_game"] is True
