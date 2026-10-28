"""
T12820: export recovery must not report COMPLETE before finalize has committed.

Incident (external QA B05): the user returns mid-render, `/modal-status` sees the
render in R2 while the in-band request still holds the DETECTING claim, the recovery
finalize loses the claim (`already_finalizing`), and the endpoint still answered
COMPLETE. The "Highlight ready" card then opened a project whose working_video_id was
still NULL -> playback-url 404. COMPLETE must mean the working video row exists.
"""

import asyncio

import pytest

USER = "user-a"
JOB = {
    "id": "job-1", "status": "processing", "modal_call_id": "fc-abc",
    "output_key": "wv/done.mp4", "project_id": 42,
}


def _patch_recovery(monkeypatch, *, finalization, concurrent):
    """Recovery sees a render in R2; its own finalize returns `finalization`; the
    concurrent in-band finalizer resolves to `concurrent` (None = still running)."""
    from app.routers import exports
    from app.routers.export import multi_clip

    async def _fake_finalize(job, result, user_id):
        return finalization

    async def _fake_wait(export_id, *a, **kw):
        return concurrent

    monkeypatch.setattr(exports, "get_export_job", lambda _id: dict(JOB))
    monkeypatch.setattr(exports, "reconcile_dispatched_export", lambda _job: "rendered")
    monkeypatch.setattr(exports, "finalize_modal_export", _fake_finalize)
    monkeypatch.setattr(exports, "get_current_user_id", lambda: USER)
    monkeypatch.setattr(multi_clip, "_await_concurrent_finalize", _fake_wait)
    return exports


LOST_CLAIM = {"finalized": False, "already_finalizing": True}


@pytest.fixture(autouse=True)
def _clean_progress_state():
    """The progress loop writes the module-global export_progress["job-1"]; a test
    that cancels the loop mid-flight leaves that entry behind, and resume_progress
    (T13780) reads an existing entry as "an in-band task still owns this render"."""
    from app.websocket import export_progress
    export_progress.pop(JOB["id"], None)
    yield
    export_progress.pop(JOB["id"], None)


@pytest.mark.asyncio
async def test_modal_status_not_complete_while_inband_finalize_holds_claim(monkeypatch):
    exports = _patch_recovery(monkeypatch, finalization=LOST_CLAIM, concurrent=None)

    out = await exports.check_modal_status("job-1")

    assert out["status"] == "running", f"COMPLETE before finalize committed: {out}"


@pytest.mark.asyncio
async def test_modal_status_complete_once_concurrent_finalize_lands(monkeypatch):
    exports = _patch_recovery(
        monkeypatch, finalization=LOST_CLAIM,
        concurrent={"finalized": True, "working_video_id": 7, "output_filename": "reel.mp4"},
    )

    out = await exports.check_modal_status("job-1")

    assert out["status"] == "complete"
    assert out["working_video_id"] == 7


@pytest.mark.asyncio
async def test_modal_status_not_complete_when_finalize_fails(monkeypatch):
    exports = _patch_recovery(
        monkeypatch, finalization={"finalized": False, "error": "boom"}, concurrent=None,
    )

    out = await exports.check_modal_status("job-1")

    assert out["status"] == "running", f"COMPLETE although finalize failed: {out}"


async def _run_progress_loop(monkeypatch, exports):
    """Start resume-progress, run its loop until the first message it sends."""
    from fastapi import BackgroundTasks

    from app.websocket import manager

    sent = []

    async def _record(job_id, data):
        sent.append(data)
        raise asyncio.CancelledError  # stop the loop after one message

    monkeypatch.setattr(manager, "send_progress", _record)
    exports._active_progress_loops.discard("job-1")
    bg = BackgroundTasks()
    await exports.resume_progress("job-1", bg)
    for task in bg.tasks:
        with pytest.raises(asyncio.CancelledError):
            await task.func(*task.args, **task.kwargs)
    return sent


@pytest.mark.asyncio
async def test_resume_progress_not_complete_while_inband_finalize_holds_claim(monkeypatch):
    exports = _patch_recovery(monkeypatch, finalization=LOST_CLAIM, concurrent=None)

    sent = await _run_progress_loop(monkeypatch, exports)

    assert sent and sent[0]["status"] == "processing", f"COMPLETE before finalize: {sent}"


@pytest.mark.asyncio
async def test_resume_progress_complete_once_finalized(monkeypatch):
    exports = _patch_recovery(
        monkeypatch, finalization={"finalized": True, "working_video_id": 7}, concurrent=None,
    )
    from fastapi import BackgroundTasks

    from app.websocket import manager

    sent = []

    async def _record(job_id, data):
        sent.append(data)

    monkeypatch.setattr(manager, "send_progress", _record)
    exports._active_progress_loops.discard("job-1")
    bg = BackgroundTasks()
    await exports.resume_progress("job-1", bg)
    for task in bg.tasks:
        await task.func(*task.args, **task.kwargs)

    assert sent[-1]["status"] == "complete"
    assert sent[-1]["workingVideoId"] == 7
