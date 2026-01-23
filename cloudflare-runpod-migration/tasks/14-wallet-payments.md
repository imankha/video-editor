# Task 14: Wallet & Payments (Optional)

## Overview
Implement a credit-based wallet system with Stripe for monetization. Users top up credits, then spend them on GPU processing jobs.

## Owner
**Both** - User sets up Stripe account, Claude implements code

## Prerequisites
- Phase 3 complete (Fly.io backend deployed)
- Task 13 complete (User management, at least anonymous users)
- Stripe account created

## Status
`OPTIONAL` - Only implement if monetizing the app

---

## Architecture

```
User clicks "Top Up"
        |
        v
+------------------+
|  /api/topup      | --> Create Stripe Checkout Session
+--------+---------+
         |
         v
+------------------+
|  Stripe Hosted   | --> User enters payment
|  Checkout        |
+--------+---------+
         |
         v
+------------------+
|  /api/webhook    | --> Stripe sends checkout.session.completed
+--------+---------+
         |
         v
+------------------+
|  SQLite Database | --> Credit user's wallet
+------------------+
```

---

## Database Schema

Add to user's SQLite database:

```sql
-- Wallet balance
CREATE TABLE IF NOT EXISTS wallet (
    id INTEGER PRIMARY KEY,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Initialize wallet with 0 balance
INSERT OR IGNORE INTO wallet (id, balance_cents) VALUES (1, 0);

-- Transaction ledger (audit trail)
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_cents INTEGER NOT NULL,
    reason TEXT NOT NULL,  -- 'topup', 'debit', 'refund', 'bonus'
    job_id TEXT,           -- Reference to export_jobs if applicable
    stripe_payment_id TEXT, -- Reference to Stripe payment
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Stripe Setup (User Task)

### 1. Create Stripe Account
1. Go to https://dashboard.stripe.com/register
2. Complete business verification
3. Start in **Test Mode** for development

### 2. Get API Keys
1. **Developers** -> **API keys**
2. Copy:
   - Publishable key: `pk_test_...` (for frontend)
   - Secret key: `sk_test_...` (for backend)

### 3. Create Webhook
1. **Developers** -> **Webhooks** -> **Add endpoint**
2. URL: `https://api.reelballers.com/api/webhook`
3. Events: `checkout.session.completed`
4. Copy signing secret: `whsec_...`

---

## Pricing Model

### Cost Per Job Type

| Job Type | Estimated GPU Time | Cost to User |
|----------|-------------------|--------------|
| Framing (30s clip) | ~10s | 5 credits ($0.05) |
| Overlay (30s video) | ~15s | 8 credits ($0.08) |
| Upscale (30s, 4x) | ~60s | 30 credits ($0.30) |

### Margin Calculation

| Metric | Value |
|--------|-------|
| Modal cost (T4 GPU) | ~$0.00016/sec |
| 15-second job actual cost | $0.0024 |
| Price to user | $0.08 (8 credits) |
| **Gross margin** | **~97%** |

---

## Environment Variables

