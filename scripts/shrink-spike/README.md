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
2. Streaming demux: reads the file in 4 MB slices via `File.slice` and feeds them to
   `mp4box`'s `appendBuffer` - the whole file is never held in memory at once.
3. Decode: `VideoDecoder`, backpressured so at most ~8 frames are in flight
   (`decoder.decodeQueueSize` and an in-flight counter both capped). `frame.close()`
   is called on every frame after it's handed to the encoder.
4. Crop+scale: `OffscreenCanvas.drawImage` into a 2688-wide target canvas.
5. Encode: tries `avc1.640033` (H.264) at 12 Mbps first; also tries an HEVC encode if
   `VideoEncoder.isConfigSupported` says yes.
6. Mux: `mp4-muxer` into an in-memory `Blob`.
7. Reports: support verdict, frames decoded, wall seconds, decode fps, end-to-end fps,
   realtime multiplier (fps / 29.97), output size, and plays 5 seconds of the output
   in a `<video>` element to prove mux correctness (not just speed).

Audio is skipped entirely (per task spec) - this is a video-pipeline timing spike only.

## How to run

```bash
cd scripts/shrink-spike
npm install          # pulls mp4box + mp4-muxer into this folder only, never the app bundle
npx serve .           # or point the app's vite dev server at this folder
```

`mp4box`'s published build has no real ESM exports (it's a classic script that sets
`window.MP4Box`/`window.DataStream`), so `index.html` loads it with a plain
`<script src>` tag rather than importing it from `spike.js`. `mp4-muxer` does ship a
real ESM build, wired up via an `importmap` in `index.html` so `spike.js` can
`import` it by bare specifier without a bundler.

Open the served URL in Chrome (and once in Edge), pick a file, press **Run**.

`file://` will **not** work - module scripts require an http(s) origin.

### Test files

- **Real target file:** `formal annotations/u14 adonis/ECNL Test - DJI Action 6/DJI_20260718120831_0006_D.MP4`
  (4.6 min, 3.3 GB, 7680x4320, 10-bit HEVC, ~30fps). This file lives outside the repo
  on your local machine - point the file picker at it directly.
- **Control file:** the Legends 1080p-class clip. Should be *far* above realtime; if
  it isn't, the pipeline has a bug, not a hardware limit - don't trust the 8K numbers
  until the control passes.

### Where to run it

Run on **at least 2 real physical machines** (e.g. the dev desktop + one laptop) in
Chrome, and once in Edge on at least one of them. A headless container cannot do this
run: no guaranteed GPU passthrough for hardware decode, no access to the local media
file (it lives outside the repo), and no second physical machine to compare against.

## Results

Fill in one row per machine/browser combination.

| Machine | CPU/GPU | OS | Browser (version) | Support verdict | Frames decoded | Wall seconds | Decode fps | End-to-end fps | Realtime multiplier | Output size | Playable? |
|---------|---------|----|--------------------|--------------------|-----------------|--------------|------------|-----------------|----------------------|--------------|-----------|
|         |         |    |                    |                    |                 |              |            |                 |                      |              |           |
|         |         |    |                    |                    |                 |              |            |                 |                      |              |           |

Control clip (Legends 1080p-class) results:

| Machine | Browser | End-to-end fps | Realtime multiplier | Notes |
|---------|---------|-----------------|----------------------|-------|
|         |         |                 |                      |       |

## Verdict

Fill in after real-hardware runs above. Do not fabricate this - a spike run inside a
headless dev container cannot produce it.

- **GO**: end-to-end >= 0.5x realtime on at least one ordinary machine.
- **GO WITH CAVEATS**: works but only via specific settings (e.g. H.264-only encode,
  smaller output) - list the caveats; T8840 inherits them as constraints.
- **NO-GO**: unsupported, or < 0.25x realtime everywhere. Stop; set the epic's shrink
  tasks (T8840, T8850, T8860) to WAITING ON USER with these numbers.

**Verdict:** _(not yet run)_

**Numbers/caveats:** _(not yet run)_
