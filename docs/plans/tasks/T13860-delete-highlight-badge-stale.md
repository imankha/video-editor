# T13860: Deleting a highlight does not refresh the Finished badge

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:**

## Found by

T13820 sync QA matrix (Playwright + `window.__syncCheck` + `GET /api/qa/sync-state`). The spec stays in `src/frontend/e2e/sync/` as `test.fixme('T13860 ...')` with the assertion intact; landing the fix flips it green (remove the `fixme` and the `known` entry).

## Evidence
- S4: after Delete from the tile menu, `galleryStore.count` client 1 vs server 0; `missingHolders` = `galleryStore.count` (no fetch after the write `delete-highlight` req 1165cf80). Badge stays 1 on Finished, Clips and Games tabs until reload. Class (a).
- Files: `qa/sync/S4/chromium/2-after-delete/` .. `4-games-tab/`.
- [STATE]: `gesture=delete-download req_id=1165cf80 ... downloads_count=0 outcome=ok`.
- Holder: `galleryStore.count`; `PublishedReelsPanel.jsx:476-484` refreshes only the collections summary, not `fetchCount`.

## Fix direction
In `confirmDelete` call `useGalleryStore.getState().fetchCount({ force: true, reason: 'delete-highlight' })` after `deleteDownload`, alongside the summary refresh.

## Acceptance Criteria

- [ ] The `T13860` fixme spec is un-fixmed and passes on chromium and iphone-sync (`npx playwright test e2e/sync --project=chromium --project=iphone-sync --workers=1`)
- [ ] Fix stays in the paradigm: refresh in the gesture handler (or subscribe the copy to the store); no `useEffect` that persists
