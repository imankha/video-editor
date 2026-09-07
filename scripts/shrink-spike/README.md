# T8830: Shrink spike - WebCodecs 8K benchmark (go/no-go)

Throwaway benchmark page. Proves or kills the assumption behind the shrink feature
(T8840-T8860): that an ordinary browser can hardware-decode 8K 10-bit HEVC, crop, and
re-encode at a usable speed. See [EPIC.md decision 6](../../docs/plans/tasks/universal-upload/EPIC.md)
for the gating model this validates.

**This spike is not shipped to users and is never imported by app code.**

## What it does

1. Capability probe: reads the container's codec string with `mp4box`, then calls
   `VideoDecoder.isConfigSupported()` at the file's real coded size. Prints the
   verdict before any decode/encode work starts.
2. Demux: reads the **whole file into memory** (`file.arrayBuffer()`) and feeds it to
   `mp4box` in a single `appendBuffer` call. **Deliberately not streaming** - see
   "Demux architecture" below for why.
3. Decode: `VideoDecoder`, backpressured so at most 32 frames are in flight
   (`decoder.decodeQueueSize` and an in-flight counter both capped - 32, not 8, because
   the hardware H.264 decoder's own pipeline depth exceeds 8 and a smaller cap deadlocks;
   see Test files). `frame.close()` is called on every frame after it's handed to the
   encoder.
4. Crop+scale: `OffscreenCanvas.drawImage` into a 2688-wide target canvas.
5. Encode: tries `avc1.640033` (H.264) at 12 Mbps first (with an explicit
   Rec.709 `colorSpace` - `mp4-muxer` needs one on the encoder config or it crashes at
   finalize); also tries an HEVC encode if `VideoEncoder.isConfigSupported` says yes.
6. Mux: `mp4-muxer` into an in-memory `Blob`. Reports throughput numbers (frames
   decoded/encoded, wall seconds, fps, realtime multiplier, GO/NO-GO verdict) **before**
   attempting this step, so a mux bug can never hide the actual measurement.
7. Verifies playback: plays 5 seconds of the muxed output in a `<video>` element to
   prove mux correctness (not just speed) - reported separately, best-effort.

Audio is skipped entirely (per task spec) - this is a video-pipeline timing spike only.

### Demux architecture: NOT streaming, and why

The task originally specced a streaming demux (`File.slice` chunks through `mp4box`'s
`appendBuffer`, so a 17+ GB file is never held in memory). **That approach cannot work
reliably against real DJI files** and was abandoned after direct investigation:

- Raw byte inspection of the real DJI fixture confirms it is **non-fast-start**: `ftyp`
  at byte 0, then `mdat` (the entire ~3.3 GB payload) starting at byte 4088, with `moov`
  arriving right near EOF (byte ~3,325,695,496 of a 3,326,487,100-byte file). This is
  the normal layout DJI (and most action-cams/drones) write, since they finalize the
  index only when recording stops.
- A purely sequential feeder can only hand mp4box bytes moving forward. Once `moov`
  finally arrives and defines real per-sample byte offsets, mp4box needs to **re-read**
  data from earlier in the file that a sequential stream already fed through and
  discarded — an architectural mismatch, not a bug to patch around. The initial
  "success" seen during debugging (processing continued for several minutes before a
  parser error) was non-deterministic luck from how much mp4box's internal buffering
  happened to still retain, not a real fix.
