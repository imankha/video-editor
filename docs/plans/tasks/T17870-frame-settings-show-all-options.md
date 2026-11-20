# T17870: Frame settings show every option instead of hiding two under "More options"

**Status:** STAGING
**Impact:** 4
**Complexity:** 1
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

In Frame on desktop, the Settings panel on the right shows Shape and Include audio, then a collapsed "More options" link. Behind it are just two settings: "Fix a tilted camera" and "Darken outside the box". The panel has plenty of empty room below, so hiding them only makes a parent click to find out what exists. The owner, testing staging on 2026-11-19: "I don't see a point of hiding settings under More options when there is plenty of room to just show those options. I get it for mobile or when things are tight, but here I'd rather just know what those options are."

## Ruling

Owner, 2026-11-19: show the options directly when there is room. Collapsing is only for mobile or tight layouts.

Owner, 2026-11-19 (added after the group started): "Darken outside the box" is not a setting, and "we actually don't even need dim anymore, we have preview, so just remove it." Remove the dim feature entirely; Preview covers seeing the framed result.

## Solution

- In `src/frontend/src/components/settings/FocusSettingsPanel.jsx`, remove the "More options" disclosure (button, `moreOpen` state, chevron) and render the "Fix a tilted camera" row directly, with the same `SettingRow` anatomy (desktop-only, as today).
- Remove the dim ("Darken outside the box") feature end to end: its Settings row, the `dimOpacity` / `onToggleDim` props and state (`src/frontend/src/modes/FocusModeView.jsx`, `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx`), the dim drawing in `src/frontend/src/modes/focus/overlays/CropOverlay.jsx`, its copy (`EDITOR_PANELS.DARKEN_OUTSIDE`, `DARKEN_OUTSIDE_HELP`), and tests that assert it (`FocusSettingsPanel.test.jsx`, `FocusSettingsPanel.shape.test.jsx`, `spotlightVocabulary.test.jsx`). Grep `src/`, `e2e/` and `scripts/` for leftovers and run `python scripts/check_dead_code.py`. The crop box overlay itself and Preview stay unchanged.
- `src/frontend/src/modes/FocusModeView.jsx` is also edited by the concurrent group g-t17860-1 (T17860, trim button); merge origin/master before PUSHREADY.
- Keep today's gating for Fix a tilted camera: desktop-only (`desktopOnly`); the phone drawer is otherwise unchanged.
- Remove `EDITOR_PANELS.MORE_OPTIONS` from `src/frontend/src/config/displayNames.js` if nothing else uses it, and update the T12180 comment in the panel.
- Copy rules: no em dashes; never "Focus" or "clip" in visible copy.

## Relevant Files

- `src/frontend/src/components/settings/FocusSettingsPanel.jsx`
- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx`
- `src/frontend/src/modes/focus/overlays/CropOverlay.jsx`

## Acceptance Criteria

- [ ] C1: In Frame at 1440 x 900, the Settings panel shows "Fix a tilted camera" with its control without any click, and no "More options" control exists.
- [ ] C2: Fix a tilted camera still turns the straighten tool on and off from the panel.
- [ ] C3: "Darken outside the box" is gone everywhere: no row in Settings on any width, no dimming outside the crop box while framing, and no dim code or copy left in `src/frontend/src` (grep for `dimOpacity`, `onToggleDim`, `DARKEN_OUTSIDE` finds nothing); Preview still works.
- [ ] C4: At phone width the Frame settings drawer is otherwise unchanged.
