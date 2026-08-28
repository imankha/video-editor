"""T7940: poster URLs must be per-owner so a URL-keyed cache (CDN/proxy/browser)
can never serve one account's poster bytes for another account's identically-
numbered game/draft/reel.

Root cause: `game.id` / `project.id` / `final_videos.id` are per-profile SQLite
AUTOINCREMENTs, so `/api/games/1/poster.jpg` is byte-identical across every
account that has an id=1 row -- a cache keyed purely on URL can cross-serve. The
fix appends `?profile_id=<owner>` to the three poster URLs (frontend) and, as a
defense-in-depth token, the backend refuses a request whose URL `profile_id`
does NOT match the caller's SESSION profile (get_current_profile_id) with a 403
BEFORE any DB read or R2 call.

The scenario these tests encode: authenticated as profile B, a request carrying
`profile_id=A` (a DIFFERENT account's poster URL) must 403 -- never fall through
to a DB read that could serve bytes. A matching `profile_id=B`, or an absent
param, proceeds to the normal 200/404 flow. profile_id is a cache-correctness
token, NOT the authorization mechanism (that is unchanged: X-Profile-ID header
-> contextvar -> profile-scoped DB read).

Handlers are exercised directly (the poster-test convention in
test_t5681_game_poster.py / test_t5671_draft_poster.py / test_t5673_reel_poster.py),
mocking the session profile contextvar rather than driving TestClient headers.
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers import downloads, games, projects

USER_ID = "test-user-t7940"
PROFILE_A = "profileA-owns-id-1"
PROFILE_B = "profileB-owns-id-1"
ID = 1  # both profiles have a row numbered 1 -> the colliding bare URL


def _fake_request(if_none_match=None):
    req = MagicMock()
    req.headers = {"if-none-match": if_none_match} if if_none_match else {}
    return req


def _tracking_db(row=None):
    """A get_db_connection() context manager that records whether it was entered
    (i.e. whether the handler read the DB) and returns `row` from fetchone()."""
    cursor = MagicMock()
    cursor.fetchone.return_value = row
    conn = MagicMock()
    conn.cursor.return_value = cursor
    state = {"entered": False}

    class _Ctx:
        def __enter__(self):
            state["entered"] = True
            return conn

        def __exit__(self, *a):
            return False

    return (lambda: _Ctx()), state


# ---------------------------------------------------------------------------
# Games poster: /api/games/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_games_poster_403_on_profile_mismatch_before_db_read():
    """Authed as B, URL says profile_id=A -> 403, and the DB is NEVER read (the
    guard is the first check, so A's row can't be resolved and served)."""
    db_factory, state = _tracking_db(row={"id": ID, "recap_video_url": "x"})
    with patch.object(games, "get_db_connection", db_factory), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_B), pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert e.value.status_code == 403
    assert e.value.detail == "Profile mismatch"
    assert state["entered"] is False  # refused BEFORE any DB read


def test_games_poster_matching_profile_id_proceeds_to_normal_flow():
    """Authed as B, URL says profile_id=B (matches) -> no 403; falls through to
    the normal flow (here a missing row -> 404), proving the token gates only the
    mismatch, never the happy path."""
    db_factory, state = _tracking_db(row=None)  # row missing -> normal 404
    with patch.object(games, "get_db_connection", db_factory), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_B):
        resp = asyncio.run(games.get_game_poster(ID, _fake_request(), profile_id=PROFILE_B))
    assert resp.status_code == 404
    assert state["entered"] is True


def test_games_poster_absent_profile_id_proceeds_to_normal_flow():
    """No profile_id on the URL -> no check possible -> normal flow (defense-in-
    depth token, not the primary guard). Existing callers/tests are unaffected."""
    db_factory, state = _tracking_db(row=None)
    with patch.object(games, "get_db_connection", db_factory), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_B):
        resp = asyncio.run(games.get_game_poster(ID, _fake_request()))
    assert resp.status_code == 404
    assert state["entered"] is True


# ---------------------------------------------------------------------------
# Draft poster: /api/projects/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_draft_poster_403_on_profile_mismatch_before_db_read():
    """Authed as B, URL says profile_id=A -> 403 before ensure_draft_poster / any
    R2 work (get_current_profile_id is imported inside the handler from
    app.profile_context, so patch it there)."""
    with patch("app.profile_context.get_current_profile_id", return_value=PROFILE_B), \
         patch("app.services.poster.ensure_draft_poster") as ensure, \
         patch.object(projects, "get_current_user_id", return_value=USER_ID), pytest.raises(HTTPException) as e:
        asyncio.run(projects.get_draft_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert e.value.status_code == 403
    assert e.value.detail == "Profile mismatch"
    ensure.assert_not_called()  # refused BEFORE any poster resolution


def test_draft_poster_matching_profile_id_proceeds_to_normal_flow():
    with patch("app.profile_context.get_current_profile_id", return_value=PROFILE_B), \
         patch("app.services.poster.ensure_draft_poster", return_value=None) as ensure, \
         patch.object(projects, "get_current_user_id", return_value=USER_ID):
        resp = asyncio.run(projects.get_draft_poster(ID, _fake_request(), profile_id=PROFILE_B))
    assert resp.status_code == 404  # no poster -> normal 404, not 403
    ensure.assert_called_once()


def test_draft_poster_absent_profile_id_proceeds_to_normal_flow():
    with patch("app.profile_context.get_current_profile_id", return_value=PROFILE_B), \
         patch("app.services.poster.ensure_draft_poster", return_value=None), \
         patch.object(projects, "get_current_user_id", return_value=USER_ID):
        resp = asyncio.run(projects.get_draft_poster(ID, _fake_request()))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Reel poster: /api/downloads/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_reel_poster_403_on_profile_mismatch_before_db_read():
    """Authed as B, URL says profile_id=A -> 403, and the DB is NEVER read."""
    db_factory, state = _tracking_db(row={"filename": "reel.mp4"})
    with patch.object(downloads, "get_db_connection", db_factory), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_B), pytest.raises(HTTPException) as e:
        asyncio.run(downloads.get_reel_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert e.value.status_code == 403
    assert e.value.detail == "Profile mismatch"
    assert state["entered"] is False  # refused BEFORE any DB read


def test_reel_poster_matching_profile_id_proceeds_to_normal_flow():
    db_factory, state = _tracking_db(row=None)  # missing reel row -> normal 404
    with patch.object(downloads, "get_db_connection", db_factory), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_B):
        resp = asyncio.run(downloads.get_reel_poster(ID, _fake_request(), profile_id=PROFILE_B))
    assert resp.status_code == 404
    assert state["entered"] is True


def test_reel_poster_absent_profile_id_proceeds_to_normal_flow():
    db_factory, state = _tracking_db(row=None)
    with patch.object(downloads, "get_current_profile_id", return_value=PROFILE_B), \
         patch.object(downloads, "get_db_connection", db_factory):
        resp = asyncio.run(downloads.get_reel_poster(ID, _fake_request()))
    assert resp.status_code == 404
    assert state["entered"] is True
