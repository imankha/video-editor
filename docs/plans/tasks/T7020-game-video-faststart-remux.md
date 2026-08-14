# T7020: Remux uploaded game videos with faststart (moov at front)

**Status:** TODO — deliberately deferred, sequenced first after T5140 (see Progress Log)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-14
**Updated:** 2026-08-14

## Problem

Uploaded game videos are stored exactly as the source device wrote them — no remux step exists
in `games_upload.py::finalize_upload`. Consumer devices frequently write the `moov` atom (the
index a player needs before it can seek anywhere) at the **end** of the file rather than the
front, since that's cheaper for the device to write during recording.

Found 2026-08-14 while investigating a user report that T6820's Not-Started-draft hover preview
took ~4s. Traced the actual R2 request sequence for one hover (backend log,
`app.routers.clips [clip-stream]` lines) against a real ~3GB source game video:

```
window=moov      range=0-10485759            -> FAILS to find a complete moov here
window=moov_tail range=3050340352-3051071722 -> falls back toward the end of the file
window=moov_tail range=3051061248-3051071722 -> refines further
window=moov      range=131072-10485759       -> re-fetches the front now that moov is located
window=clip      range=2018312192-2037246187 -> FINALLY the actual clip data
```

5 sequential round trips (~250-400ms of R2 latency each) before any clip content streams — all
because `moov` isn't at the front. This isn't specific to hover previews: it's the SAME cost
paid by Annotate scrubbing, the bounded clip-stream proxy, and anywhere else the app seeks into
a raw game video (`clips.py::stream_working_clip_bounded`, T1430/T1440's three-window strategy).

**Not a new artificial delay** — T6820's reveal-delay policy (2026-08-14) already waits exactly
as long as real content takes and no longer, confirmed by the user. This task is about making
the *real* latency shorter, not about padding removal (already done).

## Solution

Add a remux pass to `finalize_upload` (or wherever the upload pipeline's last write-time step
lives) that runs `ffmpeg -i <source> -c copy -movflags +faststart <output>` — a **lossless,
copy-only remux** (no re-encoding, no quality loss, no dimension/bitrate change), just moves the
`moov` atom to the front. This is the exact same flag already used elsewhere in this codebase
for output/export paths (`ai_upscaler/video_encoder.py:785`, `modal_functions/video_processing.py`
multiple sites) — reuse the pattern, don't invent a new one.

**Scope decisions to make explicit:**
- **New uploads only, no backfill.** Remuxing every existing game video in R2 is a large,
  separate migration-shaped effort with its own risk profile; this task should NOT attempt it.
  Existing videos keep today's latency until they're naturally superseded or a backfill task is
  filed separately.
- **Where does the remux run?** Options: (a) inline in `finalize_upload` before the upload is
  marked complete (simplest, but adds wall-clock time to every upload — `-c copy` remux of a
  multi-GB file is I/O-bound, not CPU-bound, so likely fast, but MEASURE on a real large file
  before assuming), or (b) a background/async step that doesn't block finalize (more complex,
  needs a "remux pending" state so early hover/scrub attempts don't break). Recommend starting
  with (a) and measuring; only move to (b) if the measured cost is unacceptable.
- **Multi-video games** (T1440's video_sequence): each video file in the sequence needs its own
  remux pass independently.
- **Failure handling**: if the remux fails for any reason, the ORIGINAL upload must still
  succeed and be usable (no-silent-fallback rule — log loudly, keep the un-remuxed file, don't
  block the user's upload on this optimization).

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py:264` — `finalize_upload`, where the remux step would
  be added
- `src/backend/app/routers/clips.py` — `stream_working_clip_bounded` (T1430/T1440), the bounded
  clip-window proxy that pays this cost on every seek; reference only, not modified by this task
- `src/backend/app/ai_upscaler/video_encoder.py:785` — existing `+faststart` usage to mirror
- `src/backend/app/modal_functions/video_processing.py:406,556` — existing `+faststart` usage to
  mirror (also shows the established ffmpeg-args style for this codebase)

### Related Tasks
- Follows: T6820 (hover preview for Not Started drafts) — found this during that task's
  post-merge investigation; T6820 itself needs no changes, this is a genuinely separate
  ingest-side improvement
- Also benefits: Annotate scrubbing, any future feature that seeks into a raw game video

### Technical Notes
- Confirm with a real measurement whether `-c copy -movflags +faststart` on a multi-GB file is
  fast enough to run synchronously in `finalize_upload` before committing to the inline approach
  — don't assume, measure on a real large source file first.
- `blake3_hash` (used for dedup/change-detection elsewhere, e.g. `games.blake3_hash`) will
  change after a remux even though the content is perceptually identical (byte layout changes)
  — check whether anything relies on hash stability across this operation before shipping.

## Progress Log

**2026-08-15**: Implemented as a synchronous, inline remux — works, CI green, and a real
reliability bug found live-testing it (a transient R2 502 during the re-upload step was
silently not retried; `is_transient_error` didn't recognize boto3's `S3UploadFailedError`
wrapper) is fixed and regression-tested. Branch: `feature/T7020-game-video-faststart-remux`,
commit `7f2aeb4e`, **kept on origin, not merged**.

Measured end-to-end on a 278MB test upload: the synchronous remux adds 65-78s to
`finalize_upload`'s response — roughly as much as the 58.5s original upload itself — because it
round-trips the file through R2 twice more (download + re-upload; `ffmpeg` itself is
negligible, ~1440MB/s). User does not want ANY upload-time increase, ever.

Presented a design note comparing the current synchronous approach against dispatching the
remux to Modal (mirrors T4945's `stitch_members` — a durable job independent of the Fly
machine's lifecycle, sidesteps the T1537 fire-and-forget constraint) — full comparison +
sequence diagrams: [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c).
User decision: **prefers the Modal-dispatch redesign.** Response would stay near-instant
(~1-2s, matching pre-this-task finalize time) regardless of upload size — satisfies the
zero-upload-time-cost bar the synchronous version can't.

**Not merging the synchronous branch.** Held for more thorough testing and the Modal-dispatch
rework; resequenced to be the FIRST task picked up after T5140 (the tutorial reshoot) rather
than left in the general backlog. When resumed: keep the retry-classifier fix and the
correctness logic (moov-position probe, fail-open semantics) from the current branch, replace
the synchronous `remux_game_faststart()` call in `finalize_upload` with a fire-and-forget
Modal dispatch per the design note's Option A.

## Acceptance Criteria
- [ ] New game video uploads get a lossless faststart remux before being marked ready
- [ ] Multi-video games: every video in the sequence is remuxed independently
- [ ] Remux failure never blocks or corrupts the underlying upload (fails open to the original)
- [ ] Measured: a hover-preview / clip-stream seek into a NEWLY uploaded game needs
      meaningfully fewer round trips than the 5-request sequence documented above (ideally 1-2)
- [ ] No backfill of existing videos — explicitly out of scope for this task
- [ ] Tests pass
