# T8840: Shrink pipeline core (worker transcode)

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

Turn T8830's proven spike into production code: a Web Worker that takes a source video
File + a crop rect + a preset and produces a smaller MP4 File, streaming (never holding
17 GB in memory), cancelable, and reporting progress.

## Solution

A `shrinkWorker` module implementing demux -> hardware decode -> GPU crop/scale ->
hardware encode -> mux, plus a small main-thread client API. UI (T8850) and upload wiring
(T8860) are separate tasks. See [EPIC.md](EPIC.md) decisions 5-6; T8830's README caveats
are BINDING constraints on this task.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/shrink/shrinkWorker.js` - NEW: the worker
- `src/frontend/src/services/shrink/shrinkClient.js` - NEW: main-thread API
- `src/frontend/src/services/shrink/presets.js` - NEW: preset table + estimator
- `src/frontend/src/services/shrink/capability.js` - NEW: support probe
- `src/frontend/package.json` - add `mp4box` + `mp4-muxer`

### Related Tasks
- Depends on: T8830 (GO verdict + its caveat list; reuse the spike's working demux/
  backpressure code as the starting point)
- Blocks: T8850, T8860

### T8830 binding caveats (from `scripts/shrink-spike/README.md` "Verdict", copied
verbatim 2026-09-06 - final GO WITH CAVEATS, one physical machine tested: Chrome 152 +
Edge 140, i7-13700H / Iris Xe + RTX 4060 Laptop GPU)
1. **Chunked random-access demux is mandatory.** Real camera files are non-fast-start
   (mdat before moov); a sequential streaming demux cannot work, and a single-shot
   `file.arrayBuffer()` fails in Chrome at 3.3 GB. Locate moov by top-level box hopping,
   parse the sample table, then `file.slice()` per sample/chunk.
2. **Use mp4box >= 2.4.1** (0.5.x mis-parses >2 GB atoms) and give `VideoEncoder` an
   explicit `colorSpace` (mp4-muxer crashes at finalize without one).
3. **Backpressure off `decoder.decodeQueueSize` / `dequeue`, cap >= 32.** A small
   hand-rolled in-flight count deadlocks against the hardware decoder's pipeline depth.
4. **Encode-bound, not decode-bound.** 1080p and 8K sources both land at ~42-123 fps
   into the same output target - the preset's OUTPUT size drives shrink time, not the
   input resolution (T8850's live time estimates should key off output pixels x bitrate).
5. Speed was verified on only one physical machine (above-average discrete GPU); a
   second machine was not available for T8830. Ordinary users' hardware is unverified by
   that spike - closed by caveat 6, not by more dev-machine sampling.
6. **`canShrink()`/`isConfigSupported` answers capability, not speed - do not treat
   "supported" as "fast enough."** Since the pipeline is encode-bound (#4), a weaker
   device can pass the capability check in `capability.js` and still run far below
   realtime. This task must add a real per-device runtime speed probe (time a short
   real decode+encode sample - a second or two of actual footage - on the user's own
   device before committing to the full client-side shrink) and fall back to
   server-side Modal processing when the probe comes back too slow. This is how T8830's
   single-machine gap gets closed in production: measuring every real user's device at
   runtime, rather than pre-sampling enough dev hardware to stand in for it.

### Technical Notes
- Presets (`presets.js`), applied AFTER crop: `sharpest` (cap output width 3840,
  ~24 Mbps), `recommended` (cap 2688, ~12 Mbps), `smallest` (cap 1920, ~7 Mbps). Never
  upscale: output = min(cap, crop width), height follows aspect, both rounded DOWN to
  even numbers. Estimator: `bitrate * duration / 8` + 2% mux overhead, returned in bytes.
- Crop rect arrives normalized (0..1 of source frame); clamp so width/height >= 0.1.
- Audio: copy-through - route the source audio track's samples straight from mp4box to
  mp4-muxer without touching WebCodecs audio. If copy-through fights the muxer, fallback
  is AAC re-encode via `AudioEncoder` at 128 kbps - but try copy first.
- Worker protocol (postMessage): in `{cmd:'start', file, crop, preset}` / `{cmd:'cancel'}`;
  out `{type:'progress', framesDone, framesTotal, fps}` (throttle to ~2/s),
  `{type:'done', file}` (a File made from the mux Blob, named `{orig-stem}.shrunk.mp4`),
  `{type:'error', stage, message}`. Cancel must close decoder/encoder and release all
  VideoFrames (no leaked GPU memory - verify via `chrome://gpu` memory or task manager
  during a cancel test).
- `capability.js`: `canShrink(codecString, width, height)` -> cached Promise<boolean>
  using `VideoDecoder.isConfigSupported` + `VideoEncoder.isConfigSupported` for the
  chosen output config. This is the ONLY gate T8850 consults (EPIC decision 6).
- Keyframe cadence for output: force a key frame every 2 seconds (`keyFrame: true` on the
  encode call at interval) so later seek/annotate behavior on the uploaded file is sane.
- The output file goes through the EXISTING upload path (hash, dedupe, probe) untouched -
  from the backend's perspective it is just a video file.

## Implementation

### Steps
1. [ ] Port the spike's demux + backpressure loop into `shrinkWorker.js` behind the
   message protocol; add crop/scale (OffscreenCanvas 2D; note in a comment that WebGPU is
   a later optimization, not v1).
2. [ ] Implement audio copy-through; verify A/V sync on the output of the small DJI
   segment (play the result, listen: whistle matches picture).
3. [ ] Implement `presets.js` with the table + estimator and unit tests (pure math).
4. [ ] Implement `shrinkClient.js`: `shrinkFile(file, crop, preset, {onProgress, signal})`
   -> Promise<File>, wrapping the worker, one worker per call, AbortSignal -> cancel.
5. [ ] Implement `capability.js` with a 'result memoized per codec string' cache. Also
   add a runtime speed probe (short real decode+encode sample) so a device that passes
   the capability check but is too slow triggers a Modal server-side fallback instead
   of silently running client-side at an unusable speed (T8830 caveat 6).
6. [ ] Tests: presets math unit tests; a worker-protocol test with a mocked worker
   (message sequencing, cancel path, error propagation). Real-decode paths are covered by
   a MANUAL verification checklist in the task file (run on the real DJI segment:
   completes, plays, A/V sync, cancel mid-run leaves no stuck GPU memory) - jsdom cannot
   exercise WebCodecs, do not fake it (harness-must-match-production rule).

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] Real DJI segment 0006 (3.3 GB) shrinks to a playable MP4 within 15% of the
      estimator's predicted size, A/V in sync
- [ ] Cancel mid-shrink terminates within 2s and frees resources
- [ ] Progress events arrive throttled with sane fps numbers
- [ ] `canShrink` returns false gracefully on a Firefox run (manual check) - no throw
- [ ] A device that passes the capability check but probes below the speed threshold
      falls back to Modal server-side processing instead of running client-side (T8830
      caveat 6)
- [ ] Unit tests green; manual checklist executed and recorded in the Progress Log
