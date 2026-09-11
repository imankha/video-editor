# T9440: Next-step guidance derived from saved progress, not navigation ("Now cut your first play" after two plays)

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
naming `03-naming-consistency.html`). Handoff item(s): **B7, UX-15 (handoff E2-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

After saving two annotations and finishing a highlight, returning to Games showed the game card
reading **2 annotations** and help reading **5/5**, while the page still said **Now cut your first
play** and **Step 1 of 4**. Screenshot-supported and repeatable after reopening.

Three surfaces describing the same account disagree, and the one a new parent reads first is the
one that is wrong.

## Solution

Derive next-step guidance from **actually persisted progress** (clips saved, exports completed),
never from navigation history or a first-visit flag. After the first saved play, the guidance
becomes "Review your plays" or "Make another clip"; it must not re-offer the first-play instruction
to an account that has already done it.

## Context

### Relevant Files
- `src/frontend/src/components/shared/EmptyTabGuide.jsx` - the tab guidance surface
- `src/frontend/src/config/emptyStates.js` - `FLOW_STEPS` and per-tab copy
- Game tile / Games grid guidance strings
- Quest progress source (`routers/quests.py`) where guidance reads from it

### Related Tasks
- **T9390** (TODO, high priority) already reworks the four home-tab guidance screens. **Check T9390's
  scope first** - if it lands first, this task may narrow to the Games-page and Step-N surfaces only.
- T9320 (STAGING) already removed the literal "Step N of M:" sentence from `EmptyTabGuide`; the
  "Step 1 of 4" Andrew saw may predate it. **Re-verify against current staging before implementing.**
- T9410 - same "displayed state is not the saved state" family

### Technical Notes
This is the UI half of the family; T9410 is the persistence half. They can proceed independently.

## Acceptance Criteria

- [ ] Guidance is computed from persisted progress, not from navigation or a visit flag
- [ ] Two saved plays never trigger 'Now cut your first play'
- [ ] The game card count, the help progress and the page guidance cannot contradict each other
- [ ] Re-verified against current staging so nothing already fixed by T9320/T9390 is re-implemented
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
