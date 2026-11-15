"""
T4660: one builder names a game ("Vs <Opp> <Date>", "at ...", "<Tournament>: Vs ...").

Projects, downloads and games each carried their own copy, and the projects copy
had already drifted to an inline strptime date block. The same game must read
the same in the project list, the downloads list and a collection, and only
app/services/game_display.py may define the builder.
"""

import ast
import asyncio
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.collection_metadata import encode_game_ids

USER_ID = "test-user-t4660"
PROFILE_ID = "testdefault"
APP_DIR = Path(__file__).resolve().parent.parent / "app"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _seed(db_path, *, name, opponent, date, game_type, tournament):
    """One game reached by all three lists: a project whose working clip comes
    from the game, and that project's published single-clip reel."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, game_date, opponent_name, game_type, tournament_name) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, date, opponent, game_type, tournament),
    )
    game_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, name, start_time, end_time, game_id) "
        "VALUES ('c.mp4', 5, 'play', 10.0, 20.0, ?)", (game_id,))
    raw_clip_id = cur.lastrowid
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, sort_order) VALUES (?, ?, 0)",
        (project_id, raw_clip_id))
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, source_type, "
        "name, aspect_ratio, game_ids, clip_count, published_at) "
        "VALUES (?, 'f.mp4', 1, 10.0, 'custom_project', 'Reel', '9:16', ?, 1, "
        "'2026-01-01 00:00:00')",
        (project_id, encode_game_ids([game_id])))
    final_video_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))
    conn.commit()
    conn.close()
    return game_id, project_id, final_video_id


GAMES = [
    # (stored name, opponent, date, game_type, tournament, expected)
    ("g.mp4", "Carlsbad", "2025-12-06", "home", None, "Vs Carlsbad Dec 6"),
    ("g.mp4", "Carlsbad", "2025-09-12", "away", None, "at Carlsbad Sep 12"),
    ("g.mp4", "Carlsbad", "2025-12-06", "tournament", "Surf Cup", "Surf Cup: Vs Carlsbad Dec 6"),
    ("g.mp4", "Carlsbad", None, "home", None, "Vs Carlsbad"),
    ("g.mp4", "Carlsbad", "Fall 2025", "away", None, "at Carlsbad Fall 2025"),
    ("Saturday final", None, "2025-12-06", "home", None, "Saturday final"),
]


@pytest.mark.parametrize("name,opponent,date,game_type,tournament,expected", GAMES)
def test_same_game_reads_the_same_in_projects_downloads_and_collections(
        db, name, opponent, date, game_type, tournament, expected):
    from app.routers.collections import collections_summary
    from app.routers.downloads import list_downloads
    from app.routers.projects import _read_projects_list

    game_id, project_id, final_video_id = _seed(
        db, name=name, opponent=opponent, date=date, game_type=game_type, tournament=tournament)

    project = next(p for p in _read_projects_list() if p.id == project_id)
    download = next(d for d in asyncio.run(list_downloads()).downloads if d.id == final_video_id)
    collection = next(g for g in collections_summary().games if g.game_id == game_id)

    assert {
        "projects": project.game_names,
        "downloads": download.game_names,
        "collections": [collection.game_name],
    } == {
        "projects": [expected],
        "downloads": [expected],
        "collections": [expected],
    }


def test_only_one_function_builds_a_game_display_name():
    defined = sorted(
        f"{path.relative_to(APP_DIR).as_posix()}:{node.name}"
        for path in APP_DIR.rglob("*.py")
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.FunctionDef) and "game_display_name" in node.name
    )
    assert defined == ["services/game_display.py:game_display_name"]
    # The projects copy's inline date parse goes with it (dates use short_game_date).
    assert "strptime" not in (APP_DIR / "routers" / "projects.py").read_text(encoding="utf-8")
