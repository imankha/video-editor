# T11600: Published tab shows stale summary after a publish while the tab was inactive

**Status:** WIP
**Impact:** 7
**Complexity:** 2
**Created:** 2026-10-02
**Reported:** User gsarah@gmail.com, production, 2026-09-29: "After publishing my highlight, it
disappeared and then came back later."

## Problem

No in-app bug-report ticket existed for this (admin `bug_reports` table had zero rows for the
reporter/date) — investigated from the plain-text report alone, root-caused from code, not
guessed. Full investigation delegated to the Expert agent per CLAUDE.md Model Policy (async
timing + R2-versioning root cause), then independently verified by re-reading every cited line
myself before accepting the verdict.

**Ruled out first:** the backend publish gesture (`publish_to_my_reels`,
`src/backend/app/routers/downloads.py:2101`) is durable — it declares
`Depends(durable_sync)`, which makes `RequestContextMiddleware` (`db_sync.py:1199-1240`) AWAIT
the R2 upload inside the still-held per-user write lock BEFORE returning the response, and
returns 503 (not a lying 200) if that sync fails. `published_at` was never actually lost
server-side. (There IS a documented historical precedent of the pre-fix version of this bug —
`src/backend/app/migrations/profile_db/v018_heal_lost_publish_proj41.py` repairs a real stranded
reel from "a pre-T4050 fire-and-forget publish" — but T4050 already closed that gap. Also
confirmed live via `flyctl`: prod (`reel-ballers-api`) is still exactly 1 machine / 1 uvicorn
process, so the T6402-documented "two writers PUT the same R2 version" residual race is not
reachable either.)

**Actual root cause: frontend-only, `src/frontend/src/hooks/useCollections.js:188-194`.**
`useCollections`'s Published-tab summary is fetched once eagerly at mount (T9390) and
afterwards only re-fetched when `galleryStore`'s `collectionsVersion` changes AND the tab is
active:

```js
useEffect(() => {
  if (collectionsVersion === seenVersionRef.current) return;
  seenVersionRef.current = collectionsVersion;   // <-- consumed unconditionally
  if (isActive) fetchSummary();                  // <-- but only acted on conditionally
}, [collectionsVersion, isActive, fetchSummary]);
```

`notifyCollectionsChanged()` (called from `usePublishProject.js` on a successful publish) bumps
`collectionsVersion` regardless of which tab is active — e.g. publishing from the Reels tab, or
via `DraftReelPreview`'s "Publish and create link" while the player is open. If the Published
tab is NOT active at that moment, the version bump is marked "seen" anyway, so the refetch that
should follow it never happens — permanently, until the component remounts (reload, profile
switch, or re-entering Home). The user sees the stale mount-time summary, which doesn't contain
the highlight she just published: it looks exactly like "I published it and it disappeared."
It "comes back" once anything remounts `ProjectManager`/`useCollections` (app reload) and the
eager mount-time fetch picks up the now-current state.

This also affects the `openGallery: true` path (DraftTile's Publish button, which navigates
straight to Published): `notifyCollectionsChanged()` fires while `activeTab` is still `'reels'`
(the version bump is consumed, un-acted-on), and only afterward does `ProjectManager`'s
`galleryOpenRequested` effect flip `activeTab` to `'published'` — by then there's no new
`collectionsVersion` change left to trigger a refetch, so the user lands on Published looking at
the stale summary immediately.

## Solution

Only mark the version bump "seen" once it's actually acted on (i.e. once `isActive` is true):

```js
useEffect(() => {
  if (!isActive || collectionsVersion === seenVersionRef.current) return;
  seenVersionRef.current = collectionsVersion;
  fetchSummary();
}, [collectionsVersion, isActive, fetchSummary]);
```

Preserves T9390's intent exactly (no refetch-on-every-revisit unless something actually
changed) — the only change is deferring *when* the bump is consumed, not whether it eventually
is.

**Known related gap, deliberately NOT fixed here (separate, already-accepted behavior):**
per-game `members` lists (`useCollections.members`, fetched lazily per expand) never refetch
once cached, by design (see the existing T6950 comment at `useCollections.js:128-131`). So if a
user had ALREADY expanded a game group before publishing a new highlight into that same game,
the group's tile list stays stale even after this fix corrects the summary/count. That's a
pre-existing, intentionally-scoped tradeoff, not introduced or worsened here — flagging it in
case it resurfaces as its own report.

