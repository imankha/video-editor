"""T11010: per-FILE upload ATTEMPT events for both upload kinds.

Why this exists — two read-side lies the admin Users table was telling:

  Clips  "0 tried / 11 succeeded"  `clip_upload_attempted` was registered in
         FLOW_EVENTS by T8370 but emitted by NOTHING, so the tried half of the
         pair summed one real event (clip_save_attempted, annotate flow only)
         and one dead name. Every direct-upload account read zero attempts.

  Games  "1 tried / 5 succeeded"   `game_created` is one event per GAME while
         `game_upload_succeeded` is one per VIDEO FILE, so a multi-angle game
         showed success exceeding attempt.

Both halves now fire from ONE seam — prepare_upload, on the path that is about
to push bytes — keyed on the request's explicit `kind`, never on a duration or
file-size heuristic.

Run with: pytest src/backend/tests/test_t11010_upload_attempt_pairs.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.database import USER_DATA_BASE

TEST_USER_ID = f"test_t11010_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

GAME_HASH = "a" * 64
CLIP_HASH = "b" * 64


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _client():
    from fastapi.testclient import TestClient

    from app.main import app
    return TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID})


@pytest.fixture(autouse=True)
def _r2_enabled(monkeypatch):
    monkeypatch.setattr("app.routers.games_upload.R2_ENABLED", True, raising=False)
    yield


@pytest.fixture
def recorded(monkeypatch):
    """Capture record_milestone calls instead of writing to Postgres.

    prepare_upload imports record_milestone INSIDE the function body (circular-
    import avoidance), so the patch has to land on the analytics module itself.
    """
    calls: list[tuple[str, str]] = []

    def _fake(user_id, event, context=None, reason=None):
        calls.append((user_id, event if not reason else f"{event}:{reason}"))

    monkeypatch.setattr("app.analytics.record_milestone", _fake)
    return calls


def _prepare(client, kind, blake3_hash, file_size=10 * 1024 * 1024):
    return client.post("/api/games/prepare-upload", json={
        "blake3_hash": blake3_hash,
        "file_size": file_size,
        "original_filename": f"{kind}.mp4",
        "kind": kind,
    })


class TestAttemptEventsFireAtPrepare:
    def test_game_prepare_emits_game_upload_attempted(self, monkeypatch, recorded):
        """The per-FILE attempt that matches game_upload_succeeded's grain."""
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: None)

        with _client() as client:
            _prepare(client, "game", GAME_HASH)

        events = [e for _, e in recorded]
        assert "game_upload_attempted" in events, events
        # The per-GAME event belongs to POST /api/games, never to this seam --
        # emitting it here would re-create the 1-game/5-files grain mismatch.
        assert "game_created" not in events, events

    def test_clip_prepare_emits_clip_upload_attempted(self, monkeypatch, recorded):
        """T8370 reserved this name; before T11010 nothing ever emitted it."""
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: None)

        with _client() as client:
            _prepare(client, "clip", CLIP_HASH)

        events = [e for _, e in recorded]
        assert "clip_upload_attempted" in events, events
        assert "game_upload_attempted" not in events, events

    def test_kind_decides_the_event_not_file_size(self, monkeypatch, recorded):
        """A tiny game file is still a GAME attempt; a large clip is still a CLIP one.

        The explicit `kind` is authoritative (it is validated to a closed set),
        so no duration/size threshold is ever consulted -- a 15-second game clip
        and a several-minute highlight source each file correctly.
        """
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: None)

        with _client() as client:
            _prepare(client, "game", GAME_HASH, file_size=1024)            # tiny game
            _prepare(client, "clip", CLIP_HASH, file_size=400 * 1024 * 1024)  # big clip

        events = [e for _, e in recorded]
        assert events.count("game_upload_attempted") == 1, events
        assert events.count("clip_upload_attempted") == 1, events

    def test_game_dedup_hit_emits_no_attempt(self, monkeypatch, recorded):
        """A GAME dedup hit can never produce a matching success.

        game_upload_succeeded fires only in finalize_upload, which needs an
        upload_session_id this branch never returns -- so counting the dedup hit
        would be pure attempt inflation.
        """
        monkeypatch.setattr(
            "app.routers.games_upload.r2_head_object_global",
            lambda key: {"ContentLength": 10 * 1024 * 1024},
        )

        with _client() as client:
            resp = _prepare(client, "game", GAME_HASH)

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "exists"
        events = [e for _, e in recorded]
        assert "game_upload_attempted" not in events, events
        assert "clip_upload_attempted" not in events, events

    def test_clip_dedup_hit_DOES_emit_an_attempt(self, monkeypatch, recorded):
        """A CLIP dedup hit CAN be followed by a real success, so it must count.

        clip_uploaded fires from POST /api/clips/upload per newly-created
        raw_clips row. The R2 clip object is keyed per USER while raw_clips is
        per PROFILE, so the same file dedup-hitting here and then landing a row
        under a second profile (or after its old row was deleted) is a real
        "0 tried / 1 succeeded" if this branch stays silent.
        """
        monkeypatch.setattr(
            "app.routers.games_upload.r2_head_object_global",
            lambda key: {"ContentLength": 5 * 1024 * 1024},
        )

        with _client() as client:
            resp = _prepare(client, "clip", CLIP_HASH)

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "exists"
        events = [e for _, e in recorded]
        assert "clip_upload_attempted" in events, events
        assert "game_upload_attempted" not in events, events

    def test_rejected_request_emits_no_attempt(self, monkeypatch, recorded):
        """A malformed hash is refused before the seam -- it is an upload FAILURE
        (record_upload_failure), not a byte-pushing attempt."""
        monkeypatch.setattr("app.routers.games_upload.r2_head_object_global", lambda key: None)

        with _client() as client:
            resp = _prepare(client, "game", "not-a-hash")

        assert resp.status_code == 400
        events = [e for _, e in recorded]
        assert "game_upload_attempted" not in events, events


class TestEventRegistration:
    def test_game_upload_attempted_is_a_known_flow_event(self):
        """record_milestone drops (and warns on) any event missing from FLOW_EVENTS."""
        from app.analytics import FLOW_EVENTS
        assert "game_upload_attempted" in FLOW_EVENTS
        assert "clip_upload_attempted" in FLOW_EVENTS

    def test_attempt_events_add_no_daily_counter_column(self):
        """daily_col None -> no daily_counters column, so no migration is needed."""
        from app.analytics import FLOW_EVENTS
        assert FLOW_EVENTS["game_upload_attempted"]["daily_col"] is None
        assert FLOW_EVENTS["clip_upload_attempted"]["daily_col"] is None

    def test_attempt_events_stay_out_of_the_user_funnel(self):
        """The funnel already carries game_created -> game_upload_succeeded at USER
        grain. These per-file attempts are admin-table detail, not a funnel step."""
        from app.analytics import FUNNEL_STEPS
        assert "game_upload_attempted" not in FUNNEL_STEPS
        assert "clip_upload_attempted" not in FUNNEL_STEPS
