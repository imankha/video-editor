# T11750: Readable action row under Mark play

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend only, 2 files + tests, ~40 LOC)
**Created:** 2026-10-04
**Decision gate:** none (recommendation only) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 2 of 4 in [Epic B: Fits on phones and tablets](EPIC.md). Runs before T11840 and T11860, which
also edit `modes/AnnotateModeView.jsx`. Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/07](../../../ux/2026-10-04-parent-usability-audit/iphone/07-new-game-editor-overflow-and-hidden-title.png).
Under the big green "Mark play" button (zero-plays state), "Review plays", "Share" and "Add footage"
all look disabled. Only Review plays actually is. Review plays uses `text-gray-600` (about 1.6:1 on
purple); the others use `text-gray-400` with 12px icons and no tap area.

## Solution

```
[ + Mark play                                  ]
  Captures 6 seconds before and 2 after.
 [lock Review plays]  ( share Share )  ( file Add footage )
```

- Container: `flex flex-wrap items-center justify-center gap-2`
- Enabled (Share, Add footage): `min-h-11 px-3 rounded-lg text-sm text-gray-100 ring-1 ring-inset ring-white/20 hover:bg-white/10 hover:text-white flex items-center gap-1.5`, icons 16
- Locked (Review plays): `min-h-11 px-3 rounded-lg text-sm text-gray-400 flex items-center gap-1.5`,
  `Lock` icon 16 instead of `ListVideo`, no ring, `aria-disabled="true"` (not `disabled`). On tap:
  `toast.info('Mark your first play to review it.', { dedupKey: 'review-locked' })`
- Locked vs enabled is carried by three cues together: no outline, lock icon, dimmer text. This is
  the same pattern the ModeSwitcher uses for locked tabs (T8480).

## Relevant Files (under `src/frontend/src/`)

- `modes/AnnotateModeView.jsx:1470-1499` - the zero-plays (`!hasAnnotateClips`) branch.
- `modes/annotate/AddFootageButton.jsx:215` - `variant="link"` classes; give the link variant the
  enabled classes above.
- `config/displayNames.js` - add `ANNOTATE.REVIEW_PLAYS_LOCKED_TOAST: 'Mark your first play to review it.'`.

## Implementation Steps

1. Replace the three elements' classes as above. Swap Review plays' icon to `Lock` and replace
   `disabled` with `aria-disabled="true"` plus an `onClick` that shows the toast.
2. Update `AddFootageButton`'s `link` variant classes so it matches Share.
3. Keep the row visually below the green hero: no fill colors, no `py-3`.

## Acceptance Criteria

1. Share and Add footage are visibly tappable (outline, light text, 44px tall).
2. Tapping Review plays with no plays shows "Mark your first play to review it." once (deduped).
3. Contrast: enabled text >= 4.5:1, locked text >= 4.5:1 against the panel background.
4. No layout change once the game has plays (that branch is untouched).

## Tests (red first)

- `modes/AnnotateModeView.cta.test.jsx:125-132` pins `text-xs` and `disabled === true` for this
  deliberate demotion. Rewrite it: no `py-3`, Review plays has `aria-disabled="true"`, clicking it
  calls the toast with the new copy.
- `modes/AnnotateModeView.addFootageRow.test.jsx:113` (link variant) - update class expectations.

## Landmines

- T10310 hides this row while a play is selected; keep that condition.
- Do not use the style guide's `text-gray-500` disabled token here: it is about 2.8:1 on this purple.
