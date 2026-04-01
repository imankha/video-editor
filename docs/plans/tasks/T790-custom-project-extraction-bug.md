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

### Root Cause
When working_clips are inserted into a project, the backend queues extraction tasks via ModalQueue. This code path was NOT removed by T740 — it was only bypassed for auto-created single-clip projects (which use the game video URL directly). Custom projects with multiple clips from different games still hit the old extraction pipeline.

### Fix
1. Remove extraction task creation from working_clip insertion
2. Remove/disable the ModalQueue clip extraction processor
3. Verify framing screen uses range queries for all clip types (auto + custom)
4. Clean up ExtractionWSManager references if no longer needed

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
