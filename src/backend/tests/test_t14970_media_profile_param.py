"""T14970: an editor URL's profile is held per tab, so `?profile_id=` must reach media routes.

A <video> or <img> cannot send X-Profile-ID. Without this, a tab on a profile other than the
account's active one reads the active profile's row for the same id.

Real app, real middleware, real per-profile SQLite. Two profiles of ONE account each hold a
games row numbered 1, the exact collision the URL's profile exists to resolve.
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER = "t14970-user"
ACTIVE = "aaaa1111"
TAB = "bbbb2222"
FOREIGN = "cccc3333"
GAME_ID = 1


def _seed_game(user_id, profile_id, name):
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (id, name, blake3_hash, game_date, opponent_name) VALUES (?, ?, ?, ?, ?)",
            (GAME_ID, name, f"hash-{profile_id}", "2026-03-03", name),
        )
        conn.commit()


@pytest.fixture
def client(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER] = {"profile_id": ACTIVE, "is_new_user": False}
    patchers = [
        patch("app.database.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db._initialized_user_dbs", set()),
        patch("app.middleware.db_sync._session_init.peek_registered_profile_ids", return_value={ACTIVE, TAB}),
        patch("app.routers.games.get_game_video_url", side_effect=lambda blake3, _filename: f"https://r2/{blake3}"),
    ]
    for patcher in patchers:
        patcher.start()
    _seed_game(USER, ACTIVE, "Active game")
    _seed_game(USER, TAB, "Tab game")
    from app.main import app
    yield TestClient(app, raise_server_exceptions=True, follow_redirects=False)
    for patcher in patchers:
        patcher.stop()


def _location(response):
    assert response.status_code == 302, response.text
    return response.headers["location"]


def test_owned_query_profile_selects_that_profiles_row(client):
    no_header = {"X-User-ID": USER}
    assert f"hash-{ACTIVE}" in _location(client.get(f"/api/games/{GAME_ID}/video", headers=no_header))
    assert f"hash-{TAB}" in _location(client.get(f"/api/games/{GAME_ID}/video?profile_id={TAB}", headers=no_header))


def test_foreign_query_profile_is_ignored_not_adopted(client):
    """The route's T7940 refusal still answers, and the guard's CRITICAL stays quiet: a stale
    poster URL is not a tenancy attack."""
    with patch("app.middleware.db_sync.logger.critical") as critical:
        response = client.get(f"/api/games/{GAME_ID}/poster.jpg?profile_id={FOREIGN}", headers={"X-User-ID": USER})
    assert response.status_code == 403, response.text
    critical.assert_not_called()


def test_header_beats_query(client):
    headers = {"X-User-ID": USER, "X-Profile-ID": ACTIVE}
    assert f"hash-{ACTIVE}" in _location(client.get(f"/api/games/{GAME_ID}/video?profile_id={TAB}", headers=headers))


def test_query_profile_never_chooses_where_a_write_lands(client):
    client.delete(f"/api/games/{GAME_ID}?profile_id={TAB}", headers={"X-User-ID": USER})
    response = client.get(f"/api/games/{GAME_ID}", headers={"X-User-ID": USER, "X-Profile-ID": TAB})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("path", [
    f"/api/games/{GAME_ID}/video",
    f"/api/games/{GAME_ID}/stream",
    "/api/downloads/1/stream",
    "/api/projects/1/working_video/stream",
    "/api/clips/projects/1/clips/1/stream",
    "/api/clips/projects/1/clips/1/file",
])
@pytest.mark.parametrize("value", [FOREIGN, "deadbeef", "not-an-id"])
def test_unowned_query_profile_on_a_media_route_is_a_404(client, path, value):
    """Never the active profile's bytes under a URL that names another profile."""
    response = client.get(f"{path}?profile_id={value}", headers={"X-User-ID": USER})
    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Profile not found"}


def test_unowned_query_profile_on_a_media_route_is_a_404_for_head_too(client):
    response = client.head(f"/api/games/{GAME_ID}/video?profile_id={FOREIGN}", headers={"X-User-ID": USER})
    assert response.status_code == 404


def test_query_profile_only_applies_to_media_and_posters(client):
    response = client.get(f"/api/games/{GAME_ID}?profile_id={TAB}", headers={"X-User-ID": USER})
    assert response.status_code == 200, response.text
    assert "Active game" in response.json()["name"]
