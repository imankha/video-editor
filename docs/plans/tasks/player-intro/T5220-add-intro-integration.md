# T5220: Apply the intro at every egress

**Status:** TODO
**Impact:** 7 | **Complexity:** 5
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5215](T5215-intro-attachment.md)

> Read [EPIC.md](EPIC.md) (decision 1 — this task's whole shape). Knowledge doc:
> `.claude/knowledge/export-pipeline.md` § branded outro (the precedent being mirrored) and
> § poster/og:image (the four egress points).

## Reworked 2026-08-03

Previously: an `include_intro` flag on `/api/export/multi-clip` that burned the intro into the
rendered file, plus a collection pre-roll. **Epic decision 1 replaced burn-at-export with
apply-at-serve**, mirroring `append_branded_outro` in the prepend direction.

Why: swapping a reel's intro then costs nothing and needs no re-export or credits; every existing
reel can have one immediately with no backfill; stored R2 objects stay byte-identical so posters,
slow-mo section offsets, chapter markers, ranking and share links are all untouched.

## Problem

A reel leaves the app through four doors. All four must show the intro the
[T5215](T5215-intro-attachment.md) resolver picks, and none of them may break when the card fails.

## Scope

### A. Owner download — burn it in

- `GET /api/downloads/{id}/file` (`downloads.py:~697` and the local-file branch at `:~736`) already
  downloads the object to a temp dir and calls `append_branded_outro` before streaming. Add the
  prepend in the same pass so the output is **`[intro][reel][outro]` in ONE concat**, not two.
- Reuse [T5210](T5210-intro-card-generation.md)'s cached card + the shared concat helpers.
- **Non-fatal**: a failed card logs loudly and serves the reel (with its outro) anyway. HTTP 200
  always — the existing outro contract, unchanged.

### B. Playback surfaces — pre-roll component

- Single-reel share (`SharedVideoOverlay`), collection playback (`CollectionPlayer` /
  `SharedCollectionView`), and the edge share page (`functions/shared/[token].js`).
- Mirror `BrandedEndCard.jsx`'s pattern in reverse: an `IntroPreRoll` shown before playback starts,
  then the player. No re-encode for playback.
- **Owner-facing surfaces (editor, ranker, My Reels tiles) do NOT show the pre-roll** — same
  prop-gating rule the outro card already follows.
- The share payload carries the resolved intro (presigned card URL, or the card document if the
  pre-roll renders in the DOM — the design picks one; the DOM route reuses `RichText` and avoids a
  render entirely for playback).

### C. Share-page download

- Today this fetches the presigned R2 URL directly and gets **neither** the outro nor metadata.
  **T6360 already routes this through a backend endpoint** — coordinate rather than build a second
  path: whichever lands first owns the routing, the second one adds its pass to the same helper.

### D. Collection stitched download — the T4945 seam

- [T4945](../T4945-collection-download-stitched-mp4.md) (TODO) stitches collection members into one
  MP4 with exactly one branded outro. When it lands, the intro is the **first segment of the
  stitch** — one intro for the whole collection, not one per member. Leave the seam explicit and
  documented even though T4945 is not this task's job.

### E. Serve-time helper — build it once

Three tasks now want a serve-time pass over a downloaded reel: the outro (shipped), the intro
(this), and T6360's metadata stamping. Factor **one** helper that composes the passes in a defined
order, so the file is opened, concatenated and streamed once instead of three times.

### F. Public-exposure notice

Wherever an intro is chosen or a shared link is created with one attached, state plainly: **the
player's photo and details become publicly visible to anyone with the link.** This is the single
most important compliance UX in the epic ([T5230](T5230-childrens-data-compliance.md)).

## Relevant files
- `src/backend/app/routers/downloads.py:697-751` — the two outro-burn branches
- `src/backend/app/services/branded_outro.py` — `append_branded_outro`, concat helpers, cache
- `src/backend/app/routers/collections.py:652` — resolve
- `src/frontend/src/components/BrandedEndCard.jsx` — the pattern to mirror
- `src/frontend/src/components/SharedVideoOverlay.jsx`, `collections/CollectionPlayer.jsx`,
  `SharedCollectionView.jsx`, `functions/shared/[token].js`
- `docs/plans/tasks/T6360-download-metadata-cover-art.md` — the other serve-time pass

## Classification hint
L-tier: backend + frontend, multiple egress surfaces, no schema change. Reviewer required. Manual
verification on a real share link and a real download is mandatory — the four paths cannot be
proven by unit tests alone.

## Acceptance criteria
- [ ] Downloading a reel with an intro attached yields `[intro][reel][outro]` in one concat pass.
- [ ] A shared reel plays its intro as a pre-roll; the owner's own surfaces do not show it.
- [ ] A shared collection plays its frozen intro once, before the first member.
- [ ] Changing a reel's attached card changes the next download with **no re-export**.
- [ ] Every intro failure is non-fatal: the user still gets their video, and the failure is logged.
- [ ] The public-exposure notice appears wherever an intro is attached or shared.
- [ ] The T4945 stitch seam and the T6360 shared-helper seam are documented in the code.
