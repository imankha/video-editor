# T12460: Guidance never appears on phones for most steps (hidden dialog blocks the coach)

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N2 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

On 320-390 wide screens (Home, Annotate, Focus, landscape Home) the floating guide host stays visibility:hidden although its text is in the DOM and the toggle says "On". On Focus the parked Settings drawer (role="dialog", visibility:hidden, off-screen) matches the "blocking layer" selector in FloatingCoach.jsx, so the coach hides itself permanently. On Annotate (watch phase, 0 plays) and Home no blocking layer exists but the anchor is not found so the position stays null and it stays hidden. On Overlay the inline guide renders at y=797 under the action band. The mobile-heavy audience gets no hand-holding.

Screenshots: rr-76-m390-focus-first, rr-98-m390-annotate-empty-newgame, rr-101-m390-first-play-editor-newgame, rr-85.

## Solution

Ignore hidden dialogs in the blocking check (checkVisibility()), and dock the coach (reserved strip) when the target is missing instead of hiding. Failing test per phase at a 390 viewport first. Related guide epic: T12240 (placement), T12250-T12270 (per-screen guides).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/FloatingCoach.jsx`
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12460:`

## Acceptance Criteria

- [ ] At 390x844 the guide is visible on Home, Annotate (empty and with plays), Focus and Overlay with Guidance on
- [ ] A visibility:hidden dialog never blocks the coach
- [ ] The guide never renders under the action band
- [ ] Test written first and fails on current behavior

## Evidence screenshots

Kept in `screens/T12460/` (delete that folder when this task is archived):

- [rr-101-m390-first-play-editor-newgame.jpg](screens/T12460/rr-101-m390-first-play-editor-newgame.jpg)
- [rr-76-m390-focus-first.jpg](screens/T12460/rr-76-m390-focus-first.jpg)
- [rr-85-m390-overlay-start.jpg](screens/T12460/rr-85-m390-overlay-start.jpg)
- [rr-98-m390-annotate-empty-newgame.jpg](screens/T12460/rr-98-m390-annotate-empty-newgame.jpg)
