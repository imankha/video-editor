# T8200: Game thumbnail missing (found investigating bknoto@gmail.com)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-31

## Problem

Investigating bknoto@gmail.com (bug 47p / T8170 upload-outage victim) at the user's request: the
game tile for their one surviving game shows no thumbnail.

- `games` row (profile e1e28f91, prod): `id=12`, `name='Test: Vs Test Aug 23'`,
  `video_filename='d8532ab7...810801.mp4'`, `status='ready'`, `recap_video_url=NULL`,
  `video_duration=11.9`, created `2026-08-31 05:17:45` — squarely inside the T8160/T8170
  upload-outage window (deploy ~2026-08-30 -> T8160 fix), one of the 9 throwaway "Test:..." games
  the user created retrying a failing upload.
- `raw_clips` is EMPTY for this profile (no clips ever saved against game 12), so
  `GET /api/games/12/poster.jpg` (`src/backend/app/routers/games.py:3223`) takes the no-recap
  branch and calls `ensure_game_source_poster` (`src/backend/app/services/poster.py:1138`), which
  falls back to `(primary video hash, GAME_POSTER_FALLBACK_OFFSET_SEC)` since `_choose_game_poster_frame`
  has no rated clip to pick.
- That function is best-effort and swallows failures at INFO level (`[GamePoster] ...`), so the
  actual failure reason (HEAD-probe miss, presign failure, ffmpeg extraction failure, or R2 upload
  failure — all four are dead ends inside the same `try` at poster.py:1174-1229) is not visible
  from the DB state alone.

## Solution

1. Reproduce live: hit `GET /api/games/12/poster.jpg` for this account (dev-login impersonation,
   see `backend-services.md` § Auth bypasses) and observe whether it 404s now that the network
   outage is resolved — the failure may have been transient (R2 instability during the same window
   that broke uploads) and could already be self-healing on next request, since the endpoint
   retries generation on every miss (no negative R2 cache, only a 60s HTTP cache header).
2. If it still fails, grep prod logs for `[GamePoster] game 12` around 2026-08-31 to find which of
   the four failure points hit (HEAD miss on `games/{hash}.mp4`, presign failure, ffmpeg
   `extract_first_frame_jpeg` failure, or `upload_bytes_to_r2_global` failure) — Fly log retention
   may not reach back that far; if not, treat as unreproducible-historically and validate the fix
   against a fresh forced-failure repro instead.
3. If reproducible: fix the root cause. If it was a transient outage artifact and now resolves
   itself: no code fix needed, but consider whether `ensure_game_source_poster`'s silent INFO-level
   swallow should be tightened to WARNING when the failure isn't the expected "expired source"
   case (`r2_head_object_global(game_key) is None`), so a real infra failure doesn't hide at INFO
   forever the way this one did.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py` — `get_game_poster` (L3223), the serving endpoint
- `src/backend/app/services/poster.py` — `ensure_game_source_poster` (L1138),
  `_choose_game_poster_frame`, `extract_first_frame_jpeg`
- `src/frontend/src/components/*GameTile*` — thumbnail render / fallback tile (verify exact path
  during implementation; not yet located this session)

### Related Tasks
- Bug 47p / T8160 (upload outage) / T8170 (outage victim recovery, bknoto explicitly named) — the
  game this thumbnail is missing for was created DURING the outage window as a retry throwaway.
- [[T8210]] — same account, reel poster also missing, but that reel predates the outage (published
  2026-08-29) so is very likely a SEPARATE root cause. Investigate independently; don't assume one
  fix covers both.

### Technical Notes
`ensure_game_source_poster` is explicitly "best effort: never raises" (poster.py:1163) — by design
a poster failure must never break the game tile or fail a parent operation. That contract should
stay; the fix here is either a genuine bug in one of the four failure branches, or confirms the
outage was the whole story and no code changes are needed beyond maybe raising the log level for
future diagnosability.

## Implementation

### Steps
1. [ ] Live-repro the poster endpoint for bknoto's game 12 (dev-login impersonation)
2. [ ] If still failing, identify which failure branch and root-cause it
3. [ ] Fix if a real bug; otherwise document the outage-artifact conclusion and consider the
       log-level tightening
4. [ ] Confirm the tile renders a thumbnail for this account post-fix

## Acceptance Criteria

- [ ] `GET /api/games/12/poster.jpg` for bknoto's account returns a real image, not 404
- [ ] Root cause documented (either a code fix, or confirmed outage-only with no repro today)
