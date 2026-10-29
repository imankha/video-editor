# T13870: A failed restore half-changes the DB and the client never refreshes

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:**

## Found by

T13820 sync QA matrix (Playwright + `window.__syncCheck` + `GET /api/qa/sync-state`). The spec stays in `src/frontend/e2e/sync/` as `test.fixme('T13870 ...')` with the assertion intact; landing the fix flips it green (remove the `fixme` and the `known` entry).

## Evidence
- S9a (sync-fault, 503 path): the restore response fails but the DB is already changed: probe shows `published_at` NULL; client still shows badge 1, tile present (`galleryStore.count` 1 vs 0, `projectsStore.projects` absent vs present, `collections.summary` stale). After reload the badge reads 0, so the highlight silently left Finished. Class (d)+(a).
- S9b (404 archive-missing, `seed-published-highlight {archive_missing:true}`): same root cause by code, spec is fixme and not yet observed: `published_at` is nulled at `downloads.py:2654` and committed before the archive check at `:2671` raises 404.
- [STATE]: `gesture=restore req_id=8584cd26 ... final_videos=[(1, 1, None)] downloads_count=0` on the failed request.
- Client: `useReEditReel.js:53-70` does not refresh any store on a non-ok response.
- Files: `qa/sync/S9a/chromium/1-after-failed-restore/`.

## Fix direction
Backend: move the unpublish UPDATE after the archive restore succeeds (or roll it back on 404/500/503). Client: on a non-ok restore response refetch count/projects/summary in the handler so the UI reflects the DB.

## Acceptance Criteria

- [ ] The `T13870` fixme spec is un-fixmed and passes on chromium and iphone-sync (`npx playwright test e2e/sync --project=chromium --project=iphone-sync --workers=1`)
- [ ] Fix stays in the paradigm: refresh in the gesture handler (or subscribe the copy to the store); no `useEffect` that persists
