# T9660: Preserve the full-width gallery and batch finishing while the rest of this work lands

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
naming `03-naming-consistency.html`). Handoff item(s): **UX-17 (handoff E7-04)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

**This is a preservation requirement, not a defect report.** Andrew specifically praised the
full-width responsive gallery and the ability to keep marking plays without interruption. The
first-clip work in this group (T9580, T9440, T9390) risks regressing exactly those two things: a
first-time wizard imposed on experienced users, or a narrow fixed content column replacing the
full-width layout.

## Solution

Add regression guards rather than new UI:

- The gallery uses available width at desktop and reflows on mobile; cards wrap without shrinking
  controls or introducing a narrow fixed column.
- Repeated Save does not move the playhead into another editor.
- Direct clip upload stays visible.
- Add a **persistent finish-clips entry or queue** (small, non-blocking) rather than a first-time
  wizard, so experienced users are never interrupted.

## Context

### Relevant Files
- `src/frontend/src/components/ProjectManager.jsx` and the tab panels
- Existing e2e specs covering gallery layout, plus `cta-visibility.spec.js` (T8550's helper)

### Related Tasks
- Guards: T9580, T9440, T9390
- T8550 established the viewport-sweep helper this can reuse

### Technical Notes
Prefer extending the existing `assertCtaInViewport` sweep over a new harness. Recorded lesson: a
permissive diagnostic harness fails open and proves nothing.

## Acceptance Criteria

- [ ] Gallery uses available width at desktop and reflows on mobile, asserted by test
- [ ] Repeated save does not move the playhead to another editor
- [ ] Direct clip upload remains visible
- [ ] A persistent finish-clips entry exists without a blocking first-time wizard
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
