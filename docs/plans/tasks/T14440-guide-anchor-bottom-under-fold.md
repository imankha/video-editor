# T14440: The guided highlight slot or draft tile is partly under the fold while its card sits next to it

**Status:** STAGING
**Impact:** 3
**Complexity:** 3
**Tier:** S (frontend layout)
**Created:** 2026-11-02
**Updated:** 2026-11-02
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-11-02 ([RESULTS.md section 12.2](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots (staging, 2026-11-02):

- [r4-annotate-hasplays-1024.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-hasplays-1024.png): resumed play, Portrait slot bottom under the fold
- [r4-annotate-hasplays-768.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-hasplays-768.png): resumed play, slot under the fold with the scroll pill
- [r4-annotate-hasplays-390.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-hasplays-390.png): resumed play, slot bottom under the fold
- [r4-annotate-choice-768.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-choice-768.png): post-Done choice, slots under the fold
- [r4-home-clips-1024.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-home-clips-1024.png): Home Clips, first draft tile bottom under the fold
- [r4-home-clips-390.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-home-clips-390.png): Home Clips, first draft tile bottom under the fold

## Problem

The card now sits 8 to 12 px from its anchor everywhere below, but the anchor's lower part is under the fold on open, so the step's target is only partly visible:

| State | Anchor | 1024x768 | 768x1024 | 390x844 |
|---|---|---|---|---|
| Annotate, resumed play ("Continue your portrait highlight ...") | Portrait slot | y 578 to 819 | y 927 to 1148, with "Scroll down to continue" | y 697 to 891 |
| Annotate, post-Done choice ("Tap Make highlight ...") | highlight slots | passes | y 863 to 1084 | passes |
| Home Clips, drafts ("Pick up where you left off ...") | first draft tile | y 518 to 817 | passes | y 653 to 930 |

At 1440 all three pass. The Make highlight button inside each slot is mostly visible, so this is polish, not a blocker; it was tracked under T13170 until that task's scope narrowed to Mark play.

## Solution

Scroll the guided anchor fully into view when the step opens, or tighten the layout above it at these sizes, so the step's target is fully on-screen.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` (highlight slots)
- `src/frontend/src/components/ProjectManager.jsx` (Clips gallery)
- `src/frontend/src/components/instructions/FloatingCoach.jsx` (scroll hint)

### Related Tasks
- Found by T12590; related T13170, T13530, T13160

## Acceptance Criteria

- [ ] Each anchor in the table is fully on-screen at the listed sizes when the step opens, with the card still within 250 px and not covering it
