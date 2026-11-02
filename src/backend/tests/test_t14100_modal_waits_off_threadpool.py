"""T14100 -- an in-flight Modal export must hold no threadpool thread.

Before T14100 every Modal export wait ran on the loop's default executor (the
32-thread pool from `main.py lifespan()`): `run_in_executor(None, next_item, gen)`
held a thread for each progress step, i.e. for the WHOLE export including time
queued on Modal. The same pool runs `validate_session` for every authenticated
request (db_sync.py), so 32+ concurrent exports froze every logged-in request.

The fix uses Modal's async API (`remote_gen.aio` / `remote.aio`) and gates exports
behind one global semaphore sized to the Modal GPU limit; an export waiting for a
slot reports a visible `gpu_queued` phase instead of hanging silently.

The held stub below models the real SDK: its blocking wrappers (`remote_gen(...)`,
`remote(...)`) park the calling thread until released; its `.aio` variants await
without one. Counterfactual: on the pre-fix code the 40 held waits occupy all 32
executor threads and an authenticated `/api/health` cannot run `validate_session`
until they are released (it times out here).
"""

import ast
import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

import app.services.modal_client as modal_client
from app.main import app

HELD_EXPORTS = 40
LATENCY_BUDGET = 0.2
MODAL_CLIENT = Path(modal_client.__file__)
MODAL_APP = MODAL_CLIENT.parent.parent / "modal_functions" / "video_processing.py"

FINAL = {"status": "success", "output_key": "working_videos/w.mp4", "clips_processed": 1}


class _Method:
    """A Modal method: blocking when called, non-blocking through `.aio`."""

    def __init__(self, blocking, aio):
        self._blocking = blocking
        self.aio = aio

    def __call__(self, *args, **kwargs):
        return self._blocking(*args, **kwargs)


class _HeldModalFn:
    """A Modal function whose calls stay queued/running until `release` is set."""

    def __init__(self, release: threading.Event):
        self._release = release
        self.in_flight = 0
        self.max_in_flight = 0
        self.remote_gen = _Method(self._blocking_gen, self._aio_gen)
        self.remote = _Method(self._blocking_call, self._aio_call)

    def _blocking_gen(self, **kwargs):
        self._release.wait(timeout=30)
        yield dict(FINAL)

    def _blocking_call(self, *args, **kwargs):
        self._release.wait(timeout=30)
        return dict(FINAL)

    async def _hold(self):
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            while not self._release.is_set():
                await asyncio.sleep(0.01)
        finally:
            self.in_flight -= 1

    async def _aio_gen(self, **kwargs):
        await self._hold()
        yield dict(FINAL)

    async def _aio_call(self, *args, **kwargs):
        await self._hold()
        return dict(FINAL)


def _start_exports(n: int, progress_callback=None) -> list:
    """Mix of the three export wait paths (multi-clip, framing, overlay)."""
    tasks = []
    for i in range(n):
        if i % 3 == 0:
            coro = modal_client.call_modal_clips_ai(
                job_id=f"t14100-clips-{i}", user_id="t14100-user",
                source_keys=["temp/source_0.mp4"], output_key="working_videos/w.mp4",
                clips_data=[{"keyframes": [], "segment_data": {}, "clipIndex": 0, "duration": 5.0}],
                progress_callback=progress_callback,
            )
        elif i % 3 == 1:
            coro = modal_client.call_modal_framing_ai(
                job_id=f"t14100-framing-{i}", user_id="t14100-user",
                input_key="raw_clips/c.mp4", output_key="working_videos/w.mp4",
                keyframes=[], video_duration=5.0, progress_callback=progress_callback,
            )
        else:
            coro = modal_client.call_modal_overlay(
                job_id=f"t14100-overlay-{i}", user_id="t14100-user",
                input_key="working_videos/w.mp4", output_key="final_videos/f.mp4",
                highlight_regions=[], effect_type="dark_overlay", video_duration=5.0,
                progress_callback=progress_callback,
            )
        tasks.append(asyncio.create_task(coro))
    return tasks


def _fast_validate_session(session_id):
    return {"user_id": "t14100-user", "email": "t14100@test.local"}


