# T9500: Fullscreen annotation still uses the pre-T8600 interface

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B11, UX-05, N47 (handoff E4-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Andrew likes the bottom-center annotation controls in normal mode and reports that **fullscreen
still uses the old UI**. Not independently reproduced; no fullscreen screenshot was supplied.

**This is not a regression - it is a scope decision meeting its user.** T8600 (Inline Play Editor)
was explicitly "desktop-relocation only; mobile sheet + fullscreen dock layouts stay". Fullscreen
kept the older dock deliberately. Andrew is the first evidence of what that costs.

## Solution

1. **Confirm the parity gap first** against current staging in both modes, and write down exactly
   which labels, controls and shortcuts differ. The handoff could not supply this.
2. Share the same annotation control component, labels, keyboard actions, range state and save logic
   across normal and fullscreen; adapt layout only where the viewport genuinely requires it.
3. Preserve the praised bottom-center placement and keep playback plus the primary mark action
   visible at the tested desktop height. Do not rely on fixed heights that push the primary action
   off screen.
4. Preserve selected times and an unsaved note across entering and exiting fullscreen.

## Context

### Relevant Files
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - the fullscreen dock
- `src/frontend/src/components/ClipsSidePanel.jsx` and the T8600 inline editor strip
- `src/modes/annotate/AnnotateModeView.jsx`

### Related Tasks
- T8600, T8590 (both STAGING) - the desktop inline editor whose scope excluded fullscreen
- T8960 - play editor strip layout feedback, same component family
- T9450 - the toggle copy lives in the fullscreen overlay

### Technical Notes
L-tier candidate if it turns into a real component unification. Start with the parity audit; the
audit may show the gap is narrower than "the old UI" suggests, which would shrink the task.

## Acceptance Criteria

- [ ] A written parity audit lists every differing label, control, shortcut and save behavior
- [ ] The same task can be completed without leaving fullscreen
- [ ] Selected times and an unsaved note survive entering and exiting fullscreen
- [ ] The primary action stays visible at the tested desktop height
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
