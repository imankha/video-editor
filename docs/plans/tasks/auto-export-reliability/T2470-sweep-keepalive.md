# T2470: Sweep Keepalive

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-05-04
**Updated:** 2026-05-04

## Problem

Fly.io's autosuspend monitors incoming HTTP traffic to decide if a machine is idle. The sweep scheduler runs as a background asyncio task — no HTTP requests arrive during a sweep, so Fly sees the machine as idle and suspends it mid-work.

On 2026-05-04, staging was auto-suspended after ~14 minutes of active R2 download with the log: "App reel-ballers-api-staging has excess capacity, autosuspending machine."

## Solution

During an active sweep, periodically hit the app's own health endpoint to generate HTTP traffic that prevents auto-suspend. This is a lightweight internal keepalive — no external dependency needed.

### Approach

In `_run_sweep_loop()`, wrap the `do_sweep()` call with a concurrent keepalive task:

```python
async def _keepalive_during(coro):
    """Run coro while pinging localhost health to prevent Fly autosuspend."""
    import aiohttp
    async def ping():
        async with aiohttp.ClientSession() as s:
            while True:
                try:
                    await s.get("http://localhost:8000/api/health")
                except Exception:
                    pass
                await asyncio.sleep(30)
    
    task = asyncio.create_task(ping())
    try:
        return await coro
    finally:
        task.cancel()
```

This is only needed while `do_sweep()` is actively working — the keepalive stops as soon as the sweep finishes, and Fly can auto-suspend normally between sweeps.

## Context

### Relevant Files
- `src/backend/app/services/sweep_scheduler.py:58-82` — `_run_sweep_loop()` where the keepalive wraps `do_sweep()`
- `src/backend/fly.staging.toml` / `fly.production.toml` — Fly.io machine config (auto_stop_machines setting)

### Related Tasks
- T2450 (Presigned URL) — if exports take seconds, auto-suspend rarely matters. This is belt-and-suspenders.
- T2460 (Pending Recovery) — even with keepalive, crashes can happen. Recovery ensures retries work.

### Alternative: Disable auto-suspend in fly.toml
Could set `auto_stop_machines = false` in fly.toml, but that means the machine runs 24/7 (~$5-10/mo extra). The keepalive approach only prevents suspension during active work.

## Implementation

### Steps
1. [ ] Add `_keepalive_during()` async helper to sweep_scheduler.py
2. [ ] Wrap the `await asyncio.to_thread(do_sweep)` call with it
3. [ ] Log when keepalive starts/stops: `[Sweep] Keepalive active` / `[Sweep] Keepalive stopped`
4. [ ] Test on staging: set game expiry to past, restart, verify machine stays alive through full export

## Acceptance Criteria

- [ ] Machine stays alive during active sweep (no autosuspend during export)
- [ ] Machine still auto-suspends normally when no sweep is running
- [ ] Keepalive pings don't appear in request logs (use internal route or filter)
