# Phase C: Deployment

**Status**: PLANNED
**Priority**: MEDIUM (after features complete)
**Scope**: Production deployment with Cloudflare + RunPod

---

## Overview

Deploy the Player Highlighter application to production using Cloudflare for edge infrastructure and RunPod for GPU-accelerated AI upscaling. The deployment includes a prepaid credits system using Stripe.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           INTERNET                                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE EDGE                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │    Pages     │  │   Workers    │  │      R2      │              │
│  │  (Frontend)  │  │  (Edge API)  │  │  (Storage)   │              │
│  │  React/Vite  │  │  Auth+Logic  │  │  Videos/Out  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                          │                                          │
│                    ┌─────┴─────┐                                   │
│                    │    D1     │                                   │
│                    │  (Wallet) │                                   │
│                    └───────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (RunPod API)
┌─────────────────────────────────────────────────────────────────────┐
│                          RUNPOD                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    GPU Workers                                │  │
│  │   HAT / SwinIR / RIFE Models                                 │  │
│  │   AI Upscaling + Frame Interpolation                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          STRIPE                                      │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │  Customers   │  │  Payments    │                                │
│  │  (Identity)  │  │  (Credits)   │                                │
│  └──────────────┘  └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Environments

| Environment | Purpose | URL | Backend |
|-------------|---------|-----|---------|
| **Local** | Development | localhost:5173 | Local Python + FFmpeg |
| **Staging** | Testing | staging.yourdomain.com | Cloudflare + RunPod (test) |
| **Production** | Live | yourdomain.com | Cloudflare + RunPod (prod) |

---

## Components

### 1. Cloudflare Pages (Frontend)

Static React/Vite application.

**Build Config**:
```bash
build_command = "npm run build"
build_output = "dist"
```

**Environment Variables**:
| Variable | Staging | Production |
|----------|---------|------------|
| VITE_API_URL | https://api-staging.domain.com | https://api.domain.com |
| VITE_STRIPE_PUBLIC_KEY | pk_test_xxx | pk_live_xxx |

---

### 2. Cloudflare Workers (Edge API)

Handles authentication, wallet operations, and job dispatch.

**Endpoints**:
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/topup` | POST | Create Stripe checkout session |
| `/api/webhook` | POST | Stripe webhook handler |
| `/api/export` | POST | Debit credits + dispatch RunPod job |
| `/api/status/:jobId` | GET | Check job status |

**Code Location**: `cloudflare_runpod_deploy_package/wrangler/src/`

---

### 3. Cloudflare D1 (Database)

SQLite-based wallet database.

**Schema**:
```sql
-- From: cloudflare_runpod_deploy_package/wrangler/migrations/0001-init.sql

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY,        -- Stripe customer ID
  balance INTEGER DEFAULT 0,       -- Credits in cents
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,         -- Positive = credit, negative = debit
  type TEXT NOT NULL,              -- 'topup', 'export', 'refund'
  description TEXT,
  stripe_payment_id TEXT,
  runpod_job_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES wallets(user_id)
);
```

---

### 4. Cloudflare R2 (Temporary Storage)

Temporary storage for video processing only. Users download immediately after export.

**Buckets**:
| Bucket | Purpose |
|--------|---------|
| `player-highlighter-temp` | Temporary processing storage |

**Lifecycle**:
- All files: Auto-delete after 24 hours
- Users download exported videos immediately via signed URL
- No long-term video storage

**Flow**:
1. User uploads video → stored temporarily in R2
2. RunPod processes video → output to R2
3. User downloads via signed URL (expires in 1 hour)
4. Files auto-cleaned after 24 hours

---

### 5. RunPod (GPU Compute)

Docker-based GPU workers for AI upscaling.

**Docker Image**: Contains HAT, SwinIR, RIFE models

**Job Payload**:
```json
{
  "input": {
    "source_url": "https://r2.domain.com/uploads/video.mp4",
    "output_bucket": "player-highlighter-exports",
    "output_key": "exports/job-123/output.mp4",
    "crop_keyframes": [...],
    "overlay_layers": [...],
    "upscale_model": "HAT-L",
    "target_resolution": "1080p"
  }
}
```

---

### 6. Stripe (Payments)

Prepaid credits system.

**Flow**:
1. User clicks "Add Credits"
2. Worker creates Stripe Checkout Session
3. User completes payment
4. Webhook credits user's wallet
5. Export jobs debit from wallet

**Credit Pricing** (example):
| Credits | Price |
|---------|-------|
| 100 | $5 |
| 500 | $20 |
| 1000 | $35 |

---

## Build Scripts

### package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:local": "VITE_API_URL=http://localhost:8000 vite build",
    "build:staging": "VITE_API_URL=https://api-staging.domain.com vite build",
    "build:prod": "VITE_API_URL=https://api.domain.com vite build",

    "deploy:staging": "npm run build:staging && wrangler pages deploy dist --project-name=player-highlighter-staging",
    "deploy:prod": "npm run build:prod && wrangler pages deploy dist --project-name=player-highlighter",

    "worker:dev": "cd cloudflare_runpod_deploy_package/wrangler && wrangler dev",
    "worker:deploy:staging": "cd cloudflare_runpod_deploy_package/wrangler && wrangler deploy --env staging",
    "worker:deploy:prod": "cd cloudflare_runpod_deploy_package/wrangler && wrangler deploy --env production"
  }
}
```

