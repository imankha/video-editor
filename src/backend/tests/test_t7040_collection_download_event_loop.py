"""T7040 regression tests.

Bug: clicking Download on a collection intermittently failed client-side with
`TypeError: Failed to fetch` (fetch()'s generic network-level failure -- the
browser never got a usable HTTP response). Two independent mechanisms, both
fixed here:

D (root cause -- event-loop starvation): GET /api/exports/active is an async
   route that called get_active_exports() -> cleanup_stale_exports() INLINE on
   the event loop. For every stale job with a modal_call_id, cleanup makes a
   BLOCKING Modal control-plane round-trip (check_modal_job_running -> call.get)
   in a sequential loop. On staging's single-worker uvicorn that froze the whole
   event loop (observed 31s), starving a concurrent collection-download request
   until its connection was abandoned -> "Failed to fetch". Fix: offload the
   blocking sweep to a worker thread (anyio.to_thread.run_sync) so the loop stays
   responsive. test_active_sweep_does_not_block_event_loop reproduces this: a
   ticker coroutine must keep ticking while a slow sweep is in flight.

A (hardening): the stitch/compose work ran INSIDE the StreamingResponse
   generator, so a failure fired AFTER the 200 + headers were committed and the
   client saw the same bare "Failed to fetch". Fix: do the fallible work in the
   handler BEFORE returning the stream, so a stitch failure is a clean HTTP 500.
   test_stitch_failure_returns_clean_500 covers this.
"""

import asyncio
import sqlite3
import time
from contextlib import contextmanager

import pytest

# --------------------------------------------------------------------------
# D: the /active sweep must not block the event loop
# --------------------------------------------------------------------------

def _seed_active_db(num_stale: int) -> sqlite3.Connection:
    """In-memory profile DB with `num_stale` old processing jobs, each carrying a
    modal_call_id (so cleanup_stale_exports pays a Modal round-trip per row)."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE export_jobs (id TEXT PRIMARY KEY, project_id INTEGER, type TEXT, "
        "status TEXT, error TEXT, output_video_id INTEGER, output_filename TEXT, "
        "modal_call_id TEXT, created_at TEXT, started_at TEXT, completed_at TEXT, "
        "game_id INTEGER, game_name TEXT)"
    )
    conn.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO projects (id, name) VALUES (1, 'Proj')")
    for i in range(num_stale):
        conn.execute(
            "INSERT INTO export_jobs (id, project_id, type, status, modal_call_id, created_at) "
            "VALUES (?, 1, 'multi_clip', 'processing', ?, datetime('now', '-120 minutes'))",
            (f"job-{i}", f"call-{i}"),
        )
    conn.commit()
    return conn


@pytest.mark.asyncio
async def test_active_sweep_does_not_block_event_loop(monkeypatch):
    """A slow cleanup sweep (blocking Modal checks) must NOT freeze the event
    loop: a concurrent ticker keeps advancing while list_active_exports runs.

    Pre-fix (inline get_active_exports on the loop) the ticker was starved to ~0
    ticks for the whole ~1.5s sweep. Post-fix (offloaded to a thread) it keeps
    ticking. We assert a generous floor so the test is not flaky under load."""
    from app.routers import exports

    conn = _seed_active_db(num_stale=3)

    @contextmanager
    def _fake_conn():
        yield conn  # shared; do not close between get_active_exports' two opens

    # Each Modal status check blocks 0.5s (simulates the real call.get round-trip).
    # 3 stale jobs -> ~1.5s of blocking work inside the sweep. Report "still
    # running" so the rows are left intact (no writes needed for the timing test).
    def _blocking_check(_call_id):
        time.sleep(0.5)
        return True

    monkeypatch.setattr(exports, "get_db_connection", _fake_conn)
    monkeypatch.setattr(exports, "check_modal_job_running", _blocking_check)

    ticks = 0
    stop = False

    async def _ticker():
        nonlocal ticks
        while not stop:
            ticks += 1
            await asyncio.sleep(0.01)

    ticker_task = asyncio.create_task(_ticker())
    await asyncio.sleep(0)  # let the ticker start

    result = await exports.list_active_exports()

    stop = True
    await ticker_task

    # The sweep blocks ~1.5s. If the loop stayed responsive the ticker fired many
    # times (~150 ideal); a blocked loop yields ~0. 20 is a comfortable floor that
    # a still-blocking implementation cannot reach.
    assert ticks >= 20, f"event loop was starved during the sweep (only {ticks} ticks)"
    # Sanity: the route still returned the seeded active jobs.
    assert len(result.exports) == 3


def test_cleanup_stale_exports_check_is_synchronous_and_offloaded(monkeypatch):
    """Guards the SHAPE of the fix: cleanup_stale_exports itself is a plain
    blocking function (its Modal check is sync), and the async route offloads the
    whole thing via anyio.to_thread.run_sync rather than awaiting it inline."""
    import inspect

    from app.routers import exports

    # cleanup + its Modal check stay synchronous (they are meant to run in a thread).
    assert not inspect.iscoroutinefunction(exports.cleanup_stale_exports)
    assert not inspect.iscoroutinefunction(exports.check_modal_job_running)
    # The route offloads: its source names anyio.to_thread.run_sync(get_active_exports).
    src = inspect.getsource(exports.list_active_exports)
    assert "anyio.to_thread.run_sync(get_active_exports)" in src, (
        "list_active_exports must offload the blocking sweep to a worker thread"
    )


# --------------------------------------------------------------------------
# A: a stitch failure is a clean HTTP 500, not a mid-stream "Failed to fetch"
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stitch_failure_returns_clean_500(monkeypatch):
    """When the member stitch fails, download_collection must raise HTTPException
    (a clean status the frontend reports) BEFORE returning the StreamingResponse
    -- never let the exception escape from inside the generator after headers."""
    from fastapi import HTTPException

    from app.routers import collections

    # Resolve members/definition up front without a real DB/profile context.
    monkeypatch.setattr(
        collections, "_collection_scope_and_definition",
        lambda *a, **k: (["t"], {"scope": {"type": "all"}}),
    )
    monkeypatch.setattr(collections, "collection_intro_settings_key", lambda *a, **k: "key")
    monkeypatch.setattr(collections, "get_current_user_id", lambda: "user-1")
    monkeypatch.setattr(collections, "get_current_profile_id", lambda: "prof-1")

    @contextmanager
    def _fake_conn():
        yield sqlite3.connect(":memory:")  # only .cursor() is exercised before patches

    monkeypatch.setattr(collections, "get_db_connection", _fake_conn)
    monkeypatch.setattr(collections, "get_collection_intro_card_id", lambda *a, **k: None)
    monkeypatch.setattr(
        collections, "evaluate_collection_members",
        lambda *a, **k: [{"filename": "a.mp4", "duration": 3.0}],
    )
    monkeypatch.setattr(collections, "record_milestone", lambda *a, **k: None)

    # Force the LOCAL stitch branch and make the stitch blow up.
    from app.services import modal_client
    monkeypatch.setattr(modal_client, "modal_enabled", lambda: False)

    def _boom(*a, **k):
        raise RuntimeError("collection member concat failed")

    monkeypatch.setattr(collections, "_stitch_members_local", _boom)

    with pytest.raises(HTTPException) as exc_info:
        await collections.download_collection(scope_type="all", aspect_ratio="9:16")

    assert exc_info.value.status_code == 500
    # Concrete acceptance bar: a real HTTP status, not a bare "Failed to fetch".
    assert "stitch" in str(exc_info.value.detail).lower()
