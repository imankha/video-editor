# T740 Design: Merge Clip Extraction into Framing Export

## 1. Current State

```mermaid
flowchart TD
    A[User creates project] --> B[enqueue_clip_extraction]
    B --> C[modal_queue processes task]
    C --> D[Download games/{hash}.mp4 from R2]
    D --> E[FFmpeg: extract clip segment -c copy]
    E --> F[Upload to {user}/raw_clips/{uuid}.mp4]
    F --> G[Set raw_clips.filename + WebSocket broadcast]
    G --> H[Frontend: ExtractionWebSocketManager receives event]
    H --> I[User waits in FramingScreen for extraction]
    I --> J[User edits crop/trim/speed]
    J --> K[export_framing_render]
    K --> L[Download {user}/raw_clips/{filename} from R2]
    L --> M[process_framing_ai: crop + upscale + encode]
    M --> N[Upload working_videos/{uuid}.mp4]
```

**Problems:**
- User waits for extraction before framing
- Two R2 round-trips (upload extracted clip, then re-download it)
- ExtractionWebSocketManager adds 268 lines of frontend complexity
- Extracted clips consume R2 storage redundantly

**Key code paths:**

| Step | File | Function/Line |
|------|------|---------------|
| Enqueue extraction | modal_queue.py:50 | `enqueue_clip_extraction()` |
| Process extraction | modal_queue.py:192 | `_process_clip_extraction()` |
| Modal extraction | video_processing.py:2599 | `extract_clip_modal()` |
| Auto-trigger | clips.py:612 | `_trigger_extraction_for_auto_project()` |
| Framing dispatch | framing.py:679 | `input_key = raw_clips/{filename}` |
| Framing Modal | video_processing.py:916 | `process_framing_ai()` |
| Framing local | local_processors.py | `local_framing()` |
| Frontend wait | FramingScreen.jsx | `extractionState.allExtracting` gate |
| Extraction WS | ExtractionWebSocketManager.js | Full lifecycle management |
| Quest check | quests.py:96 | `raw_clips.filename IS NOT NULL` |

## 2. Target Architecture

```mermaid
flowchart TD
    A[User creates project] --> B[Enter FramingScreen immediately]
    B --> C[Preview: game video URL + clip offset layer]
    C --> D[User edits crop/trim/speed]
    D --> E[export_framing_render]
    E --> F[Resolve: game_id → games/{hash}.mp4 + start/end times]
    F --> G[process_framing_ai: download game video, seek to range, crop + upscale + encode]
    G --> H[Upload working_videos/{uuid}.mp4]
```

**One interface, two input types.** The framing pipeline always receives `input_key` + `source_start_time` + `source_end_time`. Game clips resolve to `games/{hash}.mp4` with the clip's time range. Uploaded clips (rare, `game_id = NULL`) resolve to `raw_clips/{filename}` with start=0/end=full duration. No branching on whether a clip was previously *extracted* — the branch is on clip *source type*, which is a real distinction.

**Benefits:**
- Zero extraction wait for users
- One R2 round-trip (download game video → upload working video)
- Remove ExtractionWebSocketManager and extraction progress UI
- No extracted clip files on R2
- Single code path — no "if extracted use this, else use that"

## 3. Implementation Phases

Each phase is independently testable and deployable. Later phases depend on earlier ones.

---

### Phase 1: Backend — Framing export accepts game video + time range

**Goal:** The export pipeline can process a game video directly instead of requiring an extracted clip. This is pure backend — no frontend changes, no user-facing changes yet.

**Changes:**

**video_processing.py** — `process_framing_ai` gets `source_start_time`/`source_end_time`:

```python
def process_framing_ai(
    ...,
    source_start_time: float,  # Required
    source_end_time: float,    # Required
):
    # Game videos are global (no user prefix), uploaded clips are user-scoped
    if input_key.startswith("games/"):
        download_key = input_key  # global
    else:
        download_key = f"{user_id}/{input_key}"  # user-scoped

    # Combine extraction range with trim range
    clip_duration = source_end_time - source_start_time
    trim_start = segment_data.get('trim_start', 0) if segment_data else 0
    trim_end = segment_data.get('trim_end', clip_duration) if segment_data else clip_duration

    absolute_start = source_start_time + trim_start
    absolute_end = source_start_time + trim_end

    start_frame = int(absolute_start * original_fps)
    end_frame = int(absolute_end * original_fps)

    # Seek once, read sequentially (matches process_clips_ai pattern)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    for frame_idx in range(start_frame, end_frame):
        ret, frame = cap.read()
        # crop keyframe time is relative to clip start (0-based)
        # so offset by trim_start, not source_start_time
        crop_time = (frame_idx / original_fps) - source_start_time
        crop = _interpolate_crop(sorted_keyframes, crop_time)
```

