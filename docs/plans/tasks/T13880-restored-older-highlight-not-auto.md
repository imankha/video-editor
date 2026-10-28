# T13880: Restoring the older of two highlights lists it as non-auto-created (Legacy reels)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:**

## Found by

T13820 sync QA matrix (Playwright + `window.__syncCheck` + `GET /api/qa/sync-state`). The spec stays in `src/frontend/e2e/sync/` as `test.fixme('T13880 ...')` with the assertion intact; landing the fix flips it green (remove the `fixme` and the `known` entry).

## Evidence
- S6: two orientations on one play. After Open as Draft of the older highlight, `projectsStore.projects` client `is_auto_created` 0 vs probe 1 (`projects.is_auto_created`); persists after reload (class (d)/(e): server list derivation disagrees with the row). Clips would group it under 'Legacy reels'.
- Files: `qa/sync/S6/chromium/2-after-first-restore/`, `3-after-reload/`.
- Holder/derivation: `projects.py:460-462` and `games.py:2730-2738` derive auto-created from the single `raw_clips.auto_project_id` pointer, which points at the newest highlight.

## Fix direction
Derive auto-created from `projects.is_auto_created` / `source_raw_clip_id` (the durable T11430 link) instead of the single pointer. Needs a design check with the Clips grouping tests.

## Acceptance Criteria

- [ ] The `T13880` fixme spec is un-fixmed and passes on chromium and iphone-sync (`npx playwright test e2e/sync --project=chromium --project=iphone-sync --workers=1`)
- [ ] Fix stays in the paradigm: refresh in the gesture handler (or subscribe the copy to the store); no `useEffect` that persists