---

## Implementation Steps

### Step 1: Terraform Setup

Initialize Cloudflare infrastructure:

```bash
cd cloudflare_runpod_deploy_package/terraform

# Update variables.tf with your values
# - cloudflare_account_id
# - cloudflare_zone_id
# - domain

terraform init
terraform plan
terraform apply
```

**Resources Created**:
- Cloudflare Pages project
- R2 buckets
- Worker routes
- DNS records

---

### Step 2: D1 Database

Create and migrate the database:

```bash
cd cloudflare_runpod_deploy_package/wrangler

# Create database
wrangler d1 create wallet-db

# Apply migrations
wrangler d1 migrations apply wallet-db
```

---

### Step 3: Secrets Configuration

Set required secrets:

```bash
# Stripe
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET

# RunPod
wrangler secret put RUNPOD_API_KEY

# R2 (for signed URLs)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

---

### Step 4: Worker Deployment

Deploy the edge workers:

```bash
cd cloudflare_runpod_deploy_package/wrangler

# Staging
wrangler deploy --env staging

# Production
wrangler deploy --env production
```

---

### Step 5: Frontend Deployment

Deploy the React app to Pages:

```bash
# Staging
npm run deploy:staging

# Production
npm run deploy:prod
```

---

### Step 6: RunPod Setup

1. Create RunPod account
2. Build and push Docker image with AI models
3. Create serverless endpoint
4. Update Worker with endpoint ID

**Docker Image Requirements**:
- CUDA 11.8+
- Python 3.10+
- PyTorch 2.0+
- HAT, SwinIR, RIFE model weights
- FFmpeg

---

## Local Development Mode

For fast iteration, local mode bypasses cloud infrastructure:

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              React Frontend (Vite HMR)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Local Python Backend (localhost:8000)                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  FastAPI + FFmpeg + (optional) Local AI Models           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Local Config** (`.env.local`):
```bash
VITE_API_URL=http://localhost:8000
VITE_USE_LOCAL_BACKEND=true
```

---

## Testing Requirements

### Infrastructure Tests

- [ ] Terraform plan succeeds
- [ ] D1 migrations apply cleanly
- [ ] Workers deploy without errors
- [ ] Pages build and deploy

### Integration Tests

- [ ] Stripe checkout flow works
- [ ] Webhook credits wallet correctly
- [ ] Export job dispatches to RunPod
- [ ] RunPod returns processed video
- [ ] Signed URL download works (user gets video immediately)
- [ ] Temp files cleaned up after 24 hours

### Load Tests

- [ ] Worker handles concurrent requests
- [ ] R2 handles large file uploads
- [ ] RunPod queue handles burst

---

## Acceptance Criteria

1. **Staging Works**: Full flow works in staging environment
2. **Production Works**: Full flow works in production
3. **Payments Work**: Can add credits via Stripe
4. **Export Works**: Can export video with AI upscaling
5. **Download Works**: User can immediately download exported video
6. **Local Mode**: Development still works offline

---

## Monitoring

### Cloudflare Analytics

- Request volume
- Error rates
- Latency percentiles

### Custom Logging

Worker logs to OpenObserve (optional):

```javascript
// In worker
await fetch('https://logs.yourdomain.com/api/v1/logs', {
  method: 'POST',
  body: JSON.stringify({
    level: 'info',
    message: 'Export job dispatched',
    jobId: jobId,
    userId: userId,
  })
});
```

### Alerts

- Worker error rate > 1%
- RunPod job failure rate > 5%
- Wallet balance anomalies

---

## Cost Estimation

| Component | Estimated Monthly Cost |
|-----------|----------------------|
| Cloudflare Pages | Free |
| Cloudflare Workers | ~$5 (usage-based) |
| Cloudflare D1 | Free tier sufficient |
| Cloudflare R2 | Minimal (temp storage only, 24hr cleanup) |
| RunPod | Variable (GPU usage) |
| Stripe | 2.9% + $0.30 per transaction |

---

## File Structure

```
cloudflare_runpod_deploy_package/
├── README.md                    # Overview
├── terraform/
│   ├── main.tf                  # Resource definitions
│   ├── variables.tf             # Configuration variables
│   └── outputs.tf               # Output values
└── wrangler/
    ├── wrangler.toml            # Worker configuration
    ├── migrations/
    │   └── 0001-init.sql        # D1 schema
    └── src/
        ├── worker-entry.js      # Main entry point
        ├── topup.js             # Stripe checkout
        ├── webhook.js           # Stripe webhook
        └── debit_and_runpod.js  # Export job dispatch
```

---

## Rollback Plan

### Frontend Rollback

```bash
# List deployments
wrangler pages deployments list --project-name=player-highlighter

# Rollback to previous
wrangler pages deployments rollback --project-name=player-highlighter --deployment-id=xxx
```

### Worker Rollback

```bash
# Workers automatically version
# Use Cloudflare dashboard to rollback
```

### Database Rollback

- D1 supports point-in-time recovery
- Keep migration down scripts for manual rollback

---

## Security Considerations

- All secrets in Cloudflare Secrets Manager
- Stripe webhook signature verification
- Signed URLs for R2 (time-limited)
- Rate limiting on Workers
- Input validation on all endpoints
