# T8850: Shrink UI: offer card + crop step + presets

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-08

## Problem

Users with 50 GB of 8K footage need to be OFFERED the shrink (never forced), drag one crop
rect around the field, pick a quality, and see what they save - in parent language, with
zero friction added to normal small uploads.

## Solution

Two components in the Add Game modal flow: `ShrinkOfferCard` (inline, conditional) and
`ShrinkStep` (full-modal takeover with crop stage, filmstrip, presets, estimate). Output
is a `shrinkPlan {rect, preset}` attached to the pending upload; the actual encode runs at
upload time (T8860). Mockups + ALL microcopy: artifact screens E and F (link in the
Universal Upload [EPIC.md](../universal-upload/EPIC.md), decisions 4-6). This task now
lives in the Pre-Shrink Integration epic ([EPIC.md](EPIC.md)).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ShrinkOfferCard.jsx` - NEW
- `src/frontend/src/components/ShrinkStep.jsx` - NEW
- `src/frontend/src/components/GameFootagePicker.jsx` - render offer between strip and fields
- `src/frontend/src/components/GameDetailsModal.jsx` - takeover swap (mobile `fixed inset-0`,
  desktop widen to `max-w-2xl`), carry `shrinkPlan` in the submit payload
- `src/frontend/src/constants/uploadConstants.js` - NEW or extend: `SHRINK_OFFER_MIN_BYTES`
  (or, if T9050 landed, the inputs `decideShrink` needs instead of the constants)

### Related Tasks
- Depends on: **the Pre-Shrink Research epic complete**
  ([../pre-shrink-research/EPIC.md](../pre-shrink-research/EPIC.md)), then T8845
  (`capability.canShrink`, `presets.js` estimator, and `decision.js` / `cropPath.js` if
  research added them), T8820 (strip renders the "Will shrink to ~{size}" badge), T8800
  (`proxies` map for preview frames). Research inputs this UI consumes: T9050
  (`decideShrink` replaces the bytes+bitrate gate), T9020/T9060 (per-segment automated
  crops; a moving rect if tweening was adopted), T9070 (`stss` times for filmstrip
  seeks), T9080 (proxy frames mechanism)
- Blocks: T8860

### T8830 finding this task must respect
The shrink spike (T8830) found the pipeline is **encode-bound, not decode-bound**: a
1080p source and an 8K source land at nearly the same throughput once both are encoding
to the same output size - the OUTPUT preset (pixels x bitrate), not the input file's
resolution, drives processing time. The size estimator already keys off preset
bitrate x duration (correct per this finding). If this task or a later one ever adds a
live TIME estimate for the shrink step itself (not just size/upload-time), it must key
off output pixels x bitrate the same way - never off input resolution, which would
under-estimate 8K sources and over-estimate small ones.

### Technical Notes
- Offer renders ONLY when `totalBytes > SHRINK_OFFER_MIN_BYTES (3 GB)` AND the source
  bitrate exceeds `SHRINK_OFFER_MIN_BITRATE` (~10 Mbps; EPIC decision 4 as amended
  2026-09-07 from T8836 row 5 - the real Legends export is 4.67 Mbps, already BELOW every
  preset target, so a bytes-only gate would offer to "shrink" a file that cannot get
  smaller; the DJI 8K files are ~97 Mbps) AND `canShrink(...)` resolved true for every
  selected video's codec. Bitrate = `file.size * 8 / durationSeconds` from the intake's
  existing per-file metadata - no new probe. **If T9050 landed, `decideShrink` IS the
  gate** (mode `'none'` = no card) and the two constants become its defaults. **Expectation
  copy before starting** (T8840 caveat 10): shrinking pegs the machine for roughly the
  source's duration divided by the measured multiplier (use T9010/T9040's recorded Sharp
  number, do not guess) - say "about {t}; your computer will be busy while this runs",
  always prefixed "about". Card copy: "This
  upload is big - {size}" / "That's around {t} of uploading. Shrink it first and save
  time and credits." Upload-time estimate assumes 25 Mbps, always prefixed "around".
  Primary "Shrink before upload" (blue - green stays reserved for Add Game), dismiss
  "Keep as is" collapses to one reopenable line. Add Game stays enabled THE WHOLE TIME.
- Crop stage: preview frame from the FIRST segment. Frame sourcing order: (1) the
  segment's `.LRF` proxy from T8800's `proxies` (seek a `<video>` on a blob URL to
  mid-file, draw to canvas), (2) no proxy -> same technique on the main file IF the
  browser can play it, (3) neither -> a plain dark stage with the crop rect on a 16:9
  box (crop still works, preview is just blind - acceptable).
- Crop rect: free-form, corner handles visible at rest (white squares), 44px transparent
  hit boxes on coarse pointers, Pointer Events + `setPointerCapture` + `touch-none`,
  clamped to the frame, min 10% per axis. Outside area scrimmed `bg-black/60`.
  Stored normalized (0..1). Default rect on open: **the automated per-segment auto-crop
  suggestion** (T9020-tuned `suggestCropFromFrames`; superseding the original "full frame
  minus 10% top" default) - the user still pulls it in or out.
- Filmstrip: one thumb per segment (same sourcing rules); tapping swaps the stage frame
  and shows THAT segment's rect (per-segment crops, EPIC decision 5 as amended
  2026-09-08; the original "rect stays put" rule is superseded). Selected thumb
  ring-blue. Label: "Check every part of the game". "Reset crop" text button. If T9060's
  crop path was adopted, the rect shown is the path evaluated at the thumb's time.
- Preset chips: two only - "Sharp" (default) / "Small" (EPIC decision 5 as amended
  2026-09-08: the middle "Recommended" tier was cut, Sharpest/Smallest renamed), each
  with its live
  size estimate underneath (estimator from T8840 presets.js, summed over segments with
  each segment's duration). Never show resolution/bitrate/fps.
- Estimate panel: "New size: about {size}" + "Saves around {t} of uploading and {n}
  credits" - credits delta via the existing `calculateUploadCost(originalBytes)` minus
  `calculateUploadCost(estimatedBytes)`.
- Reassurance paragraph (verbatim from artifact screen F) including "You can still zoom
  in on your player later; this only trims wasted space around the field."
- Footer: "Use originals" (secondary) / "Shrink and continue" (primary). Back arrow +
  explicit close only - NO backdrop close (project rule).
- On confirm: strip header gains badge "Will shrink to ~{size}" + "Change" link that
  reopens the step; the modal's cost banner recalculates from the ESTIMATED size, marked
  "about {n} credits".

## Implementation

### Steps
1. [ ] Add `SHRINK_OFFER_MIN_BYTES` constant (or wire `decideShrink`); render
   `ShrinkOfferCard` conditionally (size AND capability); dismiss/reopen behavior.
2. [ ] Build the crop stage + handles interaction (desktop mouse + touch), normalized
   rect state, scrim, reset.
3. [ ] Build filmstrip with proxy-first frame sourcing; verify with the real DJI folder
   (proxies) AND with a proxy-less phone file (fallback path).
4. [ ] Preset chips + live estimate panel wired to the T8840 estimator.
5. [ ] Wire takeover open/close into `GameDetailsModal`; emit `shrinkPlan` in
   `onFootageChange`; badge + cost-banner recalc.
6. [ ] Tests: offer threshold gating (2.9 GB no card, 3.1 GB card, capability false no
   card); rect math (clamp, min size, normalization) as pure-function unit tests;
   estimate updates on preset/crop change; dismiss collapse/reopen; payload carries
   `shrinkPlan`. Real-browser manual pass for the drag feel on touch (jsdom pointer
   events are not evidence - real-browser rule for pointer fixes).

### Progress Log

**2026-09-05**: Filed.

**2026-09-08**: Moved from `docs/plans/tasks/universal-upload/` into the Video Pre-Shrink
milestone (Pre-Shrink Integration epic). Links re-pointed; dependencies now include the
Pre-Shrink Research epic; crop defaults updated to per-segment automated crops (EPIC
decision 5 amendment) and T9050/T9060/T9070/T9080 named as inputs.

## Acceptance Criteria

- [ ] Small uploads (< 3 GB) never see any shrink UI
- [ ] Firefox (no WebCodecs HEVC) never sees the offer - silently
- [ ] Crop rect draggable/resizable on desktop and a real phone; each segment shows its
      own rect across filmstrip taps
- [ ] Estimates update live; Add Game never disabled by any of this
- [ ] Curated test set green + manual touch pass recorded
