# T13140: Staging gate lane D: on-demand end-to-end release path

**Status:** STAGING
**Impact:** 5
**Complexity:** 4
**Tier:** M (e2e tooling)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

T9720 found that every defect in this release lived in the seams between features, and the existing three-lane gate and jsdom tests missed T13110 entirely. The release check was a one-off manual run. Decision recorded in T9720-RESULTS.md section 7: YES to a small on-demand lane D, not part of the default gate.

## Solution

Add `@gate-d` per T9720-RESULTS.md section 7: its own fixture account, a 3 to 5 MB game and a 5 s clip (not the 46 MB fixture), a one-line admin `grant-credits` prep step, and the section 7 assertion list (upload, two plays, framed highlight, finish, public link fetched signed out, direct clip with games list unchanged, Report a problem with a real mouse click, duplicate-tap single request, credit deltas). About 12 credits and 6 to 8 minutes per run. Document it in STAGING-GATE.md.

## Context

### Relevant Files
- `src/frontend/e2e/` new `@gate-d` spec(s), `STAGING-GATE.md`, `FIXTURE-CONTRACT.md`
- `scripts/staging-gate.sh` (opt-in flag)

### Related Tasks
- Found by T9720 (2026-10-18)
- Depends on: T13110 fixed and T12900 (fixture accounts re-seeded)

## Acceptance Criteria

- [ ] `bash scripts/staging-gate.sh --lane d` (or equivalent) runs the lane green on staging
- [ ] The lane fails against a build with T13110's bug
- [ ] Run time and credit cost recorded in STAGING-GATE.md
