# T9460: Focus sidebar shows 0.0s for a six-second clip on a freshly created draft

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
naming `03-naming-consistency.html`). Handoff item(s): **B4 (handoff E4-04 partial)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Creating the first editable draft from a saved play and opening Focus showed **0.0s** in the sidebar
while the header and output showed **0:06**. It stayed wrong for the whole initial framing session,
and **corrected itself to 6.0s after reopening the completed clip** - so this is an
initial-session state bug, not a permanently wrong media duration. No screenshot of the 0.0s state
was saved.

## Solution

Use one duration source across the sidebar, header and output. Before metadata is available, show a
loading state, not a zero - a confident `0.0s` is worse than an honest "Loading duration".

Per CLAUDE.md: **no silent fallbacks for internal data.** If the duration is genuinely missing at
that point in the lifecycle, the fix is to source it correctly, not to default it.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx` - sidebar and header duration display
- The freshly-created-draft path from Annotate save -> Focus open
- `src/frontend/src/components/shared/clipConstants.js` - duration formatting helpers

### Related Tasks
- T9480 owns the cross-surface time-format rule; this task owns the zero-versus-loading bug

### Technical Notes
Test both paths explicitly: the freshly created draft, and the reopened completed clip. Only the
first one reproduces.

## Acceptance Criteria

- [ ] Sidebar, header and output read the same duration source
- [ ] A not-yet-known duration renders as loading, never as 0.0s
- [ ] The freshly-created-draft path is covered by a test, not only the revisit path
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
