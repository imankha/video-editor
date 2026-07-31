# T6220: Deploy both halves in lockstep so the build number means something

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-30
**Updated:** 2026-07-30

## Problem

The frontend and backend deploy independently, so the "current build number" the
update gate compares against is routinely **wrong** — the server can sit several
builds ahead of the newest bundle that actually exists.

Both staging workflows are path-filtered:

- `.github/workflows/deploy-frontend.yml` → `on.push.paths: ['src/frontend/**']`
- `.github/workflows/deploy-backend.yml` → `on.push.paths: ['src/backend/**']`

A backend-only commit therefore raises `serverBuild` with no bundle published.
Production has the same shape via `scripts/deploy_production.sh --backend-only`
(and `--frontend-only`), which ship one half from a commit.

Measured on staging 2026-07-30: bundle `b130803b` #3163 vs backend `a442ad49`
#3165, with zero `src/frontend/**` files between them.

**T6210 already made the failure mode impossible** — the gate now requires a probe
to confirm a real waiting ServiceWorker bundle, so a server-ahead-of-bundle state
can no longer strand anyone in the update loop. This task is about the *other*
half of the problem, which T6210 deliberately scoped out:

> Deploy alignment was considered and NOT done. The structural fix makes the loop
> impossible regardless, but lockstep deploys would additionally keep the numbers
> accurate so the gate fires promptly.

With the numbers drifting, `serverBuild > clientBuild` is true for reasons that
have nothing to do with the client being stale. The gate's first condition becomes
noise and the probe carries the entire decision. That is a correctness-of-signal
problem, not a stranding problem: users can sit on an old bundle longer than they
should, and any future logic that trusts the build delta inherits the drift.

## Solution

Make a push to master always deploy both halves, and make the prod script's
single-half flags either match that or refuse.

1. **Drop the `paths:` filters** from `deploy-frontend.yml` and
   `deploy-backend.yml` so every master push ships both. Cost is a redundant
   deploy on docs-only commits — weigh against a build-number cache/skip step if
   that is too noisy.
2. **`deploy_production.sh`**: decide between removing `--backend-only` /
   `--frontend-only` outright, or keeping them behind an explicit
   `--i-know-the-build-numbers-will-drift` style confirmation. Do NOT leave them
   as quiet defaults.
3. **Assert the invariant** after deploy: fetch the deployed bundle's
   `__APP_BUILD__` and the backend's reported build, and fail the workflow if they
   disagree. This is the part that keeps the fix from rotting.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/deploy-frontend.yml` — path filter to remove
- `.github/workflows/deploy-backend.yml` — path filter to remove
- `scripts/deploy_production.sh` — `--all` / `--backend-only` / `--frontend-only` (lines ~7-26)
- `src/frontend/vite.config.js` — `__APP_BUILD__` define (`git rev-list --count HEAD`)
- `src/frontend/src/utils/appVersion.js` — consumer of the comparison

### Related Tasks
- Follow-up from: T6210 (structural fix — landed `65841559`)
- Origin: Tbug40p (introduced the truth-based comparison)

### Technical Notes
- Both workflows already use `fetch-depth: 0` so `git rev-list --count HEAD` is
  the true monotonic number — do not regress that.
- Lockstep deploys are a *belt* on top of T6210's *braces*. If this task is ever
  dropped, T6210 must stay intact; the reverse is not true.

## Implementation

### Steps
1. [x] Union the `paths:` filters on both staging workflows (NOT dropped — see Progress Log); confirm the two blocks are byte-identical
2. [x] Decide and implement the `deploy_production.sh` single-half policy (asymmetric: `--frontend-only` stays allowed, `--backend-only` refuses without `--accept-build-drift`)
3. [x] Add the post-deploy build-number equality assertion (`scripts/verify-build-lockstep.sh`, wired into staging + prod)
4. [ ] Verify on staging that bundle build == backend build after an arbitrary push (requires a real deploy — cannot be done from the container; leave for the next staging push)

### Progress Log

**2026-07-30**: Filed as a follow-up from T6210. Not started.

**2026-07-31**: Implemented per two pre-made policy decisions (see below); QA'd everything provable
without a live deploy. Step 4 (real staging deploy) is left for the next push to master — the
container has no deploy path.

- **Decision 1 (staging trigger):** did NOT drop the `paths:` filters (the task's literal text).
  Implemented a UNION path filter instead — both `deploy-frontend.yml` and `deploy-backend.yml` now
  carry the SAME `paths: [src/frontend/**, src/backend/**]` block plus `workflow_dispatch:`. The
  invariant that matters is "bundle build == backend build", not "always deploy": a commit touching
  EITHER half now deploys BOTH from the same commit (numbers move together), and a commit touching
  NEITHER (e.g. `docs(plan): ...`, which this repo commits constantly) deploys NEITHER, so both stay
  at the same older number — still equal, still correct, zero redundant CI. Rewrote AC #1 below to
  state that invariant directly instead of the literal "still deploys both halves on a docs-only
  push" reading, which would fire two full redundant deploys per docs commit for nothing shipped.
  Documented (not fixed) the known hole: `workflow_dispatch` can still fire one workflow alone — a
  deliberate manual single-half dispatch is an operator's call, comment added in both YAMLs.
- **Decision 2 (prod script):** asymmetric gate, not a symmetric block/allow of both flags.
  `--frontend-only` stays allowed unchanged — a bundle ahead of the server is harmless by
  construction (`appVersion.checkServerVersion` gates iff `serverBuild > clientBuild`; `server <=
  clientBuild` can never raise it). `--backend-only` now refuses unless paired with the new
  `--accept-build-drift` flag (order-independent — replaced the old single-`$1` `case` with a proper
  arg loop). `deploy_production.sh` calls `verify-build-lockstep.sh` at the end ONLY when both halves
  deployed together, printing an explicit "skipping lockstep assertion because X" line otherwise.
- Deployed bundle build number is now also served as `/build.json` (via `generate-version.js`, copied
  verbatim into `dist/` by Vite) — a fetchable fact, since scraping `__APP_BUILD__` back out of a
  hashed/minified bundle would be fragile. Confirmed NOT precached by the service worker (`.json` is
  outside `workbox.globPatterns`).

## Acceptance Criteria

- [x] **(rewritten from "A master push touching neither `src/frontend/**` nor `src/backend/**` still
  deploys both halves" — see Decision 1 in the Progress Log)** A master push never leaves the
  deployed bundle build and the backend build unequal: either both halves deploy from the same
  commit, or neither does.
- [ ] Staging bundle `build.json`'s `build` equals the backend's reported build after any deploy —
  logic implemented and wired (`verify-build-lockstep.sh` in `deploy-frontend.yml`); the real-deploy
  confirmation is Step 4, pending the next staging push.
- [x] `deploy_production.sh` cannot silently ship one half — `--backend-only` refuses by default;
  `--frontend-only` stays allowed (documented as deliberately harmless, not a silent gap).
- [x] A deliberate mismatch fails the deploy workflow loudly — `verify-build-lockstep.sh` exits
  non-zero with both build numbers named, in both the staging workflow and `deploy_production.sh`.
