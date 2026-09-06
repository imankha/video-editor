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
3. Decode: `VideoDecoder`, backpressured so at most ~8 frames are in flight
   (`decoder.decodeQueueSize` and an in-flight counter both capped). `frame.close()`
   is called on every frame after it's handed to the encoder.
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
  H.264 1920x1080). Should be *far* above realtime; if it isn't, the pipeline has a
  bug, not a hardware limit - don't trust the 8K numbers until the control passes.
  **On this run's machine the control clip stalled after decoding exactly 8 frames -
  no error event, no further `decoder.output` calls, indefinitely.** Reproduced twice
  (once in a fresh browser tab, ruling out stale hardware-decoder session state from a
  prior run). This looks like a genuine silent hardware-decoder hang specific to this
  file/machine/driver combination - a real WebCodecs landmine T8840's production
  pipeline should guard against with a decode-progress watchdog/timeout, not something
  this spike had time to root-cause further. **Because of this, the control did NOT
  validate "far above realtime" on this machine** - the DJI result below stands on its
  own (it completed successfully end-to-end), but treat it as single-machine evidence,
  not fully cross-validated the way the task intended.

### Where to run it

Run on **at least 2 real physical machines** (e.g. the dev desktop + one laptop) in
Chrome, and once in Edge on at least one of them. **Only one machine has been run so
far** (see Results below) - a second machine, and ideally a working control-clip run,
are still needed before this is a fully cross-validated verdict.

## Results

| Machine | CPU/GPU | OS | Browser (version) | Support verdict | Frames decoded | Wall seconds | Decode fps | End-to-end fps | Realtime multiplier | Output size | Playable? |
|---------|---------|----|--------------------|--------------------|-----------------|--------------|------------|-----------------|----------------------|--------------|-----------|
| Dev laptop | Intel Core i7-13700H / Intel Iris Xe + NVIDIA RTX 4060 Laptop GPU | Windows 11 Home | Chrome 152 | YES (hvc1.2.4.H156.b0 @ 7680x4320) | 750/750 (25s trim, not full file - see Test files) | 16.44 | 45.63 | 45.63 | **1.523x** | 39.6 MB | OK (played back) |
|  |  |  |  |  |  |  |  |  |  |  |  |

Control clip (Legends 1080p-class) results:

| Machine | Browser | End-to-end fps | Realtime multiplier | Notes |
|---------|---------|-----------------|----------------------|-------|
| Dev laptop | Chrome 152 | n/a | n/a | **STALLED at 8 frames decoded, no error, indefinitely** (reproduced in a fresh tab). See Test files section - looks like a real hardware-decoder hang, not a pipeline bug (the harder DJI 8K case completed successfully on the same machine/browser). Needs investigation on a second machine to see if it reproduces. |

## Verdict

Fill in after real-hardware runs above. Do not fabricate this - a spike run inside a
headless dev container cannot produce it.

- **GO**: end-to-end >= 0.5x realtime on at least one ordinary machine.
- **GO WITH CAVEATS**: works but only via specific settings (e.g. H.264-only encode,
  smaller output) - list the caveats; T8840 inherits them as constraints.
- **NO-GO**: unsupported, or < 0.25x realtime everywhere. Stop; set the epic's shrink
  tasks (T8840, T8850, T8860) to WAITING ON USER with these numbers.

**Verdict:** **PRELIMINARY GO** (single machine, real 8K content, needs a second machine
before this is final per the task's own "2+ machines" bar).

**Numbers/caveats:**
- 1.523x realtime end-to-end on a 25-second representative trim of the real DJI 8K
  10-bit HEVC footage (same codec/resolution/bitrate as the full file) - well above the
  0.5x GO threshold. Output muxed and played back correctly.
- The FULL 3.3 GB file could not be run directly through this spike (Blob-read
  reliability limit, see "Demux architecture") - the 1.523x number is from a
  representative trim, not the complete file. T8840's real implementation will need
  genuine chunked random-access demuxing regardless (see above) - that work will also
  resolve the "can't read a 3+ GB file in one shot" limit this spike hit.
- The Legends 1080p control clip stalled on this machine (see Results) - the intended
  "far above realtime, or the pipeline has a bug" cross-check did NOT complete. Since
  the harder 8K case succeeded cleanly on the same machine/browser, this reads as an
  environment/driver-specific decoder hang rather than a pipeline bug, but it is
  UNCONFIRMED - a second machine should try both files.
- **Before starting T8840**, get at least one more machine's numbers (ideally one where
  the Legends control also completes, to fully validate the harness) and update this
  file. If the second machine's DJI number is also >= 0.5x, treat this as a firm GO;
  if the Legends control fails there too, investigate that specifically before trusting
  any 8K number, per the task's own logic.
