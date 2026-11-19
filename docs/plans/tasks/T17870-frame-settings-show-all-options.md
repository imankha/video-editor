# T17870: Frame settings show every option instead of hiding two under "More options"

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

In Frame on desktop, the Settings panel on the right shows Shape and Include audio, then a collapsed "More options" link. Behind it are just two settings: "Fix a tilted camera" and "Darken outside the box". The panel has plenty of empty room below, so hiding them only makes a parent click to find out what exists. The owner, testing staging on 2026-11-19: "I don't see a point of hiding settings under More options when there is plenty of room to just show those options. I get it for mobile or when things are tight, but here I'd rather just know what those options are."

## Ruling

Owner, 2026-11-19: show the options directly when there is room. Collapsing is only for mobile or tight layouts.

## Solution

- In `src/frontend/src/components/settings/FocusSettingsPanel.jsx`, remove the "More options" disclosure (button, `moreOpen` state, chevron) and render the "Fix a tilted camera" and "Darken outside the box" rows directly, as their own group under the Shape / Include audio group, with the same `SettingRow` anatomy and a plain group heading in the same style as the existing "Video" heading if the panel's grouping calls for one.
- Keep today's gating: these two rows stay desktop-only (`desktopOnly`); the phone drawer and the landscape cockpit are unchanged.
- Remove `EDITOR_PANELS.MORE_OPTIONS` from `src/frontend/src/config/displayNames.js` if nothing else uses it, and update the T12180 comment in the panel.
- Copy rules: no em dashes; never "Focus" or "clip" in visible copy.

## Relevant Files

- `src/frontend/src/components/settings/FocusSettingsPanel.jsx`
- `src/frontend/src/config/displayNames.js`

## Acceptance Criteria

- [ ] C1: In Frame at 1440 x 900, the Settings panel shows "Fix a tilted camera" and "Darken outside the box" with their controls without any click, and no "More options" control exists.
- [ ] C2: Both controls still work from the panel: Fix a tilted camera turns the straighten tool on and off, Darken outside the box turns the dim on and off.
- [ ] C3: At phone width the Frame settings drawer is unchanged (neither row appears there, as before).
