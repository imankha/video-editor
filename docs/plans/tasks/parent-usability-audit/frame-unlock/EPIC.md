# Epic A: Frame Highlight unlock

**Status:** TODO (decisions ruled 2026-10-04, see README decision register)
**Milestone:** [Parent Usability Audit](../README.md)
**Impact:** 10 | **Complexity:** 5
**Knowledge docs:** `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/persistence-sync.md`

## Goal

On the Focus ("Frame Highlight") screen, a parent always sees what to do to unlock Generate, on
desktop, tablet and phone. Today it is the most serious stop in the whole journey: all three audit
viewports got stuck here.

## The problem (verified in code 2026-10-04)

- A centered crop box is drawn on first load, but it is **not** a keyframe. It is the computed
  default (`modes/focus/hooks/useCrop.js:380-394`). Keyframes start as an empty flat list
  (`controllers/keyframeController.js:191-202`).
- Generate is disabled while the clip is unframed: `containers/ExportButtonContainer.jsx:1021-1034`,
  predicate `clipIsFramed` in `utils/clipSelectors.js:89-95` (any crop keyframe, segment speed, trim
  or split counts). The caption "Set at least one focus point to generate" is hardcoded in
  `components/ExportButtonView.jsx:150-158`.
- The only way to create a focus point on desktop and portrait phone is to **drag or resize the
  box** and let go: CropOverlay -> `FocusContainer.handleCropComplete`
  (`containers/FocusContainer.jsx:386-471`) -> surgical `add_crop_keyframe` action. Nothing on the
  screen says so.
- The landscape-phone cockpit already has an "Add focus point" button that calls
  `onCropComplete(currentCropState)` (`modes/focus/cockpit/FocusCockpit.jsx:135-143`,
  `CockpitTimelineStrip.jsx:146-155`). Portrait and desktop do not.
- The timeline's empty hint uses a dead rule: `modes/focus/layers/CropLayer.jsx:120` shows a hint
  only when `visibleKeyframes.length === 2` (old permanent-boundary model), so with 0 keyframes
  nothing renders.
- On iPhone the sticky Generate band (`modes/FocusModeView.jsx:998`, `components/ActionBand.jsx:39`)
  is about 130-160px tall while disabled and covers the timeline, trim and settings controls.

## Why the gate exists (keep it)

T8510 (`docs/plans/tasks/first-reel-funnel/T8510-export-guard-progress-honesty.md`, user-approved
2026-09-03) added the gate after a walkthrough where a zero-effort export burned 12 credits on a
centered crop that looked like the raw clip. The recommended option keeps the gate and adds a
visible control. **If the user picks F1 option C** (Generate allowed behind a confirm), that is a
partial reversal of T8510 and must be recorded in T8510's task file.

## Design decisions

Full proposal: [focus-unlock.md](../../../ux/2026-10-04-parent-usability-audit/design/focus-unlock.md).

- **F1 (recommended D):** an explicit "Set focus point" button on every layout (T11700), plus a coach
  chip and ring on the box and gesture-naming copy (T11710). The gate stays.
- **F2 (recommended option 1):** on phones, while locked, the band collapses to one ~52px row
  (T11720).
- Amber means "the next framing action" (button, chip, ring, caption). Blue stays reserved for the
  Generate button.
- Every new string uses "your player" and makes no tracking claim. The only motion claim allowed
  is "moves smoothly between the focus points you set".

## Tasks (strict order, shared file `modes/FocusModeView.jsx`)

| ID | Task | Status |
|----|------|--------|
| T11700 | [Set focus point button on every layout](T11700-set-focus-point-button.md) | TODO |
| T11710 | [Teach the drag: coach chip, ring and gesture-naming copy](T11710-teach-the-drag-coach-and-copy.md) | TODO |
| T11720 | [Compact locked Generate band on phones](T11720-compact-locked-band-on-phones.md) | TODO |

## Completion criteria

- [ ] At 1440, 768 and 390 a fresh clip shows a visible "Set focus point" control; one tap enables
      Generate with no drag.
- [ ] The instructions name the drag gesture; the empty timeline shows a hint at 0 focus points.
- [ ] At 390 portrait, with Generate locked, the timeline and Trim controls are visible above the
      band without scrolling to the end of the page.
- [ ] `keyframes-framing.md` updated: the button path, the 0-keyframe hint, the locked band.
