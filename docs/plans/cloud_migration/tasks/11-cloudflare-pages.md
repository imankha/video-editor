# Task 12: Cloudflare Pages Frontend Deployment

## Overview
Deploy the React frontend to Cloudflare Pages for free global hosting.

## Owner
**Claude** - Build configuration and deployment setup

## Prerequisites
- Task 11 complete (Backend deployed to Fly.io)
- Cloudflare account (already have for R2)

## Testability
**After this task**: Frontend loads from `app.reelballers.com`

---

## Steps

### 1. Update Frontend API URL

Update `src/frontend/src/config.js` (or wherever API_BASE_URL is defined):

```javascript
// Production vs Development
const API_BASE_URL = import.meta.env.PROD
  ? 'https://api.reelballers.com'  // Production: Fly.io
  : 'http://localhost:8000';        // Development: local

export { API_BASE_URL };
```

### 2. Create Production Build

```bash
cd src/frontend
npm run build
```

This creates `dist/` folder with static files.

### 3. Deploy via Wrangler CLI

```bash
# Install wrangler if not already
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
npx wrangler pages deploy dist --project-name=reel-ballers-app
```

First deployment creates the project. Subsequent deploys update it.

### 4. Alternative: GitHub Integration

1. Go to Cloudflare Dashboard → Pages
2. Click "Create a project"
3. Connect to GitHub repository
4. Configure build:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `src/frontend`
5. Add environment variable: `VITE_API_URL=https://api.reelballers.com`

Now every push to `main` auto-deploys.

---

## Build Configuration

### Vite Config Updates

If needed, update `src/frontend/vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,  // Disable for production
  },
  // Handle SPA routing
  preview: {
    port: 4173,
  },
})
```

### SPA Routing

Create `src/frontend/public/_redirects`:

```
/* /index.html 200
```

This ensures client-side routing works (all routes serve index.html).

---

## Environment Variables

For GitHub integration, set in Cloudflare Pages dashboard:

| Variable | Value |
|----------|-------|
| VITE_API_URL | https://api.reelballers.com |
| NODE_VERSION | 18 |

---

## Custom Domain (Task 13)

After deployment:

1. Go to Pages project → Custom domains
2. Add `app.reelballers.com`
3. Add DNS records as instructed
4. SSL is automatic

---

## Deliverables

| Item | Description |
|------|-------------|
| Production build | `dist/` folder builds correctly |
| Deployed site | Running on pages.dev |
| API URL configured | Points to Fly.io backend |
| _redirects file | SPA routing works |

---

## Deployment Commands

### Manual Deploy
```bash
cd src/frontend
npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-app
```

### View Deployment
```bash
# List deployments
npx wrangler pages deployment list --project-name=reel-ballers-app

# View logs (limited for Pages)
# Use browser dev tools for client-side debugging
```

---

## Troubleshooting

### "API calls failing"
- Check CORS on Fly.io backend allows Pages domain
- Verify API_BASE_URL is correct in production build

### "Page not found on refresh"
- Ensure `_redirects` file exists in `public/`
- Check build output includes `_redirects`

### "Old version showing"
- Hard refresh (Ctrl+Shift+R)
- Clear Cloudflare cache: Dashboard → Caching → Purge Everything

### Build fails
- Check Node version (use 18+)
- Run `npm run build` locally first
- Check for TypeScript/ESLint errors

---

## Cost

**Free** - Cloudflare Pages free tier includes:
- Unlimited sites
- Unlimited bandwidth
- 500 builds/month
- Automatic HTTPS
- Global CDN