@pytest.fixture
def held_modal(monkeypatch):
    release = threading.Event()
    fn = _HeldModalFn(release)
    monkeypatch.setattr(modal_client, "_modal_enabled", True)
    monkeypatch.setattr(modal_client, "_get_process_clips_ai_fn", lambda: fn)
    monkeypatch.setattr(modal_client, "_get_process_framing_ai_fn", lambda: fn)
    monkeypatch.setattr(modal_client, "_get_process_framing_ai_parallel_fn", lambda: fn)
    monkeypatch.setattr(modal_client, "_get_render_overlay_fn", lambda: fn)
    yield fn, release
    release.set()


async def _timed_get(client, path) -> float:
    t0 = time.perf_counter()
    try:
        response = await asyncio.wait_for(client.get(path), timeout=2.0)
    except TimeoutError:
        return float("inf")
    assert response.status_code == 200, (path, response.status_code)
    return time.perf_counter() - t0


async def _health_latency_with_held_exports(release):
    # Mirror lifespan()'s bounded I/O executor (main.py).
    asyncio.get_running_loop().set_default_executor(
        ThreadPoolExecutor(max_workers=32, thread_name_prefix="io-test")
    )
    exports = _start_exports(HELD_EXPORTS)
    await asyncio.sleep(0.3)  # let every export reach its Modal wait
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as anon:
            anon_latency = await _timed_get(anon, "/api/health")
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver", cookies={"rb_session": "x"}
        ) as authed:
            authed_latency = await _timed_get(authed, "/api/health")
    finally:
        release.set()
        results = await asyncio.wait_for(asyncio.gather(*exports), timeout=10)
    return anon_latency, authed_latency, results


def test_health_stays_fast_with_40_held_modal_waits(held_modal):
    """T14100:C1 -- 40 in-flight exports leave the request path responsive."""
    _, release = held_modal
    with patch("app.middleware.db_sync.validate_session", _fast_validate_session):
        anon_latency, authed_latency, results = asyncio.run(_health_latency_with_held_exports(release))

    assert all(r["status"] == "success" for r in results), results
    assert anon_latency < LATENCY_BUDGET, f"anon /api/health took {anon_latency:.3f}s"
    assert authed_latency < LATENCY_BUDGET, (
        f"authenticated /api/health took {authed_latency:.3f}s with {HELD_EXPORTS} held Modal "
        f"waits -- export waits are holding the default executor's threads again"
    )


def test_no_threadpool_wait_left_on_the_modal_path():
    """T14100:C2 -- grep-provable: no executor/to_thread wait on a Modal call."""
    source = MODAL_CLIENT.read_text()
    assert "run_in_executor(None" not in source
    assert "to_thread(fn.remote" not in source
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and ast.unparse(node.func).endswith("to_thread"):
            args = [ast.unparse(a) for a in node.args]
            assert not any(a.endswith(".remote") for a in args), ast.unparse(node)


def test_export_slots_match_modal_gpu_limit():
    """The semaphore size mirrors video_processing.MODAL_GPU_CONCURRENCY_LIMIT
    (that module can't be imported app-side; keep the two copies in step)."""
    tree = ast.parse(MODAL_APP.read_text())
    limit = next(
        node.value.value for node in tree.body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "MODAL_GPU_CONCURRENCY_LIMIT"
    )
    assert limit == modal_client.MODAL_EXPORT_SLOTS


@pytest.mark.asyncio
async def test_exports_beyond_the_slots_report_queued(held_modal, monkeypatch):
    """T14100:C3 -- an export over the GPU limit shows `gpu_queued`, then runs."""
    fn, release = held_modal
    monkeypatch.setattr(modal_client, "MODAL_EXPORT_SLOTS", 2)
    phases: list[str] = []

    async def progress_callback(progress, message, phase="processing"):
        phases.append(phase)

    exports = _start_exports(3, progress_callback)
    await asyncio.sleep(0.2)
    assert fn.in_flight == 2, "only MODAL_EXPORT_SLOTS exports may be waiting on Modal"
    assert phases.count("gpu_queued") == 1, phases

    release.set()
    results = await asyncio.wait_for(asyncio.gather(*exports), timeout=5)
    assert [r["status"] for r in results] == ["success"] * 3
    assert fn.max_in_flight == 2
