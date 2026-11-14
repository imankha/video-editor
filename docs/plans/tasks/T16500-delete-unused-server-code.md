# T16500: Delete unused server code

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

About 3,400 lines on the server are never run: a video processing layer only its own tests use (1,100 lines), a benchmark copy of the GPU code that is never deployed (950), two helper modules (600), a game video endpoint nothing calls (210), several unused export endpoints, and an abandoned Cloudflare worker folder. The AI agents that work in this repo read and copy from this code, and the dead-code scanner cannot see it because tests keep it looking used. Delete it, proving for each piece that the app, the browser tests and the scripts have no caller. Nothing needs redeploying to the GPU service.

## Implementer details

- Processor stack, 1,118 lines: `app/services/video_processor.py`, `processor_local.py`, `processor_modal.py`, `local_gpu_processor.py`. `ProcessorFactory.create` is called only in docstrings and `tests/test_video_processor.py`; `app/services/__init__.py` re-exports it on every package import (the reason some tests stub cv2). Two classes named `LocalGPUProcessor` register for the same backend.
- `app/modal_functions/video_processing_optimized.py`, 952 lines: `deploy.py` and `deploy-modal.yml` deploy only `video_processing.py`. Decide in the PR whether `src/backend/experiments/` (3,227 lines, same family) goes too.
- `app/services/progress_reporter.py` (305) and `app/services/ffmpeg_errors.py` (307): no app importer, only their own tests (256 and 347 lines).
- `GET /api/games/{id}/stream` in `routers/games.py` (about 210 lines): no caller in the app or the browser tests; only a regex arm in `middleware/db_sync.py` and a case in `tests/test_t14970_media_profile_param.py`. The other three stream endpoints (downloads, working video, clips) are live and stay.
- Unused export endpoints: `POST /api/export/crop` in `routers/export/framing.py` (which also makes `app/interpolation.py`, 214 lines, dead), `GET /api/export/highlights` and `/highlights/{filename}` in `routers/export/overlay.py` with the extraction functions in `image_extractor.py`, `GET /api/exports/recent` and `GET /api/exports/project/{id}`.
- `workers/` at the repo root: a `wrangler.toml` naming a worker after the Fly app, bound to the production users bucket and pointing at a missing entry file. Delete the folder.
- Fix `.claude/knowledge/modal-gpu.md` and `export-pipeline.md` where they name anything deleted (the doc-drift check will fail otherwise).
- Grep `src/`, `src/frontend/e2e/` and `scripts/` for every deleted route and symbol and paste the result in the PR (Refactoring Rule 7). One mechanical commit per piece, each under about 200 lines of meaningful diff besides the deletions.
- The unused export pipelines that need a GPU redeploy are T4410, not this task.

## Acceptance Criteria

- [ ] Each listed file and endpoint is gone, and the PR shows an empty caller search over `src/`, `src/frontend/e2e/` and `scripts/` for each.
- [ ] The server starts and the backend suite passes with the deleted tests removed and nothing else changed.
- [ ] The route table differs from before only by the listed endpoints (snapshot test or printed diff in the PR).
