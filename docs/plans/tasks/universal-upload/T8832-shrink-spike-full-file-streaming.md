# T8832: Shrink spike part 2: full-file streaming demux on real camera files (memory + endurance)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

T8830 proved the SPEED half of the shrink bet (decode+encode of real 8K 10-bit HEVC runs at
1.4-1.5x realtime) using a 25 s `-c copy` trim. It deliberately did NOT prove the other
half: that a browser tab can stream a real 3-17 GB camera file through the pipeline
start-to-finish without running out of memory or degrading over minutes of decoding.
Two facts from T8830 make that a real, unproven risk rather than a formality:

- A single-shot `file.arrayBuffer()` on the 3.3 GB file fails in Chrome
  (`NotReadableError`), so "read it all then process" is off the table.
- Real DJI files are non-fast-start: `ftyp | free | free | mdat (3.3 GB) | moov (773 KB)`
  (top-level box scan of `DJI_20260718120831_0006_D.MP4`, 2026-09-06). A forward-only
  streaming demux never sees the sample table until the whole payload has gone by.

Today T8840 (complexity 7) inherits "chunked random-access demux is mandatory" as caveat 1,
an approach nobody has run. If it has a problem (a different Chromium memory ceiling,
mp4box retaining appended buffers, GC pressure or decoder-queue drift over a 4-45 minute
run), T8840 finds out AFTER building audio copy-through, cancellation, the worker protocol
and presets on top of it. Same reasoning that spun T8830 out in the first place: prove or
kill it BEFORE building the pipeline.

**The likely answer already exists in the app (found 2026-09-06):** T1380 shipped
client-side moov relocation for every upload, `src/frontend/src/utils/mp4Faststart.js`:
`analyzeMp4Faststart(file)` scans top-level box headers only, reads + patches the moov
(`stco`/`co64` += moovSize), and `getReorderedSlice(file, info, start, end)` returns a
zero-copy `Blob` view of the faststart-ordered file (`ftyp | patched moov | mdat region`).
Feeding mp4box's `appendBuffer` with fixed-size chunks taken from THAT view means moov
arrives first and every sample streams forward - ordinary sequential demux, no random
access, no rewrite of the file, no new parsing code. This spike's main job is to prove
(or disprove) that this is the demux T8840 should use.

## Solution

Extend the throwaway `scripts/shrink-spike/` page (still never imported by app code) with a
**streaming mode** that runs on the FULL real files, reports memory + throughput over time,
and writes a verdict that rewrites T8840's caveat 1 into a proven approach.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-spike/spike.js` - add streaming mode (chunked `appendBuffer` over the
  faststart view; decode-only and decode+encode toggles; memory + per-bucket fps report)
- `scripts/shrink-spike/index.html` - mode toggle + chunk-size input
- `scripts/shrink-spike/README.md` - new results tables + the verdict
- `src/frontend/src/utils/mp4Faststart.js` - READ ONLY, reused as-is (plain ESM, no
  imports; serve from the repo root - `npx serve` at repo root, open
  `/scripts/shrink-spike/` - so `../../src/frontend/src/utils/mp4Faststart.js` resolves).
  The rule is that APP code never imports the spike; the spike importing an app util is
  fine.
- `docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md` - caveat 1 rewritten
  from this spike's verdict

### Related Tasks
- Depends on: T8830 (GO WITH CAVEATS; its harness + README are the starting point)
- Blocks: T8840 (caveat 1 is unproven until this lands)
- Related: T1380 (client-side faststart, the reorder view), T8834 (verifies/hardens T1380
  itself on real camera files - independent, can run in parallel)

### Technical Notes
- **Feeding pattern:** `for (off = 0; off < info.newSize; off += CHUNK)` ->
  `buf = await getReorderedSlice(file, info, off, off+CHUNK).arrayBuffer()`;
  `buf.fileStart = off`; `mp4boxFile.appendBuffer(buf)`. Await backpressure between
  chunks exactly as T8830 does per sample (`decodeQueueSize`/in-flight cap 32). Try
  CHUNK = 8 MB and 32 MB; report both.
