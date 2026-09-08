# T9020: Trial auto-crop on other camera sources (Trace, Veo, iPhone, existing fixtures)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

Auto-crop has only ever seen one lens: a fixed DJI Action camera on a tripod at 8K.
Production uploads are mostly Trace/Veo exports (auto-tracked cameras that PAN and ZOOM
with play, 1080p, ~5 Mbps) and phone clips (handheld, portrait or landscape, short). The
per-cell variance heuristic assumes a static background with motion where the players
are; on a panning camera the whole frame moves and the heuristic may return either the
full frame (useless but harmless) or a confident nonsense rect (harmful). The milestone
promises the pre-shrink is net-positive across ALL video types, so we need per-source
results before anything integrates.

## Solution

Run the tuned heuristic (T9010 defaults) on every camera source we can get, using the
same sweep + ground-truth harness T9010 builds, and record one row per source in a README
results table: does it produce a usable rect, how much frame it keeps, what it gets wrong.
Where a source has no fixture (Veo), obtain one or record "not tested" explicitly. The
deliverable is a per-source verdict (use as-is / needs a source-specific rule / never
auto-crop this source) that T9040's decision rule and T8850's UI consume.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/pipeline/autoCrop.js` - the heuristic under test (post-T9010
  defaults); may gain a `sourceHint` option ONLY if a per-source rule is justified by
  the data
- `scripts/shrink-tool/qa/autocrop-sweep.mjs` + `qa/autocrop-groundtruth.py` - T9010's
  harness, reused as-is
- `scripts/shrink-tool/ui/segmentList.js` - `sampleMotionFrames`; phone clips are
  seconds long, so the middle-80% / 8-sample assumption needs checking
- `scripts/shrink-tool/tool.js` - `findProxyFile` (only DJI has `.LRF` proxies; every
  other source samples the MAIN file, which is the slower rung-2 preview path)
- `scripts/shrink-tool/README.md` - add "Auto-crop by source" results table
- Fixtures already in the repo checkout (never committed to git, multi-GB):
  - Trace exports (1080p, tracked camera): `formal annotations/u14 phillips/9.20.LEGENDS/`
    (two halves, 4.67 Mbps, the intake's export-time-overlap case), plus the other
    `formal annotations/u14 phillips/*/wcfc-vs-*.mp4` games and
    `formal annotations/u14 adonis/{rangers 8-21-26,breakers 8-30-26,ManCityCup}/`
  - Phone clip (720p, 10 s, handheld): `formal annotations/u14 adonis/Capo 8-22-2026/
    VID_20260905_094101.mp4`
  - Short test clips: `formal annotations/test.short/`
  - Veo: no fixture in the repo - ask the user for one export, or record "not tested"
- `docs/plans/tasks/universal-upload/EPIC.md` - "Evidence base" table (what each
  fixture proves about intake) and decision 4 (offer threshold: bytes AND bitrate; the
  Legends export is below every preset, so shrink would be pure loss there regardless
  of crop - this task still records what auto-crop DOES on it, because the crop stage
  may be offered independently of re-encoding later)

### Related Tasks
- Depends on: T9010 (tuned defaults + the harness)
- Blocks: T9040 (per-source verdicts are an input to "when not to shrink"), T9050
  (tweening must be designed knowing whether panning sources are in or out of scope)
- Related: T8800 (intake already classifies camera family from filename/metadata -
  reuse that classification if a per-source rule is needed rather than inventing a
  second one)

### Technical Notes
- **Expected failure mode on tracked cameras**: global motion makes every cell's
  variance high; the bounding box above threshold becomes the whole frame. That is a
  correct "nothing to crop" answer - verify the heuristic returns near-full-frame
  rather than a random subset, and consider making `suggestCropFromFrames` return
  `null` when the kept area exceeds ~90% (caller falls back to full frame, same as the
  <2-frames path) so the UI does not present a meaningless 97% rect as a suggestion.
- **Letterboxing / static overlays**: Trace/Veo exports may carry a scoreboard, logo,
  or black bars. Those are static and WILL be dropped by a variance heuristic, which is
  correct for bars and questionable for a scoreboard the parent may want. Record it;
  decide in T9040/T8850, not here.
- **Phone clips**: 10 s clips have ~8 s in the middle 80%; the heuristic may see one
  play and crop tightly around it. Also portrait orientation - `resolveCropRect`
  clamps on both axes so nothing breaks, but the result should be checked.
- Sampling from the main file (no proxy) for a 1.5 GB 1080p export is a real `<video>`
  seek x 8 on the full file; time it and record it - T8850's UI will pay this cost on
  every non-DJI upload.
- Do not add per-source branches on a hunch. Two sources with the same failure is a
  rule; one is an anecdote (abstract on the 3rd duplication).

## Implementation

### Steps
1. [ ] Inventory the available fixtures per source family; request a Veo export from
   the user; note gaps.
2. [ ] Build ground truth for one representative file per source (T9010's YOLO script;
   ball may be undetectable on 1080p far-side - record detection rate too).
3. [ ] Run the sweep harness with T9010 defaults on each; record rect, kept-area,
   ball-in-rect, players-in-rect, sampling time (proxy vs main file).
4. [ ] Classify each source: usable / near-full-frame (correct no-op) / harmful. For
   harmful cases, test the >90%-area -> `null` guard and any minimal per-source rule
   the data justifies.
5. [ ] Fill the README "Auto-crop by source" table; write the per-source verdict into
   [EPIC.md](EPIC.md) so T9040 and T8850 read one place.

### Progress Log

**2026-09-08**: Filed.

## Acceptance Criteria

- [ ] Every source family in the fixture set (Trace export, phone clip, short test
      clips; Veo if obtained) has a README row with rect, kept-area %, ball/players
      in-rect rates, and sampling time
- [ ] No source produces a "harmful" rect without a recorded mitigation (guard or rule)
      backed by at least two files showing the same behaviour
- [ ] Per-source verdict table written into EPIC.md
- [ ] `pipeline/autoCrop.js` remains pure/DOM-free; any new option is unit-tested
