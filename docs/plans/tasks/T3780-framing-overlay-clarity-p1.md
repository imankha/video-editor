# T3780: Framing/Overlay Clarity - Reduce On-Screen Noise

**Status:** DONE
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-17
**Updated:** 2026-06-18

> **Shipped (deploy 2026-06-18), with one divergence:** criteria 1, 2, 4, 5(partial), 6 met
> — confidence % badge removed, count/crop readouts left intact, `open_framing` "Open your reel"
> deep link added, CropLayer placeholder rewritten outcome-first. **Criterion 3 (replayable quest
> hint) was intentionally dropped** during review (commit `94e03f8a`); QuestPanel reverted to
> always showing the current step's hint. The `open_overlay` reword (criterion 5) was minimal —
> the copy still references the Drafts card; accepted as-is.

## Problem

The Framing and Overlay editors surface technical readouts and jargon that mean nothing to a
soccer parent and make the tool feel intimidating. Quest hints also disappear the moment a step
completes, and one step's wayfinding copy is stale. This task strips the noise and fixes the copy.

## Solution

### 1. Remove the Overlay confidence % readout (frontend-only)

The audience is soccer moms and dads. The per-detection **confidence %** — the "73%" badge on
every player box
([PlayerDetectionOverlay.jsx:227-247](../../src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx#L227-L247),
the "Confidence label" `rect` + `text`) — makes the tool look unsure. Remove the badge outright
(no "Advanced" mode, no toggle, no replacement). The box outline and the "Click to highlight"
hover hint must keep working.

**Keep, deliberately:**
- The top-right "N players detected" count badge
  ([PlayerDetectionOverlay.jsx:279-289](../../src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx#L279-L289))
  — it reassures the parent we found their players. Leave it as-is.
- The Framing crop-dimension readout "356x634 @ (647, 170)"
  ([CropOverlay.jsx:489-499](../../src/frontend/src/modes/framing/overlays/CropOverlay.jsx#L489-L499))
  — already gated to non-production builds, so a parent never sees it in prod. Leave it as-is.

### 2. Replayable quest hints

Quest step hints are one-shot: [QuestPanel.jsx](../../src/frontend/src/components/QuestPanel.jsx)
renders the current step's description (`STEP_DESCRIPTIONS[stepId]`) only inside the
`isCurrent && (...)` block (~L321), so once a step completes the hint is gone. Add a "Show again"
/ replay affordance scoped to the **current** step so a parent can re-read the active hint.

### 3. Deep-linked navigation in `open_framing`

[questDefinitions.jsx:109](../../src/frontend/src/config/questDefinitions.jsx#L109) — the
`open_framing` description reads "Click the Home button (top-left), open Drafts, then tap your
reel to start framing." Replace the text wayfinding with a clickable "Open your reel" / Library
deep link that takes the parent straight in. `STEP_DESCRIPTIONS` entries are JSX, so an `onClick`
is viable. Reuse the app's existing reel-open navigation (`editorStore` `setEditorMode` + how
ProjectsScreen/FramingScreen open a reel) — do not build a parallel nav path.

### 4. Stale `open_overlay` quest copy

[questDefinitions.jsx:115](../../src/frontend/src/config/questDefinitions.jsx#L115) — still says
"Click the reel's card under Drafts to open it in Overlay mode...", but framing now auto-advances
the user into Overlay on export complete (T3720). The user is already in Overlay. Reword to tell
them what to **do** there (add a spotlight to their player), not how to navigate.

### 5. CropLayer jargon placeholder

[CropLayer.jsx:118](../../src/frontend/src/modes/framing/layers/CropLayer.jsx#L118) reads
"Set Crop Keyframes to animate crop window" — replace with outcome-first language
("Keep your player in frame"), consistent with the rest of the framing copy.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — confidence % badge to remove (L227-247); leave the "N players detected" count (L279-289)
- `src/frontend/src/components/QuestPanel.jsx` — hint rendering (add replay)
- `src/frontend/src/config/questDefinitions.jsx` — `open_framing` (L109) + `open_overlay` (L115) step copy
- `src/frontend/src/modes/framing/layers/CropLayer.jsx` — jargon placeholder (L118)

## Acceptance Criteria

- [ ] Overlay confidence % badge removed; box outline + "Click to highlight" hover still work.
- [ ] "N players detected" count and Framing crop-dims readout left unchanged.
- [ ] Current quest step hint is replayable.
- [ ] `open_framing` offers a clickable "Open your reel" / "Library" deep link (no text wayfinding).
- [ ] `open_overlay` quest copy reflects the framing->overlay auto-advance (no "click the card under Drafts").
- [ ] CropLayer placeholder uses outcome-first language (no "Set Crop Keyframes" jargon).
- [ ] Frontend-only; no persistence changes.
