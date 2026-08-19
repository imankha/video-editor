"""
T7210 — Modal call_id recovery capture + GeneratorDone recovery handling.

Two independent regressions, both introduced by the same root cause:
`process_clips_ai.remote_gen()` returns a plain generator with no `.object_id`
attribute (verified against the installed Modal SDK, 1.3.1) -- the old
`hasattr(gen, 'object_id')` check in modal_client.py was dead code, so
`export_jobs.modal_call_id` never populated for any Modal generator export.

(a) `call_modal_clips_ai` now captures the call id from the FIRST stream item
    (the Modal function emits it via `modal.current_function_call_id()`),
    not from an attribute on the generator object.
(b) `/api/exports/{job_id}/modal-status` recovering a generator call gets a
    `GeneratorDone` marker back from `FunctionCall.get()`, not the dict the
    function yielded as its last item -- it must not blindly treat that as
    success (T4240: never finalize a row pointing at a missing R2 object).
"""

import uuid

import pytest

import app.services.modal_client as modal_client
from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_t7210_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


@pytest.fixture
def project():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T7210', '9:16')")
        project_id = cur.lastrowid
        conn.commit()
    yield project_id
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cur.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _create_job(export_id, project_id, output_key=None):
    with get_db_connection() as conn:
        conn.cursor().execute(
            "INSERT INTO export_jobs (id, project_id, type, status, input_data, output_key) "
            "VALUES (?, ?, 'framing', 'processing', '{}', ?)",
            (export_id, project_id, output_key),
        )
        conn.commit()


# ============================================================================
# (a) call_modal_clips_ai captures modal_call_id from the first stream item
# ============================================================================


class _FakeGenerator:
    """No .object_id attribute -- matches what remote_gen() actually returns."""

    def __init__(self, items):
        self._it = iter(items)

    def __next__(self):
        return next(self._it)


class _FakeProcessClipsAi:
    def __init__(self, items):
        self._items = items

    def remote_gen(self, **kwargs):
        return _FakeGenerator(self._items)


@pytest.mark.asyncio
async def test_call_modal_clips_ai_captures_call_id_from_first_stream_item(monkeypatch):
    monkeypatch.setattr(modal_client, "_modal_enabled", True)

    items = [
        {"progress": 0, "phase": "dispatched", "message": "Starting...", "modal_call_id": "fc-abc123"},
        {"progress": 50, "phase": "upscaling", "message": "halfway"},
        {"status": "success", "output_key": "working_videos/w.mp4", "clips_processed": 1},
    ]
    monkeypatch.setattr(modal_client, "_get_process_clips_ai_fn", lambda: _FakeProcessClipsAi(items))

    captured = []
    result = await modal_client.call_modal_clips_ai(
        job_id="job-1",
        user_id=TEST_USER_ID,
        source_keys=["temp/source_0.mp4"],
        output_key="working_videos/w.mp4",
        clips_data=[{"keyframes": [], "segment_data": {}, "clipIndex": 0, "duration": 5.0}],
        call_id_callback=captured.append,
    )

    assert captured == ["fc-abc123"], "callback should fire exactly once with the emitted call id"
    assert result["status"] == "success"


@pytest.mark.asyncio
async def test_call_modal_clips_ai_no_call_id_item_never_fires_callback(monkeypatch):
    """A stream with no modal_call_id item (e.g. an older deployed Modal function
    that hasn't been redeployed with the T7210 emit) must not crash or fire a
    bogus callback -- it should behave exactly as before this fix."""
    monkeypatch.setattr(modal_client, "_modal_enabled", True)

    items = [
        {"progress": 50, "phase": "upscaling", "message": "halfway"},
        {"status": "success", "output_key": "working_videos/w.mp4", "clips_processed": 1},
    ]
    monkeypatch.setattr(modal_client, "_get_process_clips_ai_fn", lambda: _FakeProcessClipsAi(items))

    captured = []
    result = await modal_client.call_modal_clips_ai(
        job_id="job-2",
        user_id=TEST_USER_ID,
        source_keys=["temp/source_0.mp4"],
        output_key="working_videos/w.mp4",
        clips_data=[{"keyframes": [], "segment_data": {}, "clipIndex": 0, "duration": 5.0}],
        call_id_callback=captured.append,
    )

    assert captured == []
    assert result["status"] == "success"


