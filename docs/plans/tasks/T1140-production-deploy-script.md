# T1140: Production Deploy Script

**Status:** DONE
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-08
**Updated:** 2026-04-20

## Problem

Deploying to production requires remembering multiple manual steps: build frontend with production env, deploy via wrangler, optionally deploy backend via Fly, verify health. Today this was done ad-hoc with separate commands. There's no single command that handles it all and reports success/failure.

The CI/CD pipeline (GitHub Actions) currently only deploys to **staging**. Production deploys are manual.

## Solution

Created `scripts/deploy_production.sh` script that automates the full production deploy with verification. Also created a `/deploy` Claude skill so deploys can be triggered with a single command.

## Context

### Relevant Files
- `scripts/deploy_production.sh` - Deploy script with pre-flight checks, health verification, git tagging
- `.claude/skills/deploy/SKILL.md` - Claude skill wrapping the deploy script
- `src/frontend/package.json` - Has `build:production` and `deploy:production` scripts
- `src/backend/fly.production.toml` - Backend production Fly config

### Related Tasks
- None

### Technical Notes
- Frontend: Cloudflare Pages project `reel-ballers-prod`, served at `app.reelballers.com`
- Backend: Fly.io app `reel-ballers-api`, served at `reel-ballers-api.fly.dev`
- Default deploys both backend + frontend (changed from original spec of frontend-only default)
- Successful deploys are git-tagged (e.g., `deploy/frontend/2026-04-20`)

## Implementation

### Steps
1. [x] Create `scripts/deploy_production.sh`
2. [x] Pre-flight checks: on master, clean working tree, up-to-date with origin
3. [x] Accept flags: `--frontend-only`, `--backend-only`, `--all` (default: all)
4. [x] Frontend deploy: build with production mode, deploy via wrangler, verify health
5. [x] Backend deploy: `fly deploy --config fly.production.toml`, verify health
6. [x] Post-deploy verification: curl health endpoints, report success/failure with URLs
7. [x] Git tagging of successful deploys
8. [x] Create `/deploy` Claude skill for one-command deploys

## Acceptance Criteria

- [x] Single command deploys frontend to production
- [x] `--all` flag also deploys backend (default behavior)
- [x] `--frontend-only` and `--backend-only` flags for partial deploys
- [x] Pre-flight rejects dirty working tree or non-master branch
- [x] Health check verifies deployment is live
- [x] Clear success/failure output with URLs
- [x] `/deploy` skill automates the workflow from Claude
