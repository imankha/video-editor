# T110: Cloudflare Pages Staging Frontend

**Status:** TESTING

## Overview
Deploy the React frontend to Cloudflare Pages for staging.

## Live URL

**https://reel-ballers-staging.pages.dev**

- Backend: https://reel-ballers-api-staging.fly.dev
- Cloudflare Pages project: `reel-ballers-staging`

## Prerequisites
- T100 complete (Backend deployed to Fly.io)
- Cloudflare account (already have for R2)
- `wrangler` CLI: `npx wrangler login`

---

## How It Works

### API URL Configuration
`src/frontend/src/config.js` reads `VITE_API_BASE` env var at build time:

```javascript
export const API_BASE = import.meta.env.VITE_API_BASE || '';
```

- **Dev:** empty string — Vite proxy forwards `/api/*` to localhost
- **Staging:** set `VITE_API_BASE=https://reel-ballers-api-staging.fly.dev` at build time

### WebSocket URLs
WebSocket managers (`ExportWebSocketManager`, `ExtractionWebSocketManager`, `CompareModelsButton`) derive the WS host from `VITE_API_BASE` when set, falling back to `window.location` for dev.

### SPA Routing
`src/frontend/public/_redirects` ensures all routes serve `index.html`:
```
/* /index.html 200
```

---

## Deploy Commands

### Redeploy after code changes
```bash
cd src/frontend
VITE_API_BASE=https://reel-ballers-api-staging.fly.dev npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-staging --branch=master
```

### On Windows (cmd)
```bash
cd src/frontend
set VITE_API_BASE=https://reel-ballers-api-staging.fly.dev && npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-staging --branch=master
```

### View Deployments
```bash
npx wrangler pages deployment list --project-name=reel-ballers-staging
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/frontend/src/config.js` | Reads `VITE_API_BASE` env var |
| `src/frontend/src/services/ExportWebSocketManager.js` | WS URL from `VITE_API_BASE` |
| `src/frontend/src/services/ExtractionWebSocketManager.js` | WS URL from `VITE_API_BASE` |
| `src/frontend/src/components/CompareModelsButton.jsx` | WS URL from `VITE_API_BASE` |
| `src/frontend/public/_redirects` | SPA routing for Cloudflare Pages |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| API calls failing | Check CORS on backend includes `reel-ballers-staging.pages.dev` |
| CORS errors on preview URLs | Use main URL `reel-ballers-staging.pages.dev`, not `*.reel-ballers-staging.pages.dev` |
| Page not found on refresh | Ensure `_redirects` exists in `public/` and appears in `dist/` after build |
| Old version showing | Hard refresh (Ctrl+Shift+R) |
| Backend not responding | First request wakes scale-to-zero machine (~2-3s cold start) |

---

## Cost

**Free** — Cloudflare Pages free tier: unlimited sites, bandwidth, automatic HTTPS, global CDN.
