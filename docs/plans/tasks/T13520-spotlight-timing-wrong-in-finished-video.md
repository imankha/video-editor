# T13520: Spotlight in the finished video is shorter than set and disappears when text starts

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** M/L (overlay render pipeline; may touch Modal)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bug 48, screenshots `BUG-48-download-first3s.png`, `BUG-48-download-contact-sheet.png`, `BUG-48b-ready-preview-shows-ring-1440.png`). Highlight "Maya goal vs Breakers" (download id 6) in game "WCFC vs. LA Breakers FC Long Beach".

## Problem

What the user sets in the Spotlight editor does not match the generated video:

- Editor: spotlight 2.0 s long starting at 0.67 s, shape Under athlete, Yellow, Dim background 40%; text "#7 Maya GOAL" 0:00-0:03.
- Downloaded file (810x1440, 29.19 s): ring + dim visible only 0.0 to about 0.75 s, then gone exactly when the text starts. Text is correct.
- In-app stream `/api/downloads/6/stream` (24.67 s): no ring in frames at 0.7, 1.0, 1.6, 2.3 s.
- The download and the stream differ in length (29.19 s vs 24.67 s).

The "ready" screen preview did show the ring (likely the editor's live overlay, not the output).

## Repro steps

1. Make any highlight to the "ready" point (Frame > Generate).
2. Add spotlight: tap your athlete on moment 1; on moment 2 use "My athlete isn't outlined" and drag the oval onto the athlete.
3. Shape: Under athlete. Color: Yellow. Dim background: 40%. Spotlight duration stays 2.0 s.
4. Add text "#7 Maya GOAL", drag its right end so it runs 0:00-0:03.
5. Generate highlight with spotlight, then Finish.
6. Download from the Finished viewer. Extract frames: `ffmpeg -i video.mp4 -t 3 -vf "fps=4,scale=150:-1,tile=6x2" -frames:v 1 first3s.png`.
7. Also scrub the in-app player to 1.0 s and 2.0 s.

**Expected:** ring and dim visible for the whole set range (about 0.67-2.67 s) in both the download and the in-app player, overlapping the text; download and stream the same length.
**Actual (before fix):** ring only 0-0.75 s in the download, none in the stream; lengths differ.

## Context

### Relevant Files
- Overlay/spotlight render path (export pipeline, Modal or local FFmpeg)
- `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/keyframes-framing.md`

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and keep the frame strip showing the ring missing after ~0.75 s. Write a test on the overlay timing (spotlight range + overlapping text range in, rendered ranges out) and see it fail.
2. **After the fix:** run the same repro (same settings) and attach the new frame strip showing the ring for the full range in both the download and the in-app player, and matching durations.

## Acceptance Criteria

- [ ] Spotlight shows in the output for exactly the range set in the editor, with or without overlapping text
- [ ] Download and in-app stream are the same video (same duration)
- [ ] Regression test fails before, passes after
- [ ] Before/after frame strips attached
