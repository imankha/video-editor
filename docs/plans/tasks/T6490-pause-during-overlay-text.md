# T6490: "Pause during text" — hold a frame while a text block is on screen

**Status:** TODO — **DEFERRED, revisit after the Player Intro epic ships**
**Impact:** 7 | **Complexity:** 6
**Follows:** [T5225](player-intro/T5225-overlay-text-layer.md) (overlay text layer, merged 2e3b532e)

> **Not part of the Player Intro epic.** Filed from the same staging session, but it is an Overlay
> feature with its own risk profile and should not compete with the intro-card track. Do it later.

## Problem

User request, 2026-08-04, after driving the overlay text layer on staging:

> We need a "pause during text" option which would pause at the current frame (extends that frame
> through the text region).

A text block currently draws over moving footage, so a callout the viewer is meant to *read* is gone
before it lands. The ask is to hold the underlying frame for the block's duration.

## Design decided 2026-08-04 (do not re-litigate)

Three placements were compared on GPU cost and intuitiveness. **Decision: the control stays in
Overlay on the text block, and the hold is applied as a render-time expansion driven by an explicit
time-remap. Nothing is materialised.**

### Why not "freeze during Framing"

Framing is the only pipeline step that runs a neural net per frame — Real-ESRGAN on a T4, measured
**1.47 fps**, 10s clip ≈ **$0.03** (`.claude/knowledge/modal-gpu.md`, verified 2026-07-03). Frames
duplicated BEFORE the upscaler are upscaled individually:

| Pause | Frames @30fps | If duplicated before upscale | If duplicated after |
|---|---|---|---|
| 1s | 30 | +20.4s GPU, $0.0030 | +0.7s, $0.0001 |
| 3s | 90 | +61.2s GPU, $0.0090 | +0.7s, $0.0001 |
| 5s | 150 | **+102s GPU**, $0.0150 | +0.7s, $0.0001 |

The dollars are trivial; a minute and a half of added export wall-clock is not, and it buys nothing —
every one of those frames is the same picture. A Framing-side hold also makes every pause tweak cost
a full re-upscale of the clip.

### Why not "insert the pause into the framed video and write it back"

Considered and REJECTED. Writing the paused result as a new `working_videos` version is
**data-destructive**: `cleanup_database_bloat` (`project_archive.py`) does
`DELETE FROM working_videos` keeping only the LATEST version per project. The un-paused original is
then pruned, so:

- shortening or removing the pause cannot regenerate from the original — it is gone;
- re-exporting inserts a pause into a video that already has one — **pauses compound**.

This is the T4020 shadow-version failure one table over (`working_clips` there, `working_videos`
here). It is also the slowest option: a full transcode plus an R2 round-trip on top of the two
encode passes the frames already get.

### The chosen shape

1. The pause is a boolean on the existing text-block entry — **metadata, always reversible, never
   baked into a stored video.**
2. Build an explicit **piecewise time-remap** ONCE per render:
   `t < pause_start → t` ; `t >= pause_start → t + pause_duration` (composed across multiple pauses).
3. Apply that remap to **all** overlay data before rendering — text ranges, highlight keyframes,
   poster marker, clip boundaries.
4. The render loop walks the OUTPUT timeline pulling source frames, repeating the held frame.

This is the cheapest option (N extra frame-encodes, no extra pass), and it gives the same guarantee
materialising was reaching for — one explicit, testable mapping — without a derived row.

## Still to work out

- **The audit is smaller now but not gone.** The export is longer than `video_duration`; list every
  consumer of the post-render duration (poster/slow-mo resolution, `_validate_concat`, progress
  reporting, share playback, the T5220 intro prepend) and state what each does. The remap gives one
  place to reason about it — use it.
- **Both render paths must agree** — Modal (`video_processing.py`) and local
  (`_process_frames_to_ffmpeg`), the pairing T5225 established. A hold in only one path silently
  produces two different videos. Modal redeploy is the user's step.
- **Editor preview must hold too**, or preview stops matching export.
- Audio: a held video frame does not hold audio. Decide — mute the held span, hold silence, or let
  audio run under a frozen picture — and say why.

## Relevant files
- `src/frontend/src/components/timeline/TextLayer.jsx` — block model + timeline affordance
- `src/backend/app/routers/export/overlay.py` — actions, render dispatch, `has_text` gate
- `src/backend/app/modal_functions/video_processing.py` — Modal loop (**redeploy**)
- `src/backend/app/services/local_processors.py` — local loop
- `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/modal-gpu.md`

## Classification hint
L-tier. Backend + Frontend + Modal. No migration (the `text_overlays` msgpack entry is schemaless).
Architect gate on the remap + the duration audit.

## Acceptance criteria
- [ ] A text block can be marked "pause during text"; default OFF, existing blocks unchanged.
- [ ] The export holds the frame at the block's start for exactly the block's duration, text over it.
- [ ] Playback resumes from the same frame — no skipped or duplicated motion at the seam.
- [ ] The pause is reversible: removing it returns the export to the original timing, byte-for-byte
      equivalent to never having set it.
- [ ] No new `working_videos` row is written for a pause.
- [ ] The time-remap is a single explicit function, unit-tested, applied to all overlay data.
- [ ] Modal and local render paths produce identical output.
- [ ] The editor preview holds too.
- [ ] Every consumer of output duration is audited and its behaviour stated.
- [ ] Two pauses in one reel compose; a pause on a block spanning a clip cut behaves.
- [ ] The audio decision is implemented and documented.
