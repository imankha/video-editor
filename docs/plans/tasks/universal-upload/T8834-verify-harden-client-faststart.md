# T8834: Verify + harden T1380 client-side faststart on real camera files

**Status:** TODO
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
1. [ ] Measure `analyzeMp4Faststart` on all four DJI segments, the Legends half, and one
   phone clip; record ms, moov size, `needsRelocation`, table in the Progress Log.
2. [ ] Reconstruct + `ffprobe`/`ffmpeg` verify the relocated output for the 3.3 GB DJI
   file and the Legends half (Playwright + real files, not jsdom).
3. [ ] Overflow: unit test that reproduces the throw, then the fallback (upload as-is,
   loud log); assert the upload no longer rejects.
4. [ ] After-moov boxes: scan the phone fixture(s); implement trailing-region passthrough
   if warranted, else document.
5. [ ] One structured diag line per file in `uploadManager` (`[Faststart] relocated=...
   reason=... analysisMs=... moovKB=... fileGB=...`) - frontend log only unless the task
   finds a reason to carry it on the create payload.
6. [ ] Curated tests: `mp4Faststart.test.js` + `uploadManager.test.js` + the relevant
   T8810 picker/upload tests.

### Progress Log

**2026-09-06**: Filed. Discovery that prompted it: while scoping T8832 the user asked
whether client-side moov relocation would be fast enough to be invisible; T1380 already
does it on every upload, but had never been measured on 8K camera files and has an
uncaught overflow throw that can fail an upload outright.

## Acceptance Criteria

- [ ] Measured analysis time < 1 s on every fixture (3.3 GB and 17 GB DJI, Legends,
      phone), recorded in the Progress Log
- [ ] Relocated output for the 3.3 GB DJI file and the Legends half is a valid faststart
      MP4 (ffprobe moov-first, identical frame count, ffmpeg decode clean, seeks in
      `<video>`)
- [ ] stco overflow can no longer reject an upload (red-green test)
- [ ] After-moov box behaviour decided with evidence and either implemented or documented
- [ ] Structured `[Faststart]` diag line emitted per uploaded file
