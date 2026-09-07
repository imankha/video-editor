# T8872: Hotfix - send `recorded_at` only when the intake trusted the timestamps

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

**Live data bug on staging, found 2026-09-06 by driving the real upload path.**

`GameFootagePicker` emits every item's embedded `creationTime` unconditionally
(`GameFootagePicker.jsx`, the `onFootageChange` payload, ~L80-90: `creationTime:
it.creationTime instanceof Date ? it.creationTime : null`). `uploadStore` ->
`uploadManager` forward it as `recorded_at`; the backend's `compute_video_offsets`
(T8870) then places every video on the game's time axis from it.

But the intake's ordering rule (`inferOrder` in `utils/footageIntake.js`, EPIC decision
1) DISCARDS those same timestamps wholesale when the chain overlaps - because on a
Trace-camera export (the Legends fixture) `creation_time` is the EXPORT time and the two
halves "overlap by 32 min". `inferOrder` only affects `order`/`confidence`; it never
touches the item's `creationTime`, so the discarded timestamps leak straight through to
the backend as evidence.

Consequence for the Legends/Trace segment (a real user population per EPIC.md's evidence
table): upload `1st-half.mp4` + `2nd-half.mp4` -> picker correctly orders by name
(confidence `name`) -> backend computes OVERLAPPING `offset_seconds` from the bogus
export times -> T8880's `hasOverlapPlacement` routes Annotate to the lane builder -> the
second half is treated as an "angle" over the first. Instead of two sequential ~44-min
halves, the game renders as one ~57-min timeline with the overlapped part of the second
half unreachable (T8890's angle UI is not merged yet; even once it is, the halves would
show as a switchable angle, which is wrong).

Reproduced the mechanism 2026-09-06 with two synthetic files whose times overlapped:
picker showed "We couldn't tell what order these go in - please check" (confidence
`unknown`), no overlap badge, yet `GET /api/games/{id}` returned `recorded_at` on both
rows and `offset_seconds` 0 / 120. The intake and the backend disagreed about whether the
timestamps were trustworthy.

## Solution

Make the picker's payload honour the intake's own verdict: emit `creationTime` only when
`confidence === 'time'` (the chain was validated as sequential); otherwise `null`. The
backend then falls back to prefix-sum-by-sequence, which is exactly today's pre-T8870
behaviour, and no bogus overlap can reach `offset_seconds`.

This deliberately means the upload path can NOT create angles until T8824 redesigns the
rule to distinguish genuine overlap from export-time artifacts. That is correct: the only
path that created an angle today was this leak, which is a bug, not a feature.

`manual` confidence (user dragged the order) also sends `null`: the user chose the
sequence, so prefix-sum by their sequence is the placement they asked for.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameFootagePicker.jsx` - the `onFootageChange` effect
  (~L78-90); `confidence` is already destructured from `useFootageIntake()` at the top
- `src/frontend/src/components/GameFootagePicker.test.jsx` - add the two payload cases

### Related Tasks
- Follows: T8870 (STAGING) - the threading this gates
- Superseded later by: T8824 (which replaces the blunt gate with a real placement model
  but MUST keep this invariant: never send an untrusted timestamp)
- Read `.claude/knowledge/annotate.md` (intake section) first

### Technical Notes
- The intake's `confidence` values: `time` | `name` | `unknown` | `manual`. Only `time`
  means the timestamps passed the chain sanity check.
- Do NOT null the item's `creationTime` inside `useFootageIntake`/`inferOrder` - T8822's
  `overlapGroups` and the evidence chips read it for display and are already correctly
  gated on `confidence === 'time'`. Gate at the payload boundary only.
- `AnnotateContainer.handleGameVideoSelect` -> `uploadStore` -> `uploadManager` are pure
  passthrough (T8870 threaded `creationTime` -> `metadata.recorded_at` ->
  `options.videoRecordedAt` -> `videoRef.recorded_at`); no change needed there.

## Implementation

### Steps
1. [ ] Gate the payload: `creationTime: confidence === 'time' && it.creationTime instanceof
   Date ? it.creationTime : null`.
2. [ ] Tests in `GameFootagePicker.test.jsx`: (a) confidence `name` with items carrying
   real `Date`s -> every emitted `creationTime` is `null`; (b) confidence `time` -> Dates
   pass through unchanged; (c) confidence `manual` -> `null`.
3. [ ] Run the curated set: `GameFootagePicker.test.jsx`, `uploadManager.test.js`,
   `footageIntake.test.js`, and the `T8820-confirm-strip-reorder.qa.spec.js` e2e (its DJI
   chain is confidence `time`, so `recorded_at` must still flow - assert that in the spec
   via `GET /api/games/{id}` if not already).

### Progress Log

**2026-09-06**: Filed from a live local-stack test of T8890 (see that task's progress
log). P1: affects the Trace/Legends upload path on staging today.

## Acceptance Criteria

- [ ] Uploading the Legends-shaped pair (names `...1st-half...` / `...2nd-half...`,
      overlapping export-time `creation_time`) yields `recorded_at = null` on both rows
      and `offset_seconds` 0 / duration1 (prefix sum) - verified via `GET /api/games/{id}`
- [ ] Uploading the DJI-shaped chain (sequential times) still yields non-null
      `recorded_at` and the same offsets as before
- [ ] Curated frontend set + the confirm-strip e2e green; provably verified (test fails
      on the pre-fix source, passes after) -> merge without asking
