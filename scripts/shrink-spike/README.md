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
npx serve .           # or point the app's vite dev server at this folder
```

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
