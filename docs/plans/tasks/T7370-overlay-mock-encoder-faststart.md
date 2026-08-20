# T7370: Overlay stuck loading a working video rendered by the CPU mock encoder

**Status:** STAGING (fixed same-session, ready to merge)
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-20
**Updated:** 2026-08-20

## Problem

Live-testing T4330 on a Modal-disabled dev container surfaced two real bugs, found while
transitioning from Framing export into Overlay:

1. **OverlayScreen could never load the rendered working video.** Console:
   `[videoMetadata] FAIL: moov atom at EOF and tail-range parse failed — producer should
   emit +faststart.` — both load attempts failed, matching the message's own diagnosis:
   the export output's `moov` atom was at the end of the file (not faststart), and the
   frontend's tail-range parse fallback also failed on it.
2. **The Overlay "Reset to spotlight" pill rendered on top of the stuck loading spinner**,
   confusing since nothing had loaded yet. Root cause: `isPastSpotlight` compared
   `currentTime` against the spotlight span with no check that a video had actually
   loaded — a `currentTime` carried over from Framing (or any stale/default value) could
   exceed a short spotlight span before Overlay's own video ever loaded.

Root cause of (1): every real encoder in this codebase writes `-movflags +faststart`
(`video_processing.py`, `ai_upscaler/video_encoder.py`, `multi_clip.py`, the `transitions/`
modules, `ffmpeg_concat.py`, `auto_export.py`, `download_metadata.py`) — except
`app/services/local_processors.py`'s two CPU/no-GPU fallback encoders
(`MockVideoUpscaler.process_video_with_upscale` and `local_framing_mock`), which this
project deliberately uses instead of the real GPU upscaler when `not modal_enabled()` and
no CUDA is available (T4120 D1(b)/(c) — "lets a /dotask worker verify the pipeline
locally"). Production always has Modal enabled and never reaches this code path, so this
was invisible there; it breaks Overlay for anyone testing a render in a local/CI/container
environment without a GPU — exactly the situation every `/dotask` worker and this session's
manual container testing run in.

## Solution

1. `local_processors.py`: add `movflags='+faststart'` to both mock encoders' ffmpeg output
   args, matching the flag already used everywhere else in the export pipeline.
2. `OverlayContainer.jsx`: gate `isPastSpotlight` on `duration > 0` (the codebase's
   standard "video metadata has loaded" signal) in addition to the existing
   `currentTime > spotlightSpan.end` check.

## Context

### Relevant Files
- `src/backend/app/services/local_processors.py` — `MockVideoUpscaler.process_video_with_upscale`
  (~L110-123) and `local_framing_mock` (~L883-895), the two CPU-fallback ffmpeg encoders
- `src/frontend/src/containers/OverlayContainer.jsx` — `isPastSpotlight` (~L170)
- `src/frontend/src/screens/OverlayScreen.jsx` — the working-video load/retry logic that
  surfaced the failure (`MAX_WORKING_VIDEO_ATTEMPTS`, ~L212, ~L434-511); unchanged by this
  fix, its retry/error state was correct — the video simply could never load

### Related Tasks
- T4120 introduced the CPU mock-encoder fallback this bug lives in
- Distinct from the deferred T7140 faststart-remux epic, which is about remuxing the
  RAW UPLOADED game video (expensive, deferred due to upload-time cost); this fix is on the
  EXPORT/RENDER output encoder, which is already writing the file via ffmpeg — adding the
  flag there is ~zero additional cost, not a remux

## Implementation

### Steps
1. [x] Add `movflags='+faststart'` to `MockVideoUpscaler.process_video_with_upscale`'s
       `out_args`
2. [x] Add `movflags='+faststart'` to `local_framing_mock`'s `ffmpeg_lib.output(...)` call
3. [x] Gate `isPastSpotlight` on `duration > 0` in `OverlayContainer.jsx`
4. [x] Regression test: synthetic ffmpeg source through `MockVideoUpscaler`, assert
       `moov` precedes `mdat` in the output bytes (mirrors `test_t6360_download_metadata.py`'s
       existing faststart assertion pattern)
5. [ ] Relevant test set green; backend import check clean
6. [ ] Live re-verify: Framing export -> Overlay loads the working video without error,
       Reset pill does not appear before the video has loaded

### Progress Log

**2026-08-20**: Found live while manually testing T4330 in a Modal-disabled dev container.
Root-caused via backend log (`[videoMetadata] FAIL: moov atom at EOF`) and static trace
(grep confirmed `local_processors.py` is the only encoder module in the codebase missing
`-movflags +faststart`). Fixed both mock encoders + the unrelated-but-co-discovered
Reset-pill gating bug in the same pass since both blocked the same manual test session.

## Acceptance Criteria

- [ ] A CPU-container (no GPU, Modal disabled) render's working video loads in Overlay
      without a moov-parse failure
- [ ] The "Reset to spotlight" pill never renders before the Overlay video has loaded
      (`duration > 0`)
- [ ] Existing `MockVideoUpscaler`/`local_framing_mock` tests (rotation warnings, T4050
      reframe pipeline) stay green
- [ ] New regression test proves faststart output byte-for-byte (moov before mdat)
