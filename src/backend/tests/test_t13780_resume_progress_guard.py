"""
T13780: a Framing export dispatched just before a backend restart never completed
in the open tab. Backend halves:

  - resume_progress must no-op while an in-band task in THIS process owns the
    render (export_progress seeded, no progress loop) and must start a loop for a
    restart orphan (no export_progress entry).
  - the WS endpoint WARNs when a client attaches to a job this process holds no
    progress state for; _graceful_shutdown WARNs naming in-flight renders.
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks

from app import websocket as ws_mod
from app.routers import exports as exports_router

JOB_ID = "export_t13780"
JOB = {"id": JOB_ID, "status": "processing", "modal_call_id": "fc-1", "started_at": None}


@pytest.fixture(autouse=True)
def _clean_state():
    ws_mod.export_progress.pop(JOB_ID, None)
    exports_router._active_progress_loops.discard(JOB_ID)
    yield
    ws_mod.export_progress.pop(JOB_ID, None)
    exports_router._active_progress_loops.discard(JOB_ID)


async def _call_resume():
    tasks = BackgroundTasks()
    with patch.object(exports_router, "get_export_job", return_value=dict(JOB)):
        result = await exports_router.resume_progress(JOB_ID, tasks)
    return result, tasks


@pytest.mark.asyncio
async def test_resume_progress_noop_when_inband_owner_alive(caplog):
    ws_mod.export_progress[JOB_ID] = {"progress": 15, "status": "processing"}
    with caplog.at_level(logging.INFO):
        _result, tasks = await _call_resume()
    assert len(tasks.tasks) == 0
    assert JOB_ID not in exports_router._active_progress_loops
    assert "in-band render owns" in caplog.text


@pytest.mark.asyncio
async def test_resume_progress_starts_loop_for_restart_orphan(caplog):
    with caplog.at_level(logging.INFO):
        _result, tasks = await _call_resume()
    assert len(tasks.tasks) == 1
    assert JOB_ID in exports_router._active_progress_loops
    assert "restart orphan" in caplog.text


@pytest.mark.asyncio
async def test_crashed_orphan_loop_clears_progress_so_next_resume_starts_loop(caplog):
    """T13830: a loop that dies must not leave export_progress sticky at 'processing'."""
    _result, tasks = await _call_resume()
    assert len(tasks.tasks) == 1
    with patch.object(exports_router, "reconcile_dispatched_export", side_effect=RuntimeError("boom")), \
         caplog.at_level(logging.WARNING):
        # Simulate the entry the loop wrote on an earlier poll before it died.
        ws_mod.export_progress[JOB_ID] = {"progress": 15, "status": "processing"}
        await tasks.tasks[0]()
    assert JOB_ID not in ws_mod.export_progress
    assert JOB_ID not in exports_router._active_progress_loops
    assert "entry cleared" in caplog.text

    _result, tasks2 = await _call_resume()
    assert len(tasks2.tasks) == 1


@pytest.mark.asyncio
async def test_ws_connect_warns_when_no_progress_state(caplog):
    websocket = MagicMock()
    from fastapi import WebSocketDisconnect
    websocket.receive_text = AsyncMock(side_effect=WebSocketDisconnect())
    with patch.object(ws_mod.manager, "connect", AsyncMock()), \
         patch.object(ws_mod.manager, "disconnect", MagicMock()), \
         caplog.at_level(logging.WARNING):
        await ws_mod.websocket_export_progress(websocket, JOB_ID)
    assert "holds no progress state" in caplog.text


@pytest.mark.asyncio
async def test_ws_connect_silent_when_progress_state_present(caplog):
    ws_mod.export_progress[JOB_ID] = {"progress": 1, "status": "processing"}
    websocket = MagicMock()
    from fastapi import WebSocketDisconnect
    websocket.receive_text = AsyncMock(side_effect=WebSocketDisconnect())
    with patch.object(ws_mod.manager, "connect", AsyncMock()), \
         patch.object(ws_mod.manager, "disconnect", MagicMock()), \
         caplog.at_level(logging.WARNING):
        await ws_mod.websocket_export_progress(websocket, JOB_ID)
    assert "holds no progress state" not in caplog.text


def test_graceful_shutdown_warns_about_inflight_renders(caplog):
    from app import main
    # clear=True: the count must not include entries other tests left in the
    # module-global dict (e.g. a cancelled progress loop's "job-1").
    with (
        patch.dict(
            ws_mod.export_progress,
            {
                JOB_ID: {"progress": 15, "status": "processing"},
                "done_job": {"progress": 100, "status": "complete"},
            },
            clear=True,
        ),
        patch("app.storage.R2_ENABLED", False),
        caplog.at_level(logging.WARNING),
        pytest.raises(SystemExit),
    ):
        main._graceful_shutdown(15, None)
    assert "1 render(s) in flight will be orphaned" in caplog.text
    assert JOB_ID in caplog.text
    assert "done_job" not in caplog.text
