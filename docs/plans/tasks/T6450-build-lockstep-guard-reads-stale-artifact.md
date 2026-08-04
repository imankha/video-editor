# T6450: the build-lockstep guard checks an artifact production builds never regenerate

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-08-03
**Found by:** prod deploy 2026-08-03 (T5830 ship)

## Problem

`scripts/verify-build-lockstep.sh` (T6220) proves the deployed frontend bundle and the running
backend came from the same commit, by comparing the site's `/build.json` against the backend's
`/api/version`. After the 2026-08-03 prod deploy they disagreed:

```
https://app.reelballers.com/build.json   -> {"build": 3204, "commit": "cb90af86"}
https://reel-ballers-api.fly.dev/api/version -> {"build": 3308, "commit": "bce639d0..."}
```

104 builds apart. Not a CDN artifact — the **direct** Pages deployment URL
(`https://c61a5313.reel-ballers-prod.pages.dev/build.json`) served the same stale values, and
Cloudflare's newest Production deployment was correctly sourced from `bce639d`.

### Root cause

`src/frontend/package.json`:
```json
"predev":   "node generate-version.js || echo '...'",
"prebuild": "node generate-version.js || echo '...'",
"build":            "vite build",
"build:production": "vite build --mode production",
```

npm only auto-runs `pre<script>` for the **matching** script name. The production deploy runs
**`build:production`**, and there is no `prebuild:production` — so `generate-version.js` never runs
on a production build. `public/build.json` ships with whatever stale content happens to be on the
builder's disk, and it is **gitignored**, so on a clean checkout it may be absent entirely (the
verify script treats a 404 as a failure).

### Why it matters

The user-facing bundle is FINE — `vite.config.js` bakes the build number in separately via its own
`execSync('git rev-list --count HEAD')` at build time, so the update gate (Tbug40p) compares real
values. **What is broken is the check**: the guard T6220 added to catch frontend/backend drift is
reading a constant that production never refreshes, so it either compares stale-vs-live (a false
alarm, as here) or silently passes on coincidence. A guard that cannot fail correctly is worse than
no guard, because the deploy log prints a reassuring line either way.

Compounding it: on this deploy the verify step **could not even execute** —
`Python was not found; run without arguments to install from the Microsoft Store` — and
`deploy_production.sh` still exited 0. The drift was found only by checking the two URLs by hand.

## Solution

1. Make the production build regenerate the artifact. Either add `"prebuild:production": "node
   generate-version.js"`, or (better, one path instead of two) have `generate-version.js` run from
   a vite plugin/`buildStart` hook so EVERY build mode stamps it and the two computations cannot
   drift. `vite.config.js` already computes the same expression — the duplication is the bug's
   root, and its own comment admits the two must be "kept in agreement".
2. Make a non-executable verify **fail the deploy**, not pass it. The `Python was not found` path
   must be a hard error; a guard that no-ops on a missing interpreter provides false assurance.
3. Consider committing `build.json` or generating it into `dist/` directly, so a clean-checkout
   build can never ship a stale or missing copy.

## Acceptance Criteria

- [ ] `npm run build:production` regenerates `public/build.json` (assert the file's mtime/content
      changes in a test or CI step)
- [ ] Frontend `/build.json` and backend `/api/version` report the SAME build number after a deploy
      from the same commit
- [ ] A missing/unrunnable verify interpreter fails `deploy_production.sh` instead of exiting 0
- [ ] Re-run the 2026-08-03 comparison and confirm the two endpoints agree
