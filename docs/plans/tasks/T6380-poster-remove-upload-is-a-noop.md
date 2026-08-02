# T6380: "Remove" on a custom cover is a no-op, and the uploaded state is never read back

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-02
**Follows:** T5410 (shipped the cover-photo upload; this is its documented limitation plus a second bug found while scoping it)

## Problem

Two related defects in the T5410 cover-photo controls. Both make the overlay UI **claim a cover that
is not the cover actually served** to shares, og:image, and the share email.

### Bug 1 — "Remove" only clears local state (the documented limitation)

`OverlayScreen.jsx:908-910`:

```js
const wrappedRemoveUpload = useCallback(() => {
  setPosterUploadedFilename(null);
}, [setPosterUploadedFilename]);
```

**No backend call at all.** Consequences:

1. The uploaded image **stays in R2** under the deterministic poster key, so every consumer
   (`shares.py::_resolve_poster`, edge og:image, share email thumbnail) keeps serving the cover the
   user just removed.
2. `final_videos.poster_source` stays `'upload'`, so `backfill_posters` **skips the reel even under
   `force`** (the override guard is working as designed) -- it never self-heals.
3. Only a full re-export overwrites it, because `generate_poster_at_export` always runs. A user who
   never re-exports keeps the "removed" image indefinitely.

### Bug 2 — the uploaded state is never hydrated (found 2026-08-02, NOT in the T5410 note)

`posterUploadedFilename` is written in exactly one place -- the upload response
(`OverlayScreen.jsx:897`) -- and read at `:1260` (`posterUploaded={!!posterUploadedFilename}`).
**Nothing ever loads it from the backend.**

So after a reload, `posterUploadedFilename` is `null` -> the panel shows the auto/marker copy and
`PosterMarkerLayer` renders as active, **while R2 still holds the uploaded image and
`poster_source` is still `'upload'`**. The "Custom image in use" state exists only in the session
that performed the upload.

Net effect, both bugs together: the overlay cover-photo UI is **session-local and diverges from the
truth in both directions**. This is exactly the class of thing CLAUDE.md's "no silent fallbacks /
correct data, not workarounds" rule exists to prevent -- the UI is asserting a state it never
verified.

## Solution

### 1. A real revert endpoint (fixes bug 1)

`POST /api/overlay/projects/{project_id}/poster/revert` -- gesture-only, mirroring the existing
`poster-time` / `poster/upload` endpoints in `routers/export/overlay.py`:

- Regenerate the auto/marker cover and **overwrite the same deterministic R2 key**, so consumers
  need zero changes (same property the upload path relies on).
- Set `poster_frame_time` + `poster_source` back to `'overlay'` (marker set) or `'auto'` (no marker).
- **Reuse `generate_poster_at_export(...)` -- do NOT write a second selection path.** T5410
  deliberately kept one selection implementation; a parallel "revert" re-derivation would be the
  2nd, and it will drift. If its signature does not fit a non-export call, adjust the shared helper
  rather than forking it.
- Requires a final video (same precondition as upload, which already 400s without one). If there is
  no final video there is nothing to revert to -- fail loudly, do not silently no-op.

### 2. Hydrate the uploaded state on overlay load (fixes bug 2)

`/overlay-data` already returns `final_video_id`, `slowmo_section`, `duration`, and
`poster_marker_time` (see its docstring ~`:130`). Add **`poster_source`** (and `poster_filename` if
the UI needs it) to that payload, and have `OverlayScreen` seed `posterUploadedFilename` from it so
`posterUploaded` reflects reality on every load, not just post-upload.

**Migration-window caution:** `poster_source` is a v032 column and this is a hot read path. Follow
the existing pattern in this very file -- `column_exists(cursor, "projects", "poster_marker_time")`
at `:181` -- so a below-head profile does not 500 the whole overlay screen. This is the T5630 /
`_has_stage_columns` landmine; do not skip it.

### Not in scope
Do not add a "revert" concept to published/My-Reels surfaces. Keep this to the overlay cover
controls that T5410 shipped.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/OverlayScreen.jsx` -- `wrappedRemoveUpload` `:908-910` (the no-op),
  `wrappedUploadPoster` `:897` (the only writer), `posterUploaded` `:1260`
- `src/backend/app/routers/export/overlay.py` -- `set_poster_time` `:1899`, `upload_poster_image`
  `:1916` (copy their shape), `/overlay-data` payload `~:130-215`, `column_exists` guard `:181`
- `src/backend/app/services/poster.py` -- `generate_poster_at_export`, `store_override_poster`
- `src/frontend/src/components/OverlaySettingsCard.jsx` -- the Remove button `:261-268`
- `src/frontend/src/stores/overlayStore.js` -- `posterUploadedFilename` `:35`, `:53`
- `.claude/knowledge/export-pipeline.md` -- poster contract (update at Stage 7)

### Technical Notes
- **Gesture-based persistence:** the revert fires from the explicit Remove click only. No
  `useEffect` -> API (the `no-persistence-in-effects` ESLint rule enforces this).
- Hydration on load is a **read**, not a write -- restore must stay read-only (CLAUDE.md rule 4).
- Consumers (`shares.py`, edge og:image) must need **zero** changes; the revert overwrites the same
  deterministic key.
- Known og:image caveat carries over: an already-crawled share may show the old image until the
  crawler cache expires. Document, do not engineer around.

## Implementation

### Steps
1. [ ] `poster/revert` endpoint reusing `generate_poster_at_export`; sets `poster_source` back to `'overlay'`/`'auto'`
2. [ ] `wrappedRemoveUpload` calls it and updates local state **from the response**, not optimistically
3. [ ] Add `poster_source` to `/overlay-data` behind a `column_exists` guard; hydrate `posterUploadedFilename` on load
4. [ ] Remove the stale "known limitation" comment at `OverlayScreen.jsx:905-907`

## Acceptance Criteria

- [ ] Clicking **Remove** restores the auto/marker cover **in R2** -- verified by re-fetching the poster object, not just by UI state
- [ ] `poster_source` returns to `'auto'`/`'overlay'`, so `backfill_posters` no longer skips the reel
- [ ] After upload **+ reload**, the panel still shows "Custom image in use" and the marker still renders inactive (bug 2)
- [ ] After remove **+ reload**, the panel shows the auto/marker state and the marker is active again
- [ ] Only ONE selection path exists -- no forked re-derivation of the poster frame
- [ ] A below-head profile (missing `poster_source`) does not 500 `/overlay-data`
- [ ] Revert with no final video fails loudly (no silent no-op)
- [ ] Backend + frontend tests pass; real-browser verification of the upload -> reload -> remove -> reload cycle
