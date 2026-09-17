# T10310: Overlay/Spotlight settings panel is too narrow to use

**Status:** WIP (user approved the ui-designer's A+B recommendation 2026-09-17, decision artifact
https://claude.ai/artifact/SPnV7hN7zm1hpWPQSvvjPZ — implementation starting)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Decision (2026-09-17)

User approved **Option A + Option B together** from the decision artifact:

- **Finding 1** (the bug as filed): `SettingsRail.jsx:158` hard-codes the expanded desktop rail at
  `300px` (inline `width: collapsed ? '64px' : '300px'`), gated only by `hidden lg:flex` — it never
  changes above the `lg` breakpoint, which is why 1280px and 1920px measured identically.
- **Finding 2** (found while auditing, not in the original task description): the Focus/Overlay
  page shell (`App.jsx:985`) is wrapped in Tailwind's `container` utility, which tops out at
  `1536px` (the `2xl` breakpoint) — at 1920px this caps the whole header+video+rail block and
  centers it, wasting the space either side.

**Option A**: bump the rail's fixed width `300px` -> `380px`. **Option B**: replace `App.jsx:985`'s
`container` class with an explicit wider cap (`max-w-[1800px]`) so the freed width goes somewhere.
Both are single-file, single-constant changes. See the artifact for the full options table
(C: two-column compact layout, D: collapsible sections — both considered, not chosen) and the
tradeoff analysis.

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
