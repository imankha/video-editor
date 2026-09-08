# T8840: Standalone browser shrink tool (fully working, zero app integration)

**Status:** WAITING ON USER
**Impact:** 7
**Complexity:** 7
**Created:** 2026-09-05
**Updated:** 2026-09-08

## Problem

**Re-scoped 2026-09-07 (user direction):** the shrink feature must NOT be integrated
into the app until it can be tested COMPLETELY, on its own, as a separate tool that
shrinks video from the browser - fully working, end to end, on real camera folders.
T8830/T8832/T8834 proved the pieces (speed, streaming with flat memory, faststart
relocation); nobody has run the whole pipeline - audio, crop, presets, streaming output,
checkpointing, cancel - on a real 50 GB game, and the one time a full-file decode+encode
ran it pegged the dev laptop until the user killed it. The user wants to drive the
finished pipeline themselves, on their own files and on other machines, and inspect the
output in a normal player before a single line of it touches the app.

This was previously scoped as `src/frontend/src/services/shrink/shrinkWorker.js`
(in-app worker module). That is now **T8845** (port the approved tool into the app), and
it does not start until the user has tested this tool and said so.

## Solution

A self-contained page under `scripts/shrink-tool/` (served from the repo root like the
spike; never imported by app code, imports nothing from the app except the plain-ESM
`mp4Faststart.js` the spike already reuses) that does the WHOLE job:

pick a camera folder -> segments listed with `.LRF` proxy previews -> ONE crop rect drawn
on a preview frame (applies to every segment) -> preset (Sharpest / Recommended /
Smallest) with a size + time estimate -> runtime speed probe (a few seconds of real
decode+encode on THIS device; refuse with a clear verdict if too slow) -> Start ->
per-segment demux (T8832 faststart view) -> hardware decode -> crop/scale -> hardware
encode -> mux with audio copy-through, output STREAMED to OPFS (never in memory) ->
per-segment progress (frames, fps, ETA) -> Cancel -> resume after a reload (finished
segments survive) -> Save each shrunk MP4 to disk -> built-in playback check.

