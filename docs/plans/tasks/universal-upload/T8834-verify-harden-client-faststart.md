# T8834: Verify + harden T1380 client-side faststart on real camera files

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

The app already moves the moov atom to the front of every uploaded MP4 in the browser
(T1380, `src/frontend/src/utils/mp4Faststart.js`, wired into `uploadManager.js`'s
`hashAndAnalyze` -> `getReorderedSlice` per multipart part). It is zero-copy (patched
moov in memory, everything else `File.slice()`), and its header claims "<1 s for 3 GB
files". That claim has never been measured on the files this epic is built for (the 8K
DJI segments: 3.3 GB with a 32-bit `mdat`, 12-17 GB with 64-bit `mdat` + `co64`), and a
code read on 2026-09-06 found real landmines:

1. **Hard upload failure on stco overflow.** `patchChunkOffsets` throws
   `stco offset overflow ... needs co64 upgrade (not yet supported)` when a 32-bit chunk
   offset + moovSize crosses 4 GB. `_hashAndAnalyze` does not catch it, so the WHOLE
   upload rejects for any file whose `stco` offsets sit within moovSize of the 4 GB line.
   Rare (encoders normally switch to `co64` above 4 GB), but when it hits there is no
   fallback - the user cannot upload that file at all.
2. **Boxes after moov are silently dropped.** `newSize = ftyp + moov + mdatRegion`; any
   box after moov never reaches R2. Confirmed harmless for the DJI 0006 file (top-level
   scan: `ftyp free free mdat moov`, nothing after moov) - unverified for phone/GoPro
   files that may append `udta`/`meta`/`skip` boxes after moov.
3. **No production telemetry.** `storage.py`'s `[FaststartCheck]` log only covers
   server-produced `working_videos/`; nothing records whether relocation ran (or was
   skipped, and why) for game uploads, so the real-world frequency and timing are unknown.
4. Analysis shares the 120 s `HASH_TIMEOUT_MS` with hashing; a slow analysis on a 17 GB
   file would surface as a "Preparing the video timed out" error with no attribution.

The user's question this answers: "can we move the moov atom client-side so fast the user
doesn't notice?" Expected answer: yes, it already happens - this task proves it on the
real files and removes the failure modes.

## Solution

