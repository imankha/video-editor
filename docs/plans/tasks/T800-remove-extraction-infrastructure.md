# T800: Remove Legacy Clip Extraction Infrastructure

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

T740 merged standalone clip extraction into the framing export pipeline — clips now use range queries on the source game video instead of being extracted into separate files. T790 removed the extraction *triggers* (the code paths that enqueued extraction tasks), but a large amount of dead infrastructure remains: response model fields, API endpoints, WebSocket managers, queue processing functions, tests, and stale comments.

This dead code:
- Confuses future development (extraction "looks" like it exists)
- Adds unnecessary DB queries (e.g., `get_project` still JOINs `modal_tasks`)
- Keeps a WebSocket connection alive for events that never fire
- Inflates test suite with tests for dead functions

## Solution

Remove all remaining clip extraction infrastructure that is no longer reachable after T790. Keep only:
- `modal_tasks` table (may be used for future task types)
- FFmpeg/Modal extraction *functions* in `ffmpeg_service.py`, `modal_client.py`, `video_processing.py` (used by framing export inline)
- Video metadata extraction (`extractVideoMetadata`) — unrelated concept
- Frame/image extraction for AI upscaling — unrelated concept

## Dead Code Inventory

### Backend — Response Models (`projects.py`)
- **Line 190**: `ClipSummary.is_extracting: bool` field
- **Lines 201-202**: `ProjectListItem.clips_extracting`, `clips_pending_extraction` fields
- **Lines 230-233**: `ProjectDetailResponse.is_extracting`, `extraction_status` fields
- **Line 1092**: `RefreshClipsResponse.extraction_triggered` field

### Backend — `get_project` Endpoint (`projects.py:735-791`)
- Still JOINs `modal_tasks` to get `extraction_status` per clip
- Still sets `is_extracting` and `extraction_status` on response
- Should remove the JOIN and hardcode these to `False`/`None`

### Backend — Retry Endpoint (`clips.py:1116-1190`)
- `POST /projects/{project_id}/clips/{clip_id}/retry-extraction` — dead endpoint
- No frontend code calls it anymore (retry UI removed in T790)

### Backend — Clips Response Model (`clips.py:160,176-177`)
- `WorkingClipResponse.extraction_status` field — always `None` now

### Backend — Extraction Status Lookup (`clips.py:1050-1076`)
- `extraction_statuses = {}` dict is now always empty
- Three branches all set `extraction_status = None`
- Simplify to just not set it / remove from response

### Backend — Stale Comments (`clips.py`, `games.py`, `projects.py`)
- `clips.py:691-692` — "Standalone extraction was removed" note (can simplify)
- `clips.py:726-728` — "triggers extraction" in docstring
- `clips.py:750` — "don't touch filename - extraction is separate"
- `clips.py:784,808,817` — "extraction triggered when user opens project"
- `clips.py:842-844,849,880,916` — extraction references in save_raw_clip
- `clips.py:1008` — "triggers extraction" in list_project_clips docstring
- `clips.py:1111` — "T740: Extraction no longer triggered here"
- `games.py:875,922,928,1004` — "pending extraction" references
- `projects.py:368-372` — "Fetch extraction status" comments
- `projects.py:735` — "extraction status" in query comment
- `projects.py:1102,1226,1231` — extraction_triggered references

### Backend — WebSocket Infrastructure (`websocket.py`, `main.py`)
- `websocket.py:153-241` — `ExtractionConnectionManager` class, `websocket_extractions` handler, `broadcast_extraction_event` function
- `main.py:67` — import of `websocket_extractions`
- `main.py:136-140` — `/ws/extractions` WebSocket endpoint

### Backend — Modal Queue (`modal_queue.py`)
- `enqueue_clip_extraction()` (lines 50-89) — no callers in production code
- `_process_clip_extraction()` (lines 192-255) — only called by queue processor for `clip_extraction` task type
- `_process_single_task()` (lines 173-189) — only handles `clip_extraction`, can be simplified
- `_extract_clip_local()` (~lines 260-350) — local FFmpeg extraction, only used by `_process_clip_extraction`
- `has_active_extraction_task()` (~line 445) — no callers
- `get_extraction_status()` (lines 465-493) — no callers after T790
- `broadcast_extraction_event` import (line 38)
- Recovery constants and stale task checking may also be extraction-only
- **Note**: Keep `process_modal_queue()`, `run_queue_processor()` — they're called from startup and retry endpoint. After removing extraction task type, they'll just find no tasks.

