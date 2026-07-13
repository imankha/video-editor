# T4270: Orphaned Writers & Dead Paths — saveAnnotations, Dedupe DELETE, Overlay Pass-Through

**Status:** DONE
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) items A7 + A9-remainder)

Three independent cleanups bundled: each is a trap that either corrupts data if ever hit or misleads the next implementor. Deletions shrink the search space for all later refactors.

## 1. Dormant full-state annotations writer

`src/frontend/src/stores/gamesDataStore.js:295-319` — `saveAnnotations` PUTs a full annotations JSON blob to `/games/{id}/annotations`. It has **zero callers** (verify: `grep -rn "saveAnnotations" src/frontend/src`), but the endpoint is live. If ever resurrected it has the same clobber profile as the overlay PUT deleted in T4210: full-state overwrite of data whose canonical write path is the surgical `/clips/raw` gesture flow.

**Action:** delete the store method. For the backend endpoint: `grep -rn "annotations" src/backend/app/routers/games.py` — the handler calls `save_annotations_to_db` (`games.py:1599-1699`). Check whether `save_annotations_to_db` has OTHER internal callers (share materialization, recap flows) before touching it: delete only the HTTP endpoint if it alone is dead; leave the function if internals use it, and note the remaining callers in the PR (they feed the later E11 write-path consolidation task).

## 2. Dedupe DELETE leaks storage refs

`src/backend/app/routers/games_upload.py:564-591` — `DELETE /api/games/dedupe/{id}` executes a bare `DELETE FROM games` (:583) with **no storage-ref cleanup and no orphan-project cleanup**, unlike the real deletion path (`games.py:1463-1516`, which decrements per-hash `game_storage` refs at `:1512-1513`). If the dedupe route is ever hit, ref-counts leak permanently (R2 objects never become deletable).

**Action:** find the dedupe route's callers (`grep -rn "dedupe" src/frontend/src src/backend`). If dead → delete the route. If live → make it call the same deletion code the main route uses (extract a small `delete_game(cursor, game_id)` helper both routes call; do NOT copy-paste the cleanup block — that's the disease this audit treats).

## 3. Overlay pass-through reads fields that no longer exist

`src/frontend/src/screens/OverlayScreen.jsx:149-160` — `clips[0]?.fileUrl || clips[0]?.url` and `clips[0]?.metadata`: since T250, `projectDataStore.clips` hold the **raw backend shape** (`file_url`; metadata lives in `clipMetadataCache`). These fields are always `undefined`, so the pass-through fallback (`effectiveOverlayVideoUrl` at `:158`) silently never works — a never-exported single-clip project opened in Overlay gets **no video source** (only the console.warn at `:163-178` fires). Related: `:763-777` `hasFramingEdits` reads `firstClip.cropKeyframes` — same nonexistent-shape problem.

**Action — reproduce before choosing the fix:** on dev, open a never-exported single-clip project directly in Overlay (drive-app-as-user skill) and observe. Then either (a) the pass-through mode is reachable and needed → read via `clipSelectors`/`clipMetadataCache` (the store's canonical accessors), or (b) it's unreachable in real flows → delete the pass-through branch and its warn block. Do not leave dead-but-load-bearing-looking code. Whichever way, fix or delete the `:763-777` raw-shape read too.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/gamesDataStore.js`
- `src/backend/app/routers/games.py`, `src/backend/app/routers/games_upload.py`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/stores/clipSelectors.js` (or wherever clip selectors live — grep `clipSelectors`)

### Technical Notes
- Every deletion here must be preceded by its grep, and the grep results pasted into the Progress Log — "zero callers" is a claim the implementor re-proves, not inherits from the audit.
- Frontend build check (`npm run build` / lint skill) catches dangling imports after deletions.

## Implementation

### Steps
1. [ ] Item 1: grep-verify → delete store method → endpoint disposition → tests/import check.
2. [ ] Item 2: grep-verify → delete or unify via shared helper → backend test for ref-count behavior if unifying.
3. [ ] Item 3: reproduce on dev → fix-or-delete with evidence → frontend tests.

## Acceptance Criteria

- [ ] No dormant full-state annotation writer in the frontend; backend endpoint disposition documented
- [ ] Deleting a game via ANY route maintains storage ref-counts (or the extra route is gone)
- [ ] Overlay's video-source selection has no branch that reads nonexistent clip fields
- [ ] Each deletion's caller-grep is recorded in the Progress Log
