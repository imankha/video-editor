# T125: CI/CD Auto-Deploy via GitHub Actions

**Status:** TODO
**Impact:** 7
**Complexity:** 4

## Problem

1. Deploying staging requires manual commands for both backend and frontend — slows iteration.
2. Landing page currently auto-deploys via Cloudflare GitHub integration on every push to master, even when `src/landing/` didn't change.

## Solution

Single GitHub Actions workflow (`.github/workflows/deploy.yml`) with 3 parallel jobs, each with path filters:

| Job | Trigger Path | Deploy Target |
|-----|-------------|---------------|
| `deploy-backend` | `src/backend/**` | Fly.io (staging) |
| `deploy-frontend` | `src/frontend/**` | Cloudflare Pages (`reel-ballers-staging`) |
| `deploy-landing` | `src/landing/**` | Cloudflare Pages (existing landing project) |

Also: disconnect the current Cloudflare GitHub integration for the landing page (manual step after workflow is working).

## Context

### Current State
- **Backend:** Manual `fly deploy --config fly.staging.toml`
- **Frontend:** Manual `npm run build && wrangler pages deploy`
- **Landing:** Auto-deploys via Cloudflare GitHub integration (no path filter — deploys on every push)

### Deploy Commands (what the workflow automates)
```bash
# Backend
cd src/backend && fly deploy --config fly.staging.toml

# Staging Frontend
cd src/frontend
VITE_API_BASE=https://reel-ballers-api-staging.fly.dev npm run build
npx wrangler pages deploy dist --project-name=reel-ballers-staging --branch=master

# Landing Page
cd src/landing
npm run build
npx wrangler pages deploy dist --project-name=reelballers-landing
```

### Relevant Files
- `.github/workflows/deploy.yml` — New workflow file (to create)
- `src/backend/Dockerfile` — Already exists
- `src/backend/fly.staging.toml` — Already exists
- `src/backend/.dockerignore` — Already exists (whitelist: `app/` + `requirements.prod.txt`)
- `src/frontend/src/config.js` — Reads `VITE_API_BASE` at build time
- `src/landing/package.json` — Build: `vite build`, deploy target: `wrangler pages deploy dist`

### Staging URLs
- Backend: https://reel-ballers-api-staging.fly.dev
- Frontend: https://reel-ballers-staging.pages.dev
- Landing: https://reelballers.com (existing)

### Related Tasks
- Depends on: T100 (Fly.io backend), T110 (Cloudflare Pages frontend)
- Blocks: None

## Implementation

### Steps
1. [ ] Create `.github/workflows/deploy.yml` with 3 jobs
2. [ ] Each job uses path filters so it only runs when its directory changes
3. [ ] Backend job: checkout → install flyctl → `fly deploy --config fly.staging.toml`
4. [ ] Frontend job: checkout → `npm ci` → build with `VITE_API_BASE` → `wrangler pages deploy`
5. [ ] Landing job: checkout → `npm ci` → `npm run build` → `wrangler pages deploy dist --project-name=reelballers-landing`
6. [ ] Add GitHub secrets (see below)
7. [ ] Test with a push to master that touches `src/backend/`
8. [ ] Test with a push that touches `src/frontend/`
9. [ ] Test with a push that touches `src/landing/`
10. [ ] Disconnect Cloudflare GitHub integration for landing page (manual — in CF dashboard)

### GitHub Secrets Needed

| Secret | How to get |
|--------|-----------|
| `FLY_API_TOKEN` | `fly tokens create deploy -x 999999h` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens → Create (Pages edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Overview → Account ID |

### Workflow Design Notes

- **Trigger:** `push` to `master` only
- **Path filters:** GitHub Actions native `paths:` filter per job (using `on.push.paths` won't work for per-job filtering — use `dorny/paths-filter` action or separate workflows)
- **Alternative:** 3 separate workflow files, each with its own `paths:` trigger — simpler and natively supported
- **Parallel:** All jobs independent, run concurrently
- **No secrets in code:** All credentials via GitHub Secrets

## Acceptance Criteria

- [ ] Push to master auto-deploys backend only when `src/backend/**` changes
- [ ] Push to master auto-deploys frontend only when `src/frontend/**` changes
- [ ] Push to master auto-deploys landing only when `src/landing/**` changes
- [ ] All three jobs can run in parallel
- [ ] No deploys trigger for unrelated changes (e.g. docs, tests)
- [ ] Landing page Cloudflare GitHub integration disconnected
- [ ] No manual steps required after merge
