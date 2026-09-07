# T8836: Survey: other cheap client-side pre-upload work worth doing now (decision doc)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

User direction (2026-09-06): while the intake is being rebuilt, any modification we can
make to a file or its metadata in the browser BEFORE upload that is fast enough to be
invisible and pays off later should be measured and decided now, not rediscovered one at a
time. T1380 (moov relocation) is the model: zero re-encode, sub-second, permanent benefit.
Re-encoding of any kind is explicitly NOT in scope - that is the shrink pipeline
(T8840-T8860), and for the typical ~3 GB 1080p upload the numbers do not favour it (a
45-minute half at ~9 Mbps re-encodes at roughly 1x realtime = 30-45 min of laptop time to
save maybe 20% of a 16-minute upload).

## Solution

A bounded spike that MEASURES each candidate on the real fixtures and produces one table
(candidate, measured ms on the 17 GB DJI file, downstream bytes/time saved, risk,
recommendation, target task). No app code ships from this task; the user picks which rows
become tasks.

## Context

### Relevant Files (REQUIRED)
- `docs/plans/tasks/universal-upload/T8836-survey-cheap-client-preupload-work.md` - the
  decision table lives here (Progress Log)
- `scripts/shrink-spike/` - reuse the harness for any timing that needs a page; still
  never imported by app code
- Read-only inputs: `src/frontend/src/utils/mp4Faststart.js`,
  `src/frontend/src/utils/videoMetadata.js`, `src/frontend/src/services/uploadManager.js`,
  `src/backend/app/services/video_probe.py`, `src/backend/app/services/poster.py`

### Related Tasks
- Depends on: none (T8834 findings are useful input, not a blocker)
- Feeds: T8840 (keyframe index), T8850 (filmstrip frames, offer gating), T8860, and
  EPIC decision 4 (shrink offer threshold)

### Technical Notes - candidates to measure (add any found during the task)
1. **Client-side probe replaces server probe.** `analyzeMp4Faststart` already has the
   moov in memory; parsing duration/fps/resolution/codec/`creation_time`/`stss` count
   from it is free. T8800 already sends `creationTime`. Measure what `video_probe.py`
   (1 MB head fetch per upload) still does that the client could send on create, and
   what breaks if the client lies (trust boundary: server must validate or re-probe
   lazily).
2. **Keyframe (`stss`) index extracted client-side.** Exact sync-sample times for the
   crop filmstrip (T8850) and for chunked/cancel-resume shrinking (T8840). Cost: zero
   beyond the moov parse. Decide the payload shape (never persist view state; this is
   file metadata, so persisting is fine if it is small).
3. **Poster + per-segment preview frames from the `.LRF` proxy** (EPIC decision 2 keeps
   proxies client-side). If a 720p-class proxy frame can be drawn to canvas and uploaded
   as a ~50 KB JPEG at create time, `poster.py`'s ~5 remote seeks per game go away.
   Measure: proxy seek + draw time; decide whether the server-side poster path stays as
   the fallback for proxy-less uploads.
4. **Dropping tracks the app never reads** (DJI data tracks - gyro/GPS/timecode - and a
   second audio track): container-only via the same box-walk + offset-patch machinery.
   Measure bytes saved on the 17 GB file. Expected < 1%; if so, recommend NO and say why.
5. **Shrink offer gated by bitrate, not total bytes** (analysis only, changes EPIC
   decision 4): compute bytes/second for the three real fixtures. The 8K DJI file is
   ~96 Mbps (3.3 GB / 4.6 min) - re-encoding to 12 Mbps is an 8x win; a 3 GB 45-minute
   1080p half is ~9 Mbps and gains almost nothing. Recommendation goes to the user; the
   threshold itself is theirs to change.
6. **Anything that needs a re-encode is out** (frame-rate reduction, audio re-encode,
   bitrate reduction) - list it, mark "shrink pipeline", move on.

Bar for "cheap": < 1 s of added work per file on the dev laptop, no extra full-file read
(the sampled hash already reads 5 MB; the moov scan reads box headers + moov), no
new Postgres state.

## Implementation

### Steps
1. [ ] Measure candidates 1-4 on the real fixtures (DJI 0006 + 0003, Legends half, one
   phone clip); record ms and bytes in the table.
2. [ ] Compute candidate 5's bitrate numbers for the fixtures.
3. [ ] Write the decision table + a one-line recommendation per row in the Progress Log;
   flag which rows are user decisions (5) vs engineering (1-4).
4. [ ] Hand the table to the user; file follow-up tasks only for the rows they pick.

### Progress Log

**2026-09-06**: Filed from the user's direction after T8830 landed.

## Acceptance Criteria

- [ ] Every candidate has a measured number on the 17 GB DJI file (or a stated reason it
      does not apply)
- [ ] One recommendation per row, with the target task named
- [ ] No app code changed by this task
- [ ] Follow-up tasks filed only for rows the user picks
