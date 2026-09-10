# T9640: Give game and direct-clip upload clear, keyboard-reachable entries

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-02, UX-03 (handoff E3-03, narrowed)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Direct clip upload exists (T8370 backend, T8380 the "Add Video" entry) but is presented as a
**secondary sentence** referring to the long destination name "In Progress Clips". The walkthrough's
observation is about prominence and phrasing, not capability.

## Narrowed scope (dedupe, 2026-09-10)

Already shipped and **not** in scope: pre-cut clip upload itself (T8370), the Add Video entry on the
Clips tab (T8380), surfacing Opponent/Date as optional with video-first ordering (T8700), and cost
disclosure before selection (T8500). Re-verify each on staging before implementing anything here.

What remains:

- Both entries visible **without hover** and reachable by keyboard.
- The distinction stated plainly: a full game needs marked plays; a short clip goes straight to
  framing.
- Sport context asked for when unknown, without blocking unrelated upload work.
- A direct clip reaches framing **without creating a game** (regression guard for T8370).

## Context

### Relevant Files
- `src/frontend/src/components/ProjectManager.jsx` - tab surfaces and entry points
- `src/frontend/src/config/displayNames.js` - `CLIP_UPLOAD` block
- `src/frontend/src/config/emptyStates.js`

### Related Tasks
- T9530 owns the labels ("Upload game" / "Upload clip", N01/N02)
- T8370, T8380, T8700, T8500 - all STAGING; verify before implementing

### Technical Notes
Likely to shrink significantly once verified against current staging. That is a good outcome, not a
wasted task - record what was already satisfied.

## Acceptance Criteria

- [ ] Both upload entries are visible without hover and keyboard-accessible
- [ ] The game-versus-clip distinction is stated in plain language at the entry point
- [ ] A direct clip still reaches framing without creating a game
- [ ] Anything already satisfied by T8370/T8380/T8700/T8500 is recorded as such, not reimplemented
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
