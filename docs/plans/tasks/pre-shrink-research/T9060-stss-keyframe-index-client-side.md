# T9060: Extract the `stss` keyframe index client-side (T8836 row 2)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

T8836 (survey of cheap client-side pre-upload work) measured that the exact sync-sample
(keyframe) index of an uploaded video is FREE to obtain: the same `ftyp + moov` parse the
T8838 capability probe already does (16-124 ms on every real fixture, including both
17 GB DJI files, never touching `mdat`) returns keyframe counts and positions (DJI 0006:
274 keyframes / 8196 samples; Legends half: 2650 / 79489). Two consumers want it: the
shrink crop step's filmstrip (seek exactly to sync samples instead of guessing) and
mid-segment resume in the shrink pipeline (today's checkpointing is whole-segment only,
README "Known limitations"). T8836's decision table said YES; the row was left for the
user to confirm. This task is that follow-up, filed provisionally - the user may veto.

## Solution

Extend the existing `probeShrinkCapability` moov parse to also return the video track's
keyframe times (seconds, from `stss` sample numbers mapped through `stts`), exposed as
one extra field on its result. No persistence, no schema, no new beacon: the index lives
in memory for the upload/shrink session and is handed to whoever asked for it. The
standalone tool's `probeContainer` reuses the same function so there is exactly one
implementation.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/shrinkCapability.js` - `probeShrinkCapability(file,
  faststartInfo) -> {decode, encode, codecFamily, resBucket, codec, width, height}`;
  plain ESM (no config/apiFetch/store imports) so the tool imports it directly. ADD
  `keyframeTimesSec: number[]` (or `null` when `stss` is absent, which means every
  sample is a sync sample - say so explicitly rather than returning `[]`)
- `src/frontend/src/utils/shrinkCapability.test.js` - extend with a fixture whose
  `stss`/`stts` are known
- `scripts/shrink-tool/pipeline/demux.js` - `probeContainer` (the tool's own moov
  parse); consume the shared function rather than re-parsing
- `scripts/shrink-tool/pipeline/checkpoint.js` - future consumer for mid-segment
  resume (NOT implemented here; this task only makes the data available)
- `docs/plans/tasks/universal-upload/T8836-survey-cheap-client-preupload-work.md` -
  decision table rows 1-2 and the raw measurements table (cite, do not duplicate)
- `docs/plans/tasks/universal-upload/T8838-shrink-capability-census.md` - how the
  moov is fed to mp4box (slice `ftyp + moov` via `faststartInfo` offsets,
  `buffer.fileStart = 0`, `appendBuffer`, `flush`, read `onReady` info)

### Related Tasks
- Depends on: T8838 (STAGING; the module exists), user confirmation of T8836 row 2
- Blocks: nothing hard. Feeds T8850 (filmstrip seeks), and a possible later
  "mid-segment resume" task in the shrink tool
- Related: T8836 (source of the numbers), T8840 (README known limitation on
  whole-segment checkpointing)

### Technical Notes
- mp4box exposes the sample table after `onReady`; keyframe sample numbers come from
  `trak.mdia.minf.stbl.stss.sample_numbers` and their times from the `stts` deltas
  (`mp4box`'s `getTrackSamplesInfo` / `trak.samples[i].is_sync` and `cts`/`dts` give the
  same answer; pick the cheapest path that does not force sample extraction). Divide by
  the track timescale, not the movie timescale.
- Size: hundreds to a few thousand floats per file; fine in memory, NOT persisted (no
  view-state or metadata persistence without a named consumer that needs it across
  sessions - none does today).
- Do not add a beacon. The census vocabulary is closed; keyframe cadence is not a
  capability.
- Bar for "cheap" from T8836: < 1 s added per file, no extra full-file read. This adds
  ~0 ms beyond the parse already happening.

## Implementation

### Steps
1. [ ] Add `keyframeTimesSec` to `probeShrinkCapability`'s result; unit test on a
   fixture with a known `stss` (the tool's synthetic 90 s fixture has ~1 keyframe/s
   with `-g` default; assert count and first/last times).
2. [ ] Point the tool's `probeContainer` at the shared function (or have it call it
   for the index) - one implementation.
3. [ ] Verify on the real DJI 0006 (`274` keyframes expected) and Legends half
   (`2650`) in the browser; record ms in the Progress Log.

### Progress Log

**2026-09-08**: Filed provisionally from T8836 decision row 2 (user had not yet picked
the row). Veto = close this task and tick T8836's step 4 with "row 2 declined".

## Acceptance Criteria

- [ ] `probeShrinkCapability` returns `keyframeTimesSec` (or explicit `null` for
      all-sync tracks); unit-tested
- [ ] Real-file check: DJI 0006 -> 274 entries, Legends half -> 2650 entries; added
      time recorded and < 50 ms
- [ ] No persistence, no beacon, no new dependency; tool and app share one function
- [ ] T8836 step 4 updated to reference this task