- **mp4box's own memory is the classic leak:** it keeps appended buffers until the samples
  in them are extracted and released. Use `setExtractionOptions(trackId, null,
  {nbSamples: N})` with small N and call `mp4boxFile.releaseUsedSamples(trackId,
  lastSampleNum)` after each `onSamples` batch; confirm heap stays FLAT across the run.
  If it climbs, that is the finding - report it, do not paper over it.
- **Memory measurement:** `performance.measureUserAgentSpecificMemory()` (needs
  cross-origin isolation headers; `serve` can send them via `serve.json`) with
  `performance.memory.usedJSHeapSize` as the fallback; sample every 5 s and report peak +
  final. Also watch Chrome Task Manager's GPU memory during a decode+encode run (VideoFrame
  leaks show there, not in the JS heap).
- **Endurance:** report end-to-end fps per 30 s bucket, not just the total. A flat line
  is the pass; a downward slope over the 4.6-minute 0006 file (or the 45-minute-class 17 GB
  0003 file) is a finding for T8840 even if the average clears 0.5x.
- **Test files (real, local):** `formal annotations/u14 adonis/ECNL Test - DJI Action 6/`
  `DJI_20260718120831_0006_D.MP4` (3.3 GB, 32-bit mdat size, moov 773 KB at EOF) AND
  `DJI_20260718105543_0003_D.MP4` (17.2 GB, 64-bit extended mdat size, `co64` offsets -
  the case T8840's "never 17 GB in memory" note is about). Control:
  `formal annotations/u14 phillips/9.20.LEGENDS/wcfc-vs-legends-fc-san-diego-1st-half-2025-09-20.mp4`
  (full first half, H.264 1080p). No trims this time.
- **Decode-only toggle** isolates demux+decode memory behaviour from the encoder; run it
  first on the 17 GB file. Then the full decode+encode run on 0006 with playback check.
- Run with no worker containers up (T8830 handoff: Docker Desktop crashed once while the
  8K benchmark ran alongside two containers).
- If the faststart-view approach fails for a reason intrinsic to it (not a harness bug),
  fall back to the random-access design in T8830's README ("Demux architecture") and
  prove THAT instead - the verdict must name one proven approach either way.

## Implementation

### Steps
1. [ ] Add streaming mode to `spike.js` (faststart view via `analyzeMp4Faststart` +
   `getReorderedSlice`, chunked `appendBuffer`, `releaseUsedSamples`, decode-only /
   decode+encode toggle, chunk-size input, memory sampler, per-bucket fps).
2. [ ] Decode-only run on the 17.2 GB 0003 file: completes, frames decoded == sample
   count from moov, peak heap + slope recorded.
3. [ ] Decode+encode run on the full 3.3 GB 0006 file: completes, output muxed + plays,
   throughput within 20% of T8830's 25 s number for the same browser, per-bucket fps flat.
4. [ ] Legends full first half as control (same two runs).
5. [ ] README: new "Full-file streaming" results table (file, size, mode, chunk size,
   peak heap, final heap, avg fps, min bucket fps, verdict) + a written verdict naming
   the proven demux approach for T8840.
6. [ ] Rewrite T8840 caveat 1 from the verdict (approach, chunk size, release pattern,
   cap) and tick this task's acceptance boxes.

### Progress Log

**2026-09-06**: Filed after T8830 landed (user direction: prove the full-file streaming
question in isolation before T8840 starts). Same day, found that T1380's
`mp4Faststart.js` already provides the zero-copy faststart view this needs - the spike
should reuse it rather than write a random-access demuxer.

## Acceptance Criteria

- [ ] The 17.2 GB DJI file decodes start-to-finish in a tab with peak JS heap under
      ~1 GB and no upward slope (decode-only run)
- [ ] The full 3.3 GB DJI file runs decode+encode start-to-finish, output plays, average
      throughput within 20% of T8830's trim result, no per-bucket degradation
- [ ] Control (Legends full half) passes both runs
- [ ] README results table + verdict written; T8840 caveat 1 rewritten to the PROVEN
      approach (faststart view + forward streaming, or random-access if that failed)
- [ ] Nothing from the spike is imported by app code (the reverse - spike importing
      `mp4Faststart.js` - is fine)
