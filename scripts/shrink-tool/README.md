# T8840: Standalone browser shrink tool

A self-contained page that shrinks a folder of camera footage entirely in the browser:
pick a folder -> draw one crop rect -> pick a preset -> speed probe -> shrink each
segment (streamed to OPFS, never held in memory) -> save the results to disk. It is
**never imported by app code** and has its own `package.json`. See
[the design doc](../../docs/plans/tasks/T8840-design.md) and
[the task file](../../docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md)
for the full spec.

`pipeline/*.js` is DOM-free ESM, written so T8845 can port it into the app's worker
mechanically (`git mv` plus two import-path edits). `worker.js`, `index.html`, `tool.js`,
and `ui/*.js` are the standalone page's own DOM/orchestration code and are **not** ported.

## How to run

```bash
cd scripts/shrink-tool
npm install                 # mp4box + mp4-muxer are LOCAL to this tool, never added to
                             # src/frontend/package.json
```

Then, from the **repo root** (the tool needs `src/frontend/src/utils/mp4Faststart.js`
and `shrinkCapability.js` at their real repo paths):

```bash
npx serve .                 # or any other static file server
```

Open `http://localhost:<port>/scripts/shrink-tool/` in Chrome. Firefox lacks
`showDirectoryPicker()`/OPFS/enough WebCodecs support for this tool; the capability
check should refuse gracefully there rather than throw (task acceptance criterion).

Opening `index.html` directly via `file://` will NOT work: `showDirectoryPicker()`,
OPFS, and module workers all require a real origin.

## Unit tests

```bash
cd scripts/shrink-tool
npx vitest run
```

Covers `pipeline/presets.js` (pure math), `pipeline/cropScale.js`'s `resolveCropRect`
(pure geometry), and `pipeline/checkpoint.js`'s reducer + `planResume` (the OPFS state
machine, design §3.3/§3.4). WebCodecs/OPFS cannot be faked in jsdom, so the rest of the
pipeline is proven by the headless smoke test below, and ultimately by the manual
recipe on real hardware.

## Headless smoke test (mechanism proof, not the acceptance bar)

```bash
# generates its own synthetic fixture if missing -- see the ffmpeg command below
node scripts/shrink-tool/qa/t8840-smoke.mjs
```

Drives the pipeline modules directly (no folder picker -- OS pickers can't be automated
headlessly) against a synthetic non-fast-start A/V fixture. Proves: demux frame-count
equivalence with the moov, `checkCapability` wiring, a full `shrinkSegment` run producing
a playable OPFS output with both tracks, cancel leaving `liveFrames === 0`, and the
`worker.js` postMessage protocol end-to-end (including a `FileSystemDirectoryHandle`
surviving structured clone into a module Worker).

This is a **container-safe mechanism check only** -- no GPU, no real footage. It does not
and cannot prove real-hardware speed, real A/V sync by ear, thermal endurance, or
checkpoint/resume across an actual page reload. That is what the recipe below is for.

Regenerate the fixture if it's missing (gitignored, ~135 MB, not committed):

```bash
ffmpeg -y -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -t 90 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -b:v 13M -minrate 13M -maxrate 13M -bufsize 13M \
  -c:a aac -b:a 128k -shortest scripts/shrink-tool/fixtures/synthetic_90s_av.mp4
```

## The user test recipe (the real acceptance bar)

This is what "fully working" means. It is not provable in a container -- it needs the
real 50 GB DJI folder, real GPU hardware, and a human watching playback. Copied verbatim
from the task file:

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

## Results per machine

Fill in one row per machine tested. This table is the evidence for the acceptance
criterion "the user has run the full test recipe... and says the tool works."

| Date | Machine (CPU/GPU, OS, browser) | Steps 1-7 result | Sharpest time (25s trim or full) | Notes |
|------|-------------------------------|-------------------|-----------------------------------|-------|
| | | | | |

## Known limitations (v1, by design)

- Whole-segment checkpointing only -- no mid-segment resume (design §3.3). A crash or
  Cancel mid-segment loses that segment's progress, not the whole job.
- One static crop rect for every segment (EPIC decision 5, v1).
- `<input webkitdirectory>` fallback (browsers without `showDirectoryPicker()`) cannot
  resume after a reload -- the folder must be re-picked.
- **A/V start-time skew beyond a couple of sample durations is not faithfully
  preserved.** `mux.js` uses mp4-muxer's `firstTimestampBehavior: 'cross-track-offset'`,
  which prevents a hard crash when the two tracks' first timestamps genuinely differ,
  but mp4-muxer never writes an edit-list (elst) box -- ISO BMFF's own rule that a
  track's first sample sits at media-internal time 0 absorbs any larger gap into the
  first inter-sample delta instead of a true "starts N ms late". Confirmed empirically
  during the T8840 revision pass. For real DJI footage the actual skew is expected to
  be sub-frame hardware-clock jitter (a few ms, per the T8830/T8832 spike findings),
  where this is imperceptible; a genuinely large skew (hundreds of ms) would need
  edit-list support this dependency doesn't have. Step 0's real-footage A/V-sync check
  (recipe step 5, "audio is in sync") is what actually proves this in practice.

## What is deliberately NOT proven by this container (supervisor/user-only)

- **Step 0** (task file): the full 17.2 GB real DJI segment decode+encode+mux run,
  unattended, plus the Sharpest-preset timing on a 25 s trim.
- **R11's quality A/B** (design doc risk register): source vs. Sharpest-preset H.264
  output, side by side, on real footage.
- The user test recipe above, on the real 50 GB folder and a second machine.

This container has no GPU and cannot see the real fixture files. Every pipeline
mechanism these would exercise is proven instead via `qa/t8840-smoke.mjs` on a
synthetic fixture (see above) -- that is a mechanism check, not a substitute for these.
