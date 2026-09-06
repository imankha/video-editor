# T8830: Shrink spike: WebCodecs 8K benchmark (go/no-go)

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-05
**Updated:** 2026-09-06

## Problem

The shrink feature (T8840-T8860) bets that a browser can hardware-decode 8K 10-bit HEVC,
crop, and re-encode at a usable speed on ordinary machines. Estimated 0.5x-1.5x realtime,
but that number is a guess. Prove or kill it BEFORE building the pipeline.

## Solution

A throwaway benchmark page (not shipped to users) that runs the real pipeline on the real
DJI file and prints throughput. See [EPIC.md](EPIC.md) decision 6 for the gating model
this validates.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-spike/index.html` - NEW: standalone page (no app integration)
- `scripts/shrink-spike/spike.js` - NEW: the benchmark
- `scripts/shrink-spike/README.md` - NEW: how to run + results table

### Related Tasks
- Blocks: T8840, T8850, T8860 (a NO-GO verdict sends those back to the user for re-scope)

### Technical Notes
- Test file: `formal annotations/u14 adonis/ECNL Test - DJI Action 6/DJI_20260718120831_0006_D.MP4`
  (the 4.6-minute, 3.3 GB segment - big enough to measure, small enough to iterate).
  Specs: 7680x4320, 10-bit HEVC (`hev1`/`hvc1` codec string from the file), ~30fps.
- Dependencies via npm in the spike folder only (never added to the app bundle):
  `mp4box` (demux) and `mp4-muxer` (mux). Serve locally (`npx serve` or the vite dev
  server pointed at the folder) - file:// will not work for module scripts.
- Pipeline to time, stage by stage: streaming demux (File.slice through mp4box's
  appendBuffer) -> `VideoDecoder` -> crop+scale via `OffscreenCanvas.drawImage` into a
  target-size canvas -> `VideoEncoder` (try `avc1.640033` first at 12 Mbps, 2688-wide
  output; also try HEVC encode if `isConfigSupported` says yes) -> mux -> Blob. Audio:
  skip entirely in the spike.
- Backpressure is the classic trap: cap in-flight decoded frames (pause demux appends
  when `decoder.decodeQueueSize > 8` or an in-flight counter exceeds ~8; resume on
  output). Always `frame.close()` after encoding.
- Capability probe FIRST: `VideoDecoder.isConfigSupported({codec, codedWidth: 7680,
  codedHeight: 4320})` with the exact codec string mp4box reports; print the verdict
  before any work.

## Implementation

### Steps
1. [ ] Build the page: file input, Run button, and a results `<pre>` that reports:
   support verdict, frames decoded, wall seconds, decode fps, end-to-end fps,
   realtime multiplier (fps / 29.97), output size, and output playability (attach the
   result Blob to a `<video>` and play 5 seconds).
2. [ ] Run on at least 2 real machines (the dev desktop + one laptop) in Chrome, and once
   in Edge. Record every row in README.md: CPU/GPU, OS, browser version, support verdict,
   realtime multiplier per stage.
3. [ ] Also measure the Legends 1080p-class file as a control (should be far above
   realtime; if it is not, the pipeline has a bug, not a hardware limit).
4. [ ] Write the verdict in README.md and the Progress Log here:
   - GO: end-to-end >= 0.5x realtime on at least one ordinary machine.
   - GO WITH CAVEATS: works but only via specific settings (e.g. H.264-only encode,
     smaller output) - list them; T8840 inherits them as constraints.
   - NO-GO: unsupported or < 0.25x realtime everywhere -> STOP, set the epic's shrink
     tasks to WAITING ON USER with the numbers.

### Progress Log

**2026-09-05**: Filed.

**2026-09-06**: Harness built by an automated worker (branch
`feature/T8830-shrink-spike-benchmark`, CI green) — index.html/spike.js/README.md per
spec, including the full demux -> decode -> crop/scale -> encode -> mux pipeline with
backpressure capping. A headless container cannot satisfy this task's real acceptance
criteria (2+ real machines, the real 3.3 GB DJI file, hand-recorded results), so the
worker's scope was limited to scaffolding + a smoke test on a small synthetic fixture
(125/125 frames decoded+encoded, output played back in headless Chromium — fixed a
concurrent-callback deadlock in the backpressure resolver and a module-loading issue along
the way). **Waiting on the user** to run the harness per README.md on real hardware with
the real DJI file and report GO / GO WITH CAVEATS / NO-GO before T8840 starts.

## Acceptance Criteria

- [ ] README.md contains a filled results table from >= 2 machines + the verdict
- [ ] The output Blob plays in a video element (proves mux correctness, not just speed)
- [ ] Nothing from this spike is imported by app code
- [ ] Verdict + numbers reported to the user before any T8840 work starts
