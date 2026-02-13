# T105: Production Backend Scaling

## Overview
Deploy production backend with proper scaling configuration based on real traffic data from staging.

**Do this task after:** Testing on staging and understanding actual usage patterns.

## Owner
**User** - Capacity planning decisions based on traffic data

## Prerequisites
- T100 complete (staging deployed and tested)
- T110 complete (frontend deployed)
- Some real usage data from staging to inform scaling decisions

## Testability
**After this task**:
- Production: `reel-ballers-api.fly.dev` works
- Custom domain: `api.reelballers.com` (configured in T120)

---

## Capacity Planning

### Factors to Consider

1. **Concurrent Users (CCU)** - How many users active at once?
2. **Request Duration** - Modal GPU calls are async, don't block server
3. **WebSocket Connections** - Export progress, lighter than HTTP
4. **Database** - SQLite per-user is fast, no shared DB bottleneck

### Rough Estimates

| VM Size | Memory | Est. CCU | Monthly Cost |
|---------|--------|----------|--------------|
| shared-1x | 512MB | 50-100 | ~$5 |
| shared-2x | 1GB | 100-200 | ~$10 |
| dedicated-1x | 2GB | 200-400 | ~$30 |
| dedicated-2x | 4GB | 400-800 | ~$60 |

### Auto-Scaling Options

```toml
# Fly.io can auto-scale based on load
[http_service]
  min_machines_running = 1    # Always keep 1 warm (no cold starts)
  auto_stop_machines = true   # Scale down excess machines
  auto_start_machines = true  # Scale up on demand

[[vm]]
  cpu_kind = "shared"         # or "dedicated" for consistent performance
  cpus = 1
  memory_mb = 1024            # Increase for more CCU
```

---

## Decision Points

Before deploying production, decide:

1. **Cold starts acceptable?**
   - Yes → `min_machines_running = 0` (cheaper)
   - No → `min_machines_running = 1` (~$5/month always-on)

2. **Expected initial traffic?**
   - Low (<50 CCU) → shared-1x, 512MB
   - Medium (50-200 CCU) → shared-2x, 1GB
   - High (200+ CCU) → dedicated, 2GB+

3. **Burst handling?**
   - Set `max_machines_running` based on peak expectations
   - Fly.io spins up new machines in ~5 seconds

---

## Steps

### 1. Create fly.production.toml

Create `src/backend/fly.production.toml`:

```toml
app = "reel-ballers-api"
primary_region = "ord"  # Chicago

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  R2_ENABLED = "true"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1    # Keep 1 warm for instant response

  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024  # Start with 1GB, adjust based on traffic
```

### 2. Create Production App

```bash
cd src/backend

# Create the production app
fly apps create reel-ballers-api

# Set production secrets
fly secrets set --app reel-ballers-api \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com \
  R2_BUCKET_NAME=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=xxx \
  MODAL_TOKEN_SECRET=xxx

# Deploy to production
fly deploy --config fly.production.toml
```

### 3. Test Production

```bash
# Check status
fly status --app reel-ballers-api

# Test endpoint
curl https://reel-ballers-api.fly.dev/api/health
```

### 4. Monitor & Adjust

```bash
# View metrics
fly dashboard --app reel-ballers-api

# Scale up if needed
fly scale memory 2048 --app reel-ballers-api
fly scale count 2 --app reel-ballers-api
```

---

## Monitoring

After production launch, monitor:

1. **Response times** - `fly dashboard` shows P50/P95 latency
2. **Memory usage** - Scale up if consistently >80%
3. **Request count** - Helps predict when to scale
4. **Error rate** - 5xx errors indicate capacity issues

---

## Cost Estimate

| Configuration | Monthly Cost |
|---------------|--------------|
| 1x shared, 1GB, always-on | ~$7-10 |
| 2x shared, 1GB, auto-scale | ~$10-20 |
| 1x dedicated, 2GB, always-on | ~$30 |

Start conservative, scale up based on actual usage.

---

## Deliverables

| Item | Description |
|------|-------------|
| fly.production.toml | Production Fly.io configuration |
| Production app | reel-ballers-api.fly.dev |
| Scaling strategy | Documented based on traffic data |
