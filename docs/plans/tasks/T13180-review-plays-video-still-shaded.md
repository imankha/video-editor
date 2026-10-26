# T13180: Review plays still shades the playing video at 1440 and 1024

**Status:** WIP
**Impact:** 3
**Complexity:** 2
**Tier:** S (frontend guide shade)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

T13100 (STAGING) added a `shadeClear` of `` `${ANNOTATE_STAGE} video` `` to `annotate.review`, but on staging 2026-10-25 the video is still dimmed during review plays at 1440 and 1024. The live shade's cutouts are only the Share plays tile, the editor Home button and the Guidance switch, with no video rect, so the selector most likely matches nothing in review mode: the playback view does not render its video inside `annotate-coach-stage`. Share plays itself is fully on-screen and highlighted. Evidence: r3-annotate-review-{1440,1024}.

## Solution

Point the review rule's shadeClear at the video the playback view actually renders, and cover it with a test that mounts the real review layout (not a fixture that carries the stage testid).

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js` (`annotate.review`)
- `src/frontend/src/modes/AnnotateModeView.jsx` (playback branch, `playback-mode-badge`)

### Related Tasks
- Residual of T13100

## Acceptance Criteria

- [ ] During review plays at 1440 and 1024 the playing video is not shaded (live check: the shade's cutouts include the video rect)
- [ ] Share plays stays highlighted
