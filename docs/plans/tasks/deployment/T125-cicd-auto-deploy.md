# T125: CI/CD Auto-Deploy for Staging

**Status:** TODO
**Impact:** 7
**Complexity:** 4

## Problem

Deploying staging requires running manual commands for both backend and frontend. This slows down iteration and risks forgetting to deploy one side after changes.

## Solution

GitHub Actions workflow that auto-deploys on push to `master`:
- **Backend** → Fly.io (`fly deploy --config fly.staging.toml`)
- **Frontend** → Cloudflare Pages (`wrangler pages deploy`)

## Context

### Current Manual Deploy Process
```bash
# Backend
cd src/backend && fly deploy --config fly.staging.toml

# Frontend
cd src/frontend
VITE_API_BASE=https://reel-ballers-api-staging.fly.dev npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-staging --branch=master
```

### Relevant Files
- `.github/workflows/deploy-staging.yml` — New workflow file
- `src/backend/Dockerfile` — Already exists
- `src/backend/fly.staging.toml` — Already exists
- `src/backend/.dockerignore` — Already exists (whitelist approach)
- `src/frontend/src/config.js` — Reads `VITE_API_BASE` at build time

### Staging URLs
- Backend: https://reel-ballers-api-staging.fly.dev
- Frontend: https://reel-ballers-staging.pages.dev

### Related Tasks
- Depends on: T100 (Fly.io backend), T110 (Cloudflare Pages frontend)
- Blocks: None

## Implementation

### Steps
1. [ ] Create `.github/workflows/deploy-staging.yml`
2. [ ] Configure GitHub secrets: `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
3. [ ] Backend job: checkout → fly deploy (only if `src/backend/` changed)
4. [ ] Frontend job: checkout → npm install → build with `VITE_API_BASE` → wrangler deploy (only if `src/frontend/` changed)
5. [ ] Test with a push to master
6. [ ] Verify both staging URLs update

### GitHub Secrets Needed

| Secret | How to get |
|--------|-----------|
| `FLY_API_TOKEN` | `fly tokens create deploy -x 999999h` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens → Create (Pages edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Overview → Account ID |

### Workflow Design

- **Trigger:** push to `master`
- **Path filters:** Only run backend job if `src/backend/**` changed, frontend job if `src/frontend/**` changed
- **Parallel:** Backend and frontend deploy independently
- **No secrets in code:** All credentials via GitHub Secrets

## Acceptance Criteria

- [ ] Push to master auto-deploys backend when backend files change
- [ ] Push to master auto-deploys frontend when frontend files change
- [ ] Both jobs can run in parallel
- [ ] Deploys only trigger for changed paths (not every push)
- [ ] No manual steps required after merge
