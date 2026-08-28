"""T7940 integration: proof via the REAL HTTP route, not a direct Python function call.

test_t7940_poster_cross_account_leak.py proves the guard's internal logic (ordering,
403 vs normal-flow) by calling `games.get_game_poster(...)` directly with mocked
DB/profile-context objects -- the established convention for this file (see
test_t5681_game_poster.py). That proves the CODE is right but bypasses three things a
direct call can't exercise: FastAPI's own query-param binding (does `profile_id: str |
None = None` actually get read from `?profile_id=...`?), the X-Profile-ID middleware
that resolves `get_current_profile_id()` from the request header, and a REAL per-profile
SQLite read (not a mocked cursor).

This file closes that gap for the games poster route -- the one that actually leaked in
prod -- using `TestClient` against the real app, two REAL accounts each with a REAL
`games` row numbered id=1 (mirroring the prod incident: imankh id=1 vs mikhail id=1),
isolated to a pytest tmp_path so nothing touches real dev user data. The only mock is
`ensure_game_source_poster` (the R2/ffmpeg boundary) -- forcing a clean 404 instead of a
real network call, which is the same boundary test_t5681_game_poster.py itself mocks for
its own "no recap, no source" cases. Everything else -- routing, query param, middleware,
the profile_id guard, the SQLite row lookup -- is live.
"""
from unittest.mock import patch

from fastapi.testclient import TestClient

USER_A = "t7940-user-a"
USER_B = "t7940-user-b"
PROFILE_A = "aaaa1111"  # 8-hex, matches the middleware's X-Profile-ID format guard
PROFILE_B = "bbbb2222"
GAME_ID = 1  # both accounts have a game numbered 1 -- the exact prod incident shape


def _seed_game(user_id, profile_id, name):
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (id, name, blake3_hash, game_date, opponent_name) "
            "VALUES (?, ?, ?, ?, ?)",
            (GAME_ID, name, f"hash-{profile_id}", "2026-03-03", "Opponent"),
        )
        conn.commit()


def _headers(user_id, profile_id):
    return {"X-User-ID": user_id, "X-Profile-ID": profile_id}


def _seeded_client(tmp_path):
    """Isolate all user data to tmp_path, seed both accounts' id=1 games (mirroring
    imankh/mikhail's real id=1 collision), and return a live TestClient. Mocks only
    the R2/ffmpeg poster-generation boundary -- the SQLite games table, the route, the
    middleware, and the profile_id guard are all real."""
    from app.session_init import _init_cache
    _init_cache[USER_A] = {"profile_id": PROFILE_A, "is_new_user": False}
    _init_cache[USER_B] = {"profile_id": PROFILE_B, "is_new_user": False}

    patchers = [
        patch("app.database.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db._initialized_user_dbs", set()),
    ]
    for p in patchers:
        p.start()

    _seed_game(USER_A, PROFILE_A, "Vs LA Breakers May 9")
    _seed_game(USER_B, PROFILE_B, "Vs Toronto JR Argos May 15")

    from app.main import app
    return TestClient(app, raise_server_exceptions=True), patchers


def test_mismatched_profile_id_403s_before_serving_the_other_accounts_game(tmp_path):
    """The exact prod incident, live: authed as B, but the poster URL carries A's
    profile_id (what a URL-keyed cache collision, or a stale copy-pasted link, would
    produce for account B's request). Must 403 -- never fall through to A's game row."""
    client, patchers = _seeded_client(tmp_path)
    try:
        with patch("app.services.poster.ensure_game_source_poster", return_value=False):
            resp = client.get(
                f"/api/games/{GAME_ID}/poster.jpg?profile_id={PROFILE_A}",
                headers=_headers(USER_B, PROFILE_B),
            )
        assert resp.status_code == 403, resp.text
    finally:
        for p in patchers:
            p.stop()


def test_matching_profile_id_proceeds_to_normal_flow(tmp_path):
    """Authed as B, URL's profile_id matches B's own session -> no 403; falls through
    to the ordinary no-poster-available 404 (proving the guard gates only a mismatch,
    never a legitimate same-account request)."""
    client, patchers = _seeded_client(tmp_path)
    try:
        with patch("app.services.poster.ensure_game_source_poster", return_value=False):
            resp = client.get(
                f"/api/games/{GAME_ID}/poster.jpg?profile_id={PROFILE_B}",
                headers=_headers(USER_B, PROFILE_B),
            )
        assert resp.status_code == 404, resp.text
    finally:
        for p in patchers:
            p.stop()


def test_absent_profile_id_proceeds_to_normal_flow(tmp_path):
    """No profile_id on the URL (an old cached link, or a client that hasn't picked up
    the frontend change yet) -> no check possible -> ordinary flow, not a 403. Backward
    compatible with any caller that hasn't started sending the new query param."""
    client, patchers = _seeded_client(tmp_path)
    try:
        with patch("app.services.poster.ensure_game_source_poster", return_value=False):
            resp = client.get(
                f"/api/games/{GAME_ID}/poster.jpg",
                headers=_headers(USER_B, PROFILE_B),
            )
        assert resp.status_code == 404, resp.text
    finally:
        for p in patchers:
            p.stop()