The pipeline is written as portable ESM modules (`scripts/shrink-tool/pipeline/*.js`:
demux, decode, cropScale, encode, mux, checkpoint, probe, presets) with no DOM
dependencies, so T8845 can port them into the app worker mechanically once approved.
The page (`index.html` + `tool.js`) is the only DOM code. See [EPIC.md](EPIC.md)
decisions 5-6; the caveats below are BINDING.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/index.html`, `tool.js` - NEW: the standalone page (file/folder
  input, segment list with proxy previews, crop rect, preset chips, estimate, probe
  verdict, progress, cancel/resume, save, playback check)
- `scripts/shrink-tool/pipeline/demux.js` - NEW: T8832's faststart-view forward
  streaming (32 MB chunks, `releaseUsedSamples`), video AND audio sample extraction
- `scripts/shrink-tool/pipeline/decode.js`, `cropScale.js`, `encode.js` - NEW: the
  T8830 pipeline stages behind the backpressure cap
- `scripts/shrink-tool/pipeline/mux.js` - NEW: mp4-muxer with a streaming OPFS target,
  audio copy-through, DJI metadata tracks dropped
- `scripts/shrink-tool/pipeline/checkpoint.js` - NEW: per-segment OPFS state (done /
  in-progress / output handle) so a reload resumes
- `scripts/shrink-tool/pipeline/probe.js` - NEW: capability (`isConfigSupported`, shared
  logic with T8838) + the runtime speed probe
- `scripts/shrink-tool/pipeline/presets.js` - NEW: preset table + size/time estimator
- `scripts/shrink-tool/package.json` - `mp4box` (2.4.1 exact) + `mp4-muxer`, local only
- `scripts/shrink-tool/README.md` - how to run, the test recipe, results per machine
- `scripts/shrink-spike/` - stays as the benchmark; the tool supersedes it for real use
- `src/frontend/src/utils/mp4Faststart.js` - READ ONLY, reused as in T8832

### Related Tasks
- Depends on: T8830 (GO verdict + its caveat list; reuse the spike's working
  backpressure/encode/mux code as the starting point) AND T8832 (full-file streaming
  proof, DONE 2026-09-07 - its verdict replaces caveat 1 below)
- Blocks: T8845 (port into the app - starts ONLY after the user has tested this tool),
  and through it T8850, T8860
- Related: T8838 (capability census, DONE 2026-09-07). `src/frontend/src/utils/shrinkCapability.js`
  now EXISTS and is deliberately PLAIN ESM (no `config`/`apiFetch`/store imports) so this tool can
  reuse it directly: `pipeline/probe.js` should `import { probeShrinkCapability, deriveCodecFamily,
  deriveResBucket }` from it for the codec-string + `isConfigSupported` logic instead of
  re-implementing — keep it one function. Only the runtime speed probe is new here.

### T8830/T8832 binding caveats (from `scripts/shrink-spike/README.md` "Verdict",
updated 2026-09-07 with T8832's real-hardware proof)
1. **Demux via T1380's faststart-ordered forward streaming - NOT random-access.**
   PROVEN on real hardware (T8832, 2026-09-07): reuse `src/frontend/src/utils/
   mp4Faststart.js` (`analyzeMp4Faststart` + `getReorderedSlice`) to get a zero-copy
   logical `ftyp | patched-moov | mdat` view of the file regardless of its original
   layout, then feed the decoder fixed-size **32 MB** chunks of that view via
   `.slice(start, end)`, moving strictly forward - no random access, no file rewrite,
   no sample-table walking needed. Use `setExtractionOptions(trackId, null,
   {nbSamples: 100})` + `releaseUsedSamples` every 100 samples to keep mp4box's own
   buffer list bounded (proven: max 1 buffer retained across a 42,264-sample, 320 s
   run on the real 17.2 GB DJI file - peak JS heap 200.8 MB, no upward slope across
   11 throughput buckets). Backpressure cap 32 in-flight frames (unchanged from T8830).
   The original "chunked random-access demux... a substantial, real piece of
   engineering" plan is NOT needed - this is simpler and already proven correct and
   memory-flat at real GB-scale. See `scripts/shrink-spike/README.md` "Verdict for
   T8840" for the full writeup.
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
7. **The muxer must STREAM its output - never `fastStart: 'in-memory'`.** (Added
   2026-09-07 from the readiness review.) The spike's `mp4-muxer` config buffers the
   ENTIRE output in a tab `ArrayBuffer` until `finalize()`. A 17 GB segment shrunk to
   12 Mbps is ~2.1 GB of output held in memory - the one thing T8832's decode-only run
   structurally could not reveal. Use a streaming target (`FileSystemWritableFileStream`
   into OPFS, or `StreamTarget` with chunked writes) with `fastStart: false`. The
   resulting moov-at-end output is fine: the upload path relocates moov via T1380 in
   6-15 ms anyway (T8834), so the shrunk file still lands on R2 fast-start.
8. **Drop DJI's metadata tracks in the mux.** (T8836 row 4.) `djmd` + `dbgi` (DJI debug
   telemetry) + `tmcd` are ~2.7% of every DJI segment (424 MB on the 17.2 GB file) and
   the app never reads them. The shrink re-muxes from scratch anyway, so only carry the
   video track and the primary audio track into the output - nearly free here, not
   worth a standalone step elsewhere.
9. **Per-segment checkpointing.** A 50 GB game is ~an hour of pegged machine; losing it
   all on a tab close is not acceptable. Segments are the natural unit (T8860's two-slot
   design already implies it): each finished segment's output must survive a reload
   (OPFS, from caveat 7), and resume must skip finished segments.
10. **Expectation-setting is part of the feature, not T8850 polish.** The real 3.3 GB
    decode+encode run pegged the dev laptop within 30 s (user had to kill it). Surface
    "about {t}, your computer will be busy" before starting, and emit progress that
    T8850/T8860 can show; consider `requestIdleCallback`-style yielding only if it
    doesn't tank throughput (measure, don't assume).
11. **`capability.js` reuses T8838's probe module** (codec string via mp4box ftyp+moov,
    the two `isConfigSupported` calls) rather than re-implementing it - T8838 is the
    first real use, this is the second. LANDED: `src/frontend/src/utils/shrinkCapability.js`
    exports `probeShrinkCapability(file, faststartInfo) -> {decode, encode, codecFamily,
    resBucket, codec, width, height}` plus the pure `deriveCodecFamily(codec)` /
    `deriveResBucket(height)` helpers. It is PLAIN ESM (no config/apiFetch/store imports;
    reporting is injected via a `report(name)` callback in `probeAndReport`), so this
    standalone tool can import it directly. Build `canShrink()` on top of
    `probeShrinkCapability`'s `decode`/`encode` fields (both must be `'yes'`) - do NOT copy
    the codec-string or `isConfigSupported` logic.

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
0. [ ] **Proof checkpoint FIRST (go/no-go before anything else is built):** in the
   throwaway spike (`scripts/shrink-spike/`, streaming mode), add (a) audio copy-through
   (mp4box audio samples -> mp4-muxer audio track, no `AudioEncoder`) and (b) a
   streaming muxer target (caveat 7) with the output written to OPFS, then run the FULL
   17.2 GB DJI segment decode+encode+mux **unattended** (it pegs the machine - run it
   when nobody needs the laptop, or overnight). Pass = completes, output plays with
   audio in sync (whistle matches picture), tab heap flat, OPFS file ~2.1 GB, no
   thermal collapse in the per-bucket fps over ~20 minutes. Also time the **Sharpest**
   preset (3840-wide, 24 Mbps) on the 25 s trim in the same session - encode-bound
   means it is the slow case and T8850's estimates need the number. A fail here
   re-scopes the task; do not build steps 1-6 on an unproven muxer/audio path.
   **Also required (added 2026-09-07, design doc R11):** a visual side-by-side of the
   source frame against the Sharpest-preset H.264 output (the default, per EPIC decision
   5) at matched viewing size,
   checking BOTH color (R3 - BT.2020/HLG source into an sRGB canvas tagged bt709 can
   wash out or shift color) AND compression artifacts (R11 - H.264 is less efficient
   than the source's 10-bit HEVC at the same bits-per-pixel, so a preset that targets
   the source's own bpp is not guaranteed equivalent quality, just equivalent density).
   Use real footage with grass texture, motion, and skin tones - where softness/blocking
   shows first. If either check fails, the fix is a constant change in `presets.js`
   (raise the affected preset's bitrate, or add an explicit canvas colorSpace) - never a
   new user-facing setting, per the standing rule that quality-neutral optimizations are
   silent and only framing (crop) is the user's call.
1. [ ] `pipeline/demux.js` + `decode.js` + `cropScale.js` + `encode.js`: the T8832
   faststart view + 32 MB forward chunks (caveat 1, never random access), backpressure
   cap 32, crop rect applied in `drawImage` (OffscreenCanvas 2D; WebGPU is a later
   optimization, not v1). Audio samples extracted alongside video.
2. [ ] `pipeline/mux.js`: mp4-muxer with a streaming OPFS target (caveat 7), audio
   copy-through, only video + primary audio carried (caveat 8). A/V sync verified on the
   small DJI segment by ear (whistle matches picture).
3. [ ] `pipeline/presets.js`: the table + size/time estimator (time keys off OUTPUT
   pixels x bitrate, caveat 4, with the step-0 Sharpest number) + pure-math unit tests.
4. [ ] `pipeline/checkpoint.js`: per-segment OPFS state; reload mid-run resumes at the
   first unfinished segment; Cancel closes decoder/encoder, releases every VideoFrame
   (verify no stuck GPU memory in Chrome Task Manager), keeps finished segments.
5. [ ] `pipeline/probe.js`: capability check (shared with T8838) + runtime speed probe
   (a few seconds of real decode+encode on this device -> realtime multiplier -> clear
   "this computer is too slow for this, upload the originals instead" verdict below a
   threshold; there is no Modal in the tool, so the verdict is the fallback).
6. [ ] `index.html` + `tool.js`: folder/file input; segment list ordered by embedded
   recording time with `.LRF` proxy preview frames (T8836 measured 224 ms/frame); ONE
   crop rect (drag/resize, min 10% per axis, stays put across segments); preset chips with
   live estimate; expectation copy ("about {t}; your computer will be busy"); Start /
   Cancel / Resume; per-segment progress (frames, fps, ETA); Save each output via
   `showSaveFilePicker` (fallback: download link); playback check per output.
7. [ ] README: how to run (serve repo root, open `/scripts/shrink-tool/`), the test
   recipe the user follows (below), and a results table with one row per machine tested.
8. [ ] Tests: presets math + name/estimate unit tests; checkpoint state machine unit
   tests (pure); a headless smoke on the synthetic non-fast-start fixture (frame-count
   equivalence with the spike, output plays). Real-decode paths are covered by the
   user's own manual run on real files - jsdom cannot exercise WebCodecs, do not fake it.

### User test recipe (what "fully working" means - the acceptance bar)
1. Serve the repo root, open the tool on the dev laptop. Pick the real DJI folder
   (4 segments, 50 GB). Segments appear in the right order with proxy previews.
2. Draw a crop around the field on segment 1; flip through the other segments' previews -
   the rect stays put. Pick Sharpest (the default, 2026-09-07 - Recommended visibly
   softened player detail in a real side-by-side, see EPIC decision 5). Estimate shows
   a size and a time.
3. Start. The probe runs (seconds), then segments shrink one by one with live progress.
   The machine WILL be busy - that is expected and the copy says so.
4. Mid-run: reload the tab. The tool resumes at the first unfinished segment; finished
   ones are still there. Cancel once; Resume once.
5. When done: Save all four outputs. Open them in any player: they play, audio is in
   sync, the crop is right, they are ~3-12 GB total (not 50).
6. Repeat steps 1-5 on a second machine (any ordinary laptop, a Mac if available) - the
   tool is a folder, nothing to install beyond `npm install` + `npx serve`.
7. Try Sharpest on one segment; try the Legends file (should refuse or warn: bitrate
   already below every preset, per EPIC decision 4).

### Progress Log

**2026-09-05**: Filed.

**2026-09-08**: Design approved and amended (R11: H.264 vs HEVC quality; Sharpest made the
default preset per real player-detail crops, see EPIC decision 5). Implementation built
against the synthetic fixture, then put through a 3-lens parallel Reviewer fan-out
(Correctness, Persistence & State, Performance) which found 3 BLOCKING bugs (backpressure
deadlock on any encode-bound machine, `outputBytes` corruption that deleted finished
segments on reload, mux `strict`-mode throw on staggered A/V timestamps) and 9 MAJOR
issues, all fixed and independently re-verified (several via live Chromium reproductions).
A further self-directed review round found 2 more real issues (flush-window error
routing, unbounded progress-log growth), also fixed. All 16 MINOR findings from the
original review addressed. Merged to master (PR #368) - the one CI failure
(`profileStore.test.js`/`useIntroCardStore`) is the pre-existing, unrelated
full-suite-parallelism flake already logged in `docs/testing/known-failures.md` from the
T8838 merge. Full mechanism (demux/decode/crop/encode/mux/checkpoint/cancel/resume) is
proven on the synthetic fixture; nothing under `scripts/shrink-tool/` is imported by app
code (grep-confirmed). What remains is explicitly out of reach for any test harness: the
real 50 GB DJI folder, a second machine, and the R11 quality A/B - that is what the
acceptance criteria below still need, and it is the user's own call, never the AI's.

## Acceptance Criteria

- [ ] **The user has run the full test recipe above on the real 50 GB DJI folder and on
      at least one other machine, and says the tool works** - this is the gate for T8845
- [ ] All four real DJI segments shrink to playable MP4s within 15% of the estimator's
      predicted size, A/V in sync, crop correct; outputs streamed to OPFS (tab heap flat
      for the whole run, no in-memory output buffer)
- [ ] Reload mid-run resumes; Cancel terminates within 2 s and frees resources (no
      stuck GPU memory)
- [ ] Progress is live and honest (frames, fps, ETA); expectation copy shown before Start
- [ ] Speed probe refuses on a too-slow device with a clear verdict; capability check
      returns false gracefully on Firefox (manual check) - no throw
- [x] Nothing under `scripts/shrink-tool/` is imported by app code (grep-confirmed)
- [ ] A device that passes the capability check but probes below the speed threshold
      falls back to Modal server-side processing instead of running client-side (T8830
      caveat 6)
- [x] Unit tests green (34/34) and the headless synthetic-fixture smoke test green
      (32/32 mechanism checks) - the manual real-hardware checklist is still open, to be
      recorded here after the user's own run
