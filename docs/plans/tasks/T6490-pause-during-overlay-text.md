# T6490: "Pause during text" — freeze the frame through a text block

**Status:** TODO
**Impact:** 7 | **Complexity:** 6
**Follows:** [T5225](player-intro/T5225-overlay-text-layer.md) (overlay text layer, merged 2e3b532e)

## Problem

User request, 2026-08-04, after driving the overlay text layer on staging:

> We need a "pause during text" option which would pause at the current frame (extends that frame
> through the text region).

Today a text block draws over moving footage. For a callout the viewer is meant to *read*, the
footage keeps playing underneath and the text is gone before it lands. The ask is a per-block option
that freezes the underlying frame for the block's duration, so the reel holds still while the text
is on screen and then resumes.

## Scope

- Per-text-block boolean (default OFF — existing blocks must not change behaviour).
- When ON, the frame at the block's `startTime` is held for `endTime - startTime`, with the text
  composited over it, then playback resumes from that same frame.
- The editor must show it: a paused block should read differently on the timeline, and the browser
  preview should hold too, or the preview stops matching the export.

## The hard part — this CHANGES OUTPUT DURATION

A freeze inserts time that does not exist in the working video. Everything keyed to the concatenated
timeline shifts after the insertion point. Before writing code, establish where the freeze is
applied:

- **At render only** (working timeline untouched; the freeze is a render-time expansion) — keeps
  every stored time value meaningful, but the export is then longer than `video_duration`, and
  anything that assumes export length == working length must be found and checked.
- **As a timeline edit** (the working video genuinely gains frames) — simpler downstream, but it
  invalidates highlight keyframes, crop keyframes, other text blocks' ranges, and the clip-boundary
  offsets T5225 added to `/overlay-data`.

The first is almost certainly right, but the audit matters more than the choice: **list every
consumer of the post-render duration** (poster/slow-mo section resolution, `_validate_concat`,
progress reporting, share playback, the T5220 intro prepend) and state what each does when the
output is longer than the source.

Both render paths must agree — the Modal loop and the local loop (`_process_frames_to_ffmpeg`), the
same pairing T5225 established. A freeze implemented in only one path silently produces two
different videos.

## Relevant files
- `src/frontend/src/components/timeline/TextLayer.jsx` — block model + the timeline affordance
- `src/backend/app/routers/export/overlay.py` — action handlers, render dispatch, `has_text` gate
- `src/backend/app/modal_functions/video_processing.py` — Modal render loop (**needs redeploy**)
- `src/backend/app/services/local_processors.py` — local render loop
- `.claude/knowledge/export-pipeline.md`

## Classification hint
L-tier. Backend + Frontend + Modal. Schema: a boolean on the existing `text_overlays` msgpack entry
(no migration — the blob is schemaless). **Architect gate required** on the duration question above.
Modal redeploy is the user's step.

## Acceptance criteria
- [ ] A text block can be marked "pause during text"; default OFF and existing blocks are unchanged.
- [ ] The export holds the `startTime` frame for exactly the block's duration, with text over it.
- [ ] Playback resumes from the same frame — no skipped or duplicated motion at the resume seam.
- [ ] Modal and local render paths produce identical output.
- [ ] The editor preview holds too, so preview still matches export.
- [ ] Every consumer of output duration is audited and its behaviour stated (see above).
- [ ] Two paused blocks in one reel compose correctly; a paused block spanning a clip cut behaves.
