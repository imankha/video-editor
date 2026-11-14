# T4410: Delete the unused export pipelines

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

A highlight is rendered by one path today. Two older complete export pipelines still sit beside it, about 2,700 lines including four GPU functions, each with its own copy of the progress and save helpers, and one bug fix has already landed in only one copy. Delete both so one of each helper remains, and check whether the export path for a video with no project can still be reached before deleting that too. Needs a GPU redeploy, so the owner is asked first. Runs after T11250.

## Implementer details

- Live path: `POST /api/export/render` then `_export_clips` then Modal `process_clips_ai` (`routers/export/multi_clip.py`).
- Dead worker pipeline: `process_export_job`, reached only from `POST /api/exports` and `POST /api/exports/framing` in `routers/exports.py`, which the app never calls. The only non-test reference is `e2e/T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js`, which uses the route as an arbitrary POST; re-point it first, with `tests/test_export_golden_worker.py`. Delete the two endpoints and `services/export_worker.py` apart from `recover_orphaned_jobs`. That leaves one `send_progress`, one callback factory and one sync (`export_helpers.py`).
- Dead framing-AI pipeline: `call_modal_framing_ai` in `services/modal_client.py` has no caller in `app/` (the one in `export_helpers.py` is a docstring example). It is the sole client of Modal `process_framing_ai`, `process_framing_ai_l4`, `process_framing_ai_chunk` and `process_framing_ai_parallel` in `modal_functions/video_processing.py` (about 1,150 lines), of `get_framing_ai_gpu_config`, and of `local_framing`, `_framing_sync` and `local_framing_mock` in `local_processors.py`. Tests to delete or re-point: `test_t13933`, `test_t14100`, `test_t14130`, `test_t7370`.
- Verify before deleting: the 'no project' overlay export `POST /api/export/overlay` and `/final` in `routers/export/overlay.py` (about 500 lines), reachable only from `ExportButtonContainer.jsx` when no project is selected. If that state cannot occur, delete it and its app branch; if unsure, leave it and say so.
- Not in scope: a registry of export handlers (Refactoring Rule 6 forbids it) and moving the sweep onto export rails (the sweep no longer exports; it stream-copies a raw clip).
- Optional last commit, pure code motion: move player detection and `_export_clips` out of the router file.
- Modal redeploy: ask the owner before running it. Fix `.claude/knowledge/modal-gpu.md` and `export-pipeline.md` in the same PR.

## Acceptance Criteria

- [ ] `call_modal_framing_ai`, the four `process_framing_ai*` GPU functions and `process_export_job` no longer exist, with an empty caller search over `src/`, `src/frontend/e2e/` and `scripts/` in the PR.
- [ ] Exactly one progress sender, one callback factory and one sync helper remain for exports.
- [ ] A highlight renders end to end on staging after the GPU redeploy.
