# T8838: Shrink capability census (probe real users' devices before building the UI)

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-07
**Updated:** 2026-09-07

## Problem

Every shrink measurement so far (T8830, T8832) ran on ONE machine - a dev laptop with a
discrete RTX 4060. The target audience uploads from ordinary consumer laptops, and 8K
10-bit HEVC (`hvc1.2.4.H156.b0` at 7680x4320) hardware decode is far from universal:
integrated GPUs often cap HEVC decode at 4K, and Main10 (10-bit) support is missing on
older silicon. Firefox has no WebCodecs HEVC at all. Nobody knows what fraction of real
uploaders could ever see the shrink offer. If it's 15%, T8850 (crop UI) and T8860
(upload integration) are a lot of polish for a niche; if it's 70%, they deserve it.

This is the single cheapest, highest-information test left: ship ONLY the capability
probe into the existing upload path, count the answers as aggregates, and let a couple
of weeks of real uploads decide how much the rest of the shrink track deserves.

## Solution

At the per-file analyze step every game upload already goes through
(`uploadManager._hashAndAnalyze`, which already has the moov's byte range from
`analyzeMp4Faststart`), read the video track's real codec string + coded size, run the
two WebCodecs capability checks the shrink feature will gate on, and fire ONE telemetry
beacon per file through the EXISTING T7515 impression pipeline
(`recordUiImpression` -> `POST /api/telemetry/impression` -> `record_impression` ->
the `user_actions` aggregate row). Counts only, bounded vocabulary, no filenames, no
new Postgres state, no new tables or columns - exactly the analytics rules
(in-house, aggregates-only).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/shrinkCapability.js` - NEW: `probeShrinkCapability(file,
  faststartInfo) -> {decode: 'yes'|'no'|'unavailable', encode: ..., codecFamily,
  resBucket}` + the beacon names
- `src/frontend/src/utils/shrinkCapability.test.js` - NEW
- `src/frontend/src/services/uploadManager.js` - call the probe from `_hashAndAnalyze`
  right after `analyzeMp4Faststart` (the gesture is the upload the user just started)
- `src/frontend/src/utils/uiTelemetry.js` - `recordUiImpression` already exists; add
  nothing except (if needed) allowing the new `capability` kind through its client-side
  checks
- `src/frontend/package.json` - add `mp4box` (T8840 needs it anyway; ~92 KB ESM,
  dynamic-`import()`ed only when a video is analyzed, never in the initial bundle)
- `src/backend/app/analytics.py` - add `"capability"` to `IMPRESSION_KINDS` (one line +
  docstring); `record_impression` needs no other change
- `src/backend/app/routers/telemetry.py` - no change expected (`kind` is validated in
  `record_impression`); read it to confirm
- Tests: the two new files + `uploadManager.test.js` + `uiTelemetry.test.js` +
  `src/backend/tests/` telemetry/analytics test for the new kind

### Related Tasks
- Depends on: T8834 (STAGING - `analyzeMp4Faststart` now returns `reason` and reliable
  moov offsets on every path)
- Informs: T8850, T8860 (how much UI/integration polish the shrink offer deserves), and
  EPIC decision 6
- Does NOT block T8840 starting; T8840's own `capability.js` should reuse this module's
  codec-string + `isConfigSupported` logic rather than re-implementing it (this is the
  first real use; T8840 is the second - keep it one function)
- Actions T8836 decision-table row 1 (client-side probe) in its minimal form

### Technical Notes
- **Codec string must be exact.** `isConfigSupported` distinguishes `hvc1.2.4.H156.b0`
  (Main10) from `hvc1.1.6.L153.b0` (Main 8-bit); a hand-rolled `hvcC`->RFC 6381 string
  that gets a profile bit wrong would silently skew the whole census. Use mp4box:
  dynamic-`import('mp4box')`, `createFile()`, feed ONLY `ftyp + moov` (slice them from
  the file using `faststartInfo.ftypOffset/ftypSize/moovOffset/moovSize`, set
  `buffer.fileStart = 0`, `appendBuffer`, `flush`), read `info.videoTracks[0]`'s
  `codec`, `video.width`, `video.height` from `onReady`. T8836 proved this exact trick
  runs in 16-124 ms on the real fixtures including the 17 GB files; it never reads mdat.
- **Two checks, both counted:** `VideoDecoder.isConfigSupported({codec, codedWidth,
  codedHeight})` with the file's real values, and
  `VideoEncoder.isConfigSupported({codec: 'avc1.640033', width: 2688, height: <aspect>,
  bitrate: 12_000_000, framerate: 30})` (the Recommended preset). `typeof VideoDecoder
  === 'undefined'` -> `unavailable` (Firefox, old Safari) - counted, not skipped.
- **Bounded beacon vocabulary** (the slug is the aggregate key, so keep it closed):
  - `shrink_probe_total` - fired for EVERY probed file (the denominator - the
    tries-vs-success rule: never ship a success count without its attempt count)
  - `shrink_decode_{yes|no|unavailable}_{codecFamily}_{resBucket}` where `codecFamily`
    in `{avc, hevc8, hevc10, av1, vp9, other}` (derived from the codec string prefix +
    profile) and `resBucket` in `{le1080, le4k, gt4k}` (by coded height: <=1080,
    <=2160, >2160)
  - `shrink_encode_{yes|no|unavailable}` (encoder support is independent of the source)
  - `shrink_probe_failed` when mp4box can't parse the moov (count it; never throw)
  Platform (desktop/mobile/browser family) is already recorded per row by
  `record_impression` via `get_current_platform()` - do not encode it in the name.
- **Gesture rule:** fires inside `_hashAndAnalyze`, which runs because the user started
  an upload - a named gesture, not a state watch. One beacon set per file. The existing
  `MAX_IMPRESSION_BEACONS_PER_SESSION = 50` cap covers runaway cases; a folder of 4
  segments is 4 x ~3 beacons.
- **Never delay or fail the upload.** The probe is fire-and-forget with its own
  try/catch; a thrown mp4box parse, a missing WebCodecs API, or a rejected beacon must
  all resolve to a counted outcome and never block `hashFile`/the upload. Run it
  concurrently with hashing, don't await it on the critical path.
- **No PII:** no filename, size, or duration in the beacon. Codec family + resolution
  bucket only.
- **Reading the census:** rows are `capability_impression:shrink_...` in the PG
  `user_actions` aggregate, already visible via the admin per-user actions view and
  queryable as `action LIKE 'capability_impression:shrink_%'` grouped by platform. A
  dedicated admin tile is a separate small follow-up IF the numbers warrant one; do not
  build it here.
- Also record `analyzeMp4Faststart`'s `reason` count? No - T8834's `[Faststart]` console
  line covers that and it isn't a product decision input. Keep this task to the shrink
  question.

## Implementation

### Steps
1. [ ] `shrinkCapability.js`: mp4box ftyp+moov parse -> codec/width/height; the two
   `isConfigSupported` calls; bounded name derivation; `probeAndReport(file,
   faststartInfo)` that never throws and always emits `shrink_probe_total` plus the
   decode/encode outcome (or `shrink_probe_failed`).
2. [ ] Backend: `"capability"` in `IMPRESSION_KINDS` + docstring; backend test that the
   new kind upserts a `capability_impression:shrink_decode_yes_hevc10_gt4k` row and an
   unknown kind is still rejected.
3. [ ] Wire into `_hashAndAnalyze` (concurrent, not awaited on the upload path).
4. [ ] Unit tests: name derivation table (codec string -> family/bucket, incl. the real
   strings `hvc1.2.4.H156.b0`, `avc1.640028`, `avc1.4d001f`), unavailable-API path,
   parse-failure path, "never throws" contract, beacon count per file == expected.
5. [ ] Live check on the local stack: upload the real 3.3 GB DJI file and the Legends
   half in Chrome; confirm the console shows the probe result and the `user_actions`
   rows appear with the expected names and platform.
6. [ ] Note in `annotate.md` (intake section): the census exists, what the rows mean,
   and the query to read it.

### Progress Log

**2026-09-07**: Filed from the shrink-readiness review after T8830/T8832/T8834 landed:
the remaining unknown is not "can a browser do it" but "how many of OUR users' browsers
can" - answer it with real uploads before investing in T8850/T8860 polish.

## Acceptance Criteria

- [ ] Every game upload emits exactly one `shrink_probe_total` plus one decode outcome
      and one encode outcome beacon (or `shrink_probe_failed`), never more, never a throw
- [ ] The codec string sent to `isConfigSupported` matches mp4box's `track.codec` for
      the real DJI file (`hvc1.2.4.H156.b0`) and the real Legends file (`avc1.640028`)
- [ ] Upload timing is unchanged (probe runs concurrently, never awaited on the path)
- [ ] `user_actions` rows appear with bounded names + platform on the local stack
- [ ] No new Postgres tables/columns; no filenames or sizes in any beacon
- [ ] T8840's `capability.js` plan updated to reuse this module (note in T8840)
