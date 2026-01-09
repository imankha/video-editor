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

See `landingpage.md` for landing-specific roadmap.

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

## Reference Patterns (Pseudo-code)

These patterns guide AI code generation. Adapt as needed.

### Worker Router Pattern
```
// Entry point routes by path prefix
router(request):
  if path.startsWith('/topup')  → topupHandler(request)
  if path.startsWith('/webhook') → webhookHandler(request)
  if path.startsWith('/debit')   → debitHandler(request)
  else → 404
```

### Top-up Flow Pattern
```
topupHandler(request):
  uid = getCookie('uid') OR generateUUID()
  session = stripe.createCheckoutSession({
    payment_method_types: ['card'],
    metadata: { uid },
    success_url, cancel_url
  })
  return redirect(session.url) + setCookie('uid', uid)
```

### Webhook Pattern
```
webhookHandler(request):
  signature = request.headers['stripe-signature']
  event = stripe.verifyWebhook(body, signature, secret)
  if event.type == 'checkout.session.completed':
    uid = event.data.metadata.uid
    amount = event.data.amount_total
    db.exec("UPDATE wallet SET balance_cents = balance_cents + ? WHERE uid = ?", amount, uid)
    db.exec("INSERT INTO ledger (uid, change_cents, reason) VALUES (?, ?, 'topup')", uid, amount)
  return 200
```

### Debit + RunPod Pattern
```
debitHandler(request):
  uid = getCookie('uid')
  cost = calculateJobCost(request.params)
  balance = db.query("SELECT balance_cents FROM wallet WHERE uid = ?", uid)
  if balance < cost → return 402 "Insufficient funds"

  db.exec("UPDATE wallet SET balance_cents = balance_cents - ? WHERE uid = ?", cost, uid)
  db.exec("INSERT INTO ledger (uid, change_cents, reason) VALUES (?, ?, 'debit')", uid, -cost)

  job = runpod.createJob({ input: request.params })
  return { job_id: job.id, status: 'queued' }
```

### Terraform Resources (Reference)
```
cloudflare_pages_project     → name, build_command, directory
cloudflare_r2_bucket         → bucket_name
cloudflare_worker_route      → pattern: "api.domain.com/*"
cloudflare_record            → A record, proxied: true
```

### Wrangler Config Pattern
```toml
name = "wallet-api"
main = "src/worker-entry.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "wallet-db"

[[r2_buckets]]
binding = "R2"
bucket_name = "reelballers-videos"

[vars]
SUCCESS_URL = "https://app.reelballers.com/success"
```
