"""T15590: two concurrent activate calls (different games, same user) each take
~1x a lone call's R2-validate time, not ~2x.

activate_game is `async def` but called _validate_video_in_r2 (a synchronous R2
HEAD) directly inside the per-user write lock that covers the whole handler, so
two concurrent activates for two DIFFERENT games serialized their R2 calls
behind that lock -- matching the staging QA repro (two tabs finishing at once).

Run with: pytest src/backend/tests/test_t15590_concurrent_activate.py -v
"""
import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t15590act"
PROFILE_ID = "ef012345"
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}
SLEEP = 0.4


def _ctx():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)


@pytest.fixture()
def three_pending_games(tmp_path, monkeypatch):
    """Three PENDING games for one user, each with one already-probed video (so
    activate's R2-HEAD validate runs but the ffprobe backfill is skipped). One
    is activated alone first (the baseline); the other two are activated
    together. Each game's own blake3_hash is also its games-row legacy hash, so
    every lone or concurrent activate call validates it twice (video row +
    legacy column) -- a fixed per-request cost, not part of what's measured."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        import app.routers.games as games_mod
        monkeypatch.setattr(games_mod, "record_milestone", lambda *a, **k: None)

        from app.database import ensure_database, get_db_connection, set_local_db_version
        from app.main import app
        from app.services.user_db import ensure_user_database

        _ctx()
        ensure_user_database(USER_ID)
        ensure_database()
        set_local_db_version(USER_ID, PROFILE_ID, 0)

        game_ids = []
        with get_db_connection() as conn:
            cur = conn.cursor()
            for n in range(3):
                h = f"{'a' * 63}{n}"
                cur.execute(
                    "INSERT INTO games (name, status, blake3_hash) VALUES (?, 'pending', ?)",
                    (f"T15590-{n}", h),
                )
                game_id = cur.lastrowid
                cur.execute(
                    """INSERT INTO game_videos
                       (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
                       VALUES (?, ?, 1, 10.0, 1920, 1080, 12345, 30.0)""",
                    (game_id, h),
                )
                game_ids.append(game_id)
            conn.commit()

        yield app, game_ids


def _activate_stubs():
    import app.routers.games as games_mod

    def slow_validate(blake3_hash):
        time.sleep(SLEEP)
        return None

    return [
        patch.object(games_mod, "_validate_video_in_r2", slow_validate),
        patch.object(games_mod, "deduct_credits", return_value={"success": True, "balance": 100}),
        patch.object(games_mod, "insert_game_storage_ref", lambda *a, **k: None),
        patch.object(games_mod, "_maybe_send_game_ready_email", lambda *a, **k: None),
        patch("app.services.poster_warmer.fire_and_forget", lambda *a, **k: None),
        patch("app.services.poster_warmer.warm_game_source_poster_background", lambda *a, **k: None),
    ]


@pytest.mark.asyncio
async def test_two_concurrent_activates_do_not_serialize_their_r2_validate_calls(three_pending_games):
    app, game_ids = three_pending_games
    stubs = _activate_stubs()
    for p in stubs:
        p.start()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver", headers=HEADERS, timeout=30,
        ) as client:
            lone_start = time.perf_counter()
            lone = await client.post(f"/api/games/{game_ids[0]}/activate")
            lone_elapsed = time.perf_counter() - lone_start
            assert lone.status_code == 200, lone.text

            started = time.perf_counter()
            r1, r2 = await asyncio.gather(
                client.post(f"/api/games/{game_ids[1]}/activate"),
                client.post(f"/api/games/{game_ids[2]}/activate"),
            )
            elapsed = time.perf_counter() - started

            assert r1.status_code == 200, r1.text
            assert r2.status_code == 200, r2.text
            # AC: two uploads finishing together each complete within 1.5x the lone time.
            assert elapsed < lone_elapsed * 1.5, (
                f"activates serialized: lone={lone_elapsed:.2f}s concurrent={elapsed:.2f}s"
            )
    finally:
        for p in stubs:
            p.stop()
