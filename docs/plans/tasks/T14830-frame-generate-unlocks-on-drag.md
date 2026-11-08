# T14830: Frame: Generate unlocks on the first box drag; pressing Play becomes advice, not a lock (decision)

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-07

## Problem

Prod Journey (2026-11-03): **Moved framing window 77 reached, 42 lost (1 stuck, 41 gone),
11 in window.** On the chart that is a 55% loss between dragging the box and exporting, the
worst ratio in the funnel. Part of that number is instrumentation (T14710: the Frame export
records no `export_completed`, so parents who exported but skipped Spotlight look lost here),
and T14710 must land first so the true loss is known. But the walk-through found a real
friction at exactly this spot that stays true whatever the corrected number is:

**Generate highlight is locked until the parent has dragged the box AND pressed Play.** The
lock label reads "Drag the box onto your player, then press Play, to unlock". In code
(`src/frontend/src/modes/FocusModeView.jsx` ~354-359): `stepsComplete = dragDone && hasPlayed`,
where `hasPlayed` is set when `isPlaying` first becomes true. The Play half was added on
2026-10-06 (commit eb77f3aa4, "locked Generate") together with the 5-step coach. The parent
usability audit ruling **F1 (2026-10-04) kept only the drag gate** (option D: "Set focus
point" button + coach chip, keep the T8510 gate); the Play requirement was never ruled on.

Why it costs exports: a parent who dragged the box and is happy taps the big teal Generate
card and nothing happens (it is disabled, with a caption). On a phone the caption is one line
under a card at the bottom of a scrolling screen. The 5-step coach does lead through Play and
Preview, but only while Guidance is on and only if the parent reads it; T14760 shows the
coach itself can stall on this screen.

## Ruling

**"Confirm once"** (owner, 2026-11-07). Replaces F1. Generate, Trim/Slow-mo and Preview are
never disabled by drag or Play, in portrait and in the landscape cockpit -- only a missing
video blocks them. When Generate is pressed and the parent has neither moved the box nor
checked it, show one warning before any credits are spent; playing the clip with a
pre-placed box counts as checked. A multi-clip highlight with several untouched clips still
shows only one warning. Continuing proceeds with the export normally; the other button
closes the warning and spends nothing. Warning copy (`FOCUS_BOX_CONFIRM` in
`displayNames.js`): title "Is your athlete in the box?", body "You haven't moved the box, so
it's still in the middle. Sharpening uses credits.", buttons "Check the box" / "Sharpen my
highlight". Guidance stays advice: coach steps still suggest the box, Play and Preview but
block nothing. T8510's credit protection now comes from this warning instead of a lock.

## Solution

Implemented per the owner's "Confirm once" ruling above: remove every lock gate (drag/Play)
from Generate, Trim/Slow-mo and Preview in both portrait and the landscape cockpit, and add a
one-time pre-spend confirmation dialog on Generate when the box is unchecked. Copy follows
the glossary (box, athlete, Sharpen my highlight).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx` - `hasPlayed`, `dragDone`, `stepsComplete`, lock caption
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx` - landscape-phone cockpit mirrors the gate
- `src/frontend/src/components/instructions/resolveGuide.js` + GUIDE copy table - `focus.progress.*` steps (step 2 "Tap Play" stays as advice)
- `src/frontend/src/modes/FocusModeView.*.test.jsx` - gate tests
- `docs/plans/tasks/parent-usability-audit/README.md` - ruling F1 (drag gate stays)

### Related Tasks
- Depends on: T14710 (so the before/after can be measured on real Exported counts). Can be implemented before it lands; the measurement comes after.
- Related: T14760 (Frame guidance starts at step 2 and stalls), T12630 (lock label), T8510 (original drag gate), T11700/T11710 (F1 implementation).

### Technical Notes
- `hasPlayed` is derived in render (no effect), keep that pattern if option B is chosen.
- Never persist any of these flags (view state).

## Implementation

### Steps
1. [x] Owner ruled "Confirm once" (2026-11-07) -- see Ruling above.
2. [x] Remove every remaining lock (`disabled`/`guideLocked` in `FocusModeView.jsx`, `locked` in `FramingActionRow.jsx`, `hasUnframedClips` gate in `ExportButtonContainer.jsx`) and all lock captions/copy requiring drag or Play.
3. [x] Add the "Is your athlete in the box?" `ConfirmationDialog` on Generate, gated on `boxChecked` (moved or played-while-pre-placed); wired through `ExportButtonContainer` -> `ExportButtonView`, and through `FocusModeView`/`FocusCockpit`'s `boxChecked` prop.
4. [x] Vitest: never-locked gates (portrait + landscape cockpit), confirm-dialog show/continue/close behavior. Playwright: a parent who never touches the box can export, including an unframed clip with no pre-placed box.
5. [ ] After T14710 is on prod: record Moved framing window -> Exported before/after in this file.

### Progress Log

**2026-11-03**: Filed from the funnel walk (desktop and phone) + prod journey screenshot. Not started. Decision pending.

**2026-11-07**: Implemented option A (drag-only gate, Play became advice). Superseded same day.

**2026-11-07 (owner ruling "Confirm once")**: Removed the drag gate entirely. `hasUnframedClips`
in `ExportButtonContainer.jsx` no longer disables the button; it now only drives a new
`needsBoxConfirm` (Framing + unframed + `!boxChecked`) that opens a `ConfirmationDialog`
("Is your athlete in the box?") on Generate press instead of blocking it. `boxChecked` is the
container's name for the existing `dragDone` signal (drag OR play-while-pre-placed),
threaded in from `FocusModeView.jsx` (`boxChecked={dragDone}`) and `FocusCockpit.jsx`
(`boxChecked={boxPrePlaced && hasPlayed}` -- the cockpit tracks its own `hasPlayed` since it
has no separate drag-gesture ref; an actual crop move is already reflected in
`hasUnframedClips`' real crop-data check). `FramingActionRow`'s `locked` prop and
`ActionBand`'s `compactLocked` phone-only band (T11720) are both removed -- nothing left to
show a locked state for. All `FOCUS_HINTS.GENERATE_LOCKED*`/`FRAMING_GUIDE.LOCKED_TITLE` copy
and the `export-unframed-caption` dead. New `FOCUS_BOX_CONFIRM` copy block added to
`displayNames.js`. Confirmed via Playwright (`e2e/T14830-never-touch-box-export.spec.js`,
dev preset `full`, project 64 which has `has_crop_keyframes: false`) that Generate is enabled
untouched, the warning shows on press, and "Sharpen my highlight" in the dialog proceeds with
the export.

## Acceptance Criteria

- [x] Generate, Trim/Slow-mo and Preview are never disabled by drag or Play, in portrait and in the landscape cockpit. Only a missing video blocks them.
- [x] A new small dialog shows when Generate is pressed and the parent has neither moved the box nor checked it, before any credits are spent. Playing the clip with a pre-placed box counts as checked. A multi-clip highlight with several such clips still shows only one warning. Continuing proceeds with the export normally; the other button closes the dialog and spends nothing.
- [x] Warning copy lives in `displayNames.js`: title "Is your athlete in the box?", body "You haven't moved the box, so it's still in the middle. Sharpening uses credits.", buttons "Check the box" and "Sharpen my highlight".
- [x] Guidance stays advice: coach steps still suggest the box, Play and Preview but block nothing.
- [x] Confirmed in the real app (Playwright) that a parent who never touches the box can export, including a clip with no pre-placed box.
