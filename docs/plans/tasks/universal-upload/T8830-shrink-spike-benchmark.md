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
the way).

**2026-09-06 (later)**: Supervisor ran the harness directly on the real 3.3 GB DJI file
via a real Chrome browser (Playwright) on the dev machine. Found and fixed real bugs the
container smoke test couldn't have caught: (1) the real DJI file is non-fast-start
(mdat, the whole payload, sits before moov — confirmed via raw byte inspection), which
defeats a purely sequential streaming demux — the vendored mp4box was also 8+ years out
of date and had a real box-parsing bug on >2GB mdat atoms, upgraded 0.5.4 -> 2.4.1;
(2) mp4-muxer needs an encoder-reported colorSpace or it crashes at finalize — added
one; (3) reordered so throughput numbers report before muxing, so a mux bug can't hide
the measurement; (4) switched to whole-file-in-memory demux (correct by construction,
legitimate for a throwaway one-off) — but the FULL 3.3GB file still can't be read via a
single Blob `.arrayBuffer()` call (a separate Chromium reliability limit). Got a real
result on a 25s representative `-c copy` trim (same codec/resolution/bitrate as the
full file): **1.523x realtime, output muxed and played back correctly — PRELIMINARY
GO**. The Legends 1080p control clip stalled after 8 frames on this machine (reproduced
in a fresh tab, no error) — documented as an unresolved, likely hardware/driver-specific
decoder hang, separate from everything else fixed. Full details + the filled results
table: `scripts/shrink-spike/README.md`. Pushed (commit 0fda5940), CI green.

**2026-09-06 (control-clip stall resolved)**: the Legends 1080p stall was a HARNESS bug,
not hardware: `IN_FLIGHT_CAP = 8` sat below Chromium's hardware H.264 decoder's
internal pipeline depth, so the decoder never emitted a first output and the in-flight
counter never decremented (`has_b_frames=0`, so pipeline depth, not stream reordering).
Cap raised to 32 -> control completes: **1.918x realtime**, 750/750 frames, output plays.
The control did exactly the job the task gave it ("if it is not far above realtime, the
pipeline has a bug"). Also learned: 1080p decodes at 57 fps vs 8K at 46 fps into the
same 2688x1512 target, so the pipeline is **encode-bound** - output size, not source
resolution, drives shrink time. Commit 238f00ea on the branch; README verdict promoted to
**GO WITH CAVEATS - PRELIMINARY** with T8840's binding caveats enumerated.

## Handoff: finishing this task (written 2026-09-06 for a fresh session)

**Where it is:** branch `feature/T8830-shrink-spike-benchmark` @ `238f00ea`, pushed, no PR
yet. `scripts/shrink-spike/` = `index.html`, `spike.js`, `README.md`, `package.json`
(mp4box 2.4.1 exact, mp4-muxer ^5). Nothing imported by app code. Worker container
`reel-task-t8830` may still exist (idle) - `bash scripts/task.sh nuke t8830` once merged.

**What is proven (one machine: Windows 11 laptop, i7-13700H, Iris Xe + RTX 4060, Chrome
152):** DJI 8K 10-bit HEVC 25 s trim 1.523x realtime, Legends 1080p 25 s trim 1.918x,
both muxed + played back. Full results table + the architectural findings are in
`README.md` on the branch - read it first, it is the primary artifact.

**Why the spike does not run the full 3.3 GB file, and why that is fine for the
verdict:** real DJI files are non-fast-start (mdat before moov), which a sequential
streaming demux cannot handle, and a single-shot `file.arrayBuffer()` on 3.3 GB fails in
Chrome (`NotReadableError`). The spike reads whole files into memory and is reliable to
at least ~300 MB; a 25 s `-c copy` trim keeps the exact codec/resolution/bitrate, so the
per-frame decode/encode cost - the only thing GO/NO-GO depends on - is representative.
Building real chunked random-access demux is T8840's job, not the spike's.

**Remaining, in order:**
1. Second machine (the task's bar is 2+ machines, Chrome, and once in Edge):
   `cd scripts/shrink-spike && npm install && npx serve .`, make the two trims
   (`ffmpeg -y -i "<DJI file>" -t 25 -c copy dji_trim_25s.mp4`, same for the Legends
   1st-half file - paths in README "Test files"), run each, add a row to both README
   tables (CPU/GPU/OS/browser from `Get-CimInstance Win32_Processor` /
   `Win32_VideoController`). Edge: same page, same files.
2. Verdict: if the second machine's DJI number is >= 0.5x, change README "Verdict" from
   "GO WITH CAVEATS - PRELIMINARY" to "GO WITH CAVEATS" and tick this file's first and
   fourth acceptance boxes. If it is < 0.25x anywhere, follow the task's NO-GO branch
   (set T8840/T8850/T8860 WAITING ON USER with the numbers).
3. Copy the five binding caveats from README "Verdict" into `T8840-shrink-pipeline-core.md`
   (its row says "gated on T8830 GO (its caveats are binding)") and the encode-bound
   finding into `T8850-shrink-ui-crop-step.md` (its live time estimates should key off
   output pixels x bitrate).
4. Open the PR (`gh pr create` from the branch; docs + a standalone script, frontend CI
   job runs eslint over `scripts/`), CI green -> merge (no provable-verification bar
   applies - nothing here is app code), flip this task to STAGING in PLAN.md + this file
   + EPIC.md, `task.sh nuke t8830`.
5. Report the verdict + caveats to the user before anyone starts T8840 (acceptance
   criterion 4).

**Do not re-investigate these - they are settled:** the mp4box 0.5.x >2 GB parsing bug
(upgraded), the mp4-muxer colorSpace crash (fixed), the non-fast-start streaming problem
(documented, out of scope), the control-clip stall (fixed). Docker Desktop crashed once
while the 8K benchmark ran alongside two worker containers - run the benchmark with
containers down.

## Acceptance Criteria

- [ ] README.md contains a filled results table from >= 2 machines + the verdict
      (1 machine filled as of 2026-09-06; second machine + Edge owed)
- [x] The output Blob plays in a video element (proves mux correctness, not just speed)
      - verified for both the DJI 8K trim and the Legends 1080p control, 2026-09-06
- [x] Nothing from this spike is imported by app code
- [ ] Verdict + numbers reported to the user before any T8840 work starts (preliminary
      GO WITH CAVEATS reported 2026-09-06; final report after the second machine)
