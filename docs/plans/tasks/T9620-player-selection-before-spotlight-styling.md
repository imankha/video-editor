# T9620: Lead spotlight editing with player selection, not styling controls

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-10, N29, N30 (handoff E5-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Opening the spotlight editor puts an **unassigned ellipse on the grass** while stroke width, fill
and dim controls dominate the panel. The first task (pick your player) is not the most prominent
thing on screen. Detection markers render as numbers (`10 . 13 . 14 . 14`) that read as **jersey
numbers** rather than player counts.

## Solution

- **"Click your player"** is the primary task, stated on screen without a tooltip.
- **Suppress the spotlight until a player is assigned** - no ellipse on empty grass.
- Reveal styling controls after assignment.
- Label detection numbers as counts, unmistakably not jersey identities.
- After selection, show the selected state and say clearly if further checkpoints need assigning.
- Keep **Preview spotlight** (the loop) distinct from **Play full clip**.

## Context

### Relevant Files
- `src/frontend/src/modes/OverlayModeView.jsx` and the spotlight settings panel
- Player-detection box rendering (see T9100/T9150 for the metadata pairing landmines)
- `src/frontend/src/config/displayNames.js`

### Related Tasks
- T9550 - spotlight styling vocabulary (Outline thickness / Spotlight fill / Dim background)
- T9700 - selection and duration persistence on reopen
- T9100, T9150 (STAGING) - detection-box alignment and the Overlay metadata half-record bug class.
  **Read those before touching detection rendering.**

### Technical Notes
Mode name stays **Spotlight** (T9320, reaffirmed by the user 2026-09-10). The report's N18
"Effects" recommendation is overridden.

## Acceptance Criteria

- [ ] The initial task is clear without a tooltip
- [ ] No spotlight renders on empty space before assignment
- [ ] Detected-count labels cannot be mistaken for jersey numbers
- [ ] Styling controls appear after selection, not before
- [ ] Preview spotlight and Play full clip stay distinct
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
