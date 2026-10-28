# T13800: "Open as Draft" leaves the Finished badge and list stale

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** S (one hook, mirror an existing pattern)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA, 2026-10-27 (hello@reelballers.com, profile 452b3380). After using a Finished tile's menu > Open as Draft, Home showed the Finished tab badge at 1 with an empty list ("View your completed work."). The DB at that moment had no published highlight (the restore had set `published_at = NULL` on the restored one), so the badge was a stale client value.

## Problem

`useReEditReel.openReelAsProject` (the single "Open as Draft" path for the tile menu, the in-player Re-edit button and the ranker replay) POSTs `/api/downloads/{id}/restore-project`, which unpublishes every final video of that project, then only navigates. It never refreshes the published-reels model. `usePublishProject` does the mirror operation on publish (`fetchCount({ force: true })` + `notifyCollectionsChanged()` + `fetchProjects({ force: true })`, usePublishProject.js:147-152), and PublishedReelsPanel's delete/move handlers do the same (PublishedReelsPanel.jsx:442-454). The restore path is the one model-changing gesture that skips it, so `galleryStore.count` keeps the pre-restore value until the next bootstrap, while the member list (refetched on tab mount) is already empty.

## Solution

In `useReEditReel`, after a successful restore and BEFORE `navigateToProject(result.project_id)`:

```js
useGalleryStore.getState().fetchCount({ force: true });
useGalleryStore.getState().notifyCollectionsChanged();
useProjectsStore.getState().fetchProjects({ force: true }); // the draft is back in Clips
```

This is the publish gesture's exact inverse and stays inside the gesture handler (no reactive persistence; these are reads). The hook's docstring says "NO new persistence", which still holds.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useReEditReel.js` - add the three refreshes on success
- `src/frontend/src/hooks/usePublishProject.js` - reference pattern (read only)
- `src/frontend/src/hooks/useReEditReel.test.js` (new or extend if present) - restore success refreshes count/collections/projects; 503 sync_failed and non-ok do NOT

### Related Tasks
- T13790 (the exclusion clause that hid the highlight in the first place; independent fix)
- T3940 (introduced the shared restore path)

## Implementation

### Steps
1. [ ] Failing test: mock apiFetch 200 -> expect `fetchCount({force:true})`, `notifyCollectionsChanged`, `fetchProjects({force:true})` called once each, then `navigateToProject(result.project_id)`
2. [ ] Implement in the success branch
3. [ ] Curated tests + lint; review on the diff

### Progress Log

**2026-10-27**: Filed from staging QA.

## Acceptance Criteria

- [ ] After Open as Draft, the Finished badge equals the number of tiles in the Finished tab without a reload
- [ ] The restored draft appears in the Clips tab without a reload
- [ ] A failed restore (503 sync_failed / non-2xx) refreshes nothing and still shows the existing alert
- [ ] Test fails before, passes after
