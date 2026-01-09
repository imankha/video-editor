# Deployment Plan

## Architecture Overview

```
reelballers.com       → Cloudflare Pages (landing)
app.reelballers.com   → Cloudflare Pages (main app)
api.reelballers.com   → Cloudflare Worker (API router)
```

## Tech Stack

| Component | Service | Purpose |
|-----------|---------|---------|
| Frontend (Landing) | Cloudflare Pages | Marketing + signups |
| Frontend (App) | Cloudflare Pages | Main React/Vite app |
| Edge API | Cloudflare Workers | Top-up, webhook, debit router |
| Wallet DB | Cloudflare D1 | User wallet + ledger |
| Storage | Cloudflare R2 | Video outputs |
| Payments/Identity | Stripe | Customers & payment methods |
| GPU Compute | RunPod | Docker jobs for AI processing |

## Cloudflare Pages Projects

### Landing Page
- **Project name**: `reelballers-landing`
- **Source**: `src/landing/`
- **Root path**: `/src/landing`
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Domain**: `reelballers.com`

See `plans/landingpage.md` for landing-specific roadmap.

### Main App
- **Project name**: `reelballers-app`
- **Source**: `src/frontend/`
- **Root path**: `/src/frontend`
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Domain**: `app.reelballers.com`

**Setup Steps:**
1. Create new Cloudflare Pages project
2. Connect to same repo with root path `/src/frontend`
3. Add custom domain `app.reelballers.com`

**Environment Variables:**
```
VITE_API_URL=https://api.reelballers.com
```

---

## Backend API (Cloudflare Workers)

### Architecture
```
api.reelballers.com
├── /topup    → Create Stripe checkout, set uid cookie
├── /webhook  → Stripe webhook, credit wallet
└── /debit    → Check wallet, debit, trigger RunPod job
```

### Worker Entry Point
Routes requests to appropriate handlers:
- `/topup` - Payment flow initiation
- `/webhook` - Stripe webhook receiver
- `/debit` - GPU job trigger with wallet debit

### Secrets Required
```bash
wrangler secret put STRIPE_SECRET
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RUNPOD_API_KEY
```

### Environment Variables
```toml
[vars]
PAGES_URL = "https://app.reelballers.com"
SUCCESS_URL = "https://app.reelballers.com/success"
CANCEL_URL = "https://app.reelballers.com/cancel"
```

---

## Database (Cloudflare D1)

### Schema
```sql
-- Users table
CREATE TABLE users (
  uid TEXT PRIMARY KEY,
  stripe_customer_id TEXT
);

-- Wallet balance
CREATE TABLE wallet (
  uid TEXT UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0
);

-- Transaction ledger
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  change_cents INTEGER,
  reason TEXT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Setup
```bash
wrangler d1 create wallet-db
wrangler d1 migrations apply wallet-db
```

---

## Payment Flow (Stripe)

1. **User clicks "Top Up"** → `/topup` endpoint
2. **Worker creates Stripe Checkout Session** with uid in metadata
3. **User completes payment** on Stripe
4. **Stripe sends webhook** to `/webhook`
5. **Worker credits wallet** in D1

### Stripe Configuration
- Create webhook endpoint pointing to `api.reelballers.com/webhook`
- Subscribe to `checkout.session.completed` events
- Store webhook signing secret

---

## GPU Processing (RunPod)

### Flow
1. Frontend requests GPU job → `/debit` endpoint
2. Worker checks wallet balance
3. If sufficient funds: debit wallet, trigger RunPod job
4. RunPod processes video, uploads to R2
5. Worker/webhook notifies frontend of completion

### RunPod Setup
- Create serverless endpoint template
- Configure Docker image with AI models
- Set up R2 credentials for output upload

---

## Storage (Cloudflare R2)

### Bucket Structure
```
reelballers-videos/
├── {uid}/
│   ├── input/      # User uploads
│   └── output/     # Processed videos
```

### R2 Setup
```bash
wrangler r2 bucket create reelballers-videos
```

### Worker Binding
```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "reelballers-videos"
```

---

## Terraform (Optional)

Infrastructure as code available in `docs/plans/cloudflare_runpod_deploy_package/terraform/`:
- Cloudflare Pages project
- R2 bucket
- Worker routes
- DNS records

```bash
cd docs/plans/cloudflare_runpod_deploy_package/terraform
terraform init
terraform plan
terraform apply
```

---

## Deployment Commands

### Initial Setup
```bash
# Create D1 database
wrangler d1 create wallet-db

# Create R2 bucket
wrangler r2 bucket create reelballers-videos

# Set secrets
wrangler secret put STRIPE_SECRET
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RUNPOD_API_KEY

# Apply migrations
wrangler d1 migrations apply wallet-db

# Deploy worker
wrangler deploy
```

### Pages Deployment
```bash
# Landing page
cd src/landing && npm run build && wrangler pages deploy dist

# Main app (when ready)
cd src/frontend && npm run build && wrangler pages deploy dist
```

---

## Rollback Procedures

```bash
# List deployments
wrangler pages deployment list --project-name=<project-name>

# Rollback to specific deployment
wrangler pages deployment rollback <deployment-id> --project-name=<project-name>

# Worker rollback
wrangler rollback
```

---

## Monitoring

- **Cloudflare Analytics**: Built-in for Pages and Workers
- **D1 Analytics**: Database metrics in Cloudflare dashboard
- **Stripe Dashboard**: Payment metrics and webhook logs
- **RunPod Dashboard**: GPU job metrics
- **Error Tracking**: Consider Sentry for production

---

## Reference Implementation

Full working code available in:
`docs/plans/cloudflare_runpod_deploy_package/`

```
├── terraform/          # Infrastructure as code
├── wrangler/
│   ├── src/
│   │   ├── worker-entry.js
│   │   ├── topup.js
│   │   ├── webhook.js
│   │   └── debit_and_runpod.js
│   ├── migrations/
│   │   └── 0001-init.sql
│   └── wrangler.toml
└── README.md
```
