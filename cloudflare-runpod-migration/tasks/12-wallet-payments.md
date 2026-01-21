# Task 12: Wallet & Payments

## Overview
Implement a credit-based wallet system with Stripe for monetization. Users top up credits, then spend them on GPU processing jobs.

## Owner
**Both** - User sets up Stripe account, Claude implements code

## Prerequisites
- Task 06 complete (Workers API working)
- Stripe account created

## Time Estimate
3-4 hours

---

## Architecture

```
User clicks "Top Up"
        │
        ▼
┌─────────────────┐
│  /api/topup     │ → Create Stripe Checkout Session
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Stripe Hosted  │ → User enters payment
│  Checkout       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  /api/webhook   │ → Stripe sends checkout.session.completed
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  D1 Database    │ → Credit user's wallet
└─────────────────┘
```

---

## Database Schema

Add to D1 migrations:

### 0002_create_wallet.sql

```sql
-- Users table (links to Stripe customer)
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    stripe_customer_id TEXT,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wallet balance
CREATE TABLE IF NOT EXISTS wallet (
    uid TEXT PRIMARY KEY,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (uid) REFERENCES users(uid)
);

-- Transaction ledger (audit trail)
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    change_cents INTEGER NOT NULL,
    reason TEXT NOT NULL,  -- 'topup', 'debit', 'refund', 'bonus'
    job_id TEXT,           -- Reference to export_jobs if applicable
    stripe_payment_id TEXT, -- Reference to Stripe payment
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE INDEX IF NOT EXISTS idx_ledger_uid ON ledger(uid);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at);
```

---

## Stripe Setup (User Task)

### 1. Create Stripe Account
1. Go to https://dashboard.stripe.com/register
2. Complete business verification
3. Note: Start in Test Mode for development

### 2. Get API Keys
1. Go to **Developers** → **API keys**
2. Copy:
   - **Publishable key**: `pk_test_...` (for frontend)
   - **Secret key**: `sk_test_...` (for backend)

### 3. Create Webhook
1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. URL: `https://api.reelballers.com/api/webhook`
4. Select events: `checkout.session.completed`
5. Copy **Signing secret**: `whsec_...`

### 4. Create Products (Optional)
For fixed price top-ups:
1. Go to **Products**
2. Create products like:
   - "10 Credits" - $5.00
   - "50 Credits" - $20.00
   - "100 Credits" - $35.00

---

## API Routes

### POST /api/topup
Create a Stripe checkout session for adding credits.

