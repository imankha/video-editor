# T3410: Keep Fly.io Machines Warm

**Epic:** For Launch - Infrastructure
**Priority:** P1
**Complexity:** 1
**Impact:** 9
**Status:** TODO

## Problem

Cold-start auth/me takes 1.8s (Fly.io machine boot + Postgres pool init). This is the single largest component of the 3.1s page load. The inline warmup script fires 44ms before auth/me -- not enough lead time for a suspended machine to boot.

On warm machines, auth/me drops to ~200ms, giving a ~1.2s total page load.

## Evidence

- Production HAR: auth/me 1799ms (1773ms server wait) on cold start
- Production HAR: bootstrap 816ms (717ms server wait) on warm machine
- Warm page load estimate: 200ms auth/me + 400ms auth/init + 500ms bootstrap = ~1.2s

## Implementation Options

### Option A: Fly.io min_machines_running (Recommended)

Set `min_machines_running = 1` in fly.production.toml. Fly keeps at least one machine running at all times -- never suspends it. Machine stays warm, Postgres pool stays initialized.

```toml
[http_service]
  min_machines_running = 1
```

Cost: ~$3-5/month for a shared-1x-cpu machine running 24/7.

### Option B: External keep-alive ping

UptimeRobot or similar pings /api/health every 5 minutes. Prevents Fly from suspending the machine due to inactivity. Free, but adds a dependency on an external service and the machine can still suspend briefly between pings.

### Option C: Cloudflare Worker cron

Cloudflare Worker cron trigger pings the API every 5 minutes. Already have CF infrastructure. Near-free.

## Recommendation

Option A is simplest and most reliable. $3-5/mo is negligible for a launched product. No external dependencies, no timing gaps.

## Files

| File | Change |
|------|--------|
| `fly.production.toml` | Add `min_machines_running = 1` |

## Acceptance Criteria

- [ ] Production Fly.io machine never suspends
- [ ] auth/me consistently < 300ms (no cold starts)
- [ ] Total page load under 2s on repeat visits
