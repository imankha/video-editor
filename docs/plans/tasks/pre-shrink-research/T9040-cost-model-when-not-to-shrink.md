# T9040: Cost model: when NOT to shrink, and the size-cap-driven bitrate rule

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

Today the shrink offer is gated by two constants: `totalBytes >= 3 GB AND sourceBitrate
>= 10 Mbps` (`shouldOfferShrink` in `scripts/shrink-tool/pipeline/presets.js`, EPIC
decision 4). That is a heuristic, not a cost model. It ignores the user's connection
speed (the whole reason to shrink), the device's measured speed (the probe multiplier),
battery/thermal state on a laptop, and the server cost of the Modal fallback when the
device is too slow. The milestone requires the pre-shrink to be NET-POSITIVE across all
video types and sizes, with one deliberate asymmetry: on a slow connection the tool
should automatically spend MORE time shrinking, because that still saves total time.
Intuition is not enough - the rule must come with numbers.

A second idea has been explicitly parked until auto-crop is proven (T9010/T9020):
**size-cap-driven bitrate** - instead of fixed preset bitrates, derive the target bitrate
from a hard total-upload cap (~8 GB per game) and let a source-bits-per-pixel quality
floor choose the output resolution. This task picks that idea back up now that the crop
work precedes it in the epic order.

## Solution

A pure-math decision module in `scripts/shrink-tool/pipeline/` (DOM-free, unit-tested,
portable by T8845) that replaces the two-constant gate:

```
decideShrink({
  totalBytes, sourceBitrateBps, durationSec, sourceWidth, sourceHeight, sourceFps,
  cropAreaFraction,            // from auto-crop (1.0 = full frame)
  measuredUploadMbps | null,   // from a short upload probe or T8990's default bucket
  probeMultiplier | null,      // runtime speed probe (design §4.1); null before probe
  probePixelsPerSecond | null,
  onBattery | null, thermalThrottled | null,   // navigator.getBattery() where available
  uploadCapBytes = 8e9,        // the hard total-upload cap
  sourceBppFloor,              // never encode below the source's own bits-per-pixel
}) -> { mode: 'client' | 'modal' | 'none', targetBitrateBps, outWidth, outHeight,
        estShrinkSec, estUploadSec, estTotalSec, estOriginalUploadSec, reason }
```