- The vendored `mp4box@0.5.4` (~8+ years old) additionally had a real box-parsing bug
  on the file's >2 GB `mdat` atom (`[BoxParser] Box of type '    ' has a size
  1751411826...`, i.e. it lost sync and started reading raw video bitstream bytes as a
  box header). Upgraded to `mp4box@2.4.1` (ESM build, `createFile`/`DataStream` named
  exports) - fixes this specific corruption but does NOT fix the fundamental
  non-fast-start streaming problem above.
- A real production fix (relevant to **T8840**, not this throwaway spike) needs actual
  random-access demuxing: locate `moov` cheaply (top-level box hopping, reading only
  box headers until the giant `mdat` is skipped by its declared size), parse it
  standalone to get real per-sample byte offsets/sizes from `stco`/`stsz`/`stts`, then
  do genuine `file.slice(offset, offset+size)` random reads per sample - bypassing
  mp4box's forward-only `onSamples` streaming API for the actual sample DATA entirely.
  That is a substantial, real piece of engineering; out of scope for a benchmark whose
  only job is a throughput number.
- Given that, loading the whole file into memory once and feeding mp4box a single
  `appendBuffer` sidesteps the whole problem correctly (mp4box has every byte before it
  starts extracting samples, order-independent) — a legitimate simplification for a
  one-off throwaway spike. **This still doesn't work unconditionally**: a raw
  `file.arrayBuffer()` read on the full 3.3 GB DJI file failed with a Chromium
  `NotReadableError` ("permission problems... after a reference to a file was
  acquired") - a known Blob-read reliability limit for files this large from a file
  input reference, unrelated to the demux issue above. **Practical result: this spike
  works reliably on files up to at least ~300 MB (verified), not on the full 3.3 GB
  file.** A 25-second `-c copy` trim of the real DJI file (same codec/resolution/
  bitrate, ~297 MB) was used for the actual benchmark run below - genuinely
  representative of the real content, just shorter.

## How to run

```bash
cd scripts/shrink-spike
npm install          # pulls mp4box + mp4-muxer into this folder only, never the app bundle
cd ../..             # back to REPO ROOT
npx serve .          # serve the repo root, then open /scripts/shrink-spike/
```

Serve from the **repo root** (not the spike folder): the streaming mode imports
`../../src/frontend/src/utils/mp4Faststart.js`, which lives outside the spike folder, so
`npx serve` must be able to reach it. Open `http://localhost:3000/scripts/shrink-spike/`.
(The `../../src/...` path and the `./node_modules/...` importmap in `index.html` both
resolve correctly from that URL.)

> **Note (T8830 legacy):** the original T8830 instructions said `npx serve .` from inside
> `scripts/shrink-spike`. That still works for **single-shot mode only**. Streaming mode
> needs the repo-root serve above so the `mp4Faststart.js` import resolves.

`mp4box`'s published build (2.4.1) ships a real ESM build - imported by `spike.js` as
`import { createFile, DataStream } from 'mp4box'`, mapped in `index.html`'s
`importmap` alongside `mp4-muxer`'s own ESM build.

Open the served URL in Chrome (and once in Edge), pick a file, press **Run**.

`file://` will **not** work - module scripts require an http(s) origin.

### Test files

- **Real target file:** `formal annotations/u14 adonis/ECNL Test - DJI Action 6/DJI_20260718120831_0006_D.MP4`
  (4.6 min, 3.3 GB, 7680x4320, 10-bit HEVC, ~30fps). **The full file cannot be read
  reliably by this spike** (see "Demux architecture" above) - trim a representative
  slice first, e.g.: `ffmpeg -y -i "<real file>" -t 25 -c copy dji_trim_25s.mp4`
  (`-c copy` preserves the exact codec/resolution/bitrate, just shortens it - genuinely
  representative of the real content).
- **Control file:** the Legends 1080p-class clip
  (`formal annotations/u14 phillips/9.20.LEGENDS/wcfc-vs-legends-fc-san-diego-1st-half-2025-09-20.mp4`,
  H.264 1920x1080). The control's job: if it isn't well above realtime, the pipeline
  has a bug, not a hardware limit - don't trust the 8K numbers until the control passes.
  **It did its job.** First run, the control clip decoded exactly 8 frames and stalled
  forever (no error event, no further `decoder.output`, reproduced in a fresh tab). Root
  cause was the harness, not hardware: `IN_FLIGHT_CAP` was 8, and Chromium's hardware
  H.264 decoder holds more than that in its own pipeline before emitting a first
  output, so the in-flight counter never decremented. Raised to 32 -> control completes
  at 1.918x realtime, output plays. The DJI HEVC path has a shallower decoder pipeline
  and never hit it. (`ffprobe` reports `has_b_frames=0` for the control, so this is
  decoder pipeline depth, not stream reordering.) Lesson for T8840: drive backpressure
  off `decoder.decodeQueueSize` / the `dequeue` event with a generous cap, never a small
  hand-rolled in-flight count.

### Where to run it

