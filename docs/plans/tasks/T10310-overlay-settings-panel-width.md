# T10310: Overlay/Spotlight settings panel is too narrow to use

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging: "In overlay/spotlight, the settings panel lacks width and isn't usable
as skinny as it is. Maybe we need less padding on the app in general or maybe the panel should
just take more width, I don't know, ask the UX expert."

The rail is `src/frontend/src/components/settings/SettingsRail.jsx:101`, fixed at `w-[316px]
max-w-full` (shared by Overlay and Focus; T9920 fixed its parked-drawer overflow). The Spotlight
panel (`OverlaySpotlightPanel.jsx`, T9620/T9960) stacks player picker + color + interval + fill
controls inside that width.

## Solution

1. **ui-designer agent first** (the user asked for the UX expert): audit the rail at 1024/1280/
   1440/1920 and at the parked-drawer widths, with the Spotlight panel contents, and propose
   options with mockups as a decision artifact: (a) wider rail (e.g. 380-420px) above `lg`; (b)
   less global gutter padding so the rail can grow without shrinking the video; (c) a two-column
   layout inside the panel for compact controls; (d) collapsible sections. Include which
   controls are actually cramped (screenshots), and keep Focus's rail consistent.
2. User picks; implement the chosen option in `SettingsRail.jsx` + the panel(s); T9920's
   overflow tests must still pass; add a width assertion at the breakpoints.

## Context

### Relevant Files
- `src/frontend/src/components/settings/SettingsRail.jsx` (+ test)
- `src/frontend/src/modes/OverlayModeView.jsx`, `src/frontend/src/components/OverlaySpotlightPanel.jsx`
- `src/frontend/src/modes/FocusModeView.jsx` (shares the rail)
- `.claude/references/ui-style-guide.md`

### Related Tasks
- Follows T9920 (narrow/fullscreen layouts) and T9150->T9270 (rail flexbox)

## Acceptance Criteria

- [ ] Decision artifact with at least two options reviewed by the user
- [ ] Chosen layout implemented; Spotlight controls usable at 1280px without truncation
- [ ] Focus rail stays consistent; T9920 tests green; screenshots at 1024/1280/1920