### Frontend — ExtractionWebSocketManager (`ExtractionWebSocketManager.js`)
- Entire file (~270 lines) is dead — no extraction events are broadcast
- Connected from `ProjectsScreen.jsx` but events never fire

### Frontend — ProjectsScreen WS Listener (`ProjectsScreen.jsx:134-142`)
- Connects to extraction WebSocket on mount
- Listens for `extraction_complete` and `extraction_failed` events
- Refreshes project list on these events — but they never fire

### Frontend — Store Action (`projectDataStore.js:142-156`)
- `retryExtraction` action — calls dead `/retry-extraction` endpoint
- No UI calls it after T790 removed the retry button

### Frontend — Stale Skill Docs (`.claude/skills/`)
- `state-management/SKILL.md:303-313` — examples using `isExtracted`, `isExtracting`, `extraction_status`
- `type-safety/SKILL.md:67-68` — `EXTRACTING`, `PENDING_EXTRACTION` enum values

### Backend Tests
- `test_save_raw_clip.py:25-30,62-95` — `TestEnqueueClipExtraction` class testing dead function
- `test_extraction_recovery.py` (entire file, ~330 lines) — tests stale task recovery, retry, dedup for extraction

### E2E Tests (`regression-tests.spec.js`)
- `triggerExtractionAndWait()` function (lines 598-748) — ~150 lines of extraction orchestration
- Called from ~5 test cases (lines 934-936, 1231-1233, 1484-1486, 2256-2259)
- These tests will need to be updated to work without extraction (clips use game video range queries)

### Frontend — Stale Comment (`FramingScreen.jsx:3,121-122`)
- T740 removal comments that are now doubly stale

## Context

### Relevant Files
- `src/backend/app/routers/projects.py` — Response models, get_project endpoint
- `src/backend/app/routers/clips.py` — Response model, retry endpoint, stale comments
- `src/backend/app/routers/games.py` — Stale comments
- `src/backend/app/services/modal_queue.py` — Dead extraction functions
- `src/backend/app/websocket.py` — ExtractionConnectionManager
- `src/backend/app/main.py` — /ws/extractions endpoint
- `src/backend/tests/test_extraction_recovery.py` — Dead test file
- `src/backend/tests/test_save_raw_clip.py` — Dead test class
- `src/frontend/src/services/ExtractionWebSocketManager.js` — Dead WS manager
- `src/frontend/src/screens/ProjectsScreen.jsx` — WS listener
- `src/frontend/src/stores/projectDataStore.js` — retryExtraction action
- `src/frontend/src/screens/FramingScreen.jsx` — Stale comments
- `src/frontend/e2e/regression-tests.spec.js` — triggerExtractionAndWait
- `src/frontend/.claude/skills/state-management/SKILL.md` — Stale examples
- `src/frontend/.claude/skills/type-safety/SKILL.md` — Stale enum values

### Related Tasks
- T740: Merged extraction into framing export (the original change)
- T790: Removed extraction triggers (the bug fix that started this cleanup)

### Technical Notes
- The `modal_tasks` table should NOT be dropped — it may be used for future GPU task types
- The `process_modal_queue()` / `run_queue_processor()` functions should be kept as infrastructure (startup recovery, background processing) but the `clip_extraction` task type handler can be removed
- E2E tests that call `triggerExtractionAndWait()` will need alternative setup — clips now work without extraction via game video range queries, so these tests may just need to skip the extraction step entirely
- `ExtractionWebSocketManager` is NOT used for framing export progress (that uses `ExportWebSocketManager`) — safe to delete entirely

## Acceptance Criteria

- [ ] No response model fields reference extraction (is_extracting, extraction_status, clips_extracting, clips_pending_extraction)
- [ ] `/retry-extraction` endpoint removed
- [ ] `get_project` no longer JOINs modal_tasks
- [ ] ExtractionConnectionManager and /ws/extractions endpoint removed
- [ ] ExtractionWebSocketManager.js deleted
- [ ] ProjectsScreen no longer connects extraction WebSocket
- [ ] retryExtraction store action removed
- [ ] Dead functions in modal_queue.py removed (enqueue, process, get_status)
- [ ] Dead test file (test_extraction_recovery.py) removed
- [ ] Dead test class (TestEnqueueClipExtraction) removed
- [ ] E2E tests updated to work without extraction
- [ ] Stale comments cleaned up across clips.py, games.py, projects.py
- [ ] Backend import check passes
- [ ] Frontend build passes
- [ ] Skill docs updated