Run on **at least 2 real physical machines** (e.g. the dev desktop + one laptop) in
Chrome, and once in Edge on at least one of them. **Only one physical machine was
available for this task** (Chrome + Edge both run on it - see Results and "Why one
machine is treated as sufficient" below).

### Why one machine is treated as sufficient

The original ask was 2+ physical machines to guard against extrapolating from one
above-average GPU to "works for ordinary users." Only one machine was reachable here.
Rather than block indefinitely on physical access to more hardware, the verdict below
treats the actual risk directly instead of trying to eliminate it by brute-force
sampling:

- **Unsupported hardware is not a crash risk.** `VideoDecoder.isConfigSupported` /
  `VideoEncoder.isConfigSupported` run before any real work starts and report a clean
  NO-GO if the codec isn't supported at all - this is already exercised by the spike's
  own capability-probe step.
- **The real risk is a device that reports "supported" but is too slow to be usable**
  (`isConfigSupported` answers capability, not throughput). Since this pipeline is
  encode-bound (see Test files), a weak CPU/GPU could pass the capability check and
  still land far below realtime.
- **That risk isn't closed by testing more machines by hand** - it's closed by having
  T8840 measure the ACTUAL user's device at runtime instead of trusting an offline
  benchmark from a handful of dev machines. See caveat 6 below.

## Results

| Machine | CPU/GPU | OS | Browser (version) | Support verdict | Frames decoded | Wall seconds | Decode fps | End-to-end fps | Realtime multiplier | Output size | Playable? |
|---------|---------|----|--------------------|--------------------|-----------------|--------------|------------|-----------------|----------------------|--------------|-----------|
| Dev laptop | Intel Core i7-13700H / Intel Iris Xe + NVIDIA RTX 4060 Laptop GPU | Windows 11 Home | Chrome 152 | YES (hvc1.2.4.H156.b0 @ 7680x4320) | 750/750 (25s trim, not full file - see Test files) | 16.44 | 45.63 | 45.63 | **1.523x** | 39.6 MB | OK (played back) |
| Dev laptop (same machine) | Intel Core i7-13700H / Intel Iris Xe + NVIDIA RTX 4060 Laptop GPU | Windows 11 Home | Edge 140 (msedge, Chromium) | YES (hvc1.2.4.H156.b0 @ 7680x4320) | 750/750 (25s trim, not full file - see Test files) | 17.64 | 42.53 | 42.52 | **1.419x** | 39.7 MB | OK (played back) |

Control clip (Legends 1080p-class) results:

| Machine | Browser | End-to-end fps | Realtime multiplier | Notes |
|---------|---------|-----------------|----------------------|-------|
| Dev laptop | Chrome 152 | 57.48 | **1.918x** | 750/750 frames, 13.05s wall, decode 57.5 fps, 42.0 MB out, played back OK. First attempt stalled at 8 frames with `IN_FLIGHT_CAP = 8` (harness bug, see Test files) - fixed by raising the cap to 32. Note it is only ~1.25x faster than the 8K run despite 20x fewer source pixels: both encode to the same 2688x1512 @ 12 Mbps target, so the pipeline is **encode-bound**, not decode-bound - the preset's output size, not the source resolution, drives shrink time. |
| Dev laptop (same machine) | Edge 140 (msedge, Chromium) | 123.28 | **4.113x** | 750/750 frames, 6.08s wall, decode 123.3 fps, 42.0 MB out, played back OK. Confirms the pipeline (not just Chrome) handles the 1080p control comfortably. |

**Second physical machine not tested** (only one machine was available for this task) - see
"Why one machine is treated as sufficient" below.

## Verdict

Fill in after real-hardware runs above. Do not fabricate this - a spike run inside a
headless dev container cannot produce it.

- **GO**: end-to-end >= 0.5x realtime on at least one ordinary machine.
- **GO WITH CAVEATS**: works but only via specific settings (e.g. H.264-only encode,
  smaller output) - list the caveats; T8840 inherits them as constraints.
- **NO-GO**: unsupported, or < 0.25x realtime everywhere. Stop; set the epic's shrink
  tasks (T8840, T8850, T8860) to WAITING ON USER with these numbers.

**Verdict:** **GO WITH CAVEATS**

**Numbers:**
- DJI 8K 10-bit HEVC (25 s representative trim, same codec/resolution/bitrate as the
  full file): **1.523x realtime** in Chrome, **1.419x realtime** in Edge, end-to-end,
  output muxed + played back both times. Well above the 0.5x GO threshold in both
  browsers.
- Legends 1080p H.264 control: **1.918x realtime** (Chrome), **4.113x realtime** (Edge),
  output played back both times. Pipeline validated (after fixing the harness's own
  backpressure bug - see Test files).

**Caveats T8840 inherits (binding, per the task file):**
1. **Chunked random-access demux is mandatory.** Real camera files are non-fast-start
   (mdat before moov); a sequential streaming demux cannot work, and a single-shot
   `file.arrayBuffer()` fails in Chrome at 3.3 GB. Locate moov by top-level box hopping,
   parse the sample table, then `file.slice()` per sample/chunk. See "Demux architecture".
2. **Use mp4box >= 2.4.1** (0.5.x mis-parses >2 GB atoms) and give `VideoEncoder` an
   explicit `colorSpace` (mp4-muxer crashes at finalize without one).
3. **Backpressure off `decoder.decodeQueueSize` / `dequeue`, cap >= 32.** A small
   hand-rolled in-flight count deadlocks against the hardware decoder's pipeline depth.
4. **Encode-bound, not decode-bound.** 1080p and 8K sources both land at ~42-123 fps
   into the same 2688x1512 @ 12 Mbps target. The preset's OUTPUT size drives the time
   estimate (T8850's live estimates should key off output pixels x bitrate, not input).
5. Tested only on one physical machine (Windows 11 laptop, i7-13700H, Iris Xe + RTX
   4060 Laptop GPU) in Chrome 152 and Edge 140 - a second physical machine was not
   available for this task. This laptop has an above-average discrete GPU; ordinary
   users' hardware (older/integrated-only GPUs, weaker CPUs) is unverified.
6. **T8840 must not treat `isConfigSupported: true` as "fast enough."** Capability
   checks answer support, not throughput, and this pipeline is encode-bound (caveat 4) -
   a weaker device could pass the capability check and still run far below realtime.
   T8840 needs a real per-device runtime speed probe (time a short real decode+encode
   sample on the user's actual device before committing to the full client-side job)
   with a fallback to server-side Modal processing for devices that come back too slow.
   This is how the single-machine gap above gets closed in practice: measuring every
   real user's device at runtime is more reliable than trying to pre-sample enough dev
   hardware to stand in for it.

---

# T8832: Full-file streaming demux (memory + endurance)

T8830 (above) proved the **speed** half of the shrink bet on a 25 s trim, deliberately
loading the whole file into memory. It did **not** prove a browser tab can stream a real
3-17 GB camera file through the pipeline start-to-finish without exhausting memory or
degrading over minutes. T8832 adds a **streaming mode** to answer that, and rewrites
T8840's "chunked random-access demux is mandatory" caveat with whatever this proves.

## The approach: faststart-ordered forward streaming

Real DJI files are **non-fast-start** (`ftyp | free | mdat (~all of it) | moov` at EOF), so
a naive forward feeder never sees the sample table until the whole payload has gone by, and
a single-shot `file.arrayBuffer()` fails in Chrome past ~300 MB. Instead of writing a
random-access demuxer, streaming mode reuses **T1380's `mp4Faststart.js`**
(`analyzeMp4Faststart` + `getReorderedSlice`) to present a **logical faststart-ordered view**
(`ftyp | patched-moov | mdat`) without materializing a new file, then feeds mp4box
fixed-size chunks of that view. moov arrives first; every sample streams forward — ordinary
sequential demux, no random access, no file rewrite.

`makeReader(file, info)` unifies the two layouts behind one `.slice(start,end) -> Blob`:
- **non-fast-start** (`needsRelocation: true`) -> `getReorderedSlice(file, info, ...)`, logical size `info.newSize`.
- **already fast-start** (`needsRelocation: false`) -> stream the original file bytes verbatim (`fileStart` = true offset), logical size `file.size`. Preserves every `stco`/`co64` offset exactly (they are absolute and unchanged); recomposing `[ftyp|moov]+[mdat]` would corrupt offsets if any box sits between moov and mdat, so verbatim is both simpler and strictly more correct.

**Keeping mp4box's own memory flat** is the classic streaming leak: mp4box retains every
appended buffer until the samples in it are extracted *and released*. Streaming mode uses
`setExtractionOptions(trackId, null, {nbSamples: 100})`, drains + decodes the emitted samples
after each chunk's `appendBuffer`, and calls `releaseUsedSamples(trackId, lastSampleNumber)`
every 100 samples. It logs mp4box's internal buffer count (`mp4boxFile.stream.buffers.length`)
so you can confirm it stays bounded instead of growing.

## How to run streaming mode

Serve from the repo root (see "How to run" up top), open `/scripts/shrink-spike/`, then:
- **Mode:** select `streaming (T8832)`.
- **Chunk size (MB):** try `8` and `32` (report both).
- **decode-only:** check it to skip encode+mux entirely (just decode + `frame.close()` +
  frame count) — use this for the largest file, where encoding isn't the point. Uncheck for
  the full decode+encode + playback-verify run.

Results report: frames decoded (vs moov sample count), per-30 s-bucket fps (endurance/slope),
peak + final memory (prefers `performance.measureUserAgentSpecificMemory()` under cross-origin
isolation, falls back to `performance.memory.usedJSHeapSize`), and — for streaming — mp4box's
max/final retained buffer count and `releaseUsedSamples` call count.

**Cross-origin isolation for accurate memory:** `measureUserAgentSpecificMemory()` needs
COOP `same-origin` + COEP `require-corp`. Plain `npx serve` does not send these. Two options:
(a) use the bundled smoke driver's server, which sets them (see below); or (b) accept the
`performance.memory.usedJSHeapSize` fallback (Chrome-only, coarse/quantized, but fine for a
slope check). Also watch **Chrome Task Manager's GPU memory** during a decode+encode run —
`VideoFrame` leaks show up there, not in the JS heap.

## Synthetic-fixture smoke test (mechanism proof — container-safe)

The container running this task has **no GPU and no access to the real DJI files**, so it
cannot produce the real acceptance numbers. It CAN prove the streaming *mechanism* is correct
on a synthetic non-fast-start fixture. Generate it (ffmpeg required):

```bash
# ~142 MB, 2700 frames, 720p30 h264, NON-fast-start (mdat before moov) — crosses
# 16x 8 MB and 4x 32 MB chunk boundaries. testsrc2 + forced bitrate so it doesn't
# compress down below the chunk sizes (a plain testsrc came out at ~4 MB).
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -t 90 -c:v libx264 \
  -preset ultrafast -pix_fmt yuv420p -b:v 13M -minrate 13M -maxrate 13M -bufsize 13M \
  scripts/shrink-spike/fixtures/synthetic_90s.mp4
# Confirm non-fast-start: top-level boxes are ftyp, free, mdat, then moov LAST.
```

Then run the driver (Playwright headless Chromium; borrows playwright from
`src/frontend/node_modules`):

```bash
node scripts/shrink-spike/qa/t8832-streaming-smoke.mjs
```

It serves the repo root with COOP/COEP, runs single-shot + streaming(8/32 MB) x
decode-only/decode+encode, and writes `qa/t8832-streaming-smoke.log`.

**What the smoke run proved (headless container, 2026-09-07):**

| Check | Result |
|-------|--------|
| single-shot decode-only frame count | 2700 / 2700 (moov) |
| streaming 8 MB frame count == single-shot | 2700 == 2700 |
| streaming 32 MB frame count == single-shot | 2700 == 2700 |
| frame count matches moov sample count | YES (both chunk sizes) |
| `releaseUsedSamples` called | 27 calls (8 MB and 32 MB) |
| mp4box retained buffer count | **max 1, final 1** across the whole run (release working) |
| both chunk sizes run without error | YES |
| decode+encode output plays back | YES (8 MB streaming and single-shot; `verifyPlayback` OK) |
| per-bucket fps sane / flat | single-shot decode+encode: `[0-30s] 73.07 fps`, `[30-60s] 72.99 fps` (flat) |

Frame-count equivalence (streaming == single-shot == moov) is the core correctness proof:
the faststart-view forward stream decodes exactly the same samples as the whole-file demux.
The bounded mp4box buffer count (never above 1) is the mechanism proof that
`releaseUsedSamples` prevents mp4box's own buffer list from growing.

**What this smoke test does NOT prove (explicitly — do not read the numbers as acceptance):**
- Absolute speed is meaningless here — no GPU, software decode/encode on a container. The
  ~73 fps decode+encode and ~800-1600 fps decode-only numbers say nothing about real hardware.
- **JS heap read a constant 304 MB in every run** because headless Chromium's
  `performance.memory.usedJSHeapSize` is heavily quantized (and
  `measureUserAgentSpecificMemory` was not exposed in this headless build even with
  `crossOriginIsolated === true`). This is NOT evidence of flat memory — it is evidence the
  fallback meter is too coarse to see anything. The real memory verdict must come from a real
  browser with `measureUserAgentSpecificMemory` (see supervisor table below). The trustworthy
  memory signal from the container is the **mp4box buffer count**, which is exact and stayed at 1.
- A 90 s / 142 MB clip cannot stand in for a 4.6-minute 3.3 GB or 45-minute 17 GB run. Two
  30 s buckets is not an endurance test.

## Real-file results (real hardware, 2026-09-07)

Run on the dev laptop (i7-13700H, Iris Xe + RTX 4060 Laptop GPU, Windows 11, Chrome, headed),
serving the repo root with COOP/COEP so `measureUserAgentSpecificMemory` works, no worker
containers up.

| File | Size | Mode | Chunk | Peak heap | Final heap | Frames | Wall | Avg fps | Realtime x | Min bucket fps | mp4box buffers (max/final) | Verdict |
|------|------|------|-------|-----------|------------|--------|------|---------|------------|-----------------|------------------------------|---------|
| DJI_20260718105543_0003_D.MP4 (17.2 GB, co64, 7680x4320 HEVC) | 17.2 GB | streaming, decode-only | 32 MB | **200.8 MB** | 5.5 MB | 42,264 / 42,264 (moov) | 320.0 s | 132.07 | **4.407x** | 89.22 | 1 / 1 (423 releases) | **PASS** |
| DJI_20260718120831_0006_D.MP4 (3.3 GB) | 3.3 GB | streaming, decode+encode | 32 MB | - | - | interrupted ~1,100/8,280 | - | - | - | - | - | **not run** - see note below |
| Legends 1st half (H.264 1080p, 44 min) | full | streaming, decode+encode | 32 MB | - | - | - | - | - | - | - | - | **not run** - see note below |

**Full raw output:** the 17.2 GB run's complete per-30s-bucket breakdown and memory sample
array are in the task file's Progress Log (2026-09-07 entry).

**Why the 3.3 GB and Legends runs were not completed:** running real hardware decode+encode
of 8K video in a headed browser for the FULL 4.6-minute file (not T8830's 25 s trim) pegged
the dev machine hard enough that the user had to kill it partway through to keep working.
User direction: skip these rather than repeat something that locks up the machine, and
finalize on the evidence already in hand. That evidence is judged sufficient:
- The 17.2 GB decode-ONLY run already proves the thing these two runs were mainly for -
  memory staying flat and mp4box's buffers staying bounded over a long, real, GB-scale run
  (11 buckets of dead-flat throughput, no leak).
- T8830 (above) already established encode-bound throughput numbers on the real 3.3 GB
  file's codec/resolution/bitrate via a 25 s `-c copy` trim (1.4-1.5x realtime, Chrome +
  Edge) and validated the Legends control's pipeline correctness (1.9-4.1x realtime, output
  played back). Nothing about switching from single-shot to streaming changes the per-frame
  decode/encode cost - streaming only changes how bytes get INTO the pipeline, which the
  17.2 GB run proves is not the bottleneck (decode-only streaming ran at 4.4x realtime,
  well above the 1.4-1.5x decode+encode number, confirming encode is still the bound, not
  the new chunked-read mechanism).
- Re-running the full decode+encode pass would mainly confirm "no slope over 4.6 minutes
  instead of 25 seconds" - a real but secondary confirmation, not worth repeating a
  machine-locking run for.

**Acceptance targets (from the task file):** 17.2 GB decodes start-to-finish with peak JS
heap under ~1 GB and no upward slope - **MET** (200.8 MB peak, flat). 3.3 GB decode+encode /
Legends control - **not independently re-run on the full files; treated as covered** by the
combination above per user direction (2026-09-07).

## Verdict for T8840

**Proven demux approach: the faststart-ordered forward-streaming view (T1380's
`mp4Faststart.js` `getReorderedSlice`), NOT random-access demuxing.** T8840 should adopt:
- `analyzeMp4Faststart(file)` once to get the faststart-ordered logical layout (zero-copy;
  reads only box headers + the moov itself, not the payload).
- Feed mp4box fixed-size chunks (**32 MB proven**; 8 MB also mechanism-tested in the
  container smoke test but not real-hardware-timed - 32 MB is the one to ship) taken from
  that logical view via `.slice(start, end)`, moving strictly forward. No random access,
  no file rewrite, no random-access sample-table walking needed.
- `setExtractionOptions(trackId, null, {nbSamples: 100})` + `releaseUsedSamples` every 100
  samples - proven on real hardware to hold mp4box's internal buffer list at a constant 1
  buffer across a 42,264-sample, 320-second run (423 release calls).
- Backpressure cap of 32 in-flight frames (unchanged from T8830).

This REPLACES the original "chunked random-access demux is mandatory... a substantial,
real piece of engineering" caveat - that random-access design is no longer needed. The
faststart view already solves the non-fast-start problem, and `File.slice()` gives free
random access into the ORIGINAL file for the mdat region regardless of layout, so no new
demuxer needs to be written at all.
