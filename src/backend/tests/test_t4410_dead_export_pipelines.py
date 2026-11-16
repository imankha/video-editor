"""T4410: the two unused export pipelines are deleted.

  * C1 -- the durable-worker pipeline (`process_export_job`, reached only from
    `POST /api/exports` and `POST /api/exports/framing`) and the framing-AI
    pipeline (`call_modal_framing_ai` and the four `process_framing_ai*` Modal
    functions it alone called) no longer exist, and no symbol of the deleted code
    is referenced anywhere in src/, src/frontend/e2e/ or scripts/.
  * C2 -- exactly one export progress sender, one progress-callback factory and
    one post-export sync helper remain (all in `services/export_helpers.py`).
"""

import ast
import functools
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]
APP = BACKEND / "app"

DELETED_ROUTES = {"POST /api/exports", "POST /api/exports/framing"}

# Symbols only the deleted code defined. A hit in src/, e2e/ or scripts/ is a
# caller the deletion missed (Refactoring Rule 7). `process_framing_ai` also
# covers `_l4`, `_chunk` and `_parallel`; `local_framing` covers `_mock`.
DELETED_SYMBOLS = [
    "process_export_job",
    "process_framing_export",
    "_sync_after_export",
    "call_modal_framing_ai",
    "process_framing_ai",
    "get_framing_ai_gpu_config",
    "FRAMING_AI_GPU_THRESHOLDS",
    "FRAMING_MAX_CHUNKS",
    "local_framing",
    "_framing_sync",
    "_make_framing_upscaler",
    "/api/exports/framing",
]

# The T4410 check artifacts name the deleted symbols on purpose; recorded
# benchmark results (experiments/*.json) are measurements of the deleted
# functions, not callers.
T4410_ARTIFACTS = [
    "src/backend/tests/test_t4410_dead_export_pipelines.py",
    "src/frontend/e2e/checks/T4410.checks.json",
    "src/backend/experiments/*.json",
]


@functools.cache
def _grep_hits():
    args = ["git", "grep", "-n", "-F"]
    for symbol in DELETED_SYMBOLS:
        args += ["-e", symbol]
    args += ["--", "src", "scripts", ":!*.md", *(f":!{path}" for path in T4410_ARTIFACTS)]
    result = subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=300)
    assert result.returncode in (0, 1), result.stderr
    return result.stdout.splitlines()


@pytest.mark.parametrize("symbol", DELETED_SYMBOLS)
def test_no_caller_of_deleted_symbol(symbol):
    callers = [line for line in _grep_hits() if symbol in line.split(":", 2)[-1]]
    assert callers == [], f"callers of deleted {symbol!r}:\n" + "\n".join(callers)


def test_deleted_routes_are_gone():
    from fastapi.routing import APIRoute

    from app.main import app
    routes = {f"{m} {r.path}" for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert routes & DELETED_ROUTES == set()


def _module_level_defs(name: str) -> list[str]:
    hits = []
    for path in APP.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                hits.append(str(path.relative_to(BACKEND)))
    return sorted(hits)


@pytest.mark.parametrize("name", ["send_progress", "create_progress_callback", "sync_export_db_to_r2"])
def test_one_export_helper_of_each_kind(name):
    assert _module_level_defs(name) == ["app/services/export_helpers.py"]
