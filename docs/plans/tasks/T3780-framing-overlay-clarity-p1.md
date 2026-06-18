# T3780: Framing/Overlay Clarity P1 - Reduce On-Screen Noise

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-17
**Updated:** 2026-06-17

## Problem

Split out of T3700 (Framing & Overlay Clarity). T3700's P0 shipped (zero-effort default crop ->
valid export, non-blocking framing hint, "Export Highlight"/"Add Spotlight" button renames) and is
marked DONE. T3700's P2 (Subtle/Bold presets, keyframe-affordance polish) was dropped as not worth
doing. This task carries the remaining P1 work: lowering the cognitive load a non-technical parent
faces in the Framing and Overlay editors.

## Solution

### P1 deliverables
1. **Hide pro readouts behind "Advanced."** The per-detection **confidence %** is shown on every box
   ([PlayerDetectionOverlay.jsx:246](../../src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx#L246))
   — a "73%" badge makes the tool look unsure to a parent. Hide it (and any pixel-coordinate
   readouts, if present) behind an Advanced toggle that defaults off.
2. **Replayable hints.** Quest step hints are one-shot (only render while the step is active in
   QuestPanel). Add a "Show again" / replay affordance so a parent can re-read the current step's hint.
3. **Deep-linked navigation.** Replace the text instruction "Home -> Drafts -> tap your reel" in the
   `open_framing` step copy with a clickable deep link / "Open your reel" + "Library" nav.

### Related cleanups (cheap, outcome-first copy)
4. **Stale `open_overlay` quest copy.** It still tells users to "click the card under Drafts to open
   it in Overlay" ([questDefinitions.jsx](../../src/frontend/src/config/questDefinitions.jsx)), but
   T3720 now auto-advances them into Overlay on export complete. The copy is misleading — reword to
   match the auto-advance behavior.
5. **CropLayer jargon placeholder.** [CropLayer.jsx:118](../../src/frontend/src/modes/framing/CropLayer.jsx#L118)
   still reads "Set Crop Keyframes to animate crop window" — replace with outcome-first language
   ("Keep your player in frame") consistent with P0.2.

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — confidence % display
- `src/frontend/src/components/QuestPanel.jsx` — hint rendering (add replay)
- `src/frontend/src/config/questDefinitions.jsx` — `open_framing` + `open_overlay` step copy
- `src/frontend/src/modes/framing/CropLayer.jsx` — jargon placeholder
- `src/frontend/src/components/ExportButtonView.jsx` — where an Advanced toggle would live

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — P0 done, P2 dropped, this is P1
- T3720 (Auto-Advance) — shipped; the `open_overlay` copy fix reconciles with it

## Acceptance Criteria

- [ ] Confidence % (and any pixel readouts) hidden by default behind an Advanced toggle.
- [ ] Current quest step hint is replayable.
- [ ] Post-export navigation offers a clickable "Open your reel" / "Library" deep link.
- [ ] `open_overlay` quest copy reflects the framing->overlay auto-advance (no "click the card under Drafts").
- [ ] CropLayer placeholder uses outcome-first language (no "Set Crop Keyframes" jargon).
- [ ] Frontend-only; no persistence changes.
