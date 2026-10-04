# T11700: Set focus point button on every layout

**Status:** TODO
**Impact:** 10
**Complexity:** 3
**Tier:** M (frontend only, ~5 files, ~170 LOC including tests)
**Created:** 2026-10-04
**Decision gate:** F1 (recommended option D; this task is the "B" half)

## Epic Context

Task 1 of 3 in [Epic A: Frame Highlight unlock](EPIC.md). Read the EPIC for the verified mechanism
and why the T8510 gate stays. Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/05](../../../ux/2026-10-04-parent-usability-audit/desktop/05-frame-editor-focus-point-confusion.png),
[iphone/08](../../../ux/2026-10-04-parent-usability-audit/iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png).
The parent sees a box already around their player, but Generate stays disabled. The only working
gesture (drag the box and let go) is never shown. A parent who believes "the box is already on my
kid" has nothing to tap.

## Solution

Add a "Set focus point" button directly under the video on desktop, tablet and portrait phone. It
does exactly what the landscape cockpit's "Add focus point" button already does: it calls
`onCropComplete` with the crop box as it is now, which goes through the one existing write path.

| State | Label | Style |
|-------|-------|-------|
| 0 focus points | **Set focus point** | amber call-to-attention (classes below) |
| 1+ focus points | **Add focus point** | gray secondary (same as the other FramingActionRow buttons) |
| Just tapped | inline check + **Focus point set at 0:02** for ~2.5s | `text-xs text-green-400` |

Tooltip (desktop `title`): **Sets a focus point using the box where it is now**

## Relevant Files (all under `src/frontend/src/`)

- `modes/focus/cockpit/FocusCockpit.jsx:135-143` - `addFocusPointAtPlayhead`, the pattern to copy.
- `modes/focus/cockpit/CockpitTimelineStrip.jsx:146-155` - the cockpit button (amber `Plus`).
- `modes/focus/FramingActionRow.jsx` - desktop row under the stage; secondary button classes at
  `:27-31` (`rounded-lg border px-3 py-2 text-sm font-medium coarse-pointer:min-h-11`, idle
  `border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700`). Mounted at `FocusModeView.jsx:853`.
- `modes/FocusModeView.jsx` - `currentCropState` and `onCropComplete` are already in scope around
  `:683-693`; focus point count is computed at `:336` (keyframes where `origin !== 'trim'`).
- `containers/FocusContainer.jsx:386-471` - `handleCropComplete` (do not change; reuse).
- `config/displayNames.js:544` - `FOCUS_COCKPIT.ADD_FOCUS_POINT` = "Add focus point".

## Implementation Steps

1. **Strings.** In `config/displayNames.js` add a `FOCUS_EDITOR` group (or extend an existing focus
   group) with `SET_FOCUS_POINT: 'Set focus point'`, `ADD_FOCUS_POINT` (reuse the cockpit value, do
   not duplicate the literal), `SET_FOCUS_POINT_TOOLTIP: 'Sets a focus point using the box where it is now'`,
   and `FOCUS_POINT_SET_AT: (time) => \`Focus point set at ${time}\``.
2. **Handler.** In `FocusModeView.jsx` add `handleSetFocusPointHere` that mirrors
   `addFocusPointAtPlayhead`: read `currentCropState` (`{x, y, width, height}`) and call
   `onCropComplete({ x, y, width, height })`. If you prefer, lift the cockpit function into one shared
   helper and use it in both places; do not create a second write path.
3. **Confirmation.** In the click handler (not a `useEffect`), set a local `justSetAt` state to the
   formatted playhead time, and clear it with a 2500ms timeout (clear the timeout on unmount).
   The copy says "set", never "saved".
4. **Desktop/tablet placement.** Pass `onSetFocusPoint` and `focusPointCount` into
   `FramingActionRow` and render the button **first**, left of "Preview highlight".
   - 0 points: `flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/25 coarse-pointer:min-h-11`, icon `Plus` size 16.
   - 1+ points: the existing gray secondary classes, label "Add focus point".
5. **Portrait phone placement.** Below `sm`, render the same button full width directly under the
   stage (`w-full justify-center`, 44px tall), above `RotateNudge` (`FocusModeView.jsx:796-802`).
   Render the confirmation as one centered line under it.
6. **Hide while previewing.** Do not render the button while `previewActive` is true.
7. **Analytics.** `handleCropComplete` already fires `FUNNEL_EVENTS.FRAMING_POINT_ADDED` with
   `path:'manual'`. Pass a distinguishing tag (`path:'button'`) only if `handleCropComplete` already
   accepts one; otherwise leave analytics alone and note it in the PR.

## Acceptance Criteria

1. Fresh clip, 0 focus points, no drag: tapping **Set focus point** creates one keyframe at the
   current frame with the visible box, and Generate becomes enabled immediately.
2. The request sent is the same surgical `add_crop_keyframe` action a drag sends (check the network
   tab or the action spy in tests).
3. After the first point the button reads **Add focus point** in gray styling.
4. "Focus point set at m:ss" appears for about 2.5s after a tap and then disappears.
5. Works at 1440, 768 and 390 portrait. The landscape cockpit is unchanged.
6. Tapping within 10 frames of an existing keyframe updates that keyframe (existing snap rule), and
   the label still behaves correctly.

## Tests (write first, watch them fail, then implement)

- New `modes/FocusModeView.setFocusPoint.test.jsx`: renders with 0 keyframes, finds "Set focus
  point", clicks it, asserts `onCropComplete` was called once with the current crop rect; with 1
  keyframe asserts the label "Add focus point".
- Update `modes/focus/FramingActionRow.test.jsx` for the new first button.
- Regression set to run: `ExportButtonContainer.test.js`, `utils/clipSelectors.test.js`,
  `modes/focus/cockpit/__tests__/CockpitTimelineStrip.test.jsx`, `CropOverlay.test.jsx`.
- E2E (run locally): extend `e2e/T8510-export-guard.qa.spec.js` with "tap Set focus point, Generate
  enables" at 1440 and 390.

## Landmines

- `currentCropState` reflects a live drag. Disable the button while a drag is in progress.
- Do not write anything on mount or when the default box is computed (coding-standards
  § Persistence, rule 3: runtime fixups are memory-only).
- The T8510 gate stays exactly as it is. This task never enables Generate for an untouched clip.

## If the user picks a different F1 option

- **A (teach the drag only):** skip this task; T11710 carries the whole fix.
- **C (Generate behind a confirm):** replace this task with a confirm in `ExportButtonContainer`
  (see focus-unlock.md option C) and record the partial reversal in T8510's task file.
