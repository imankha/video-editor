"""T14130 -- Modal capacity limits and the single local compose fallback.

  1. Every `@app.function` in the DEPLOYED Modal app (`video_processing.py`) sets an
     explicit `max_containers`, and the framing orchestrator's cap times the largest
     framing fan-out fits inside the documented GPU concurrency limit.
  2. At most ONE local compose fallback runs at a time: while one Modal-failed
     download is composing locally, a second Modal-failed download is REFUSED (its
     local compose is never started) and degrades visibly, never OOM-stacking a
     second 1.7 GB ffmpeg render on the API machine.
"""

import ast
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import serve_time_video as S
from app.services.modal_client import get_framing_ai_gpu_config

MODAL_APP = Path(__file__).resolve().parent.parent / "app" / "modal_functions" / "video_processing.py"


def _module_constants(tree: ast.Module) -> dict:
    consts: dict = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                consts[node.targets[0].id] = eval(
                    compile(ast.Expression(node.value), "<const>", "eval"), {}, dict(consts),
                )
            except Exception:
                continue
    return consts


def _app_functions(tree: ast.Module) -> dict:
    """{function name: {decorator kwarg: ast node}} for every @app.function(...)."""
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        for dec in node.decorator_list:
            if (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr == "function" and isinstance(dec.func.value, ast.Name)
                    and dec.func.value.id == "app"):
                out[node.name] = {kw.arg: kw.value for kw in dec.keywords}
    return out


def test_every_modal_function_sets_max_containers():
    tree = ast.parse(MODAL_APP.read_text(encoding="utf-8"))
    fns = _app_functions(tree)
    assert len(fns) >= 10, "AST walk found too few @app.function decorators"
    missing = sorted(name for name, kws in fns.items() if "max_containers" not in kws)
    assert missing == [], f"@app.function without max_containers: {missing}"


def test_framing_fanout_fits_gpu_limit():
    tree = ast.parse(MODAL_APP.read_text(encoding="utf-8"))
    consts = _module_constants(tree)
    limit = consts["MODAL_GPU_CONCURRENCY_LIMIT"]
    # The Modal-side copy of the largest fan-out must match the client's real one.
    largest_fanout = get_framing_ai_gpu_config(10_000.0)[0]
    assert consts["FRAMING_MAX_CHUNKS"] == largest_fanout

    fns = _app_functions(tree)
    env = dict(consts)

    def cap(name: str) -> int:
        return eval(compile(ast.Expression(fns[name]["max_containers"]), name, "eval"), {}, env)

    # Whole framing exports queue at the orchestrator instead of chunks of many
    # exports interleaving: orchestrators x largest fan-out never exceeds the limit.
    assert cap("process_framing_ai_parallel") * largest_fanout <= limit
    assert cap("process_framing_ai_parallel") >= 1
    for name, kws in fns.items():
        gpu = kws.get("gpu")
        if isinstance(gpu, ast.Constant) and gpu.value is not None:
            assert cap(name) <= limit, f"{name} GPU cap exceeds the plan limit"


def _modal_fails(monkeypatch):
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: True)

    def _boom(*a, **k):
        raise RuntimeError("modal down")
    monkeypatch.setattr(S, "_compose_via_modal", _boom)


def test_second_concurrent_local_fallback_is_refused(monkeypatch):
    _modal_fails(monkeypatch)
    entered = threading.Event()
    release = threading.Event()
    local_calls = []

    def _slow_local(reel, out, intro=None, outro=True, report=None):
        local_calls.append(reel)
        entered.set()
        assert release.wait(10)
        if report is not None:
            report["full_fidelity"] = True
        return True

    monkeypatch.setattr(S, "compose_serve_time", _slow_local)

    first_result = {}
    t = threading.Thread(target=lambda: first_result.setdefault(
        "ok", S.compose_serve_time_dispatched("a.mp4", "a-out.mp4", user_id="u1")))
    t.start()
    try:
        assert entered.wait(10), "first fallback never started"

        report: dict = {}
        ok = S.compose_serve_time_dispatched("b.mp4", "b-out.mp4", user_id="u2", report=report)
        assert ok is False
        assert local_calls == ["a.mp4"], "second local compose must not start"
        assert report.get("full_fidelity") is False
        assert report.get("degraded_reason") == "local_fallback_busy"
    finally:
        release.set()
        t.join(10)
    assert first_result["ok"] is True

    # The slot is released after the first finishes: the next fallback runs.
    release.set()
    assert S.compose_serve_time_dispatched("c.mp4", "c-out.mp4", user_id="u3") is True
    assert local_calls == ["a.mp4", "c.mp4"]


def test_fallback_slot_released_when_local_compose_raises(monkeypatch):
    _modal_fails(monkeypatch)

    def _raises(*a, **k):
        raise RuntimeError("ffmpeg exploded")
    monkeypatch.setattr(S, "compose_serve_time", _raises)
    with pytest.raises(RuntimeError):
        S.compose_serve_time_dispatched("a.mp4", "a-out.mp4", user_id="u1")

    monkeypatch.setattr(S, "compose_serve_time", lambda *a, **k: True)
    assert S.compose_serve_time_dispatched("b.mp4", "b-out.mp4", user_id="u2") is True


def test_modal_off_local_path_is_not_gated(monkeypatch):
    """Modal OFF (dev/in-container) is the normal local path, not a fallback:
    concurrent local composes there are not refused."""
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: False)
    entered = threading.Event()
    release = threading.Event()

    def _slow_local(*a, **k):
        entered.set()
        assert release.wait(10)
        return True

    monkeypatch.setattr(S, "compose_serve_time", _slow_local)
    t = threading.Thread(target=S.compose_serve_time_dispatched, args=("a.mp4", "a-out.mp4"),
                         kwargs={"user_id": "u1"})
    t.start()
    try:
        assert entered.wait(10)
        monkeypatch.setattr(S, "compose_serve_time", lambda *a, **k: True)
        assert S.compose_serve_time_dispatched("b.mp4", "b-out.mp4", user_id="u2") is True
    finally:
        release.set()
        t.join(10)
