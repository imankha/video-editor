# T13070: Staging share page Open ReelBallers links to the production app

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Tier:** S (config; verify intent)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

On staging, the recipient share page's "Open ReelBallers" goes to https://app.reelballers.com/home (production). The string is not in `src/frontend/src`, so the host comes from config or the backend. It may be intentional, but it means the claim flow cannot be walked on staging, and a staging tester lands on prod. Also seen: the page's Download label is low-contrast grey.

## Solution

Find where the share page gets its app URL (backend share render or a build-time env var). If it is not intentional, point staging at the staging app. Raise the Download label's contrast.

## Context

### Relevant Files
- Share page render (backend share router or frontend share page)
- `deploy-frontend.yml` VITE_* env (staging env vars come only from there)

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] On staging, Open ReelBallers opens the staging app; on prod, the prod app
- [ ] The claim flow can be walked end to end on staging
- [ ] The Download label meets AA contrast