# ============================================================================
# (b) /modal-status recovering a generator call (GeneratorDone, not a dict)
# ============================================================================


class _FakeGeneratorDone:
    """Stand-in for modal's api_pb2.GeneratorDone -- not a dict."""


class _FakeFunctionCall:
    def __init__(self, get_result):
        self._get_result = get_result

    def get(self, timeout=0):
        return self._get_result


@pytest.mark.asyncio
async def test_modal_status_generator_done_finalizes_when_output_exists(project, monkeypatch):
    """GeneratorDone + a confirmed R2 object -> treat as success and finalize."""
    export_id = f"exp-{uuid.uuid4().hex[:8]}"
    _create_job(export_id, project, output_key="working_videos/w_ok.mp4")
    with get_db_connection() as conn:
        conn.cursor().execute("UPDATE export_jobs SET modal_call_id = 'fc-1' WHERE id = ?", (export_id,))
        conn.commit()

    import app.routers.exports as er

    monkeypatch.setattr(er, "get_current_user_id", lambda: TEST_USER_ID)

    class _FakeModal:
        FunctionCall = type("FunctionCall", (), {"from_id": staticmethod(lambda cid: _FakeFunctionCall(_FakeGeneratorDone()))})

    monkeypatch.setitem(__import__("sys").modules, "modal", _FakeModal())
    import app.storage as storage_mod
    monkeypatch.setattr(storage_mod, "file_exists_in_r2", lambda *a, **k: True)

    async def fake_finalize(job, result, user_id):
        return {"finalized": True, "working_video_id": 1, "output_filename": "w_ok.mp4"}

    monkeypatch.setattr(er, "finalize_modal_export", fake_finalize)

    resp = await er.check_modal_status(export_id)

    assert resp["status"] == "complete"


@pytest.mark.asyncio
async def test_modal_status_generator_done_errors_when_no_output_object(project, monkeypatch):
    """GeneratorDone + NO confirmed R2 object -> must NOT silently finalize a
    row pointing at a missing object (T4240). Reports error instead."""
    export_id = f"exp-{uuid.uuid4().hex[:8]}"
    _create_job(export_id, project, output_key="working_videos/w_missing.mp4")
    with get_db_connection() as conn:
        conn.cursor().execute("UPDATE export_jobs SET modal_call_id = 'fc-2' WHERE id = ?", (export_id,))
        conn.commit()

    import app.routers.exports as er

    monkeypatch.setattr(er, "get_current_user_id", lambda: TEST_USER_ID)

    class _FakeModal:
        FunctionCall = type("FunctionCall", (), {"from_id": staticmethod(lambda cid: _FakeFunctionCall(_FakeGeneratorDone()))})

    monkeypatch.setitem(__import__("sys").modules, "modal", _FakeModal())
    import app.storage as storage_mod
    monkeypatch.setattr(storage_mod, "file_exists_in_r2", lambda *a, **k: False)

    finalize_called = []

    async def fake_finalize(job, result, user_id):
        finalize_called.append(True)
        return {"finalized": True}

    monkeypatch.setattr(er, "finalize_modal_export", fake_finalize)

    resp = await er.check_modal_status(export_id)

    assert resp["status"] == "error"
    assert finalize_called == [], "must not finalize when the output object is missing"
    with get_db_connection() as conn:
        status = conn.cursor().execute(
            "SELECT status FROM export_jobs WHERE id = ?", (export_id,)
        ).fetchone()[0]
    assert status == "error"