```bash
# Add to Fly.io secrets
fly secrets set --app reel-ballers-api \
  STRIPE_SECRET_KEY=sk_live_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Staging uses test keys
fly secrets set --app reel-ballers-api-staging \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_test_xxx \
  STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

---

## FastAPI Implementation

### app/routers/payments.py

```python
"""
Payment routes for wallet top-up and management.
"""
import os
import stripe
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["payments"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
APP_URL = os.getenv("APP_URL", "https://app.reelballers.com")


class TopupRequest(BaseModel):
    amount_cents: int  # e.g., 500 for $5


@router.post("/topup")
async def create_topup_session(request: Request, body: TopupRequest):
    """
    Create a Stripe Checkout session for adding credits.
    """
    user_id = request.state.user_id  # From auth middleware

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": f"{body.amount_cents} Credits",
                    },
                    "unit_amount": body.amount_cents,
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{APP_URL}/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{APP_URL}/cancel",
            metadata={
                "user_id": user_id,
                "credits": str(body.amount_cents),  # 1 cent = 1 credit
            },
        )

        return {"checkout_url": session.url, "session_id": session.id}

    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events.
    """
    body = await request.body()
    signature = request.headers.get("stripe-signature")

    if not signature:
        raise HTTPException(status_code=400, detail="Missing signature")

    try:
        event = stripe.Webhook.construct_event(
            body, signature, STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    # Handle checkout completed
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session["metadata"].get("user_id")
        credits = int(session["metadata"].get("credits", 0))

        if user_id and credits > 0:
            await credit_wallet(user_id, credits, session["payment_intent"])

    return {"received": True}


async def credit_wallet(user_id: str, credits: int, payment_id: str):
    """
    Add credits to user's wallet.
    """
    from app.services.database import get_db_connection

    with get_db_connection(user_id) as conn:
        cursor = conn.cursor()

        # Update balance
        cursor.execute("""
            UPDATE wallet SET balance_cents = balance_cents + ?, updated_at = datetime('now')
        """, (credits,))

        # Record in ledger
        cursor.execute("""
            INSERT INTO ledger (change_cents, reason, stripe_payment_id)
            VALUES (?, 'topup', ?)
        """, (credits, payment_id))

        conn.commit()


@router.get("/wallet")
async def get_wallet(request: Request):
    """
    Get user's current balance.
    """
    user_id = request.state.user_id
    from app.services.database import get_db_connection

    with get_db_connection(user_id) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT balance_cents FROM wallet WHERE id = 1")
        result = cursor.fetchone()

        return {"balance_cents": result["balance_cents"] if result else 0}


@router.post("/debit")
async def debit_wallet(request: Request, job_id: str, cost_cents: int):
    """
    Debit wallet when starting a job.

    Called internally before starting an export job.
    """
    user_id = request.state.user_id
    from app.services.database import get_db_connection

    with get_db_connection(user_id) as conn:
        cursor = conn.cursor()

        # Check balance
        cursor.execute("SELECT balance_cents FROM wallet WHERE id = 1")
        result = cursor.fetchone()
        balance = result["balance_cents"] if result else 0

        if balance < cost_cents:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "Insufficient funds",
                    "balance_cents": balance,
                    "required_cents": cost_cents,
                }
            )

        # Debit the wallet
        cursor.execute("""
            UPDATE wallet SET balance_cents = balance_cents - ?, updated_at = datetime('now')
        """, (cost_cents,))

        cursor.execute("""
            INSERT INTO ledger (change_cents, reason, job_id)
            VALUES (?, 'debit', ?)
        """, (-cost_cents, job_id))

        conn.commit()

        return {
            "success": True,
            "new_balance_cents": balance - cost_cents,
        }
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

# Forward webhooks to local dev
stripe listen --forward-to localhost:8000/api/webhook

# Trigger test event
stripe trigger checkout.session.completed
```

### Test Against Staging
```bash
# Forward webhooks to staging
stripe listen --forward-to https://reel-ballers-api-staging.fly.dev/api/webhook
```

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

  const handleTopup = async (amount) => {
    const response = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amount_cents: amount }),
    });
    const { checkout_url } = await response.json();
    window.location.href = checkout_url;
  };

  if (loading) return <span>...</span>;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-400">
        ${(balance / 100).toFixed(2)}
      </span>
      <button
        onClick={() => handleTopup(500)}
        className="px-2 py-1 bg-green-600 rounded text-sm"
      >
        Add $5
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
    showInsufficientFundsModal(cost - balance_cents);
    return;
  }

  // Start the job (backend will debit wallet)
  const jobRes = await fetch('/api/export/start', {
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
  const baseCosts = { framing: 5, overlay: 8, annotate: 10 };
  return baseCosts[type] || 10;
}
```

---

## Integration with Export Flow

Update export endpoint to debit wallet before starting job:

```python
# In routers/export.py

@router.post("/export/start")
async def start_export(request: Request, body: ExportRequest):
    user_id = request.state.user_id
    job_id = str(uuid.uuid4())

    # Debit wallet first
    if body.cost_cents > 0:
        from app.routers.payments import debit_wallet
        await debit_wallet(request, job_id, body.cost_cents)

    # Then start the export job
    # ... rest of export logic
```

---

## Handoff Notes

This task is **optional** for initial launch. You can start without payments and add later.

When implementing:
1. Start with Stripe test mode on staging
2. Test the full flow with Stripe CLI
3. Deploy webhook endpoint first
4. Test with small real payments before going live
5. Always test on staging before production

The per-user SQLite keeps wallet data isolated - each user has their own wallet table in their own database.
