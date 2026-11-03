"""
T14550: a default play name never carries a rating word.

Low ratings are coach jargon a parent should not see in a name other families read,
so a default name is built from the tags alone, or from the play's time when it has
no tags. Each test goes through a real production path: the project created by Make
highlight, the raw-clip and game-annotation read APIs, and the public team rail.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.utils.encoding import encode_data

TEST_USER_ID = f"test_t14550_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def game_id():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES ('T14550', ?)",
            (f"hash_{uuid.uuid4().hex[:16]}",),
        )
        new_game_id = cur.lastrowid
        conn.commit()
    return new_game_id


def _insert_play(game_id, rating, tags, start_time=750.0, notes=''):
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, game_id, start_time, end_time, tags, notes) "
            "VALUES ('', ?, ?, ?, ?, ?, ?)",
            (rating, game_id, start_time, start_time + 8, encode_data(tags), notes),
        )
        clip_id = cur.lastrowid
        conn.commit()
    return clip_id


def _make_highlight_project_name(clip_id):
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cur = conn.cursor()
        project_id = _create_auto_project_for_clip(cur, clip_id, clip_name="")
        name = cur.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()["name"]
        conn.commit()
    return name


@pytest.mark.parametrize("rating", [1, 2, 3, 4, 5])
def test_make_highlight_names_the_project_from_tags_only(game_id, rating):
    clip_id = _insert_play(game_id, rating, ["Dribble", "Assist"])
    assert _make_highlight_project_name(clip_id) == "Dribble and Assist"


def test_make_highlight_names_a_tagless_play_by_its_time(game_id):
    clip_id = _insert_play(game_id, 1, [], start_time=750.0)
    assert _make_highlight_project_name(clip_id) == "Play at 12:30"


def test_time_name_shows_hours_past_the_hour(game_id):
    clip_id = _insert_play(game_id, 4, [], start_time=3725.0)
    assert _make_highlight_project_name(clip_id) == "Play at 1:02:05"


def test_notes_still_name_a_tagless_play_before_the_time(game_id):
    clip_id = _insert_play(game_id, 2, [], notes="Great run down the wing")
    assert _make_highlight_project_name(clip_id) == "Run Wing"  # the TF-IDF title of the notes


def test_raw_clip_api_returns_a_tag_only_name(game_id):
    clip_id = _insert_play(game_id, 1, ["Dribble"])
    response = client.get(f"/api/clips/raw/{clip_id}")
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Dribble"


def test_game_annotations_return_a_tag_only_name(game_id):
    clip_id = _insert_play(game_id, 2, ["Goal"])
    response = client.get(f"/api/games/{game_id}")
    assert response.status_code == 200, response.text
    annotation = next(a for a in response.json()["annotations"] if a["id"] == clip_id)
    assert annotation["name"] == "Goal"
    assert annotation["has_custom_name"] is False


def test_public_team_rail_names_a_play_from_its_tags(game_id):
    """The rail is what strangers read on a game share page."""
    from app.routers.games import _build_team_clip_rail

    clip_id = _insert_play(game_id, 1, ["Goal"])
    mapping = [{"id": clip_id, "name": "", "rating": 1, "tags": ["Goal"], "notes": "",
                "recap_start": 0.0, "recap_end": 8.0}]
    with patch("app.services.auto_export.load_recap_mapping", return_value=("team", mapping)):
        rail = _build_team_clip_rail(TEST_USER_ID, game_id, "recaps/x_clips.json")
    assert rail[0]["name"] == "Goal"


def test_a_name_the_parent_typed_is_kept(game_id):
    from app.routers.clips import _create_auto_project_for_clip

    clip_id = _insert_play(game_id, 1, ["Goal"])
    with get_db_connection() as conn:
        cur = conn.cursor()
        project_id = _create_auto_project_for_clip(cur, clip_id, clip_name="Ava's header")
        name = cur.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()["name"]
        conn.commit()
    assert name == "Ava's header"
