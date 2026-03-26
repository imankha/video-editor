# T740: Merge Clip Extraction into Framing Export

**Status:** TESTING
**Impact:** 8
**Complexity:** 7
**Created:** 2026-03-26
**Updated:** 2026-03-26

## Problem

The current pipeline has two separate GPU steps:

1. **Extraction** — FFmpeg extracts a clip from the source game video (by start/end time), uploads to R2 as a standalone clip file
2. **Framing** — Modal/local processes the extracted clip file (crop, upscale, speed changes)

This means:
- Users wait for extraction to complete before they can even start framing
- Two separate GPU/FFmpeg jobs for what could be one
- Extracted clip files consume R2 storage (duplicating data already in the game video)
- Extraction has its own WebSocket progress, recovery logic, and failure modes — all infrastructure that could be eliminated

## Solution

Move the extraction work into the framing export step. The framing pipeline receives the **source game video** + **start/end times** instead of a pre-extracted clip file. It extracts the segment and processes it (crop, upscale, speed) in a single pass.

### What Changes

**From the user's perspective: nothing.** They still annotate clips, open framing, set crop keyframes, and export. The difference is:
- No extraction wait step between annotating and framing
- The "Extract Clip" quest step and progress UI become part of "Frame Video"
- Framing export takes slightly longer (it now does extraction + processing) but eliminates the separate extraction wait

### What Stays the Same

- All framing UI: crop keyframes, speed segments, trim, aspect ratio
- Overlay mode: still processes the framed working video (unchanged)
- Multi-clip projects: each clip references a source video + time range instead of an extracted file
- Gallery/downloads: unchanged

### Multi-Clip Support

For multi-clip projects, each clip has:
- `game_id` → source game video URL(s)
- `start_time`, `end_time` → segment within the source video
- `video_sequence` → which video file (for T82 multi-video games)

The framing export processes each clip by:
1. Downloading the source game video (or using cached copy if multiple clips reference same game)
2. Extracting the segment (start_time → end_time)
3. Applying crop keyframes, speed changes, upscaling
4. Outputting the framed clip

For projects with multiple clips from the same game video, the source only needs to be downloaded once.

## Technical Approach

### Backend Changes

**Framing export pipeline** (`modal_client.py` → `video_processing.py`):
- Currently receives: extracted clip R2 key → processes it
- New: receives source game video R2 key + start_time + end_time → extracts segment + processes it
- Single FFmpeg command can extract + apply speed + crop in one pass (avoid intermediate file)

**Clip data model changes:**
- `working_clips` currently requires `filename` (extracted clip file) before framing can start
- New: framing can start with just `raw_clip_id` which has `game_id` + `start_time` + `end_time`
- The `filename` field gets populated after framing (the output), not before

**Extraction code reuse:**
- The FFmpeg extraction logic from the current extraction pipeline moves into the framing pipeline
- Extraction as a standalone step is removed
- The extraction WebSocket progress, recovery logic (`ExtractionWebSocketManager`), and UI can be cleaned up

### Frontend Changes

**FramingScreen / useProjectLoader:**
- Currently waits for `clip.filename` to be set (extraction complete) before enabling framing
- New: can enter framing immediately with raw clip data (game video URL + times)
- Video preview in framing mode: load source game video, seek to clip's start_time (similar to annotate mode)

**Extraction UI removal:**
- Remove "Extract Clip" progress indicator and waiting state
- Remove `ExtractionWebSocketManager` and related WebSocket handling
- The "Frame Video" button handles everything

**Quest system:**
- Quest 2 step "Extract Clip" either gets merged into "Frame Video" or removed
- The step completion check changes from "has extracted filename" to part of framing completion

### Optimization: Single-Pass FFmpeg

Instead of: extract → save intermediate → load → crop → upscale → save
Do: source video → seek to start → extract+crop+speed in one FFmpeg command → upscale → save

This eliminates the intermediate file and reduces I/O.

## Context

### Relevant Files (REQUIRED)

**Backend — will change:**
- `src/backend/app/services/modal_client.py` — `call_modal_framing_ai()` needs source video + time range params
- `src/backend/app/modal_functions/video_processing.py` — Modal framing function needs extraction logic
- `src/backend/app/services/local_processors.py` — Local fallback for framing
- `src/backend/app/services/export_worker.py` — Export job processing (framing type)
- `src/backend/app/routers/clips.py` — Clip extraction endpoints (to be removed/simplified)

**Backend — extraction code to absorb into framing:**
- `src/backend/app/services/extraction_service.py` — FFmpeg extraction logic
- `src/backend/app/modal_functions/video_processing.py` — `extract_clip_modal()` function

**Frontend — will change:**
- `src/frontend/src/hooks/useProjectLoader.js` — Remove extraction wait, load from source video
- `src/frontend/src/screens/FramingScreen.jsx` — Handle unextracted clips
- `src/frontend/src/containers/FramingContainer.jsx` — Video source from game URL + times
- `src/frontend/src/services/ExtractionWebSocketManager.js` — Remove or repurpose

**Frontend — extraction UI to remove:**
- Extraction progress indicators in project cards
- "Extract Clip" waiting state in framing
- ExtractionWebSocketManager WebSocket handling

**Quest system:**
- `src/frontend/src/config/questDefinitions.js` — Update/remove "Extract Clip" step
- `src/backend/app/routers/quests.py` — Update step completion check

### Related Tasks
- Depends on: None
- Related: T710 (Play Annotations — also simplified the annotate→export pipeline)
- Related: T730 (Detection points — detection still runs during framing, just with source video)

## Implementation

### Steps
1. [ ] Modify framing export to accept source video + time range (backend)
2. [ ] Implement single-pass FFmpeg extract+crop+speed in Modal function
3. [ ] Update local fallback processor with same logic
4. [ ] Update frontend to enter framing without waiting for extraction
5. [ ] Load source game video in framing preview (seek to clip start)
6. [ ] Handle multi-clip projects (multiple source videos)
7. [ ] Remove extraction WebSocket and progress UI
8. [ ] Update quest step ("Extract Clip" → merged into framing)
9. [ ] Clean up unused extraction code
10. [ ] Test with single-clip, multi-clip, and multi-video-game projects

## Acceptance Criteria

- [ ] User can go from annotate → framing without any extraction wait
- [ ] Framing export produces identical output to current extract+frame pipeline
- [ ] Multi-clip projects work (multiple clips from same/different games)
- [ ] Multi-video games work (T82 per-half videos)
- [ ] No extracted clip files created on R2 (source video used directly)
- [ ] Framing preview shows correct video segment
- [ ] Quest system updated — no broken/stuck steps
- [ ] ExtractionWebSocketManager removed or repurposed
- [ ] Single-pass FFmpeg where possible (no intermediate extracted file)
