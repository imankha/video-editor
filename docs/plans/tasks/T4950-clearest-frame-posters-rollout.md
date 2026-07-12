# T4950: Clearest-Frame Posters — Prod Rollout + Real Footage on Game Links

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

Link previews (og:image) originally used the FIRST frame of each reel. First frames
are frequently the worst frame: fade-ins, motion blur off the whistle, or black
lead-in. A blurry unfurl card weakens the share -> signup funnel (the preview IS the
pitch to a not-yet-user parent).

Separately, game/teammate share links (`/shared/teammate/{token}`) unfurl with the
generic branded card (logo + tagline) rather than actual game footage - correct but
less compelling than a real frame from that game.

## What is ALREADY SHIPPED (merged 2026-07-12, commit 175f6253 - do not rebuild)

- `extract_clearest_frame_jpeg` in [poster.py](../../src/backend/app/services/poster.py):
  samples one frame at 15/30/50/70/85% of the clip (skips fade-in/out extremes),
  JPEG-encodes each, keeps the LARGEST encoding. **Heuristic rationale: JPEG size
  tracks detail - motion blur and defocus compress away high-frequency content, so
  the biggest encoding is the crispest candidate.** ~5 fast seeks + 5 single-frame
  encodes per reel (faststart MP4s make remote seeks ranged reads); no ML, sub-second,
  runs ONCE per reel at publish. Falls back to first-frame when ffprobe fails.
- `generate_and_store_poster` now uses it - all NEW reels get clearest-frame posters.
- `backfill_posters(limit, dry_run, force)` - `force=True` REGENERATES posters for all
  published reels in place (deterministic key, overwrite; no schema change).
  Admin endpoint: `POST /api/admin/backfill-share-posters?limit=N&force=true`.
- Tests: `test_clearest_frame_skips_blurry_opening` (black opener vs detailed middle),
  fallback test, plus the existing poster suite (18 passing).
- STAGING: force regeneration run 2026-07-12 (all ~32 published reels).

## Remaining Scope

### 1. Prod rollout (the actual task trigger)

After the next production deploy (`/deploy`) ships commit 175f6253+:

1. Run the force regeneration on prod (batched; repeat while `partial=true`):
   ```
   fly ssh console -a reel-ballers-api -C 'python -c "from app.services.pg import init_pg_pool; init_pg_pool(); from app.services.poster import backfill_posters; import json; print(json.dumps(backfill_posters(200, False, True)))"'
   ```
   (Admin endpoint alternative: `POST /api/admin/backfill-share-posters?limit=200&force=true`.)
2. Verify with the crawler-sim on a real prod share link:
   ```
   python scripts/verify_share_unfurl.py https://app.reelballers.com/shared/{token} --attempts 3
   ```
3. Note: prod app root og:image (`app.reelballers.com/og-card.jpg`) also goes live with
   this deploy - verify it serves `image/jpeg` (staging + landing already verified).

### 2. Game/teammate links: real footage instead of the branded card

Today `/shared/teammate/{token}` unfurls with the static branded card
([functions/shared/teammate/[token].js](../../src/frontend/functions/shared/teammate/%5Btoken%5D.js))
because games have no poster objects. Upgrade path:

- Every game has a RECAP (`recaps/{game_id}.mp4` under the sharer's profile prefix,
  hi-q since T4140). Generate a poster from it with the SAME clearest-frame helper,
  cached at `recaps/posters/{game_id}.jpg` (deterministic key, generate-on-first-
  request then reuse - a crawler-triggered ffmpeg run is acceptable at this
  frequency, and the 24h Cache-Control on the proxy absorbs repeats).
- New stable endpoint `GET /api/shared/teammate/{token}/poster.jpg` mirroring the
  reel/collection poster proxies (`_serve_poster_jpeg` in shares.py; token+revoked
  gate; NEVER presigned URLs in og:image - see the T4890 lessons in the edge files).
- Teammate edge function: use the poster endpoint when the recap poster resolves,
  keep the branded card as the no-recap fallback (recap missing/reclaimed -> card,
  never a broken image).
- Tests: poster generated + cached on second request; fallback to card when recap
  absent; no sharer email in tags (existing test stays green).

### 3. Optional tuning (only if visual QA on staging shows misses)

`CANDIDATE_POSITIONS` and the JPEG `-q:v` are module constants in poster.py. If the
size heuristic ever picks a busy-but-irrelevant frame (e.g. crowd pan), candidates:
add a center-crop weighting, or bias toward frames where the spotlight overlay region
has motion. Do NOT reach for scene-detection/ML - cost is not justified at this
image size.

## Context

### Relevant Files
- `src/backend/app/services/poster.py` - clearest-frame helper + backfill (shipped)
- `src/backend/app/routers/shares.py` - poster proxies (`_serve_poster_jpeg`)
- `src/frontend/functions/shared/teammate/[token].js` - game-link edge tags
- `scripts/verify_share_unfurl.py` - crawler-sim verifier (run per surface)

### Related Tasks
- Builds on: T4890 (poster mechanism + unfurl hardening; see its task file for the
  presigned-URL / cache-poisoning / twitter-card lessons)

## Acceptance Criteria

- [ ] Prod posters regenerated with clearest-frame (force backfill, 0 failed)
- [ ] `verify_share_unfurl.py` passes 3/3 on a prod reel link, collection link, and
      teammate link
- [ ] Game/teammate links unfurl with a real recap frame when a recap exists, the
      branded card when not
- [ ] `app.reelballers.com/og-card.jpg` serves image/jpeg on prod
- [ ] Tests pass
