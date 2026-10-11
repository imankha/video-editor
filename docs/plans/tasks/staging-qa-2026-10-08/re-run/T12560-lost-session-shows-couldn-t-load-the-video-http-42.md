# T12560: Lost session shows "Couldn't load the video"; HTTP 422 on exports/acknowledge

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N19, N20 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

After a second login signed the phone browser out, the viewer showed "Loading your highlight..." and "Couldn't load the video. Try again." at once with a Retry that cannot work, instead of prompting sign-in; the page behind was already the sign-in screen after reload. Separately, loading the Finished tab at 320 and 360 logs HTTP 422 on POST /api/exports/acknowledge.

Screenshots: rr-90, rr-91, rr-92, rr-93; scripts/sweep-all.json.

## Solution

Detect 401 in the viewer and route to sign-in with one message; find why acknowledge returns 422 (payload shape) and fix at the source. Root cause first; escalate to the expert agent if not obvious.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/utils/acknowledgeExportJob.js`
- `src/frontend/src/hooks/useExportRecovery.js`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12560:`

## Acceptance Criteria

- [ ] A 401 in the viewer prompts sign-in, with no contradictory loading and error messages
- [ ] Finished tab load produces no 4xx on /api/exports/acknowledge
- [ ] Tests written first