```typescript
// workers/src/routes/payments.ts

interface TopupRequest {
  amount_cents: number;  // e.g., 500 for $5
  uid?: string;          // User ID from cookie
}

export async function handleTopup(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as TopupRequest;
  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Get or create user ID
  let uid = cookies.uid || body.uid;
  if (!uid) {
    uid = crypto.randomUUID();
  }

  // Ensure user exists in database
  await env.DB.prepare(`
    INSERT OR IGNORE INTO users (uid) VALUES (?)
  `).bind(uid).run();

  // Create Stripe checkout session
  const stripe = new Stripe(env.STRIPE_SECRET);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${body.amount_cents / 100} Credits`,
        },
        unit_amount: body.amount_cents,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/cancel`,
    metadata: {
      uid: uid,
      credits: body.amount_cents.toString(),  // 1 cent = 1 credit
    },
  });

  return new Response(JSON.stringify({
    checkout_url: session.url,
    session_id: session.id,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `uid=${uid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
    },
  });
}
```

### POST /api/webhook
Handle Stripe webhook events.

```typescript
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  // Verify webhook signature
  const stripe = new Stripe(env.STRIPE_SECRET);
  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    const credits = parseInt(session.metadata?.credits || '0');

    if (uid && credits > 0) {
      // Credit the wallet
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO wallet (uid, balance_cents) VALUES (?, ?)
          ON CONFLICT(uid) DO UPDATE SET balance_cents = balance_cents + ?
        `).bind(uid, credits, credits),

        env.DB.prepare(`
          INSERT INTO ledger (uid, change_cents, reason, stripe_payment_id)
          VALUES (?, ?, 'topup', ?)
        `).bind(uid, credits, session.payment_intent),
      ]);

      console.log(`Credited ${credits} cents to user ${uid}`);
    }
  }

  return new Response(JSON.stringify({ received: true }));
}
```

### GET /api/wallet
Get user's current balance.

```typescript
export async function handleGetWallet(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const uid = cookies.uid;

  if (!uid) {
    return new Response(JSON.stringify({ balance_cents: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const wallet = await env.DB.prepare(`
    SELECT balance_cents FROM wallet WHERE uid = ?
  `).bind(uid).first<{ balance_cents: number }>();

  return new Response(JSON.stringify({
    balance_cents: wallet?.balance_cents || 0,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### POST /api/debit
Debit wallet when starting a job.

```typescript
interface DebitRequest {
  job_id: string;
  cost_cents: number;
}

export async function handleDebit(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as DebitRequest;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const uid = cookies.uid;

  if (!uid) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check balance
  const wallet = await env.DB.prepare(`
    SELECT balance_cents FROM wallet WHERE uid = ?
  `).bind(uid).first<{ balance_cents: number }>();

  const balance = wallet?.balance_cents || 0;

  if (balance < body.cost_cents) {
    return new Response(JSON.stringify({
      error: 'Insufficient funds',
      balance_cents: balance,
      required_cents: body.cost_cents,
    }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Debit the wallet
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE wallet SET balance_cents = balance_cents - ? WHERE uid = ?
    `).bind(body.cost_cents, uid),

    env.DB.prepare(`
      INSERT INTO ledger (uid, change_cents, reason, job_id)
      VALUES (?, ?, 'debit', ?)
    `).bind(uid, -body.cost_cents, body.job_id),
  ]);

  return new Response(JSON.stringify({
    success: true,
    new_balance_cents: balance - body.cost_cents,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## Pricing Model

### Cost Per Job Type

| Job Type | Estimated GPU Time | Cost to User |
|----------|-------------------|--------------|
| Framing (30s clip) | ~10s | 5 credits ($0.05) |
| Overlay (30s video) | ~15s | 8 credits ($0.08) |
| Upscale (30s, 4x) | ~60s | 30 credits ($0.30) |
| Track (30s) | ~20s | 10 credits ($0.10) |

### Margin Calculation

| Metric | Value |
|--------|-------|
| RunPod cost (RTX 4000 Ada) | $0.00031/sec |
| 15-second job actual cost | $0.0047 |
| Price to user | $0.08 (8 credits) |
| **Gross margin** | **~94%** |

---

## Frontend Integration

### Wallet Display Component

```jsx
function WalletBalance() {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/wallet', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setBalance(data.balance_cents);
        setLoading(false);
      });
  }, []);

  const handleTopup = async () => {
    const response = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amount_cents: 500 }),  // $5
    });
    const { checkout_url } = await response.json();
    window.location.href = checkout_url;
  };

  if (loading) return <span>...</span>;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-400">
        {(balance / 100).toFixed(2)} credits
      </span>
      <button
        onClick={handleTopup}
        className="px-2 py-1 bg-green-600 rounded text-sm"
      >
        Add Credits
      </button>
    </div>
  );
}
```

### Check Balance Before Export

```javascript
async function startExportWithPayment(projectId, type, params) {
  const cost = calculateJobCost(type, params);

  // Check balance
  const walletRes = await fetch('/api/wallet', { credentials: 'include' });
  const { balance_cents } = await walletRes.json();

  if (balance_cents < cost) {
    // Show top-up modal
    showInsufficientFundsModal(cost - balance_cents);
    return;
  }

  // Start the job (will debit automatically)
  const jobRes = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      project_id: projectId,
      type,
      params,
      cost_cents: cost,
    }),
  });

  return jobRes.json();
}

function calculateJobCost(type, params) {
  // Estimate based on video duration and job type
  const baseCosts = { framing: 5, overlay: 8, upscale: 30, track: 10 };
  return baseCosts[type] || 10;
}
```

---

## Environment Variables

```bash
# Stripe (set as secrets)
wrangler secret put STRIPE_SECRET
wrangler secret put STRIPE_WEBHOOK_SECRET

# wrangler.toml vars
[vars]
APP_URL = "https://app.reelballers.com"
STRIPE_PUBLISHABLE_KEY = "pk_live_..."  # Safe to expose
```

---

## Testing

### Test Mode
Use Stripe test keys (`sk_test_...`) during development.

### Test Card Numbers
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

### Webhook Testing
```bash
# Install Stripe CLI
stripe login

# Forward webhooks to local
stripe listen --forward-to localhost:8787/api/webhook

# Trigger test event
stripe trigger checkout.session.completed
```

---

## Handoff Notes

**This task is optional for initial launch** - you can start without payments and add later.

When implementing:
1. Start with Stripe test mode
2. Test the full flow locally with Stripe CLI
3. Deploy webhook endpoint first
4. Test with small real payments before going live