Measure on the real fixtures, prove the relocated bytes are a correct faststart MP4, fix
the overflow path to never fail an upload, and add the one log line that tells us what
happens in production.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/mp4Faststart.js` - overflow fallback (or co64 upgrade), after-moov
  box handling
- `src/frontend/src/utils/mp4Faststart.test.js` - overflow case, after-moov case
- `src/frontend/src/services/uploadManager.js` - never let analysis failure reject the
  upload (upload as-is + loud log); one structured diag line with `relocated`, `reason`,
  `analysisMs`, `moovKB`, `fileGB`
- `src/backend/app/routers/games.py` - ONLY if the flag should ride the create/attach
  payload for admin visibility (optional; the frontend diag line may be enough - decide
  during the task, do not add Postgres state)

### Related Tasks
- Depends on: none (T1380 shipped long ago)
- Related: T8832 (the shrink spike reuses `getReorderedSlice`; a correctness bug found
  here affects it), T8860 (the "upload originals" fallback path relies on this)
- Does NOT block the shrink track (T8840-T8860)

### Technical Notes
- **Invariant to preserve:** the dedupe hash (`hashFile`, sampled blake3) is computed over
  the ORIGINAL bytes while the uploaded bytes are the relocated ones. That is by design -
  restore-from-local matches a user's original file against the stored hash (see memory
  note "Restore game video from local - SAMPLED blake3 match"). Do not "fix" it.
- **Correctness check, real files:** in a Playwright run, reconstruct the full relocated
  stream with `getReorderedSlice(file, info, 0, info.newSize)` for the 3.3 GB DJI file and
  the Legends half, save to disk, then `ffprobe` (moov first, same duration/frame count as
  the original), `ffmpeg -v error -i out.mp4 -f null -` (clean), and seek-play in a
  `<video>`. For the 17 GB file: measure analysis time only (writing 17 GB to disk is not
  the point) and assert `co64` was patched, not `stco`.
- **Timing bar:** `analysisTimeMs` < 1000 on every fixture on the dev laptop (the scan
  reads ~5 box headers + the moov: 773 KB for 0006). Record actual numbers in the log.
- **Overflow fix, preferred:** catch in `_hashAndAnalyze`, log at error level with the
  reason, and continue with `needsRelocation: false` (upload as-is; the file still plays,
  just slower to start - today's pre-T1380 behaviour). A real `co64` upgrade changes
  `stco`->`co64` box sizes and therefore every ancestor box size up to `moov` plus the
  delta itself; only do it if it turns out to be a small change, otherwise the fallback
  is enough.
- **After-moov boxes:** decide per evidence - if a phone/GoPro fixture carries a
  meaningful trailing box, include the post-moov region in the reordered layout
  (`ftyp | moov | mdatRegion | trailing`), offsets unaffected since trailing boxes are not
  referenced by `stco`. Otherwise document "dropped, verified harmless".

## Implementation

### Steps
1. [x] Measure `analyzeMp4Faststart` on all four DJI segments, the Legends half, and one
   phone clip; record ms, moov size, `needsRelocation`, table in the Progress Log.
   DONE (supervisor, real Chrome, real files).
2. [x] Reconstruct + `ffprobe`/`ffmpeg` verify the relocated output for the 3.3 GB DJI
   file (Playwright + real files, not jsdom). DONE. Legends needed no reconstruction -
   it's already fast-start, so the upload path uses `file.slice()` directly, nothing to
   reconstruct or verify beyond confirming `needsRelocation: false` (done in step 1).
3. [x] Overflow: unit test that reproduces the throw, then the fallback (upload as-is,
   loud log); assert the upload no longer rejects. DONE (synthetic red→green).
4. [x] After-moov boxes: implemented trailing-region passthrough + synthetic unit test
   (no real phone fixture in container — supervisor confirms on real files if found).
5. [x] One structured diag line per file in `uploadManager` (`[Faststart] relocated=...
   reason=... analysisMs=... moovKB=... fileGB=...`) - frontend log only (no PG/payload).
6. [x] Curated tests: `mp4Faststart.test.js` + `uploadManager.test.js` (+ attachVideo,
   stall) + `useClipUpload.test.js` + `GameFootagePicker.test.jsx` — 77 pass.

### Progress Log

**2026-09-06**: Filed. Discovery that prompted it: while scoping T8832 the user asked
whether client-side moov relocation would be fast enough to be invisible; T1380 already
does it on every upload, but had never been measured on 8K camera files and has an
uncaught overflow throw that can fail an upload outright.

**2026-09-07** (container worker, M-tier hardening, no Architect): implemented the CODE
half. Real-file measurement/ffprobe steps (task steps 1-2, acceptance criteria 1-2)
NOT done here — those files live outside git under `formal annotations/` on the host;
the supervisor closes them in real Chrome. Everything below is proven on SYNTHETIC
fixtures (existing test helpers), which is sufficient proof for code correctness.

- **stco overflow fallback** — caught inside `analyzeMp4Faststart` (chosen over
  `_hashAndAnalyze`: keeps the fallback next to the throw and makes the reason string
  available to the diag line). On the `patchChunkOffsets` throw it logs at error level
  (file name/size + `err.message`, which already carries the exact `offset + delta > 4GB`)
  and returns `needsRelocation:false, reason:'overflow-fallback', newSize=file.size,
  patchedMoov=null` — i.e. upload as-is, the pre-T1380 behaviour (file still plays, just
  no faststart speedup). Downstream `getReorderedSlice` is only reached when
  `needsRelocation` is true, so the null moov never dereferences. **Real red→green
  proven**: stashed the source fix and ran the new test against unfixed code — it rejected
  with the throw; restored the fix — it resolves with `needsRelocation:false`. Did NOT
  attempt a co64 upgrade (task says only if small; it changes every ancestor box size —
  the fallback is enough and much lower risk).
- **After-moov box passthrough** — relocated layout extended from
  `ftyp | moov | mdatRegion` to `ftyp | patched-moov | mdatRegion | trailingRegion`
  (`trailingRegion` = `moov.offset + moov.size` .. EOF). Trailing boxes (udta/meta/skip/
  free) are never referenced by stco/co64 (chunk offsets only point into mdat), so it's a
  straight passthrough — no offset patching. `result.newSize`, `trailingOffset`,
  `trailingSize` added; `getReorderedSlice` gained region 4 and region 3 is now capped at
  `mdatEnd`. Backward compatible: with no trailing box `trailingSize=0` and the layout
  collapses to the old three-region form (existing tests still green). New test builds a
  synthetic MP4 with a real trailing `free` box and asserts full reconstruction now
  includes those bytes byte-for-byte + `newSize` reflects them (this was a real
  red→green: pre-fix `info.trailingSize` was undefined and the bytes were dropped).
  **IMPLEMENTED AND UNIT-TESTED, NOT verified against a real phone/GoPro fixture with a
  real trailing box** — no access to one in the container; supervisor should confirm on
  real files if one is found with a meaningful trailing box.
- **Structured diag line** — one `[Faststart] relocated=<bool> reason=<string>
  analysisMs=<n> moovKB=<n> fileGB=<n.nn>` line per uploaded file in `_hashAndAnalyze`
  (uploadManager.js). `reason` is returned from `analyzeMp4Faststart` (new `result.reason`
  field: `relocated` / `already-faststart` / `tiny-file` / `overflow-fallback` /
  `fragmented-mp4` / `no-ftyp` / `no-moov` / `no-mdat`) rather than re-derived.
  **Decision: frontend-console-only** — no Postgres column, not threaded onto the
  create/attach payload (per task file: "decide during the task, do not add Postgres
  state"; the console line is sufficient for observing production frequency/timing).
- **Timeout attribution (item 4)** — **decision: no second timeout budget.** The existing
  `[DIAG upload-freeze] analyzeMp4Faststart <n>ms` line already prints analysis wall-clock
  BEFORE hashing starts, and the new `[Faststart]` line repeats `analysisMs`. Together they
  answer "which phase was slow" when someone reads the log, so a slow analysis is
  attributable even though it shares `HASH_TIMEOUT_MS` with hashing. Splitting the 120s
  budget would be over-engineering for a phase the scan keeps well under 1s.
- **Tests (curated, ~77)**: `mp4Faststart.test.js` (10, +2 new), `uploadManager.test.js`
  + `.attachVideo` + `.stall` (44), `useClipUpload.test.js` (4), `GameFootagePicker.test.jsx`
  (19) — all pass. Not the whole frontend suite; Branch CI is the full sweep.
  Independently re-verified by the supervisor (not just the worker's own claim): reverted
  `mp4Faststart.js` to the pre-fix commit, confirmed 2/10 tests fail against the real
  production code path, restored the fix, confirmed all 10 pass.

**2026-09-07 (supervisor, real-file verification)**: Ran `analyzeMp4Faststart` in real
Chrome (ES module import, no container) directly against the real fixtures - a lightweight
box-header + moov read, not a full-file read, so this carries none of the resource risk
the T8832 decode runs did.

| File | Size | `analysisTimeMs` | `needsRelocation` | `reason` | moov size |
|---|---|---|---|---|---|
| 0006 (DJI, stco) | 3.326 GB | **6 ms** | true | relocated | 773 KB |
| 0003 (DJI, co64) | 17.184 GB | **15 ms** | true | relocated | 2787 KB |
| Legends 1st half | 1.547 GB | **8 ms** | false | already-faststart | 887 KB |
| Phone clip | 0.003 GB | **2 ms** | true | relocated | 13 KB |

All four to five orders of magnitude under the <1000ms bar. **0003 (17.2 GB) succeeding
with `reason: 'relocated'` (not `overflow-fallback`) confirms `co64` was patched, not
`stco`** - a 17 GB mdat cannot fit in 32-bit `stco` offsets, so the only way this
succeeds is the `co64` branch of `patchChunkOffsets` actually running correctly on a
real camera file's `co64` table. Answers the user's original question directly: **yes,
moving the moov atom client-side is fast enough to be invisible - single-digit to
low-double-digit milliseconds, even on the largest real files this epic targets.**

Reconstructed 0006's full relocated stream (`getReorderedSlice(file, info, 0,
info.newSize)`, saved via a real browser download, not synthesized) and verified:
- **Byte-exact size**: reconstructed file is 3,326,487,100 bytes, identical to the
  original - confirms the relocation is a pure reorder, no bytes added or lost.
- **Box order**: `ftyp@0(28) | moov@28(791608) | free@791636(8) | free@791644(4052) |
  mdat@795696(3325691404)` - moov correctly relocated to immediately after ftyp.
- **ffprobe**: `duration=273.473200s, nb_frames=8196, codec_name=hevc, 7680x4320` -
  identical to the original file's own ffprobe output (verified against the T8830/T8832
  numbers for the same file).
- **`ffmpeg -v error -i reconstructed_0006.mp4 -f null -`**: clean full decode, zero
  errors printed, exit 0.
- Legends needed no reconstruction (already fast-start; the upload path bypasses
  `getReorderedSlice` entirely for that case).
- Trailing-box passthrough remains unit-tested on synthetic fixtures only - **none of
  the real fixtures probed (0006, 0003, Legends, phone clip) actually carry a trailing
  box after moov** (`trailingSize: 0` on every one, confirmed in the table above and in
  T8836's independent box scan), so there is no real fixture available to exercise that
  path end-to-end. Left as an open, low-priority confirmation for if/when a fixture with
  a real trailing box turns up (some GoPro/phone models append `udta` after moov).

## Acceptance Criteria

- [x] Measured analysis time < 1 s on every fixture (3.3 GB and 17 GB DJI, Legends,
      phone), recorded in the Progress Log — **6/15/8/2 ms respectively, 2026-09-07**
- [x] Relocated output for the 3.3 GB DJI file is a valid faststart MP4 (ffprobe
      moov-first, identical frame count, ffmpeg decode clean) — **verified 2026-09-07**;
      Legends needed no reconstruction (already fast-start)
- [x] stco overflow can no longer reject an upload (red-green test) — done, red→green
      proven by the worker AND independently reproduced by the supervisor
- [x] After-moov box behaviour decided with evidence and either implemented or documented
      — trailing-region passthrough IMPLEMENTED + unit-tested (synthetic); no real
      fixture with a trailing box exists among those probed to confirm further
- [x] Structured `[Faststart]` diag line emitted per uploaded file — done (frontend
      console only; no Postgres/payload)
