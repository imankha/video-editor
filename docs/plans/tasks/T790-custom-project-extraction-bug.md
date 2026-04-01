# T790: Custom Project Triggers Extraction (Should Be Removed)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-31
**Updated:** 2026-03-31

## Problem

When creating a custom project via "New Project" (GameClipSelectorModal), the project enters an "Extracting (0/N)" state on the Projects screen. Extraction was removed in T740 — it was merged into the framing export pipeline. Custom projects should NOT trigger extraction since framing now handles clip segment extraction inline during export.

This is visible in the UI: all project cards show "Extracting (0/1)" with an orange progress bar. The "Spring 2026" custom project with 35 clips shows "Extracting (0/35)".

The bug likely occurs because the project creation endpoint or the working_clips insertion triggers the old extraction pipeline. Since custom projects pull clips from multiple games (potentially different videos), the extraction code path may still be active for multi-video scenarios even though T740 removed it for single-clip auto-projects.

### User Impact
- User sees "Extracting" status that never completes (or takes very long)
- Projects appear stuck in a state the user doesn't understand
- Blocks the quest flow (Quest 4: Frame Your Reel) because the project appears broken
- Wastes GPU/CPU resources running unnecessary extraction

### Screenshot
Projects screen showing multiple projects with "Extracting (0/1)" status and orange progress bars. Custom "Spring 2026" project shows "Extracting (0/35)".

### Backend Log Evidence
The backend is actively running clip extractions via ModalQueue. Each clip downloads the FULL game video from R2 to a temp file, then extracts the clip segment — for every clip in the project:

```
[ModalQueue] Processing clip extraction: task=14, clip=35
[LocalExtract] Downloading games/{hash}.mp4 from R2 to C:\...\tmp.mp4
[ModalQueue] Processing clip extraction: task=15, clip=36
[LocalExtract] Downloading games/{hash}.mp4 from R2 to C:\...\tmp.mp4
... (tasks 14-35, clips 2-36 — 22 extraction tasks queued)
```

Each task downloads the full ~3GB game video separately, creating massive temp file bloat and wasting bandwidth. For a 35-clip custom project this means downloading the game video 35 times.

### Frontend Log
ExtractionWSManager shows connection/reconnection events. `extraction_complete` events fire as clips finish extracting. Project cards show "Extracting (0/N)" with orange progress bars.

## Solution

Remove ALL remaining extraction code paths. T740 replaced extraction with:
1. **Range queries on the source video** — framing screen uses the full game video with clip offset/duration, no separate extraction needed
2. **Virtual streaming controls** — video player streams the source with range requests, seeking to the clip's start time
3. **Extraction merged into framing export** — when the user clicks "Frame Video", the backend extracts + frames + upscales in one pipeline

The old extraction pipeline (ModalQueue clip extraction tasks) should have been fully removed in T740 but wasn't — it still fires when working_clips are added to custom projects.

### Root Cause (Confirmed)

T740 removed extraction triggering from `list_project_clips()` (when user OPENS a project) but missed TWO other code paths that still trigger extraction:

| Code Path | File | Lines | What It Does |
|-----------|------|-------|-------------|
| **Multi-clip project creation (BUG)** | `projects.py` | 723-753 | `create_project_from_clips()` loops through clips, calls `enqueue_clip_extraction()` for each unextracted clip, then `run_queue_processor()` in background |
| **Single-clip manual add** | `clips.py` | 1328-1330 | `add_clip_to_project()` calls `trigger_clip_extraction()` for single clips added to existing projects |
| **Dead code** | `clips.py` | 613-633 | `_trigger_extraction_for_auto_project()` defined but never called |

The multi-clip path in `projects.py:723-753` is the primary bug. It builds a `clips_to_extract` list (clips with no filename, has game_id, has video_filename) and enqueues each one. The ModalQueue then downloads the full game video from R2 for EACH clip separately.

T740's comment at `clips.py:1147` says:
```python
# T740: Extraction no longer triggered here — framing export handles it directly
```

But the same removal was never applied to `projects.py:create_project_from_clips()`.

### Fix
1. **Remove lines 723-753 in projects.py** — delete the extraction loop from `create_project_from_clips()`
2. **Remove lines 1328-1330 in clips.py** — delete `trigger_clip_extraction()` call from `add_clip_to_project()`
3. **Remove `_trigger_extraction_for_auto_project()` dead code** in clips.py (lines 613-633)
4. **Consider removing `enqueue_clip_extraction()` and `_process_clip_extraction()`** from modal_queue.py if no other callers exist
5. **Verify** framing screen uses range queries for all clip types (auto + custom)
6. **Keep ExtractionWSManager** for now — it may be used for framing export progress

## Context

### Relevant Files
- `src/backend/app/routers/clips.py` — Working clip creation, may trigger extraction
- `src/backend/app/routers/projects.py` — Project creation endpoint
- `src/backend/app/services/modal_client.py` — Modal GPU task submission
- `src/frontend/src/components/ProjectManager.jsx` — Shows extraction status on project cards
- `src/frontend/src/services/ExportWebSocketManager.js` — ExtractionWSManager for real-time updates

### Related Tasks
- T740: Extraction merged into framing (the change that should have removed standalone extraction)
- T780: Quest redesign (discovered during Quest 4 testing)

### Technical Notes
- T740 merged extraction into framing export — no separate extraction step should exist
- Custom projects with clips from multiple games may hit a different code path than auto-created single-clip projects
- The extraction may be triggered by a background task that wasn't fully removed in T740
- Check `modal_tasks` table for any pending extraction tasks

## Acceptance Criteria

- [ ] Custom projects do NOT trigger extraction on creation
- [ ] Project cards show correct status (Not Started, not Extracting)
- [ ] Framing export still works correctly (extraction happens inline during export)
- [ ] Auto-created single-clip projects also don't trigger extraction
- [ ] Backend import check passes
- [ ] Frontend build passes
