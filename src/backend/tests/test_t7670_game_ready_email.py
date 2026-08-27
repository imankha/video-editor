"""T7670: upload-complete return-trigger email.

The email fires from activate_game at the durable pending->ready transition,
exactly once per game, and never on a re-activation of an already-ready game or
on a failed activation. The helper's eligibility guards (impersonation, opt-out,
missing address) and the dev-mode send are covered separately.

Models test_game_activate_consistency.py: a real profile DB via ensure_database,
externalities stubbed. Postgres writes are conftest no-ops.
"""

import sqlite3
from unittest.mock import MagicMock, patch

import pytest

USER_ID = "test-user-t7670"
PROFILE_ID = "testdefault"
HASH = "b" * 64


@pytest.fixture()
def profile_db(tmp_path):
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


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_game(db_path, status, name="Lions vs Hawks", with_ref=False):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, status, blake3_hash) VALUES (?, ?, ?)",
        (name, status, HASH),
    )
    game_id = cur.lastrowid
    cur.execute(
        """INSERT INTO game_videos
           (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
           VALUES (?, ?, 1, 10.0, 1920, 1080, 12345, 30.0)""",
        (game_id, HASH),
    )
    if with_ref:
        cur.execute(
            "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, ?, '2099-01-01')",
            (HASH, 12345),
        )
    conn.commit()
    conn.close()
    return game_id


def _activate_stubs(games_router):
    return (
        patch.object(games_router, "_validate_video_in_r2", return_value=None),
        patch.object(games_router, "deduct_credits", return_value={"success": True, "balance": 100}),
        patch.object(games_router, "insert_game_storage_ref", return_value=None),
    )


# ---- trigger site: exactly once per game -------------------------------------

@pytest.mark.asyncio
async def test_email_fires_once_on_pending_to_ready(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="pending", name="Lions vs Hawks")
    s1, s2, s3 = _activate_stubs(games_router)
    with s1, s2, s3, \
         patch.object(games_router, "_maybe_send_game_ready_email") as spy:
        result = await games_router.activate_game(game_id)

    assert result["status"] == "ready"
    spy.assert_called_once_with(game_id, "Lions vs Hawks")


@pytest.mark.asyncio
async def test_no_email_on_reactivation_of_ready_game(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", with_ref=True)
    with patch.object(games_router, "_maybe_send_game_ready_email") as spy:
        result = await games_router.activate_game(game_id)

    assert result["status"] == "ready"
    spy.assert_not_called()  # early-return path never reaches the trigger


@pytest.mark.asyncio
async def test_no_email_when_activation_fails(profile_db):
    from fastapi import HTTPException

    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="pending")
    with patch.object(games_router, "_validate_video_in_r2", return_value=None), \
         patch.object(games_router, "insert_game_storage_ref", return_value=None), \
         patch.object(games_router, "deduct_credits", return_value={"success": False, "balance": 0}), \
         patch.object(games_router, "_maybe_send_game_ready_email") as spy:
        with pytest.raises(HTTPException):
            await games_router.activate_game(game_id)

    # Status never flipped -> trigger unreached, no false "ready" email.
    assert spy.call_count == 0


# ---- end-to-end (real helper, dev-mode send) --------------------------------

@pytest.mark.asyncio
async def test_activation_end_to_end_emits_dev_mode_email(profile_db, monkeypatch, caplog):
    """QA: drive activate_game through the REAL _maybe_send_game_ready_email and
    the REAL send_game_ready_email with RESEND_API_KEY unset. Proves the whole
    chain fires exactly one dev-mode send carrying the deep link, end to end."""
    import logging

    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="pending", name="Lions vs Hawks")

    s1, s2, s3 = _activate_stubs(games_router)
    with s1, s2, s3, \
         patch("app.user_context.get_current_impersonator_id", return_value=None), \
         patch("app.services.user_db.get_notification_email_optout", return_value=False), \
         patch("app.services.auth_db.get_user_by_id", return_value={"email": "parent@example.com"}), \
         caplog.at_level(logging.WARNING, logger="app.services.email"):
        result = await games_router.activate_game(game_id)
        # Let the fire-and-forget send task run.
        import asyncio
        await asyncio.sleep(0.05)

    assert result["status"] == "ready"
    dev_logs = [r.message for r in caplog.records if "DEV MODE -- game-ready email" in r.message]
    assert len(dev_logs) == 1, dev_logs
    assert "parent@example.com" in dev_logs[0]
    assert f"game={game_id}" in dev_logs[0] or f"game {game_id}" in dev_logs[0]
    assert "profile=" in dev_logs[0]  # deep link carries the profile


# ---- helper eligibility guards ----------------------------------------------

def _run_helper(game_id=7, game_name="G"):
    from app.routers import games as games_router
    games_router._maybe_send_game_ready_email(game_id, game_name)


def _guard_patches(*, impersonator=None, opted_out=False, email="p@x.com"):
    return (
        patch("app.user_context.get_current_impersonator_id", return_value=impersonator),
        patch("app.services.user_db.get_notification_email_optout", return_value=opted_out),
        patch("app.services.auth_db.get_user_by_id", return_value={"email": email} if email else None),
        patch("app.services.email.send_game_ready_email", MagicMock(name="send")),
        patch("app.services.poster_warmer.fire_and_forget", MagicMock(name="faf")),
    )


def test_helper_sends_for_eligible_user():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    imp, opt, usr, send, faf = _guard_patches(email="parent@example.com")
    with imp, opt, usr, send as send_mock, faf as faf_mock:
        _run_helper(game_id=42, game_name="Lions vs Hawks")

    send_mock.assert_called_once_with("parent@example.com", "Lions vs Hawks", 42, PROFILE_ID)
    faf_mock.assert_called_once()


def test_helper_skips_during_impersonation():
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)

    imp, opt, usr, send, faf = _guard_patches(impersonator="admin-1")
    with imp, opt, usr, send as send_mock, faf:
        _run_helper()
    send_mock.assert_not_called()


def test_helper_skips_when_opted_out():
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)

    imp, opt, usr, send, faf = _guard_patches(opted_out=True)
    with imp, opt, usr, send as send_mock, faf:
        _run_helper()
    send_mock.assert_not_called()


def test_helper_skips_when_no_email():
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)

    imp, opt, usr, send, faf = _guard_patches(email=None)
    with imp, opt, usr, send as send_mock, faf:
        _run_helper()
    send_mock.assert_not_called()


# ---- email builder + deep link ----------------------------------------------

def test_deep_link_includes_game_and_profile():
    from app.services.email import _get_game_editor_url
    url = _get_game_editor_url(42, "abc-profile")
    assert "game=42" in url
    assert "profile=abc-profile" in url


@pytest.mark.asyncio
async def test_send_game_ready_email_dev_mode_no_key(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    from app.services.email import send_game_ready_email
    ok = await send_game_ready_email("parent@example.com", "Lions vs Hawks", 42, "abc")
    assert ok is True  # dev-mode logs + returns True, never raises


# ---- opt-out round-trip ------------------------------------------------------

def test_optout_flag_round_trips(tmp_path):
    with patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.storage.R2_ENABLED", False):
        from app.services.user_db import (
            get_notification_email_optout,
            set_notification_email_optout,
        )
        assert get_notification_email_optout(USER_ID) is False  # default opted-in
        set_notification_email_optout(USER_ID, True)
        assert get_notification_email_optout(USER_ID) is True
        set_notification_email_optout(USER_ID, False)
        assert get_notification_email_optout(USER_ID) is False
