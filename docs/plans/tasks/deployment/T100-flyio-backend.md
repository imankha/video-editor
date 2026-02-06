# Task 10: Fly.io Backend Deployment

## Overview
Deploy the FastAPI backend to Fly.io. This task creates BOTH staging and production apps.

## Owner
**Claude** - Configuration and deployment setup

## Prerequisites
- Task 09 complete (Modal integration tested locally)
- Fly.io account created (free)

## Testability
**After this task**:
- Staging: `reel-ballers-api-staging.fly.dev` works
- Production: `reel-ballers-api.fly.dev` works (custom domain in Task 12)

---

## What This Task Creates

| Resource | Purpose |
|----------|---------|
| `reel-ballers-api-staging` | Staging backend (test before prod) |
| `reel-ballers-api` | Production backend |
| `fly.toml` | Fly.io configuration |
| `Dockerfile` | Production container |

---

## Steps

### 1. Install Fly CLI

```bash
# macOS
brew install flyctl

# Windows
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# Linux
curl -L https://fly.io/install.sh | sh
```

### 2. Login to Fly.io

```bash
fly auth login
```

### 3. Create fly.toml

Create `src/backend/fly.toml`:

```toml
# NOTE: App name is set via --app flag, not here
# This allows same config for staging and production
primary_region = "ord"  # Chicago - adjust to your region

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  R2_ENABLED = "true"
  # MODAL_ENABLED set via secrets (differs per environment)

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true      # Scale to zero
  auto_start_machines = true     # Wake on request
  min_machines_running = 0       # Allow full scale-down

  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

### 4. Create Dockerfile

Create `src/backend/Dockerfile`:

```dockerfile
FROM python:3.11-slim

# Install ffmpeg for local processing fallback
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Run with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### 5. Create Staging App

```bash
cd src/backend

# Create the staging app
fly apps create reel-ballers-api-staging

# Set staging secrets
fly secrets set --app reel-ballers-api-staging \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com \
  R2_BUCKET_NAME=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=xxx \
  MODAL_TOKEN_SECRET=xxx

# Deploy to staging
fly deploy --app reel-ballers-api-staging
```

### 6. Test Staging

```bash
# Check status
fly status --app reel-ballers-api-staging

# View logs
fly logs --app reel-ballers-api-staging

# Test endpoint
curl https://reel-ballers-api-staging.fly.dev/api/health
```

### 7. Create Production App

```bash
# Create the production app
fly apps create reel-ballers-api

# Set production secrets (same R2/Modal, different Stripe later)
fly secrets set --app reel-ballers-api \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com \
  R2_BUCKET_NAME=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=xxx \
  MODAL_TOKEN_SECRET=xxx

# Deploy to production
fly deploy --app reel-ballers-api
```

### 8. Test Production

```bash
curl https://reel-ballers-api.fly.dev/api/health
```

---

## Environment Differences

| Setting | Staging | Production |
|---------|---------|------------|
| App name | reel-ballers-api-staging | reel-ballers-api |
| Domain | *.fly.dev | api.reelballers.com |
| Stripe | sk_test_xxx (later) | sk_live_xxx (later) |
| R2 Bucket | Same | Same |
| Modal | Same | Same |

**Why same R2/Modal?** User data is isolated by user ID prefix. Modal functions are stateless. No need for separate resources.

---

## Deployment Workflow

```bash
# After testing locally, deploy to staging first
fly deploy --app reel-ballers-api-staging

# Test on staging, then deploy to production
fly deploy --app reel-ballers-api
```

---

## Configuration Details

### Scale to Zero
- `auto_stop_machines = true` stops VMs after idle period (~5 min)
- `min_machines_running = 0` allows full scale-down
- Cold start: ~2-3 seconds when waking

### WebSocket Support
Fly.io supports WebSockets natively. No configuration needed.

### Custom Domain (Task 12)
```bash
fly certs add api.reelballers.com --app reel-ballers-api
```

---

## Deliverables

| Item | Description |
|------|-------------|
| fly.toml | Fly.io configuration |
| Dockerfile | Production container |
| Staging app | reel-ballers-api-staging.fly.dev |
| Production app | reel-ballers-api.fly.dev |
| Secrets configured | R2 + Modal credentials on both |

---

## Troubleshooting

### "No machines running"
Expected when scaled to zero. First request wakes the machine.

### Cold start too slow
- Increase `min_machines_running = 1` (costs ~$5/month)
- Or add health check ping to keep warm

### WebSocket disconnects
- Check `force_https = true` is set
- Ensure frontend uses `wss://` not `ws://`

### Modal not working
- Verify MODAL_ENABLED=true in secrets
- Check MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are set
- View logs: `fly logs --app reel-ballers-api-staging`

---

## Cost Estimate

| App | Usage | Monthly Cost |
|-----|-------|--------------|
| Staging | Occasional testing | ~$0-2 |
| Production (low traffic) | Scale to zero | ~$0-5 |
| Production (moderate) | 1000 req/day | ~$5-7 |

---

## Next Step
Task 11 - Cloudflare Pages Frontend (deploy React app)
