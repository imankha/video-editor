# T14110: Prod machine: dedicated CPU and pinned to one machine

**Status:** TODO
**Impact:** 8
**Complexity:** 1
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

Prod runs on ONE shared vCPU: `src/backend/fly.production.toml` has `cpu_kind = "shared"`, `cpus = 1`, `memory_mb = 2048`, `soft_limit = 200`. The app is a single uvicorn process (GIL) that also runs CPU-heavy work locally: ffmpeg stamping on every download (`routers/downloads.py` ~890), the sweep's local auto-export, and the compose fallback (T14130). Shared vCPUs get a small baseline plus burst credit; a sustained evening at ~100 sessions drains it and everything slows at once. Separately, the app is NOT safe on more than one machine (in-process locks and version caches, export progress dict, background loops with no leader election; see the Session Scaling epic), yet `soft_limit` plus auto-start would start a second machine if one existed.

## Solution

Move prod to `performance-1x` (or 2x) with 4 GB, after checking Fly's CPU-throttle metric for prod to confirm the shared quota is actually being hit. Pin the app to exactly one machine (`fly scale count 1`, documented in the deploy skill) until the Session Scaling epic lands. **Spend decision: the user approves the machine size before this ships.**

## Context

### Relevant Files
- `src/backend/fly.production.toml`
- `src/backend/fly.staging.toml` (keep staging representative)
- `.claude/skills/deploy/SKILL.md` (single-machine note)

### Notes
Load: backend-services.md. Related: Session Scaling epic (T2250, T40, T2260) is the path to more than one machine.

## Acceptance Criteria

- [ ] Prod Fly CPU-throttle metric before/after recorded in the task
- [ ] fly.production.toml is dedicated CPU, machine count pinned to 1 and documented
- [ ] User approved the size (cost)
