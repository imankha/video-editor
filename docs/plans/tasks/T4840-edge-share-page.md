# T4840: Edge-Rendered Share Page (video snaps)

- **Impact:** 9
- **Complexity:** 6
- **Status:** TODO
- **Stack:** Backend (FastAPI) + Edge (Cloudflare Pages Function)
- **Migration:** none (no schema change)

## Problem (measured on prod, 2026-07-10 -- supervisor HAR analysis)

`https://app.reelballers.com/shared/{token}` takes ~1.63s to video-playing (fresh
browser, warm edge; 4.9s true-cold). Attribution:

1. **~755ms** -- the share view boots the entire editor SPA: 816KB app JS + 1MB
   Stripe + 259KB Google GSI + service-worker precache of every editor chunk, for
   an anonymous viewer.
2. **~530ms** -- `GET /api/shared/{token}` TTFB (~400ms server work): `record_milestone("share_viewed")`
   ran SYNCHRONOUSLY before the response -- 2 Postgres writes + opening the
   SHARER's per-user SQLite.
3. **~370ms** -- video bytes (R2-direct presigned, 512KB prefetch) -- healthy, keep.

Goal: **the video snaps** -- player shell visible ~200-300ms, video playing well
under 1s.

## Design (implemented)

### 1. Backend: analytics off the response path
- `get_shared_video` (`src/backend/app/routers/shares.py`) now schedules
  `record_milestone(...)` via FastAPI `BackgroundTasks` instead of calling it
  inline. Response no longer waits ~400ms; semantics identical.
- New `POST /api/shared/{share_token}/viewed` -- a beacon endpoint that validates
  the token exists and schedules the same `record_milestone` in the background;
  returns 204. Unknown token -> 404; revoked -> 204 without recording. No auth
  (public shares are viewed anonymously today; the old GET recorded anonymously).
  The edge page calls this on EVERY view (cache hits included) so view analytics
  don't regress when the JSON is edge-cached.

### 2. Edge: Cloudflare Pages Function `src/frontend/functions/shared/[token].js`
- Route matches ONLY single-segment `/shared/{token}`. `/shared/collection/*` and
  `/shared/teammate/*` are two segments -> never match `[token]` -> keep hitting
  the SPA via `public/_redirects` (`/* /index.html 200`). Functions take
  precedence over that rewrite.
- **API base by hostname** (no dashboard env vars): `app.reelballers.com` ->
  `https://api.reelballers.com`; anything else (staging/preview) ->
  `https://reel-ballers-api-staging.fly.dev`.
- Fetches `GET {api}/api/shared/{token}` server-side. **Edge-caches** the JSON via
  the Cache API keyed by token, ONLY when `is_public === true` (and a `video_url`
  is present), TTL **10 minutes** (`s-maxage=600`) -- comfortably under the 4h
  presign expiry (`generate_presigned_url_global` default 14400s) so a cached page
  never embeds a dead video URL. Non-public / error / timeout responses: never
  cached.
- **200 + public** -> render the share page. **Non-public / 403 / 404 / 410 / API
  error / timeout (~2s cap)** -> fall through to the SPA via `context.env.ASSETS.fetch()`
  so today's sign-in / revoked / not-found flows stay byte-identical. The function
  MUST NEVER make a share less accessible than today -- any doubt -> SPA fallthrough.
- `waitUntil(fetch POST {api}/api/shared/{token}/viewed)` -- fire-and-forget on
  every render (cache hit or miss).

### 3. The share page HTML (rendered by the function)
Single self-contained HTML string (inline CSS, ZERO external JS/CSS -- no Stripe,
GSI, service worker, or app bundle):
- `<video src=... autoplay muted playsinline controls preload="auto">` -- muted +
  playsinline makes mobile autoplay legal so the first frame paints as fast as the
  bytes arrive. Tap-to-unmute overlay button (a few inline lines).
- `<link rel="preconnect">` to the video URL origin in `<head>`.
- Dark theme matching the app (bg #030712, cyan `#22d3ee` accent); title =
  `video_name`; Download link; footer CTA "Open Reel Ballers" -> `https://app.reelballers.com/`.
- Open Graph / Twitter meta (`og:title`, `og:video`, `og:type=video.other`, desc)
  so links unfurl in iMessage/WhatsApp.
- ALL interpolated values pass through an `escapeHtml` helper (server-rendered
  HTML; XSS via a crafted video name must be impossible).
- Page weight target: < 15KB total HTML.

### 4. SPA: untouched
`SharedVideoOverlay.jsx` remains the fallback path (non-public, collection,
teammate, revoked, direct navigation while signed in). No frontend `src/` changes.

## Deploy pipeline

Both `.github/workflows/deploy-frontend.yml` (staging) and
`scripts/deploy_production.sh` (prod) run `wrangler pages deploy dist` with
`working-directory: src/frontend` (cwd `src/frontend`). Wrangler auto-bundles
`./functions` from cwd -- **no deploy-script change required** for either env.

## Revoke latency (documented tradeoff)

A public share's JSON is edge-cached for up to 10 minutes. If a sharer revokes a
public share, the edge page may keep serving for **up to 10 minutes** (the cache
TTL) before the next fetch re-checks the API and gets the 410 -> SPA fallthrough.
This is an accepted tradeoff for the snap; private shares are never cached, and
the presign TTL (4h) always dominates so a cached page never embeds a dead URL.

## Acceptance criteria

- [ ] Public share link renders a self-contained edge page (< 15KB, zero external
      JS) with muted autoplay video; measured locally: video element present
      < 500ms, no app bundle / Stripe / GSI in the HAR.
- [ ] Non-public / collection / teammate / unknown / revoked paths fall through to
      the SPA byte-identical to today.
- [ ] `GET /api/shared/{token}` no longer blocks on analytics (record_milestone in
      background); beacon endpoint records views on edge-cache hits.
- [ ] Edge cache: public shares cached <= 10 min (< 4h presign); non-public never
      cached; revoke honored within TTL (<=10-min revoke latency, documented above).
- [ ] OG / Twitter meta present; all interpolations HTML-escaped (test proves it).
- [ ] Deploy pipeline picks up `functions/` (wrangler bundles it from
      `working-directory: src/frontend`; prod script uses the same command).
- [ ] Backend tests pass (scope: shares / analytics).
