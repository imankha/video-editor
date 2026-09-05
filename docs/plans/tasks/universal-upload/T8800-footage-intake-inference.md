# T8800: Footage intake logic: probe + order inference

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

To accept "everything from the camera" we must turn an arbitrary pile of files into an
ordered, trustworthy timeline plan: filter junk, read each video's duration and embedded
recording time, decide the play order, and detect gaps - all client-side, before upload.
No UI in this task; this is the pure, unit-testable brain the next two tasks render.

## Solution

A new hook `useFootageIntake` plus pure helper functions in a new util module. See
[EPIC.md](EPIC.md) decisions 1-3 for the ordering rule, junk rules, and evidence base.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/footageIntake.js` - NEW: pure functions (filter, infer, gaps)
- `src/frontend/src/utils/footageIntake.test.js` - NEW: unit tests
- `src/frontend/src/hooks/useFootageIntake.js` - NEW: stateful wrapper (probe queue, merge)
- `src/frontend/src/utils/videoMetadata.js` - EXTEND: expose creation_time from the mvhd box

### Related Tasks
- Blocks: T8810, T8820
- The mvhd creation field is currently parsed and SKIPPED in `extractVideoMetadataFromUrl`
  (the box walker around lines 138-154 reads duration from `mvhd`; the creation timestamp
  is the 4 bytes right before it in version-0 boxes, 8 bytes in version-1).

### Technical Notes
- MP4 `mvhd` creation time epoch is 1904-01-01 UTC (subtract 2082844800 seconds to get
  Unix time). Version-1 boxes use 64-bit values. A zero value means "not set" - treat as
  missing, never as 1904.
- Probing must NOT read whole files: `extractVideoMetadataFromUrl` already walks boxes via
  ranged reads of a blob URL. Extend that walker; do not add a second parser.
- `File.lastModified` is NOT evidence (it is the copy date - proven by the Capo sample in
  EPIC.md). Only embedded creation_time and filenames count.

## Implementation

### Steps
1. [ ] In `videoMetadata.js`, extend the mvhd parse to also return `creationTime`
   (a JS `Date` in UTC, or `null` when absent/zero). Add it to the object
   `extractVideoMetadata(file)` resolves with. Keep every existing field untouched.
2. [ ] Create `src/frontend/src/utils/footageIntake.js` with pure functions:
   - `isJunkFile(file)` -> true for extensions `.lrf .thm .srt .jpg .jpeg .png .heic .gif`,
     names starting with `.` or `._`, and zero-byte files. Case-insensitive.
   - `isVideoFile(file)` -> accept when MIME starts with `video/` OR (MIME empty AND
     extension is `.mp4 .mov .webm .m4v`). The empty-MIME fallback is REQUIRED: files from
     folder drops often report an empty MIME string.
   - `pairProxies(files)` -> returns `{videos, proxies}` where a `.LRF` whose basename
     matches an accepted `.MP4` is moved to `proxies` keyed by that video's name (kept for
     T8850's preview, never uploaded).
   - `inferOrder(items)` where each item is `{name, duration, creationTime}`. Returns
     `{ order: [items...], confidence: 'time'|'name'|'unknown', gaps: [{afterIndex, seconds}] }`
     implementing EPIC decision 1 exactly:
     a. If every item has `creationTime`, sort by it; validate the chain with tolerance
        `CHAIN_TOLERANCE_S = 120` (next.start >= prev.start + prev.duration - tolerance).
        Valid -> confidence `time`; record a gap entry wherever
        `next.start - (prev.start + prev.duration) > GAP_MIN_S = 120`.
     b. Any overlap beyond tolerance, or any missing creationTime -> discard timestamps
        WHOLESALE. Try filename rules in order: half-words
        (`1st|first` < `2nd|second`, with `half` nearby), a shared prefix with a trailing
        counter (`DJI_0231` < `DJI_0232`, `clip (2)`), a full-date pattern in the name.
        Decisive -> confidence `name`.
     c. Otherwise natural-sort by name, confidence `unknown`.
   - `dedupeKey(item)` -> `${name}|${size}|${duration}` for add-more merges.
3. [ ] Create `useFootageIntake` hook: state
   `{status: 'empty'|'checking'|'ready', items, order, confidence, gaps, skipped, proxies}`;
   `addFiles(fileList)` runs filter -> probe (sequential queue, `extractVideoMetadata`
   per file) -> `inferOrder`, merging with existing items via `dedupeKey` (duplicate ->
   return the duplicate's name so the caller can toast). `removeItem(name)`,
   `setManualOrder(names)` (sets confidence `'manual'`), `reset()`.
   A file whose probe throws gets `{probeError: true}` and is excluded from `order`.
4. [ ] Unit tests (Vitest) for `inferOrder` covering the three real-world cases as
   synthetic tuples (values from EPIC.md evidence table):
   - DJI: 4 items, times 17:55:44/18:19:15/18:44:59/19:08:32, durations 1410/1013/1411/273
     -> confidence `time`, order 0003..0006, exactly one gap (~529s) after index 1.
   - Legends: 2 items whose times overlap by ~32 min -> timestamps discarded, half-words
     win -> confidence `name`, 1st-half first.
   - Ambiguous: 2 items, no creationTime, names `a.mp4`/`b.mp4` -> confidence `unknown`.
   - Plus: junk filter, empty-MIME acceptance, proxy pairing, dedupe, missing-one-timestamp
     falls to name path, zero mvhd treated as missing.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] `inferOrder` reproduces the three fixture verdicts above exactly
- [ ] `.LRF` files never appear in `order`, do appear in `proxies`
- [ ] A file with empty MIME but `.mp4` extension is accepted
- [ ] No network or backend calls anywhere in this task
- [ ] `npx vitest related --run src/frontend/src/utils/footageIntake.js` curated set green
