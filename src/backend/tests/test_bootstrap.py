"""
Tests for GET /api/bootstrap — the single page-load aggregate.

T4771 parallelized the endpoint: the user.sqlite reads (profiles/credits/settings/
quests) run on a worker thread while the profile.sqlite reads (projects/games/
downloads/exports/pending) run on the event loop. These tests lock in:
  1. the response contract (all keys present, right shapes), and
  2. contextvars propagation into the worker thread — if the request's user/profile
     context did NOT reach the thread, get_current_user_id() there would raise and
     bootstrap would error (or read the wrong user). A green bootstrap returning
     this user's own profiles/games IS the propagation regression test.

The endpoint coroutine is driven directly with asyncio.run() (this env's
starlette/httpx pairing makes TestClient unusable), which still exercises the
run_in_executor + copy_context path exactly as a real request does.

Run with: pytest src/backend/tests/test_bootstrap.py -v
"""

import asyncio
import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_bootstrap_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from app.routers.bootstrap import bootstrap


def _ctx():
    """Set the request context on the current (main) thread, as middleware would.
    copy_context() inside bootstrap() then carries it into the worker thread."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def _run_bootstrap():
    _ctx()
    return asyncio.run(bootstrap())


@pytest.fixture
def seeded_game():
    _ctx()
    from app.database import get_db_connection
    game_hash = "boot_hash_" + uuid.uuid4().hex[:32]
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("Bootstrap Test Game", game_hash),
        )
        conn.commit()
        game_id = cursor.lastrowid
    yield {"id": game_id, "hash": game_hash}
    _ctx()
    with get_db_connection() as conn:
        conn.cursor().execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


class TestBootstrapContract:
    def test_returns_all_top_level_keys(self):
        data = _run_bootstrap()
        for key in (
            "profiles", "credits", "settings", "quests_progress",
            "projects", "games", "downloads", "exports", "pending_uploads",
        ):
            assert key in data, f"missing key: {key}"

    def test_shapes(self):
        data = _run_bootstrap()
        assert isinstance(data["profiles"], list)
        assert isinstance(data["quests_progress"], list)
        assert isinstance(data["pending_uploads"], list)
        assert isinstance(data["settings"], dict)
        assert {"count", "unwatched_count"}.issubset(data["downloads"].keys())
        assert "active" in data["exports"] and "unacknowledged" in data["exports"]
        assert isinstance(data["exports"]["active"], list)
        assert isinstance(data["exports"]["unacknowledged"], list)
        assert "games" in data["games"]

    def test_user_scoped_read_runs_in_thread_with_context(self):
        """profiles/credits come from the worker thread. If contextvars did not
        propagate, bootstrap() would raise (RuntimeError: No user context set)."""
        data = _run_bootstrap()
        assert isinstance(data["profiles"], list)
        assert isinstance(data["credits"], dict)

    def test_seeded_game_appears(self, seeded_game):
        """profile-scoped read (event loop) returns the game seeded for this user."""
        data = _run_bootstrap()
        names = [g.get("name") for g in data["games"]["games"]]
        assert "Bootstrap Test Game" in names

    def test_repeated_calls_are_stable(self):
        """Concurrency sanity: the two-group parallel read yields identical
        top-level keys across repeated calls (no torn/missing group)."""
        first = _run_bootstrap()
        for _ in range(3):
            again = _run_bootstrap()
            assert set(again.keys()) == set(first.keys())
