# T14730: Full-screen button for the admin Journey map

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Tier:** M
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "I want to be able to full screen."

## Problem

The Journey map on the admin screen is wider than its panel. With stages expanded, the admin has to
drag a horizontal scrollbar to see the right half (prod screenshots 2026-11-03 show the map cut off
at "Watched result"). There is no way to see the whole map at once.

## Solution

Add a **Full screen** button to the Journey section. Clicking it shows the Journey (filter pills,
loss ranking, map, legend and inspector) over the whole screen; **Esc** or an **Exit full screen**
button returns to the normal admin page.

- Use the browser Fullscreen API on the Journey container: `element.requestFullscreen()` /
  `document.exitFullscreen()`, and listen for `fullscreenchange` so the button label stays correct
  when the user presses Esc. Keep "is full screen" as React state (view state only, never saved).
- In full screen the container needs its own background (`bg-[#...]` matching the admin page) and
  `overflow-auto`, otherwise the browser shows it on black and long content cannot scroll.
- In full screen, size the map to the screen width so all visible stages fit without the
  horizontal scrollbar when possible. The SVG already has a `viewBox`; set the SVG to
  `width="100%"` in full screen so it scales. Keep the existing scroll when the map would become
  too small to read (pick a sensible minimum column width, e.g. 90px per stage, and note it).
- Button: a small icon button at the top right of the Journey section, the same style as the other
  admin pill buttons (see `PillGroup` in `JourneyTab.jsx`). Label "Full screen" / "Exit full
  screen", with an `aria-label`.
- If `document.fullscreenEnabled` is false (older iOS Safari), hide the button. It is an admin
  tool used on desktop.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/admin/JourneyTab.jsx` - `JourneyTab` (wrap its content in the full-screen container, add the button and state)
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - the outer `<div className="overflow-x-auto">` and `<svg width={width} ...>`; take a prop such as `fit` to switch to `width="100%"`
- `src/frontend/src/components/admin/JourneyTab.test.jsx` - add tests
- `src/frontend/src/screens/AdminScreen.jsx` - only for reference: the Journey sits in a `CollapsibleSection`
- `.claude/references/ui-style-guide.md` - button style

### Related Tasks
- Runs after the Copy audit milestone. Button copy follows its style rules ([copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)): sentence case ("Full screen", "Exit full screen"), no em dashes or "--", and new strings go in `src/frontend/src/config/displayNames.js` if the admin screen already reads labels from there (check first; if admin keeps its strings inline, match that).
- None blocking. Touches the same files as T14720 and T14740; coordinate if they run at the same time.

### Technical Notes
- jsdom (Vitest) does not implement the Fullscreen API. In tests, stub
  `Element.prototype.requestFullscreen`, `document.exitFullscreen` and `document.fullscreenElement`,
  and fire a `fullscreenchange` event to check the label flips back after Esc.
- Do not use a CSS-only "fixed inset-0" overlay unless the Fullscreen API is unavailable. The real
  full screen hides the browser chrome, which is the point.

## Implementation

### Steps
1. [ ] Write failing Vitest tests: the button calls `requestFullscreen` on the Journey container; after `fullscreenchange` with `fullscreenElement` set, the label reads "Exit full screen"; clicking it calls `exitFullscreen`; after `fullscreenchange` with no element, the label is back to "Full screen"; the button is hidden when `fullscreenEnabled` is false
2. [ ] Implement the button and state in `JourneyTab`
3. [ ] Add the `fit` mode to `JourneyFlowChart`
4. [ ] Check it by hand in a real browser (`npm run dev`, admin screen, Journey): enter, expand all groups, Esc, re-enter. Attach a screenshot to the PR
5. [ ] Run `JourneyTab.test.jsx` and lint changed files

### Progress Log

## Acceptance Criteria

- [ ] A Full screen button on the Journey section puts the whole Journey (controls, map, inspector) in browser full screen
- [ ] Esc and the Exit button both return to the admin page, and the button label is right either way
- [ ] In full screen the map fills the screen width and shows all stages without horizontal scrolling on a 1440px-wide screen with all groups expanded
- [ ] The full-screen view has the admin background and scrolls vertically
- [ ] Clicking stages and drop ribbons still works in full screen
