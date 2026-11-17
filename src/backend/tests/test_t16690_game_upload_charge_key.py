"""T16690: a game upload is charged once per game, whichever profile it is in.

activate_game charged under the ledger key `game_upload:<game_id>`, and game ids
are a per-PROFILE SQLite autoincrement while the ledger is per-USER. So game 1 in
a second profile found `game_upload:1` already spent by game 1 of the first
profile, was treated as a retry, and was stored without being charged.

Real Postgres ledger (pg_conn) + real per-profile SQLite + the real
/api/games/{id}/activate route; only R2 / email / poster side effects are stubbed.

Run with: pytest src/backend/tests/test_t16690_game_upload_charge_key.py -v
"""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
import pytest

USER_ID = "user-a"
PROFILE_A = "a1690aaa"
PROFILE_B = "b1690bbb"
VIDEO_SIZE = 4_600_000  # the 4.6 MB staging game


def _bind(profile_id):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)
    set_current_profile_id(profile_id)


def _seed_pending_game(profile_id, blake3_hash):
    """One pending game with one probed video in `profile_id`; returns its id."""
    from app.database import ensure_database, get_db_connection, set_local_db_version
    _bind(profile_id)
    ensure_database()
    set_local_db_version(USER_ID, profile_id, 0)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, status, blake3_hash) VALUES (?, 'pending', ?)",
            (f"T16690-{profile_id}", blake3_hash),
        )
        game_id = cur.lastrowid
        cur.execute(
            """INSERT INTO game_videos
               (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
               VALUES (?, ?, 1, 10.0, 1920, 1080, ?, 30.0)""",
            (game_id, blake3_hash, VIDEO_SIZE),
        )
        conn.commit()
    return game_id


@pytest.fixture()
def env(tmp_path, pg_conn, monkeypatch):
    import app.routers.games as games_mod
    from app.main import app
    from app.services.credit_ledger import credit_key, grant
    from app.services.user_db import ensure_user_database

    monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch.object(games_mod, "_validate_video_in_r2", lambda h: None), \
         patch.object(games_mod, "insert_game_storage_ref", lambda *a, **k: None), \
         patch.object(games_mod, "_maybe_send_game_ready_email", lambda *a, **k: None), \
         patch("app.services.poster_warmer.fire_and_forget", lambda *a, **k: None), \
         patch("app.services.poster_warmer.warm_game_source_poster_background", lambda *a, **k: None):
        _bind(PROFILE_A)
        ensure_user_database(USER_ID)
        grant(USER_ID, 100, "admin_grant", credit_key("admin_grant", "t16690-seed"))
        yield app


def _upload_debits():
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT amount, reference_id FROM credit_transactions "
            "WHERE user_id = %s AND source = 'game_upload'",
            (USER_ID,),
        )
        return cur.fetchall()


async def _activate(app, profile_id, game_id):
    _bind(profile_id)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        headers={"X-User-ID": USER_ID, "X-Profile-ID": profile_id}, timeout=30,
    ) as client:
        return await client.post(f"/api/games/{game_id}/activate")


@pytest.mark.asyncio
async def test_same_game_number_in_two_profiles_is_charged_in_both(env):
    """T16690:C1"""
    from app.services.credit_ledger import get_balance
    from app.services.storage_credits import calculate_upload_cost

    cost = calculate_upload_cost(VIDEO_SIZE)
    game_a = _seed_pending_game(PROFILE_A, "a" * 64)
    game_b = _seed_pending_game(PROFILE_B, "b" * 64)
    assert game_a == game_b, "precondition: both profiles hand out the same game number"

    before = get_balance(USER_ID)
    ra = await _activate(env, PROFILE_A, game_a)
    rb = await _activate(env, PROFILE_B, game_b)
    assert ra.status_code == 200, ra.text
    assert rb.status_code == 200, rb.text

    debits = _upload_debits()
    assert len(debits) == 2, f"expected one game_upload charge per game, got {debits}"
    assert get_balance(USER_ID) == before - 2 * cost


@pytest.mark.asyncio
async def test_retried_activation_of_the_same_game_charges_once(env):
    """T16690:C2: a retry after a crash between the charge and the ready flip
    (the game is still pending) must not charge the game again."""
    from app.database import get_db_connection
    from app.services.credit_ledger import get_balance
    from app.services.storage_credits import calculate_upload_cost

    cost = calculate_upload_cost(VIDEO_SIZE)
    game_id = _seed_pending_game(PROFILE_A, "c" * 64)
    before = get_balance(USER_ID)

    first = await _activate(env, PROFILE_A, game_id)
    assert first.status_code == 200, first.text
    # Simulate the lost ready flip: the charge is durable, the game is pending again.
    _bind(PROFILE_A)
    with get_db_connection() as conn:
        conn.execute("UPDATE games SET status = 'pending' WHERE id = ?", (game_id,))
        conn.commit()
    second = await _activate(env, PROFILE_A, game_id)
    assert second.status_code == 200, second.text

    assert len(_upload_debits()) == 1
    assert get_balance(USER_ID) == before - cost