fitted to T9030's measured numbers and T8990's bandwidth distribution, with the
"when NOT to shrink" boundaries stated explicitly and the slow-connection asymmetry
built in. Documented as a decision table in EPIC.md; wired into the tool's offer line so
the user can see the verdict on real files. App integration (T8850 offer gating, T8860
Modal fallback) consumes it later.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/pipeline/presets.js` - `PRESETS` (sharp 3840 / 24 Mbps, small
  1920 / 7 Mbps), `SHRINK_OFFER_MIN_BYTES = 3e9`, `SHRINK_OFFER_MIN_BITRATE = 10 Mbps`,
  `shouldOfferShrink`, `resolveOutputSize` (never upscales; even dimensions),
  `estimateOutputBytes` (+2% mux), `estimateShrinkSeconds` (output pixels /
  `pixelsPerSecond`)
- `scripts/shrink-tool/pipeline/decision.js` - NEW: `decideShrink` + the size-cap
  bitrate derivation; pure functions, exhaustive unit tests
- `scripts/shrink-tool/pipeline/probe.js` - `runSpeedProbe` output shape
  (`realtimeMultiplier`, `pixelsPerSecond`, verdict bands 0.5x / 0.25x)
- `scripts/shrink-tool/tool.js` - `checkOfferShrink`, the estimate line (M6: the ONE
  place crop + preset -> output dimensions is derived), `onProbeResult`; show the
  decision's mode + reason in the verdict banner
- `docs/plans/tasks/T8840-design.md` §4.2 - the existing economics argument (0.23x
  floor at 20 Mbps; 4 h `MAX_COMFORTABLE_SECONDS` guard) that this model generalizes
- `docs/plans/tasks/universal-upload/EPIC.md` - decisions 4 (offer threshold), 5
  (presets; "no visible quality loss on the player beats minimizing time"), 6
  (capability gating + Modal fallback when too slow)
- `.claude/knowledge/modal-gpu.md` - Modal cost anchors (T4 ~$0.03 per 10 s upscaled
  clip; framing ~0.3c per exported second). The shrink fallback is a DIFFERENT workload
  (ffmpeg/NVENC transcode of a whole game) - measure it, do not reuse these numbers
- `src/backend/app/services/storage_credits.py` - `R2_RATE_PER_GB_MONTH = 0.015`,
  `MARGIN = 0.10` (storage side of the ledger; smaller uploads also cost less to store)
- `docs/plans/research/pre-shrink-benchmark.md` - T9030's numbers (input)
- `docs/plans/tasks/pre-shrink-research/EPIC.md` - "Milestone goal" (T8990) and the
  decision table this task adds

### Related Tasks
- Depends on: T8990 (bandwidth distribution + goal), T9030 (time/quality per source
  type and machine), T9010 + T9020 (auto-crop proven - the explicit precondition for
  un-parking the size-cap idea)
- Blocks: T8850 (offer gating replaces bytes+bitrate constants with `decideShrink`),
  T8860 (Modal fallback consumes `mode: 'modal'` and its cost bound)
- Related: T8950 (credit pricing for high-res sources), T8838 (capability share)

### Technical Notes
- **Client cost side**: wall-clock the user waits (shrink + upload), machine pegged
  (design caveat 10), battery drain (measure Wh on the dev laptop for one segment at
  Sharp; `navigator.getBattery()` is Chrome-only - treat as optional input), thermal
  throttling (the tool's EWMA re-check already observes it; feed the observed
  multiplier back into the estimate).
- **Server cost side (Modal fallback)**: measure one real transcode of a DJI segment
  and a Legends half on Modal (GPU class TBD; `deploy_result.staging.txt` shows the
  staging app) -> $ per source-minute. The fallback also UPLOADS THE ORIGINAL first
  (server cannot shrink what it does not have), so its total time is upload-original +
  server transcode; it only wins on storage/credits, never on upload time. State this
  plainly in the rule.
- **The asymmetry**: slower uplink -> the break-even shrink time grows linearly
  (`estOriginalUploadSec - estUploadSec(shrunk)`), so the model should prefer Sharp on
  fast links and be willing to spend longer (or pick a smaller output) on slow links -
  but never below the bpp floor (quality rule beats time, EPIC decision 5).
- **Size-cap-driven bitrate**: `targetBitrate = uploadCapBytes * 8 / totalDurationSec`
  across all segments of the game; then `bpp = targetBitrate / (outWidth * outHeight *
  fps)`; if `bpp < sourceBppFloor` (DJI source ~0.098 per design R11), lower the output
  resolution (respecting crop and even dimensions) until the floor holds; if even the
  minimum acceptable resolution cannot hold the floor under the cap, the cap loses and
  the rule reports the size it WILL produce. Never upscale. Test with the real 50 GB
  folder's numbers: 68.5 min total -> 8 GB cap gives ~15.6 Mbps.
- **When NOT to shrink (must be explicit outputs, each with a numeric boundary)**:
  source bitrate already at/below the derived target; break-even bandwidth exceeded;
  probe below 0.25x and Modal cost above its bound; total estimated shrink time above
  the comfort guard on battery; capability false (Firefox) - already handled upstream
  but the rule should return `'none'` consistently.
- No UI redesign: names still never expose resolution/bitrate (EPIC decision 5); the
  tool shows mode + one plain-language reason.

## Implementation

### Steps
1. [ ] Write the cost equations with T9030's measured constants; produce the
   break-even bandwidth curve per source type and the Modal $ per source-minute.
2. [ ] Implement `pipeline/decision.js` (`decideShrink`, `deriveSizeCapBitrate`) with
   unit tests covering: DJI 50 GB on 5/10/25/50 Mbps; Legends export (must be `'none'`);
   phone clip (must be `'none'`); slow probe -> `'modal'` vs `'none'` by cost bound;
   battery + long job -> `'none'` or Small.
3. [ ] Replace `shouldOfferShrink`'s two-constant gate with `decideShrink` in the tool;
   surface mode + reason in the verdict banner; keep the presets as the fallback when
   the size-cap rule is off.
4. [ ] Run on the real folder + Legends + phone clip; record the decisions and the
   estimate-vs-actual error in the README.
5. [ ] Write the decision table (inputs -> mode, with the numeric boundaries) into
   [EPIC.md](EPIC.md); note which inputs T8850/T8860 must supply from the app.

### Progress Log

**2026-09-08**: Filed. Carries the parked "size-cap-driven bitrate (~8 GB cap, source-bpp
quality floor chooses resolution)" idea, sequenced after T9010/T9020 as agreed.

## Acceptance Criteria

- [ ] `decideShrink` is pure, DOM-free, unit-tested; every "do not shrink" branch has
      a numeric boundary and a reason string
- [ ] Break-even bandwidth per source type and Modal $ per source-minute are measured,
      not estimated
- [ ] Size-cap bitrate derivation implemented with the bpp floor; verified on the real
      folder's numbers
- [ ] Slow-connection asymmetry demonstrated in tests (lower Mbps -> longer accepted
      shrink time, never below the bpp floor)
- [ ] Decision table in EPIC.md; tool shows mode + reason on real files
