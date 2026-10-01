# T11550: Lead the delivered file with the chosen cover (conditional)

**Status:** TODO (blocked: T11540 results + explicit user approval)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Epic Context

This is task 5 of 5 in the Social Cover Image epic. Read [EPIC.md](EPIC.md), design decisions 2
and 4.

**Do not start this task** until both of these are true:

- T11540 shows that a leading still sets the default cover on Instagram Reels and/or TikTok.
- The user has approved the visible change.

If T11540 shows no win, mark this task OBSOLETE.

## Problem

When a video *file* is uploaded, most platforms default the cover to the first frame. Our first
frame is the intro card's first frame, or the reel's first frame. Neither is the cover the user
chose, so every upload starts with the wrong default cover.

## Solution (sketch; the Architect produces the real design)

Put the chosen cover still in front of the served file, for the minimum hold that T11540 found
wins. Do it in the existing serve-time compose pass (`compose_serve_time` /
`compose_serve_time_dispatched`), which already re-encodes and concatenates
`[intro?][reel][outro]`. The result becomes `[cover still][intro?][reel][outro]`.

Design questions the Architect must settle:

1. **Scope:** downloads and "Share video" only, or also the in-app player and the share page? The
   recommendation is delivered files only, because the in-app player already shows the cover as
   its poster.
2. **Interaction with the intro card:** put the cover first, or make the intro card's first frame
   the cover, which avoids a flash but only helps reels that have an intro?
3. **Cache keys:** serve-time compose output is cached. The key must include `poster_frame_time`,
   or the poster's identity, so that moving the marker yields a new file.
4. **Modal vs local ffmpeg routing:** the memory note on intro-card OOM says heavy ffmpeg work goes
   to Modal.
5. **Opt-out:** should there be a per-reel or per-user toggle? Ask the user. The default is no
   toggle unless they want one.

## Context

### Relevant Files
- `src/backend/app/services/serve_time_video.py`: the compose seam.
- `src/backend/app/routers/downloads.py` (L669-847): `download_file`, `stream_download`,
  `_stamp_download`.
- `src/backend/app/routers/shares.py` (~L388): the shared-video download stamp path.
- `src/backend/app/services/poster.py`: the poster object and `poster_frame_time`.
- `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/modal-gpu.md`.

### Related Tasks
- Blocked by: T11540 (evidence) and user approval.
- Related: T6360 (cover-art embed), T7090 (intro-card OOM -> Modal).

### Technical Notes
- This changes the delivered video, so it is NOT an invisible, quality-neutral optimization. The
  user must approve it (EPIC decision 4).
- Golden-output harness: `tests/test_export_golden_*` and the download goldens must be re-blessed
  in a dedicated commit with a stated reason.

## Acceptance Criteria (to be refined by the design)
- [ ] The served download's first N frames show the chosen cover (ffprobe / frame-hash test).
- [ ] Moving the cover marker changes the served file's leading still (cache-key test).
- [ ] Live-verified: uploading a fresh download to Instagram Reels shows the chosen cover as the
      default, with no picker interaction.
- [ ] No regression in intro / outro composition or download metadata stamping.
