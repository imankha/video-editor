# T5671: Draft poster thumbnails (backend)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 1 of 7

## Problem

The home-screen tile/carousel redesign (T5672) and My Reels tiles (T5673) need an image per
reel draft. Today **no thumbnail/poster field exists for drafts or clips anywhere in the data
model** (audited 2026-07-20: repo-wide grep for thumbnail/poster/preview fields on
project/clip models = zero hits). The only visual media is live video streaming
(`/api/downloads/{final_video_id}/stream` — and only when `has_final_video`; in-progress
drafts have nothing). You cannot build an image grid on top of video streams: a carousel of
~13 autoplaying `<video>` elements is a bandwidth/perf non-starter, especially mobile.

Published reels already get a poster at publish time (T5280, clearest-frame-posters epic).
Drafts — the surface being redesigned — do not.

## Solution

Give every reel draft a cheap, cacheable poster JPEG:

- **Endpoint:** `GET /api/projects/{project_id}/poster.jpg` (session-authed, same auth as the
  project routes). Serves from R2 cache; generates on first request.
- **R2 key:** deterministic `posters/drafts/{project_id}.jpg` — derived from the ID, **no new
  DB column, no migration** (correct-data rule: the key is derivable, storing it would be
  redundant state).
- **Frame choice:** reuse the clearest-frame helper family in
  `src/backend/app/services/poster.py` (`generate_and_store_poster:402` and the whole-clip
  clearest-frame path used by `ensure_recap_poster:529`). Source = the draft's first clip's
  source video at the clip's start region. No slow-mo policy (that's for published finals,
  T5090). If the source video is expired/missing, return 404 — the frontend renders its
  no-poster fallback; do NOT fabricate an image (no-silent-fallback rule).
- **Invalidation:** poster is regenerated when the draft's first clip changes. Delete the R2
  object inside the same gesture-triggered backend actions that change clip composition
  (clip add/remove/reorder on the project) — next GET regenerates. No reactive watcher.
- **Warming:** optional warm at auto-draft creation (materialization) IF cheap; otherwise
  generate-on-first-request is acceptable since the home screen tolerates late-loading images
  (unlike og:image crawlers — the T5270 constraint does not apply here).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/poster.py` — clearest-frame + poster storage helpers (reuse, don't fork)
- `src/backend/app/routers/clips.py` or the projects router — where the new GET endpoint lands (match existing poster endpoints' shape; see `shares.py` teammate poster proxy from T5180)
- `src/backend/app/routers/` clip-composition actions — hook poster invalidation into the existing gesture handlers
- R2 storage helpers already used by `poster.py`

### Related Tasks
- Blocks: T5672 (drafts tiles), T5673 (My Reels tiles, for any unpublished entries)
- Reuses: clearest-frame-posters epic (T5090/T5180/T5270/T5280) — read its
  [EPIC.md](../clearest-frame-posters/EPIC.md) design decisions (per-artifact policy,
  no-silent-fallback, warm-at-gesture)

### Technical Notes
- Per-user SQLite + R2 media: poster generation reads the user's source video from R2 —
  ffmpeg cost is one frame extract; recap posters already do this pattern (T5180 caches at
  `recaps/posters/{game_id}.jpg`).
- Expired-game drafts: source gone ⇒ 404 ⇒ frontend fallback tile. Do not resurrect
  (bug29p class — expiry is real).
- Poster failure must never fail the parent action (epic decision #1).

## Implementation

### Steps
1. [ ] Add `ensure_draft_poster(project_id, user_id)` in `poster.py` reusing clearest-frame helpers
2. [ ] Add `GET /api/projects/{project_id}/poster.jpg` (cache-first, generate-on-miss, 404 on missing source)
3. [ ] Invalidate (delete R2 object) in clip add/remove/reorder gesture handlers
4. [ ] Backend tests: cache hit, generate-on-miss, missing-source 404, invalidation on clip change
5. [ ] Update `.claude/knowledge/export-pipeline.md` (poster surface map) at task complete

## Acceptance Criteria

- [ ] `GET /api/projects/{id}/poster.jpg` returns a JPEG for a draft with a live source video
- [ ] Second GET is a cache hit (no ffmpeg run — assert via log/timing)
- [ ] Draft whose source is expired returns 404 (no fabricated image)
- [ ] Changing the draft's first clip serves a fresh poster on next GET
- [ ] Poster failure does not break clip actions (test with R2 write forced to fail)
- [ ] Backend tests pass (`run_tests.py` — warn user first: tests wipe dev Postgres)

## Progress Log

- 2026-07-22 (worker, branch `feature/T5671-draft-poster-thumbnails`): Implemented.
  - `poster.py`: `ensure_draft_poster` (cache-first, clearest frame in the first
    clip's `[in,out]` region via reused `resolve_clip_source` + `extract_clearest_frame_jpeg`,
    SourceUnavailable -> None), `invalidate_draft_poster` (best-effort delete, never raises),
    `draft_poster_rel_path`, `_load_first_clip_for_poster`. Key: `posters/drafts/{id}.jpg`
    (no DB column, no migration).
  - `projects.py`: `GET /api/projects/{id}/poster.jpg` + `_serve_draft_poster_jpeg`
    (session-authed, per-profile presign proxy, 404 on missing source/no clips).
  - `clips.py`: invalidation wired into add/upload/reorder/remove clip handlers.
  - Tests: `tests/test_t5671_draft_poster.py` (21 passing). Knowledge doc updated.
  - QA (live, imankh@gmail.com, project 39): 1st GET 200 image/jpeg 321KB 5.58s
    (`[DraftPoster] stored`); 2nd GET 0.25s identical bytes, no ffmpeg log = cache hit;
    reorder gesture -> next GET regenerated (5.67s, fresh store); no-clips draft -> 404;
    real-data expired-source (SourceUnavailable) -> None -> 404. All acceptance criteria met.
