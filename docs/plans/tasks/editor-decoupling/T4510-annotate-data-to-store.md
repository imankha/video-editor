# T4510: Annotate API Data → gamesDataStore (Kill the Restore-Sync Effects)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit item D5

## Problem

[SYNC] Backend API data lives in `AnnotateContainer` `useState`, duplicating store state: `gameVideos`, `activeVideoIndex` (:97-99), `serverTeammateTags` (:248), `sharedTagData` (:264). Two mount-restore effects exist ONLY to re-sync these parallel copies after navigation: :280-298 (upload-store restore + `getGame` refetch) and :323-333 (activeUpload → annotate state copy). This is the exact "parallel store requiring manual sync effects" failure mode the standards ban — and the T1540 (clips lost during upload) / T4060 (annotations stopped rendering) bug class grew here. Annotate is the onboarding surface; multi-video work is active, so this code churns.

## Solution

- Game-scoped server data moves to `gamesDataStore`, keyed by gameId: videos list, teammate tags, share state — stored RAW (API shape), read via selectors. Fetch actions live on the store with in-flight dedup (`_fetchPromise` house pattern).
- `activeVideoIndex` is UI selection state — it can stay local IF nothing else needs it after navigation; if the restore effects exist to preserve it across screens, it belongs in `editorStore` (decide from the inventory, record in the Progress Log).
- The two restore effects are deleted: navigation-return reads the store, which still holds the data (no refetch, no copy).
- Upload-completion updates (`uploadStore.activeUpload` → game becomes ready) write to `gamesDataStore` at the upload-event site, not via an annotate-mounted effect.

## Context

- Files: `containers/AnnotateContainer.jsx`, `stores/gamesDataStore.js`, `stores/uploadStore.js`, `screens/AnnotateScreen.jsx`
- Read T1540's fix first — the `annotateGameId` gating it repaired lives in this flow; do not regress it (its test should still pass).
- T4260 (if landed) already removed the duration PATCH from this container; coordinate if both in flight.
- MVC rule: Screen owns fetching/guards; container consumes guarded data (mvc-pattern skill).

## Steps

1. [ ] Inventory: every useState in AnnotateContainer holding fetch results; table (state → store home → consumers) in the Progress Log.
2. [ ] Store slices + selectors + fetch actions with dedup; unit tests.
3. [ ] Migrate container reads; delete the two restore effects.
4. [ ] E2E: annotate → navigate away mid-upload → return (T1540 scenario); multi-video tab switching; share-tag display.

## Acceptance Criteria

- [ ] No backend API data in AnnotateContainer useState (grep `useState` + review)
- [ ] Both restore-sync effects deleted; navigation-return shows correct state with zero refetch-copy choreography
- [ ] T1540 regression test green; upload-completion updates flow through the store
- [ ] Multi-video switching works unchanged