Same changes to `process_framing_ai_parallel`, `local_framing`, `local_framing_mock`.

**modal_client.py** — Thread new required params:

```python
async def call_modal_framing_ai(
    ...,
    source_start_time: float,
    source_end_time: float,
) -> dict:
```

**framing.py** — Resolve source based on clip type:

```python
# SQL LEFT JOINs games table (NULL for uploaded clips):
# SELECT wc.*, rc.start_time as raw_start_time, rc.end_time as raw_end_time,
#        rc.game_id, rc.filename as raw_filename,
#        g.blake3_hash as game_blake3_hash
# FROM working_clips wc
# JOIN raw_clips rc ON wc.raw_clip_id = rc.id
# LEFT JOIN games g ON rc.game_id = g.id
# WHERE wc.project_id = ? ...

if clip['game_id']:
    # Game clip: use source game video + time range
    input_key = f"games/{clip['game_blake3_hash']}.mp4"
    source_start_time = clip['raw_start_time']
    source_end_time = clip['raw_end_time']
else:
    # Uploaded clip: use the raw file directly, full duration
    input_key = f"raw_clips/{clip['raw_filename']}"
    source_start_time = 0.0
    source_end_time = clip['raw_duration']
```

**Pipeline optimizations (applied here since we're touching the frame loop):**

- **Combined trim range**: extraction range + user trim = fewer frames to read and upscale
- **Sequential read**: `cap.set()` once to `start_frame`, then `cap.read()` in loop (no per-frame seek)
- **Pre-sort keyframes**: `_interpolate_crop` accepts pre-sorted list, skips internal sort

**Progress bar retuning:**

```
Current:                          New:
 5%     initializing               2%     initializing
 8-12%  downloading clip           3-10%  downloading game video (larger)
14-18%  loading AI model          10-12%  seeking to clip range
18-75%  upscaling frames          12-16%  loading AI model
76-88%  encoding video            16-75%  upscaling frames
90-100% uploading                 76-88%  encoding video
                                  90-100% uploading
```

**Requires Modal redeploy** after changes (see Section 5). Function signatures change — old callers will break.

**Test:** Run framing export with game video key + time range. Compare output to current extract-then-frame pipeline. Output should be identical (same frames, same crop, same quality).

---

### Phase 2: Frontend — Clip offset layer in useVideo

**Goal:** The video player can load a long video file and present a subset of it as if it were the full video. All downstream components (crop, segments, timeline) continue working with 0-based clip time — they don't know the video file is longer.

**The core problem:** `useVideo.js` has 4 places that read/write `videoRef.current.currentTime` and 6 places that read `video.duration`. These are the only points where the raw video element's absolute time enters the system. Everything downstream works with `currentTime` from videoStore and mapping functions.

**The solution:** An offset layer in useVideo that translates between two coordinate spaces:

```
clip time (0-based, what the rest of the app sees)
    ↕  offset layer in useVideo
video time (absolute, what the <video> element uses)
```

```javascript
// New state in useVideo or videoStore:
clipOffset: 0,        // source_start_time (e.g., 120.0)
clipDuration: null,    // source_end_time - source_start_time (e.g., 30.0)

// Translation (only in useVideo.js):
const videoToClip = (videoTime) => videoTime - clipOffset;
const clipToVideo = (clipTime) => clipTime + clipOffset;
```

**Exact changes in useVideo.js (4 writes/reads + duration):**

```javascript
// Line 246 — seek() WRITE:
// Current:  videoRef.current.currentTime = validTime;
// New:      videoRef.current.currentTime = clipToVideo(validTime);

// Line 328 — handleTimeUpdate() READ:
// Current:  setCurrentTime(videoRef.current.currentTime);
// New:      setCurrentTime(videoToClip(videoRef.current.currentTime));

// Line 387 — RAF update loop READ:
// Current:  const newTime = videoRef.current.currentTime;
// New:      const newTime = videoToClip(videoRef.current.currentTime);

// Line 410 — handleSeeked() READ:
// Current:  setCurrentTime(videoRef.current.currentTime);
// New:      setCurrentTime(videoToClip(videoRef.current.currentTime));

// Line 417 — handleLoadedMetadata():
// Current:  setDuration(video.duration);
// New:      setDuration(clipDuration ?? video.duration);
//           if (clipOffset > 0) videoRef.current.currentTime = clipOffset;

// Line 297 — restart():
// Current:  seek(0);
// New:      seek(0);  // unchanged — seek() handles offset internally
```

**Playback clamping:** When `currentTime` (in video time) exceeds `clipOffset + clipDuration`, pause and clamp:

```javascript
// In handleTimeUpdate or RAF loop:
const videoTime = videoRef.current.currentTime;
if (clipDuration && videoTime >= clipOffset + clipDuration) {
    videoRef.current.pause();
    videoRef.current.currentTime = clipOffset + clipDuration;
    setCurrentTime(clipDuration);
}
```

**What does NOT change (verified by audit):**
- `CropLayer.jsx` — uses `currentTime` from store (now 0-based clip time) ✅
- `SegmentLayer.jsx` — maps through `sourceTimeToVisualTime()` ✅
- `useCrop.js` — keyframes are frame-based relative to clip start ✅
- `useSegments.js` — boundaries are in source time (0-based) ✅
- `TimelineBase.jsx` — uses mapping functions, not raw video time ✅
- `FramingTimeline.jsx` — pure pass-through ✅
- `FramingMode.jsx` — pure container ✅

**Test:** Load a video file, set `clipOffset=120, clipDuration=30`. Verify:
- Duration shows 30s, not the file's full duration
- Timeline scrubber covers 0-30s range
- Seeking to t=0 shows the frame at 120s in the file
- Seeking to t=30 shows the frame at 150s
- Playback pauses at t=30 (doesn't continue past clip end)
- Crop keyframes placed at t=5 appear at the correct frame
- Trim range 5-25s works correctly

This can be tested with an existing extracted clip by artificially setting offset > 0.

---

### Phase 3: Frontend — Wire up game video in framing mode

**Goal:** Framing mode loads the game video URL with clip offset instead of waiting for extraction. Users can open framing immediately after annotating.

**Changes:**

**useProjectLoader.js** — Provide game video URL + clip range instead of extracted clip URL:

```javascript
// For each clip in the project:
// Current: uses clip.file_url (presigned URL to extracted clip on R2)
// New: uses game video presigned URL + start/end times

const clipConfig = {
    videoUrl: clip.game_video_url,     // presigned URL for games/{hash}.mp4
    clipOffset: clip.start_time,        // e.g., 120.0
    clipDuration: clip.end_time - clip.start_time,  // e.g., 30.0
    // ... rest of clip metadata
};
```

**Backend API** — Return game video presigned URL in clip data:

```python
# In the clips/project endpoint that returns clip data for framing:
clip['game_video_url'] = generate_presigned_url(
    None,  # global, no user prefix
    f"games/{game_blake3_hash}.mp4"
)
clip['start_time'] = raw_clip['start_time']
clip['end_time'] = raw_clip['end_time']
```

**FramingScreen.jsx** — Remove extraction gate:

- Remove `ExtractionWebSocketManager` import and lifecycle
- Remove extraction spinner / waiting overlay
- Remove `extractionState` computation
- Load video with `clipOffset` and `clipDuration` from project loader
- Pass offset to useVideo via new `loadVideoFromStreamingUrl(url, { clipOffset, clipDuration })`

**Test:** Full flow — annotate a clip, open framing, verify:
- No extraction wait (framing opens immediately)
- Video preview shows the correct 30s segment
- Crop keyframes work normally
- Trim/speed segments work normally
- Export produces correct output (Phase 1 backend handles it)

---

### Phase 4: Remove extraction pipeline, quest update, deploy + reset

**Goal:** Clean up dead code, deploy, nuke accounts.

**Backend removals:**

- `clips.py`: Remove `_trigger_extraction_for_auto_project()` calls, `retry_extraction` endpoint
- `modal_queue.py`: `enqueue_clip_extraction()` and `_process_clip_extraction()` — remove
- `video_processing.py`: `extract_clip_modal()` — remove

**Frontend removals:**

- `ExtractionWebSocketManager.js` — delete file
- `clipSelectors.js` — remove `isExtracted`, `isExtracting`, `isFailed`, `isRetrying`
- Any extraction progress indicators in project cards

**Quest system:**

```python
# quests.py — extract_clip step:
# From: raw_clips.filename IS NOT NULL
# To: auto-complete when open_framing is achieved
steps["extract_clip"] = steps.get("open_framing", False)
```

```javascript
// questDefinitions.js — update step text:
{ id: 'extract_clip', title: 'Open Project in Framing', description: 'Your clip is ready to frame!' }
```

**Deploy + reset sequence:**

```bash
# 1. Deploy Modal functions (new signatures, extract_clip_modal removed)
cd src/backend && PYTHONUTF8=1 .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py

# 2. Restart backend

# 3. Nuke all accounts (clears extracted clips, pending tasks, stale state)
cd src/backend && .venv/Scripts/python.exe scripts/reset_all_accounts.py
```

**Test:** Full regression — all quest steps complete, no broken/stuck steps, no console errors from missing extraction code. Fresh account flow works end to end.

---

## 4. Frontend Offset Layer — Detailed Audit

### Why it's safe (verified)

The entire framing UI works with "source time" from videoStore. Only `useVideo.js` touches the raw `<video>` element. The audit found:

| Location | What it accesses | Coordinate space | Needs change? |
|----------|-----------------|------------------|---------------|
| useVideo.js:246 | `videoRef.currentTime =` (WRITE) | Raw video time | **YES** — add offset |
| useVideo.js:328 | `videoRef.currentTime` (READ) | Raw video time | **YES** — subtract offset |
| useVideo.js:387 | `videoRef.currentTime` (READ) | Raw video time | **YES** — subtract offset |
| useVideo.js:410 | `videoRef.currentTime` (READ) | Raw video time | **YES** — subtract offset |
| useVideo.js:417 | `video.duration` (READ) | Raw video duration | **YES** — override with clipDuration |
| CropLayer.jsx:107 | `currentTime` from store | 0-based clip time | No |
| CropLayer.jsx:46 | `frameToTime(frame, framerate)` | 0-based clip time | No |
| SegmentLayer.jsx:90 | `sourceTimeToVisualTime(currentTime)` | 0-based clip time | No |
| useCrop.js:74 | `duration` from videoMetadata | Clip duration | No (if we set it correctly) |
| useSegments.js:79 | `initializeWithDuration()` | Clip duration | No (if we set it correctly) |
| TimelineBase.jsx:219 | `sourceTimeToVisualTime(currentTime)` | 0-based clip time | No |

**6 changes in useVideo.js. Zero changes in all other components.**

### Existing precedent

`useVirtualTimeline.js` (annotate mode) already maps between virtual time and actual video time bidirectionally. Our offset layer is simpler — it's just a constant offset, not a segment-based mapping.

### Uploaded clips

Uploaded clips get `clipOffset = 0`, `clipDuration = video.duration` → the offset layer is a no-op. No special handling needed.

## 5. Modal Deployment

Changing `process_framing_ai`, `process_framing_ai_parallel`, `process_clips_ai` signatures requires redeploying Modal functions. `extract_clip_modal` is being removed.

**All 4 functions live in one file:** `src/backend/app/modal_functions/video_processing.py`, registered under `modal.App("reel-ballers-video-v2")`.

**Functions and their images:**

| Function | Decorator | Image | GPU |
|----------|-----------|-------|-----|
| `extract_clip_modal` | `@app.function(image=image, timeout=300)` | Base (FFmpeg only) | None |
| `process_framing_ai` | `@app.function(image=upscale_image, gpu="T4", timeout=1800)` | Real-ESRGAN | T4 |
| `process_framing_ai_parallel` | `@app.function(image=upscale_image, gpu="T4", timeout=3600)` | Real-ESRGAN | T4 |
| `process_clips_ai` | `@app.function(image=upscale_image, gpu="T4", timeout=3600)` | Real-ESRGAN | T4 |

**Deploy command (required after Phase 1):**
```bash
cd src/backend && PYTHONUTF8=1 .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py
```

**Deploy is a breaking change** — the new function signatures are incompatible with old callers. Deploy + backend restart must happen together. Run `scripts/reset_all_accounts.py` after deploy to clear any stale extraction state.

**Phase 1 deploy sequence:**
1. Implement changes to video_processing.py + modal_client.py + framing.py
2. `modal deploy` (updates all functions atomically)
3. Restart backend
4. `scripts/reset_all_accounts.py` (nuke accounts — clears stale extracted clips, pending extraction tasks, etc.)

## 6. Performance: Why Merged Is Faster

### Current two-step pipeline (per clip)

| Step | What | Wall clock |
|------|------|-----------|
| 1. Extraction cold start | `extract_clip_modal` uses base image (no GPU) | 5-15s |
| 2. Download game video | R2 → Modal (same cloud) | 10-120s |
| 3. FFmpeg codec-copy extract | `-ss {start} -t {dur} -c copy` | 1-3s |
| 4. Upload extracted clip | Modal → R2 | 5-30s |
| 5. *User waits for extraction WebSocket* | *Frontend polls/listens* | *0-5s* |
| 6. Framing cold start | `process_framing_ai` uses upscale_image (GPU, torch, Real-ESRGAN) | 15-45s |
| 7. Download extracted clip | R2 → Modal | 5-10s |
| 8. Real-ESRGAN upscale | 681ms/frame × 900 frames (30s @ 30fps) | ~10 min |
| 9. FFmpeg encode | Two-pass or single-pass | 30-60s |
| 10. Upload working video | Modal → R2 | 30-60s |
| **Total** | | **~12-16 min** |

### Merged pipeline (per clip)

| Step | What | Wall clock |
|------|------|-----------|
| 1. Framing cold start | Same upscale_image container | 15-45s |
| 2. Download game video | R2 → Modal (same cloud, same size) | 10-120s |
| 3. Seek to clip range | `cap.set(CAP_PROP_POS_FRAMES, start_frame)` | <1s |
| 4. Real-ESRGAN upscale | Same 681ms/frame, but **fewer frames if trim applied** | ~10 min (or less) |
| 5. FFmpeg encode | Same | 30-60s |
| 6. Upload working video | Modal → R2 | 30-60s |
| **Total** | | **~11-14 min** |

### What's eliminated

| Eliminated step | Savings | Why |
|----------------|---------|-----|
| Extraction cold start (5-15s) | **5-15s** | No separate extraction container needed |
| R2 upload of extracted clip (5-30s) | **5-30s** | No intermediate file on R2 |
| R2 download of extracted clip (5-10s) | **5-10s** | Framing reads game video directly |
| Extraction FFmpeg pass (1-3s) | **1-3s** | Seeking replaces extraction |
| **Total per clip** | **16-58s** | |
| **10-clip project** | **3-10 min** | Compounds across clips |

### What's additionally faster (optimizations in Phase 1)

| Optimization | Savings per clip |
|-------------|-----------------|
| **Combined trim range**: clip 120-150s + trim 5-25s → read only 125-145s instead of 120-150s | Fewer frames × 681ms/frame. 10s trimmed = ~300 frames = **~3.5 min saved** |
| **Sequential read**: seek once then `cap.read()` vs. per-frame `cap.set()` | ~1-2ms/frame × 900 frames = **~1-2s** |
| **Pre-sorted keyframes**: skip sort in `_interpolate_crop` | ~0.1ms/frame × 900 = **~0.1s** (minor) |

The **combined trim range** is the big win unique to the merged pipeline. Currently extraction always extracts the full clip range, then framing trims. Merged: we only read+upscale the trimmed range. For a 30s clip trimmed to 20s, that's 300 fewer frames × 681ms = **~3.5 minutes saved**.

### Multi-clip bonus

For projects with multiple clips from the same game video:
- Current: download game video N times (once per extraction)
- Merged: download game video **once**, seek to each clip's range
- Savings: (N-1) × game video download time

## 7. Design Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Source resolution | Always game video vs. branch on game_id | Branch on `game_id` | Uploaded clips (game_id=NULL) are a genuinely different input type — they have no source game video. This isn't backward-compat branching; it's two real clip sources. |
| `source_start_time`/`source_end_time` | Optional params vs. required | Required for game clips, 0/full-duration for uploaded clips | Uploaded clips pass start=0, end=video_duration. Framing function always receives a range. |
| Frontend video subset | Load game video raw / extract preview clip / offset layer | Offset layer in useVideo | 6 lines changed, all downstream components unaffected. Game video loaded with Range requests — browser only downloads needed chunks. |
| Offset implementation | New hook vs. in useVideo vs. wrapper component | In useVideo directly | Offset is a translation at the video element boundary. useVideo is that boundary. No new abstractions needed. |
| Game video download | Global key (no user prefix) | `games/{hash}.mp4` directly | Matches existing `extract_clip_modal` pattern for global game keys |
| Extraction code | Keep dormant vs. remove | Remove — dead code (Phase 4, after stabilization) | No dual paths. Clean removal. But deferred until Phase 3 is stable. |
| Quest step | New step vs. alias | Auto-complete `extract_clip` = `open_framing` | Minimal quest system changes |
| Trim combination | Keep relative trim vs. combine with extraction range | Combine into absolute range in backend | Fewer frames read + upscaled. Direct perf win. |
| Frame iteration | Per-frame seek vs. sequential read | Sequential read (seek once) | Matches `process_clips_ai` pattern. Eliminates per-frame codec seek overhead. |
| Keyframe sort | Sort per-call vs. pre-sort once | Pre-sort once, pass to `_interpolate_crop` | Eliminates O(n log n) per frame. |

## 6. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Game video download larger than extracted clip | Medium | Same-cloud R2-to-Modal transfer is fast. Browser uses HTTP Range requests — only downloads chunks near the clip's time range, not the full file. |
| Clip offset leaks — raw video.currentTime used somewhere without offset | High | Audit found only 4 access points, all in useVideo.js. Phase 2 test verifies no leakage by setting artificial offset on existing clip. |
| Multi-video games need correct blake3_hash | Medium | Join through game_videos table using video_sequence field |
| Browser seeking to offset on load | Low | Set `videoRef.currentTime = clipOffset` in handleLoadedMetadata. Some browsers may briefly show frame 0 before seeking — mitigate with loading overlay until first seeked event. |
| `process_framing_ai_parallel` also needs changes | Medium | Same required params; chunk boundaries offset by `start_frame` in game video |
| Uploaded clips (no game_id) | Low | Uploaded clips branch on `game_id`: use `raw_clips/{filename}` with start=0, end=full duration. Not a backward-compat hack — genuinely different input type. |

## 7. Resolved Questions

### Uploaded clips (game_id = NULL)

**Researched.** Uploaded clips always have `game_id = NULL` (set explicitly in clips.py:1491). They use `raw_clips.filename` — there is no separate `uploaded_filename` column in raw_clips (the `uploads/` branch in framing.py:682 is dead code).

**Impact on T740:** The "always use game video" approach breaks uploaded clips. Fix: branch on `game_id` in framing.py:

```python
if clip['game_id']:
    # Game clip: use source game video + time range
    input_key = f"games/{clip['game_blake3_hash']}.mp4"
    source_start_time = clip['raw_start_time']
    source_end_time = clip['raw_end_time']
else:
    # Uploaded clip: use the uploaded file directly, full duration
    input_key = f"raw_clips/{clip['raw_filename']}"
    source_start_time = 0.0
    source_end_time = clip['raw_duration']  # full video
```

This is **not** backward-compat branching — it's two genuinely different input types (game source vs. direct upload). The framing function always receives `source_start_time`/`source_end_time` regardless.

For the frontend offset layer: uploaded clips get `clipOffset = 0`, `clipDuration = video.duration` → offset layer is a no-op.

**No backward compatibility.** Run `scripts/reset_all_accounts.py` after deploy. All existing extracted clips, pending extractions, and stale state get wiped.

### process_clips_ai (multi-clip function)

**Confirmed: update in this task.** Same pattern — pass `source_start_time`/`source_end_time` per clip in `clips_data`.

### R2 Range request efficiency

**Researched. Already proven in production — no concerns.**

- R2 fully supports HTTP Range requests on presigned URLs. The codebase already uses them:
  - `loadVideoFromStreamingUrl()` (useVideo.js:159) sets `<video src>` directly — browser streams via Range requests
  - Cache warming (cacheWarming.js:117) explicitly sends `Range: bytes=0-1023` headers and gets HTTP 206 back
- **Annotate mode already loads full game videos** this way via presigned streaming URLs (AnnotateContainer.jsx:306). This is production-proven.
- **Moov atom handling:** For non-faststart MP4s, cache warming pre-fetches both head (first 1KB) and tail (last 5MB) of videos >100MB, ensuring the moov atom is cached at the CDN edge (cacheWarming.js:137).
- **Presigned URL expiration:** Game videos get 4-hour expiration (storage.py), which is plenty for a framing session.
- **Bandwidth:** Browser with `#t=120,150` will download moov atom + data chunks around the clip range. For a 30s clip in a 30-minute game, this is ~8-15MB, not the full video.
