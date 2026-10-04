# T11820: Rename Publish to Finish across the app (only if S2 = Finish)

**Status:** TODO (OBSOLETE if decision S2 keeps "Publish")
**Impact:** 6
**Complexity:** 5
**Tier:** M by logic, wide by surface (copy sweep across many files; no behavior change)
**Created:** 2026-10-04
**Decision gate:** S2 (recommended B2: "Finish", tab "Finished"). Depends on T11810 and T11790.

## Epic Context

Task 4 of 5 in [Epic C](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

"Publish" makes no one able to see anything. It moves a highlight from Clips to the owner's
Published tab and archives its working data. Parents read "publish" as "make public", so every
surface needs a caption to undo the word. Private and Published already show the same audience
text (`utils/draftStage.js:82-84`).

## Solution

Rename the **user-visible** verb and tab. Internal ids stay (`published_at`, `is_published`,
`/published` route, `SECTION_NAMES.PUBLISHED` key, analytics events) per the shared-vocabulary
standing rule.

| Old | New |
|-----|-----|
| Published (tab) | Finished |
| Publish highlight (library action) | Finish highlight |
| Publish (Overlay primary) | Finish |
| Published (status / badge / filter) | Finished; show "Shared" only where the data proves a share link exists |
| Publish and get link (T10180) | Get share link |
| Publish "{name}"? (T10180 review title) | Share "{name}"? (body unchanged: "Anyone with the link can watch. Creating a link does not send it.") |
| "6 annotations · 2 published" (game card) | "6 plays · 2 finished" (noun from H3) |
| Just published (T11580 card) | Just finished |

Status detail for Finished: **Only you until you share a link**. Private stays "Only you can see it".

## Implementation Steps

1. `grep -rn "Publish\|publish" src/frontend/src/config/displayNames.js` and change only display
   values. Then grep components for inline literals (`Published`, `publish`) in JSX text, aria-labels,
   titles, toasts and empty states. Move any inline literal you find into `displayNames.js`.
2. Update the guided tour / quest / empty-tab guide copy that names the tab.
3. Update `src/landing` only if it names the in-app tab (check with grep; landing marketing copy
   that says "share" is fine).
4. Update every test and e2e selector that finds elements **by text**. Prefer switching them to
   `data-testid` where one exists.

## Acceptance Criteria

1. No user-visible "Publish"/"Published" remains in the app (grep proof in the PR, listing any
   intentional leftovers such as admin pages).
2. No internal identifier, route or analytics name changed (`git diff` shows only display strings,
   tests and docs).
3. The tab bar fits at 320px ("Finished" is 8 characters).

## Tests

- Run the curated set touched by the sweep; at minimum `FocusPublishActionBar.test.jsx`,
  `OverlayPublishActionBar.test.jsx`, `ProjectManager.threeTabIA.test.jsx`,
  `CollectionsTab.justPublished.test.jsx`, `PublishLinkFlow` tests, `draftStage.test.js`.
- E2E: grep `src/frontend/e2e` for `Published|Publish` text selectors, update, run locally.
  (Branch CI does not run Playwright: CLAUDE.md refactoring rule 7.)

## Landmines

- This reverses T8555, T9530 N12 (2026-09-10), T10180 and T9860 D5. Add a dated reversal note to
  each of those task files.
- Admin dashboards may say "published" about data; leave admin-only surfaces unless the user asks.
