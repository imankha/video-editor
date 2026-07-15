# T5180: Real recap footage on game/teammate links

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Epic:** [Clearest-Frame Posters](EPIC.md) — child 2 of 3
**Created:** 2026-07-15 (split from T4950)

> Read [EPIC.md](EPIC.md) for shared context: the shipped clearest-frame helper, the
> per-artifact poster policy, and the never-presigned-URLs-in-og:image rule.

## Problem

Game/teammate share links (`/shared/teammate/{token}`) unfurl with the generic branded card
(logo + tagline) rather than actual game footage — correct but far less compelling than a real
frame from that game. Games have no poster objects today.

## Decision (from user)

Game recaps use the **whole-clip clearest-frame heuristic** (the already-shipped 5-sample
JPEG-size selection). Recaps are stitched artifacts with no per-segment slow-mo data, so the
reel-only slow-mo-first policy (T5090) does NOT apply here — do not attempt slow-mo
reconstruction for recaps.

## Solution

- Every game has a RECAP (`recaps/{game_id}.mp4` under the sharer's profile prefix, hi-q since
  T4140). Generate a poster from it with the SAME `extract_clearest_frame_jpeg` helper, cached at
  `recaps/posters/{game_id}.jpg` (deterministic key; generate-on-first-request then reuse — a
  crawler-triggered ffmpeg run is acceptable at this frequency, and the 24h Cache-Control on the
  proxy absorbs repeats).
- New stable endpoint `GET /api/shared/teammate/{token}/poster.jpg` mirroring the reel/collection
  poster proxies (`_serve_poster_jpeg` in [shares.py](../../../src/backend/app/routers/shares.py);
  token + revoked gate; **never presigned URLs in og:image** — see the T4890 lessons in the edge
  files, restated in EPIC.md).
- Teammate edge function
  ([functions/shared/teammate/[token].js](../../../src/frontend/functions/shared/teammate/%5Btoken%5D.js)):
  use the poster endpoint when the recap poster resolves; keep the branded card as the no-recap
  fallback (recap missing/reclaimed -> card, never a broken image).

## Relevant files
- `src/backend/app/services/poster.py` — reuse `extract_clearest_frame_jpeg` (do not modify its
  selection logic here)
- `src/backend/app/routers/shares.py` — `_serve_poster_jpeg` pattern; add the teammate poster proxy
- `src/frontend/functions/shared/teammate/[token].js` — game-link edge tags
- `scripts/verify_share_unfurl.py` — crawler-sim verifier

## Steps
1. [ ] `recaps/posters/{game_id}.jpg` generation from the game recap via the shipped helper,
   cached (generate-on-first-request, deterministic key, overwrite-safe)
2. [ ] `GET /api/shared/teammate/{token}/poster.jpg` proxy (token + revoked gate, 24h
   Cache-Control, image/jpeg)
3. [ ] Teammate edge function emits og:image/twitter:image via the endpoint; branded card fallback
   when no recap
4. [ ] Tests: poster generated + cached on second request; fallback to card when recap absent;
   no sharer email in tags (existing test stays green)

## Classification hint
M-tier: backend endpoint + poster generation + one edge function. No schema change (deterministic
R2 key, no DB ref needed). Reuses the shipped helper — no frame-selection logic here.

## Acceptance criteria
- [ ] Game/teammate links unfurl with a real recap frame (whole-clip clearest) when a recap
  exists, the branded card when not (never a broken image)
- [ ] Recap poster generated on first crawler request and reused thereafter
- [ ] og:image is served through the token-gated proxy, never a presigned URL
- [ ] `verify_share_unfurl.py` passes on a teammate link; existing no-email test stays green
