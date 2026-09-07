# T8850: Shrink UI: offer card + crop step + presets

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

Users with 50 GB of 8K footage need to be OFFERED the shrink (never forced), drag one crop
rect around the field, pick a quality, and see what they save - in parent language, with
zero friction added to normal small uploads.

## Solution

Two components in the Add Game modal flow: `ShrinkOfferCard` (inline, conditional) and
`ShrinkStep` (full-modal takeover with crop stage, filmstrip, presets, estimate). Output
is a `shrinkPlan {rect, preset}` attached to the pending upload; the actual encode runs at
upload time (T8860). Mockups + ALL microcopy: artifact screens E and F (link in
[EPIC.md](EPIC.md), decisions 4-6).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ShrinkOfferCard.jsx` - NEW
- `src/frontend/src/components/ShrinkStep.jsx` - NEW
- `src/frontend/src/components/GameFootagePicker.jsx` - render offer between strip and fields
- `src/frontend/src/components/GameDetailsModal.jsx` - takeover swap (mobile `fixed inset-0`,
  desktop widen to `max-w-2xl`), carry `shrinkPlan` in the submit payload
- `src/frontend/src/constants/uploadConstants.js` - NEW or extend: `SHRINK_OFFER_MIN_BYTES`

### Related Tasks
- Depends on: T8840 (`capability.canShrink`, `presets.js` estimator), T8820 (strip
  renders the "Will shrink to ~{size}" badge), T8800 (`proxies` map for preview frames)
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
- Offer renders ONLY when `totalBytes > SHRINK_OFFER_MIN_BYTES (3 GB)` AND
  `canShrink(...)` resolved true for every selected video's codec. Card copy: "This
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
  Stored normalized (0..1). Default rect on open: full frame minus 10% top - do NOT
  pre-guess the field; let the user pull it in.
- Filmstrip: one thumb per segment (same sourcing rules); tapping swaps the stage frame,
  THE RECT STAYS PUT (that is how one static crop is verified across segments). Selected
  thumb ring-blue. Label: "Check every part of the game". "Reset crop" text button.
- Preset chips: "Sharpest" / "Recommended" (default) / "Smallest", each with its live
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
1. [ ] Add `SHRINK_OFFER_MIN_BYTES` constant; render `ShrinkOfferCard` conditionally
   (size AND capability); dismiss/reopen behavior.
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

## Acceptance Criteria

- [ ] Small uploads (< 3 GB) never see any shrink UI
- [ ] Firefox (no WebCodecs HEVC) never sees the offer - silently
- [ ] Crop rect draggable/resizable on desktop and a real phone; stays put across
      filmstrip taps
- [ ] Estimates update live; Add Game never disabled by any of this
- [ ] Curated test set green + manual touch pass recorded
