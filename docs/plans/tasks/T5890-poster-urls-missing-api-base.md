# T5890: Poster URLs use bare `/api/...` paths — no poster imagery on staging/prod (split-host)

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Created:** 2026-07-25

## Problem

User report 2026-07-25: "how come i don't see any game posters on staging?"

**Not a missing-poster problem — a URL problem. No backfill is needed.**

`GameTile.jsx:139` builds the poster URL as a **bare relative path**:

```js
const posterUrl = `/api/games/${game.id}/poster.jpg`;
```

The frontend (Cloudflare Pages) and the API (Fly) are **different hosts** in staging and prod, so
that resolves against the Pages origin and returns the SPA shell instead of an image. Verified live
on staging 2026-07-25:

| Request | Result |
|---|---|
| `https://reel-ballers-staging.pages.dev/api/games/7/poster.jpg` (what the tile requests) | **200 `text/html`** — `<!doctype html>...` |
| `https://reel-ballers-api-staging.fly.dev/api/games/7/poster.jpg` (the real API) | **200 `image/jpeg`** |

The `<img>` gets HTML, decode fails, `onError` fires, `posterState='error'`, the img unmounts and
the sport-aware branded fallback renders — so the UI looks "fine" while every poster is silently
broken. DOM check on the staging Games tab: **6 `[data-game-id]` tiles, 0 poster `<img>` elements.**

**The backend is healthy.** All 6 games returned 200 with real JPEG bytes (14-38 KB) when fetched
against the API host directly — including games with **no recap** (source-frame path) and
**expired** games. Generation-on-demand works. A poster backfill/migration would regenerate files
that already generate fine and the tiles still would not show them.

**Why it passed review:** locally, Vite proxies `/api` to the backend, so relative URLs work. The
bug only appears on split-host deployments, and the container QA ran against the local stack.

## Solution

Use the configured API base, as the rest of the app already does (e.g. `BuyCreditsModal` uses
`${API_BASE}/api/payments/...`):

```js
const posterUrl = `${API_BASE}/api/games/${game.id}/poster.jpg`;
```

### Audit ALL poster/media URL construction (required — do not fix only GameTile)

The same mistake may exist on other poster surfaces. On the staging **reels** page only **1 `<img>`
total** rendered, which suggests draft/reel posters may be affected too (note: a local screen
recording DID show draft posters rendering, which is consistent with the local Vite proxy masking
it — so verify on STAGING, not locally). Grep the frontend for bare `` `/api/ `` string literals used
as image `src`, `href`, `poster=`, or fetch targets, and fix every one:
- `src/frontend/src/components/GameTile.jsx` (confirmed broken)
- `src/frontend/src/components/DraftTile.jsx`, `components/collections/ReelTile.jsx` /
  `DownloadsPanel.jsx` (how is `posterUrl` built and passed?)
- recap posters, share/unfurl posters, any `<video poster=...>`
Report the full list you found and which were already correct.

### Guard against regression
Add a lint-style or unit guard so a bare `/api/` literal cannot be used as a media URL again (the
repo already has precedent for this kind of gate — see `scripts/check-viewport-units.mjs` and the
Branch CI "Viewport-unit gate"). A cheap grep-based check in CI is acceptable; state what you chose.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx:139` — the confirmed bug
- Wherever `API_BASE` is defined/exported — use the existing constant, do not invent a new one
- `src/backend/app/routers/games.py:2473` — the poster endpoint (WORKING, do not change)
- `.github/workflows/branch-ci.yml` + `scripts/check-viewport-units.mjs` — precedent for a repo gate

### Related
- T5681 (Games tab poster grid) — introduced `GameTile`; this defeats its entire purpose in prod
- T5682 (poster serving perf) — poster serving/caching, unaffected
- Clearest-Frame Posters epic — backend poster generation, confirmed working

## Acceptance Criteria

- [ ] Game posters render on the Games tab **on staging** (not just locally)
- [ ] Every poster/media URL uses the API base; the audit list is reported, including surfaces
      already correct
- [ ] No poster surface regressed (drafts, reels, recaps, share unfurls)
- [ ] A regression guard prevents a bare `/api/` media URL from returning
- [ ] Verified against the DEPLOYED staging host, with evidence (a poster `<img>` with
      `naturalWidth > 0`), NOT the local dev server — local Vite proxying masks this class of bug
