"""T16500: unused server code is deleted, and nothing else moved.

  * C1 -- each listed dead module, folder and endpoint is gone, and no symbol of
    the deleted code is referenced anywhere in src/, src/frontend/e2e/ or scripts/.
  * C3 -- the route table differs from the pre-T16500 table only by the listed
    endpoints. `fixtures/t16500_routes_before.json` is the route table at the
    T16500 base revision (test seams and dev accounts excluded: they mount per
    env). Routes added later are fine; a later intentional route removal adds
    itself to that file's history by deleting its line from the fixture.
"""

import functools
import json
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]

DELETED_FILES = [
    "src/backend/app/services/video_processor.py",
    "src/backend/app/services/processor_local.py",
    "src/backend/app/services/processor_modal.py",
    "src/backend/app/services/local_gpu_processor.py",
    "src/backend/app/modal_functions/video_processing_optimized.py",
    "src/backend/app/services/progress_reporter.py",
    "src/backend/app/services/ffmpeg_errors.py",
    "src/backend/app/services/image_extractor.py",
    "src/backend/app/interpolation.py",
    "workers",
]

DELETED_ROUTES = {
    "GET /api/games/{game_id:int}/stream",
    "POST /api/export/crop",
    "GET /api/export/highlights",
    "GET /api/export/highlights/{filename}",
    "GET /api/exports/recent",
    "GET /api/exports/project/{project_id}",
}

# Symbols only the deleted code defined. A hit in src/, e2e/ or scripts/ is a
# caller the deletion missed (Refactoring Rule 7).
DELETED_SYMBOLS = [
    "ProcessorFactory",
    "LocalGPUProcessor",
    "ModalProcessor",
    "app.services.video_processor",
    "local_gpu_processor",
    "processor_local",
    "processor_modal",
    "video_processing_optimized",
    "progress_reporter",
    "ProgressReporter",
    "ffmpeg_errors",
    "image_extractor",
    "list_highlight_images",
    "extract_player_image",
    "generate_crop_filter",
    "stream_game_bounded",
    "list_recent_exports",
    "get_recent_exports",
    "list_project_exports",
    "get_project_exports",
    "export_crop",
    "/api/export/crop",
    "/api/export/highlights",
    "/api/exports/recent",
    "/api/exports/project",
]


@pytest.mark.parametrize("rel", DELETED_FILES)
def test_dead_file_is_deleted(rel):
    assert not (REPO / rel).exists(), f"{rel} should be deleted"


@functools.cache
def _grep_hits():
    # One git grep for every symbol (a grep per symbol took minutes on a slow
    # checkout). This file names every symbol on purpose; it is excluded.
    args = ["git", "grep", "-n", "-F"]
    for symbol in DELETED_SYMBOLS:
        args += ["-e", symbol]
    args += ["--", "src", "scripts", ":!src/backend/tests/test_t16500_dead_server_code.py", ":!*.md"]
    result = subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=300)
    assert result.returncode in (0, 1), result.stderr
    return result.stdout.splitlines()


@pytest.mark.parametrize("symbol", DELETED_SYMBOLS)
def test_no_caller_of_deleted_symbol(symbol):
    callers = [line for line in _grep_hits() if symbol in line.split(":", 2)[-1]]
    assert callers == [], f"callers of deleted {symbol!r}:\n" + "\n".join(callers)


def _route_table():
    from fastapi.routing import APIRoute

    from app.main import app
    return {f"{m} {r.path}" for r in app.routes if isinstance(r, APIRoute) for m in r.methods}


def test_route_table_differs_only_by_listed_endpoints():
    before = set(json.loads((BACKEND / "tests/fixtures/t16500_routes_before.json").read_text()))
    assert before >= DELETED_ROUTES, "fixture must hold the base route table"
    now = _route_table()
    assert before - now == DELETED_ROUTES
