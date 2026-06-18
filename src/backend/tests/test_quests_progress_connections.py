"""T1536 merit proof — deterministic DB-connection count for GET /quests/progress.

Each DB open is a potential cold R2 restore (~200ms+). Before T1536, /progress
opened user.sqlite TWICE (completed_quests + credit_transactions via two
independent get_user_db_connection calls) plus profile.sqlite once. T1536 merges
the two user.sqlite reads into a single connection.

This test spies on the connection factories and asserts open counts. It is exact
and CI-stable (no wall-clock flake). The user.sqlite count is the merit proof:
2 -> 1.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.services import user_db
from app.routers import quests

TEST_USER_ID = f"test_quests_conn_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

# Pre-populate init cache so the middleware's user_session_init takes the fast
# path (no DB opens) instead of resolving a profile via R2.
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    # Warm the DBs once (uncounted) so first-call file/schema creation isn't
    # part of the counted request below.
    resp = client.get("/api/quests/progress")
    assert resp.status_code == 200
    yield


def test_progress_db_open_counts(monkeypatch):
    """GET /quests/progress opens user.sqlite once and profile.sqlite once.

    user.sqlite: was 2 (get_completed_quest_ids + _get_claimed_quest_ids),
    now 1 (merged get_completed_and_claimed_quest_ids).
    profile.sqlite: 1 (step computation in _check_all_steps).
    """
    calls = {"user": 0, "profile": 0}

    real_user = user_db.get_user_db_connection
    real_profile = quests.get_db_connection

    def user_counter(*a, **k):
        calls["user"] += 1
        return real_user(*a, **k)

    def profile_counter(*a, **k):
        calls["profile"] += 1
        return real_profile(*a, **k)

    # Patch every binding the handler can reach. get_completed_quest_ids resolves
    # the name inside the user_db module; _get_claimed_quest_ids (pre-T1536) and
    # the merged helper resolve it via the quests-module import binding.
    monkeypatch.setattr(user_db, "get_user_db_connection", user_counter)
    monkeypatch.setattr(quests, "get_user_db_connection", user_counter, raising=False)
    monkeypatch.setattr(quests, "get_db_connection", profile_counter)

    resp = client.get("/api/quests/progress")
    assert resp.status_code == 200

    assert calls["user"] == 1, f"expected 1 user.sqlite open, got {calls['user']}"
    assert calls["profile"] == 1, f"expected 1 profile.sqlite open, got {calls['profile']}"
