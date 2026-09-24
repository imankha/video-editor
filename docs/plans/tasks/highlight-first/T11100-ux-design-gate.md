# T11100: UX design gate - badges, Done popup, rating gate, mode bar

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

T11120-T11140 change the Annotate play editor's shape: the rating becomes required, the clip
badge's "Create clip" nudge disappears, and a popup replaces the Frame Now / Frame Later row.
The existing named / rated / noted / clip badge row (`PlayProgressBadges.jsx`) was designed
around the old optional-rating + nudge model and has to be redesigned before implementation.

## Solution

ui-designer produced a mockup artifact with labelled options; the user picks one per section.
The picks become binding inputs for T11130 (badges, popup), T11120 (gate), T11140 (mode bar).

| Section | Options | What it decides |
|---|---|---|
| A | A1 / A2 / A3 | Badge-row concept in the play editor (desktop + 393 px), states: unrated / 1-4 / Highlight / clip exists |
| B | B1 / B2 | Done popup presentation + exact copy, incl. the Keep Annotating teaching line |
| C | C1 / C2 | What Done does with no rating (inline required state vs disabled Done + hint) |
| D | D | Mode bar in 3 states (no clip / clip exists / in Frame Highlight), disabled-tab explanation |

Copy constraints (standing rules): no em dashes; never claim the AI frames or tracks
automatically (user frames, AI upscales and finds players); never close a modal on backdrop
click.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - current badge row
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - play editor (5 layouts)
- `src/frontend/src/modes/AnnotateModeView.jsx` - Frame Now / Frame Later row (T10450)
- `src/frontend/src/components/shared/ModeSwitcher.jsx` - mode bar
- `src/frontend/src/config/displayNames.js` - all copy

### Related Tasks
- Blocks: T11120, T11130, T11140
- Artifacts: mockups + decision artifact (links recorded in the Progress Log)

## Progress Log

**2026-09-24**: Filed. Mockups: https://claude.ai/artifact/FFGqtZQnE4a9n9PHjANaeA (ui-designer
recommends A1, B2, C1, D as shown). Decision artifact (answers stored in its `answers` db
collection, one doc per question id): https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB, covering
H1-H14 (H12 split into H12A-D) and R1-R12.

## Acceptance Criteria

- [ ] User has picked A, B, C, D options (or given a redirect)
- [ ] Picks recorded in this file and copied into T11120 / T11130 / T11140
