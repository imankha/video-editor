# T5220: "Add intro" integration (multiclip + collection share)

**Status:** TODO
**Impact:** 7 | **Complexity:** 5
**Epic:** [Player Intro](EPIC.md) — child 4 of 5

> Read [EPIC.md](EPIC.md). This wires the generated intro ([T5210](T5210-intro-card-generation.md))
> into the two surfaces the user named: creating a multiclip video and sharing a collection.

## Scope

### A. Multiclip video (burned-in)
- Frontend: add an **"Add intro"** toggle where the multiclip export is triggered
  (`ExportButtonContainer.jsx:642`, the `/api/export/multi-clip` request assembly). Toggle is
  ephemeral view state (per project rule — never persisted as a preference).
- Backend: add `include_intro` (+ implicit current `profile_id`) to the `/api/export/multi-clip`
  body → `multi_clip.py:1832 export_multi_clip` → `_export_clips` (:1191). **Prepend** the intro
  segment before `concatenate_clips_with_transition` (:1100), or concat the intro card ahead of the
  rendered working video via the [T5210](T5210-intro-card-generation.md) engine. Intro missing/not
  set up -> export proceeds without it (non-fatal).

### B. Collection share (playback pre-roll)
- Collection shares are **playback-composited** (presigned member list, no stitched file):
  `collections.py:775` create stores `collection_definition` JSONB; `:652` resolve presigns
  members. Add an `include_intro` flag into the definition at create; the resolver returns an
  `intro` field (presigned intro card URL, generated on first resolve + cached like posters).
- Viewer: render the intro as a **pre-roll** in `CollectionPlayer.jsx` before the first reel,
  mirroring the post-roll `BrandedEndCard.jsx` pattern (shown in `SharedCollectionView` +
  `DownloadsPanel`). No re-encode needed for playback.
- **Coordinate with [T4945](../T4945-collection-download-stitched-mp4.md)** (stitched-MP4 collection
  download, TODO): when that lands, the intro becomes the first burned-in segment of the stitch
  (reuse the T5210 concat), same as the multiclip case.

### C. Public-exposure warning (compliance — EPIC decision #4)
On the "Add intro" toggle in BOTH surfaces (and once at setup), show a clear notice: **the player's
photo and details become publicly visible to anyone with the share link.** Full name / high school
are optional; surface that. This is the single most important compliance UX in the epic.

## Relevant files
- `src/frontend/src/containers/ExportButtonContainer.jsx` (:642 multiclip trigger)
- `src/backend/app/routers/export/multi_clip.py` (:1832 / :1191 / :1100)
- `src/backend/app/routers/collections.py` (:775 create, :652 resolve)
- `src/frontend/src/components/collections/CollectionPlayer.jsx`, `SharedCollectionView.jsx`,
  `components/BrandedEndCard.jsx` (post-roll precedent)

## Classification hint
L-tier: two integration surfaces (burned-in export + playback pre-roll), frontend + backend, share
payload change. No schema migration (flag rides existing `collection_definition` JSONB + request
body). Depends on T5210. Reviewer required.

## Acceptance criteria
- [ ] Multiclip export with "Add intro" on prepends the intro to the rendered video (non-fatal when absent).
- [ ] Shared collection with intro plays the intro as a pre-roll before the first reel.
- [ ] Public-exposure warning shown on the toggle in both surfaces.
- [ ] Coordinated seam noted for T4945 burned-in collection stitch.
