# T9480: One time-format rule, exact trim entry, and honest billable duration

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-12

**Design approved 2026-09-12**: `docs/plans/tasks/T9480-design.md`, full scope (including Stage
D3 shared-player default and D4 falsy-guard removal). Real count of duplicate time formatters:
19 named + 6 inline across 13 files (task file's own "~8" estimate was low), plus a live bug
(`59.97s` renders `"00:60.0"`) and a `formatTimeSimple` name collision across two modules. One
documented rule: instants floor, lengths round-half-up (matching the credit charge exactly).
Staged refactor: characterize (A) -> build canonical module (B) -> mechanical moves (C) ->
isolated behavior changes (D) -> feature work/exact entry+disclosure (E) -> docs (F). Tier L.

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B8, N36, UX-06 (handoff E4-04)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Dragging the first annotation start to **2.973 s** produced three different renderings of one
number: the sidebar and Overlay **floor** it to `0'02"`, trim details **round** it to `00:03.0`, and
the span (6.027 s) displays as `6.0`. The export estimated and charged **seven** credits for a clip
the UI calls six seconds. There is no evidence of overcharging - the fractional duration plausibly
explains the seventh credit - but the parent cannot derive the charge from anything on screen.

Confirmed adjacent evidence: a grep for time formatters finds roughly eight separate
`formatTime`-family implementations across components, which is the structural cause of N36.

## Solution

1. **One rounding and display rule**, applied in the list, the editor, Overlay and export.
2. **Exact start/end entry** plus frame stepping, so a parent can hit a boundary deliberately
   instead of fighting a drag handle.
3. **Show the billable duration** whenever rounding changes the cost, with the rule stated
   ("rounded up to the next whole second") - and **only** if that matches the real billing rule,
   which T9680 is confirming.
4. Enforce bounds: reject end <= start and out-of-media ranges.

## Context

### Relevant Files
- The ~8 `formatTime`-family implementations (grep `formatTime`/`formatGameTime` under
  `src/frontend/src`); consolidating them is part of the work, not a side quest
- `src/frontend/src/components/shared/clipConstants.js`
- `src/modes/annotate/components/ClipListItem.jsx`, `ClipScrubRegion.jsx`
- Backend export cost estimate, for the boundary comparison

### Related Tasks
- Depends on: **T9680** for the confirmed billing rule. Do not ship rounding copy ahead of it.
- T9460 - the zero-duration bug on the same surfaces
- T9490 - handle responsiveness, measured separately

### Technical Notes
Abstract on the third duplication (CLAUDE.md refactoring rules): with ~8 implementations, a single
shared formatter is justified. Keep the move mechanical and separate from the behavior change.

## Acceptance Criteria

- [ ] One documented rounding rule is applied across list, editor, Overlay and export
- [ ] Exact start/end entry and frame stepping exist and the final preview matches the released value
- [ ] Boundary cases around integer seconds match the backend estimate
- [ ] Billable duration is disclosed when rounding changes the cost, matching the rule confirmed by T9680
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
