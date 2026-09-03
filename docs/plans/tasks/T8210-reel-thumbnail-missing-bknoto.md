# T8210: Reel (published video) thumbnail missing (found investigating bknoto@gmail.com)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-31

## Problem

Investigating bknoto@gmail.com at the user's request: their one published reel shows no
thumbnail/cover image.

- `final_videos` row (profile e1e28f91, prod): `id=3`, `filename='final_2_8ba1a403.mp4'`,
  `published_at='2026-08-29 18:53:49'`, `poster_filename=NULL`, `poster_frame_time=NULL`,
  `poster_source=NULL`. This predates the 2026-08-30 upload outage (T8160/T8170) — unlike
  [[T8200]]'s game-poster miss, this is NOT explained by that incident and needs its own
  root-cause.
- Per T5410 (see code comment at `src/backend/app/routers/downloads.py:2169-2176`), poster capture
  moved from publish-time to OVERLAY-EXPORT time: `generate_poster_at_export`
  (`src/backend/app/services/poster.py:716`), called from `routers/export/overlay.py:1995` right
  after `_finalize_overlay_export`. `export_jobs` for this account shows the matching overlay
  export completed successfully (`export_1788029576512_ib5xwby`, type=overlay, status=complete,
  output_filename matches `final_videos.filename`) — so the export succeeded but the poster step
  that should have run immediately after it left no trace.
- `generate_poster_at_export` is explicitly documented as "best-effort — NEVER raises" and on
  failure only logs at INFO (`[Poster] fv=... generation error: ...` or
  `[Poster] fv=... no poster stored`) — so, same shape as T8200, the actual failure reason is not
  visible from DB state alone.
- Publish itself (`publish_to_my_reels`, downloads.py:2089) only does a best-effort R2
  existence check post-hoc and logs at INFO if the poster object is missing — it does not
  retry generation, by design (T5410 reversed the old publish-time capture specifically to avoid
  duplicating the export-time capture).
- There is a backfill sweep referenced at `admin.py:935` / `poster.py:1409` for exactly this
  case ("rows with `poster_filename IS NULL`... backfill") — worth checking whether it has run
  recently, or whether it should be run for this account as an immediate remediation while the
  root cause of the export-time miss is investigated separately.

## Solution

1. Grep prod logs for `[Poster] fv=3` around 2026-08-29 18:52-18:54 to find the actual failure
   (ffmpeg seek failure, R2 upload failure, or an uncaught exception in `open_play_window`/
   `select_poster_frame`) — check log retention first; this is 2 days old and may already be gone.
2. If logs are gone, drive a fresh overlay export in a similar shape (same slowmo section values:
   `slowmo_section_start=3.22522`, `slowmo_section_end=5.904092`, `duration=10.7`) to see if the
   poster step reproducibly fails, or was a one-off (transient ffmpeg/R2 hiccup).
3. Root-cause and fix if reproducible.
4. Regardless of root cause, run (or build, if it doesn't already have an admin trigger) the
   existing poster-backfill sweep for this account so the reel gets a thumbnail without waiting on
   a re-export — check `poster.py` around L1409 / `admin.py` around L935 for the existing
   entry point before building a new one.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/poster.py` — `generate_poster_at_export` (L716), `_set_poster_fields`
  (L688), the backfill sweep (~L1409)
- `src/backend/app/routers/export/overlay.py` — call site (L1995), `_finalize_overlay_export`
- `src/backend/app/routers/downloads.py` — `publish_to_my_reels` (L2089), the post-hoc existence
  check (L2169-2191)
- `src/backend/app/routers/admin.py` — backfill trigger (~L935)

### Related Tasks
- [[T8200]] — same account, game poster also missing, likely a SEPARATE root cause (this reel
  predates the upload outage; the game does not)

### Technical Notes
Both poster generators share the "best-effort, INFO-only, never raises" contract deliberately
(poster failure must never fail export or publish). That's correct and should not change; but
consider whether the failure log should also increment a counter/metric so silent poster misses
are discoverable in aggregate rather than only via manual account investigation like this one.

## Implementation

### Steps
1. [ ] Grep prod logs for the L2093-era `[Poster] fv=3` line; note outcome
2. [ ] If unrecoverable from logs, reproduce with a similar export and observe
3. [ ] Root-cause and fix if a real bug found
4. [ ] Run/trigger the poster backfill for bknoto's account as immediate remediation
5. [ ] Confirm the reel shows a thumbnail in My Reels / Gallery post-fix

## Acceptance Criteria

- [x] bknoto's published reel (final_video id=3) has a real poster image
- [x] Root cause documented; if a genuine bug, fixed with a regression test
- [x] Considered (not necessarily built) a discoverability signal for future silent poster misses

## Post-merge remediation (2026-09-03)

Ran the existing `backfill_posters` sweep against **production** via
`fly ssh console -a reel-ballers-api` (direct function call, bypassing the HTTP admin
layer, same pattern as `scripts/apply_stranded_uploads_sweep.py`):

1. Dry run (`dry_run=True`) confirmed the entire candidate set was exactly one row:
   `scanned: 1, generated: [3]` &mdash; final_video id=3 (bknoto), nothing else in prod
   currently missing a poster.
2. Real run (`dry_run=False`) executed: `generated: [3], failed: []`.
3. Verification: re-ran the dry run &mdash; `scanned: 0, generated: []`, confirming the
   row fell out of the candidate set (poster_filename is no longer NULL).

bknoto's reel now has a real cover image. No other account was touched.
