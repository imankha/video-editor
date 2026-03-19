# T590: Production Environment Launch

**Status:** TODO
**Impact:** 10
**Complexity:** 5
**Created:** 2026-03-19
**Updated:** 2026-03-19

## Problem

No production environment exists. The app is only accessible on staging (`reel-ballers-staging.pages.dev`). Several dev-only features also need to be gated before public launch.

## Solution

Deploy the full prod stack (CF Pages frontend + Fly.io backend), configure the domain, and add `import.meta.env.PROD` guards to hide dev-only UI from production users.

## What's Already Done

The following was completed in the T550 session and is committed to master:

- `src/frontend/src/utils/analytics.js` — CF beacon injected only when `VITE_CF_ANALYTICS_TOKEN` is set; `track()` calls on login, export_started, export_complete, quest_reward_claimed
- `src/frontend/.env.production` — token `1f6df107d8a943e488e609ce101776ae`, API base `https://reel-ballers-api.fly.dev`
- `src/frontend/.env.staging` — analytics token intentionally absent (analytics prod-only)
- `src/backend/fly.production.toml` — prod Fly.io config, app `reel-ballers-api`, region lax
- `src/frontend/package.json` — `build:production`, `deploy:production`, `deploy:staging` scripts
- `scripts/release.bat` — tags commit + deploys frontend; guards against dirty tree / wrong branch
- `src/landing/index.html` — CF analytics beacon already embedded
- `reel-ballers-prod` CF Pages project — created in dashboard (manual upload placeholder)
- `DebugInfo.jsx` — already returns null when `versionInfo.environment === 'production'` ✅

## Context

### Relevant Files

**Frontend — feature gates (need changes):**
- `src/frontend/src/components/DownloadsPanel.jsx` — Before/After button (~line 221, `handleBeforeAfter`)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Import/Export annotation buttons
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — export handler (may also expose export)

**Frontend — already handled:**
- `src/frontend/src/components/DebugInfo.jsx` — already prod-gated ✅
- `src/frontend/src/utils/analytics.js` — CF beacon + track() ✅
- `src/frontend/.env.production` — token + API base ✅
- `src/frontend/package.json` — deploy scripts ✅

**Backend:**
- `src/backend/fly.production.toml` — prod Fly.io config ✅
- `src/backend/fly.staging.toml` — reference for which secrets to copy

**Infra:**
- `scripts/release.bat` — prod release script ✅

### Related Tasks
- Depends on: T550 (admin panel — TESTING, provides admin dashboard for monitoring)
- Blocks: T525 (Stripe integration — needs prod env first)

### Technical Notes

**Feature gate pattern** — use `import.meta.env.PROD` (Vite built-in, true only in production builds):
```jsx
{!import.meta.env.PROD && <BeforeAfterButton ... />}
```
This is tree-shaken at build time — zero runtime cost, the code is removed from the prod bundle entirely.

**DebugInfo** uses `versionInfo.environment` from `version.json`, which is set from `NODE_ENV` at build time. `vite build --mode production` sets `NODE_ENV=production`, so this already works correctly.

**CF Pages domain** — `reel-ballers-prod` project needs a custom domain added. Options:
- `app.reelballers.com` (recommended — keeps landing at root)
- `reelballers.com` directly (replaces the "coming soon" worker)

**Fly.io secrets** — prod app needs the same secrets as staging. Get current staging secrets as reference:
```
fly secrets list --app reel-ballers-api-staging
```

## Implementation

### Step 1 — Frontend feature gates (~20 LOC)

- [ ] `DownloadsPanel.jsx` — wrap Before/After button in `{!import.meta.env.PROD && ...}`
- [ ] `ClipsSidePanel.jsx` — wrap Import and Export buttons in `{!import.meta.env.PROD && ...}`
- [ ] Verify `DebugInfo.jsx` still hides correctly (it should — already implemented)
- [ ] Run `npm run build:production` locally and confirm the 3 elements are absent from the bundle

### Step 2 — Deploy frontend to CF Pages prod

> Wait for Cloudflare API to recover (was 503 on 2026-03-19)

```bat
cd src\frontend
npm run deploy:production
```

Expected output: `✨ Deployment complete! URL: https://reel-ballers-prod.pages.dev`

### Step 3 — Add custom domain to CF Pages prod

1. CF Dashboard → Workers & Pages → `reel-ballers-prod` → Custom domains
2. Add `app.reelballers.com` (or `reelballers.com` — decide first)
3. CF will auto-provision SSL

### Step 4 — Deploy backend to Fly.io prod

```bat
# Create the prod app (one-time)
fly apps create reel-ballers-api

# Set secrets (copy from staging — get values from 1Password / .env)
fly secrets set --app reel-ballers-api \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  GOOGLE_CLIENT_ID=... \
  SECRET_KEY=...

# Deploy
cd src\backend
fly deploy --config fly.production.toml
```

- [ ] Update `CORS_ORIGINS` in `fly.production.toml` to match the actual prod domain once chosen in Step 3

### Step 5 — Verify

- [ ] Open prod URL — app loads, no DebugInfo badge visible
- [ ] Log in — no errors, credits load
- [ ] Annotate screen — no Import/Export buttons visible
- [ ] Gallery — no Before/After button on downloads
- [ ] Open DevTools Network tab — CF beacon fires to `static.cloudflareinsights.com`
- [ ] Check CF Analytics dashboard — site shows traffic

### Step 6 — Tag the release

```bat
cd /path/to/video-editor
scripts\release.bat v1.0.0
```

## Acceptance Criteria

- [ ] `https://app.reelballers.com` (or chosen domain) serves the prod build
- [ ] Backend `https://reel-ballers-api.fly.dev` responds to `/api/health`
- [ ] DebugInfo badge not visible in prod
- [ ] Before/After button not visible in Gallery on prod
- [ ] Import/Export buttons not visible in Annotate on prod
- [ ] CF Analytics beacon fires on page load (verify in Network tab)
- [ ] First prod release tagged as `v1.0.0` in git
