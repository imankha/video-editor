# T1140: Production Deploy Script

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Deploying to production requires remembering multiple manual steps: build frontend with production env, deploy via wrangler, optionally deploy backend via Fly, verify health. Today this was done ad-hoc with separate commands. There's no single command that handles it all and reports success/failure.

The CI/CD pipeline (GitHub Actions) currently only deploys to **staging**. Production deploys are manual.

## Solution

Create a `scripts/deploy_production.sh` script that automates the full production deploy with verification.

## Context

### Current Deploy Commands

**Frontend (Cloudflare Pages):**
```bash
cd src/frontend
npm run build:production
npx wrangler pages deploy dist --project-name reel-ballers-prod --branch main
```

**Backend (Fly.io):**
```bash
cd src/backend
fly deploy --config fly.production.toml
```

### Relevant Files
- `scripts/deploy_production.sh` - New script to create
- `src/frontend/package.json` - Has `build:production` and `deploy:production` scripts
- `src/backend/fly.production.toml` - Backend production Fly config
- `scripts/release.bat` - Existing Windows release script (reference for validation logic)
- `.github/workflows/deploy-frontend.yml` - Staging CI (reference)
- `.github/workflows/deploy-backend.yml` - Staging CI (reference)

### Related Tasks
- None

### Technical Notes
- Frontend: Cloudflare Pages project `reel-ballers-prod`, served at `app.reelballers.com`
- Backend: Fly.io app `reel-ballers-api`, served at `reel-ballers-api.fly.dev`
- `wrangler` is not globally installed; use `npx wrangler`
- Script should work in bash (the dev environment uses Git Bash on Windows)
- Consider also updating GitHub Actions to support production deploys (manual trigger)

## Implementation

### Steps
1. [ ] Create `scripts/deploy_production.sh`
2. [ ] Pre-flight checks: on master, clean working tree, up-to-date with origin
3. [ ] Accept flags: `--frontend-only`, `--backend-only`, `--all` (default: frontend only)
4. [ ] Frontend deploy: build with production mode, deploy via wrangler, verify health
5. [ ] Backend deploy: `fly deploy --config fly.production.toml`, verify health
6. [ ] Post-deploy verification: curl health endpoints, report success/failure with URLs
7. [ ] Optional: add `workflow_dispatch` trigger to GitHub Actions for production deploy

### Script Behavior
```
$ ./scripts/deploy_production.sh
[pre-flight] On master, clean tree, up-to-date with origin ✓
[frontend]   Building with production env...
[frontend]   Deploying to Cloudflare Pages (reel-ballers-prod)...
[frontend]   Verifying https://app.reelballers.com ... ✓
[done]       Frontend deployed successfully.

$ ./scripts/deploy_production.sh --all
[pre-flight] ...
[backend]    Deploying to Fly.io (reel-ballers-api)...
[backend]    Verifying https://reel-ballers-api.fly.dev/api/health ... ✓
[frontend]   ...
[done]       Frontend + Backend deployed successfully.
```

## Acceptance Criteria

- [ ] Single command deploys frontend to production
- [ ] `--all` flag also deploys backend
- [ ] Pre-flight rejects dirty working tree or non-master branch
- [ ] Health check verifies deployment is live
- [ ] Clear success/failure output with URLs