Also corrected two stale backend comments/log lines (`downloads.py:2114-2122`, `:2179`,
`:2213`) that still described the pre-T4050 fire-and-forget behavior in present tense,
misleading about a gap that no longer exists.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useCollections.js:185-199` — the fix
- `src/frontend/src/hooks/usePublishProject.js:104-114` — where `notifyCollectionsChanged()`
  fires, and the `openGallery`/tab-switch race
- `src/frontend/src/components/ProjectManager.jsx:1225-1231` — `galleryOpenRequested` tab switch
- `src/backend/app/routers/downloads.py:2101-2228` — the publish endpoint (ruled out, comments
  corrected)
- `src/backend/app/middleware/db_sync.py:1199-1240` — `durable_sync`'s await-before-respond
  guarantee (confirms the backend already does the right thing)

### Related Tasks
- T11580 (Published tab: surface the just-published highlight, WIP) — a different,
  complementary fix: a UX discoverability feature (spotlight card threading `final_video_id`
  straight from the publish response, bypassing the summary fetch entirely for that one card).
  Does NOT fix this bug on its own — the summary/game-group staleness this task fixes is a
  separate, independent defect that would still affect Top Plays/other game groups.

### Technical Notes
- No schema/backend change. Frontend-only, matches the "no reactive persistence" rule trivially
  (this is a read-path staleness bug, not a write).
- M-tier: bug fix, 2 files touched (+ 2 backend comment/log corrections), no new abstractions.

## Implementation

### Steps
1. [x] Root-caused via Expert agent + independent verification of every cited line
2. [x] Failing regression test first: `useCollections.publishWhileInactive.test.jsx` (red
   against pre-fix code: asserted the second summary fetch, got only 1 call)
3. [x] Fix `useCollections.js`'s version-bump effect
4. [x] Correct the two stale backend comments/log lines in `downloads.py`
5. [x] Relevant test set green (new tests + existing `useCollections` suite + `PublishedReelsPanel`
   + `collections/*` component tests + `EmptyTabGuide` — 211 tests final, 0 regressions)
6. [x] Backend import check + frontend build check green
7. [x] Reviewer pass (round 1): 0 BLOCKING, 2 MAJOR, 4 MINOR — see Progress Log
8. [x] Fixed both MAJOR findings + MINOR 1/2 (MINOR 3/4 addressed or accepted, see below);
   re-ran full regression set green; re-requested review
9. [x] Final reviewer sign-off: APPROVED (round 2), 0 blocking/major
10. [ ] Commit

### Progress Log

**2026-10-02:** Filed from a production user report with no existing bug ticket. Backend sync
paradigm (the thing the user's report hinted to check) verified sound; root cause isolated to a
frontend staleness bug in the Published tab's version-bump consumption. Fixed, tested, green.

**2026-10-02 (review round 1):** Opus reviewer found 2 MAJOR, both confirmed real by re-tracing
the code myself (not taken on faith):
- **MAJOR 1 (ABA hazard my first fix introduced):** `collectionsVersion` is not monotonic —
  `galleryStore.reset()` zeros it on every profile switch, and `useCollections`'s
  `seenVersionRef` survives that reset (`ProjectManager` isn't remounted per profile). My first
  fix's early-return (`if (!isActive || ...) return;`) skipped updating `seenVersionRef` entirely
  while inactive, so a reset-then-rebump-to-the-same-number while inactive would be
  misidentified as "already seen" and silently drop the refetch — reproducing the exact reported
  bug via a different path. **Fixed**: split into two refs — `seenVersionRef` now tracks every
  version change unconditionally (so it never goes stale across a reset), and a separate
  `refetchPendingRef` gates only the ACTION (the fetch) on `isActive`. Added a second regression
  test (`useCollections.publishWhileInactive.test.jsx`, "ABA" case) that reproduces this exact
  sequence; confirmed it fails against the first (reviewed) fix and passes against the final one.
- **MAJOR 2 (member-cache staleness):** an already-expanded game group's cached tile list never
  refetches once `'ready'` (pre-existing T6950 behavior), so publishing another highlight into an
  already-expanded game would still look stale after this fix corrected the summary. Took the
  reviewer's option (a): the same consume branch now also clears `members`/`memberStates` (and
  aborts any in-flight member fetches) whenever it acts on a real version change — no extra UX
  cost since the summary's own `'loading'` state already collapses/unmounts every group behind a
  spinner during that window.
- **MINOR 1**: restored the original, accurate `"[SYNC] ... -> R2 sync OK/FAILED"` log reference
  in the `downloads.py` comment (my rewrite had pointed to the DURABLE-tagged log line, which only
  fires on the failure branch, not on success) and fixed "below" (the dependency is in the route
  signature above, not below); dropped the historical "T11600 corrected it" narration (commit-
  message material, not comment material).
- **MINOR 2**: kept the `useCollections.js` comment focused on mechanism/why rather than
  re-narrating the bug report.
- **MINOR 3 (test gaps)**: rewrote the test to use the real `galleryStore` (not a hand-rolled
  mock) via `notifyCollectionsChanged()`/`reset()`, added the explicit "no fetch while still
  inactive" assertion, and added the MAJOR-1 regression case.
- **MINOR 4** (one spinner flash on first activation after a publish): accepted as noted,
  matches pre-existing behavior for a publish while already active, not a regression.

**2026-10-02 (review round 2): APPROVED, 0 blocking/major.** Both MAJOR fixes confirmed by
re-tracing; two new MINOR notes, neither requiring action (one extra harmless summary refetch
after a profile switch; the member-cache-clear fix had no direct test assertion). Added that
missing assertion as a third test case (`clears cached member lists on a real version-bump
refetch...`) rather than leave it as a gap. Final regression run: 211 tests / 23 files green.

## Acceptance Criteria

- [x] Publishing a highlight while the Published tab is NOT active, then opening it, shows the
      newly published highlight without needing a reload
- [x] Existing T9390 guarantee preserved: revisiting the Published tab with no new publish does
      NOT re-fetch (no spinner flash)
- [ ] Live-verified in the running app (publish from Reels tab, switch to Published, confirm the
      new highlight appears without reload) — pending before STAGING promotion
