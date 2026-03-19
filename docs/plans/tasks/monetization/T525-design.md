# T525 Design: Stripe Integration

## Current State

```mermaid
flowchart LR
    subgraph Credits Exist
        QuestReward["Quest Reward"] -->|grant_credits| AuthDB[(auth.sqlite)]
        AdminGrant["Admin Grant"] -->|grant_credits| AuthDB
        FramingExport["Framing Export"] -->|deduct_credits| AuthDB
    end

    subgraph Purchase Flow (NOT IMPLEMENTED)
        InsufficientModal["InsufficientCreditsModal"] -->|disabled button| Nothing["Coming Soon: Purchase"]
    end
```

**What exists:**
- `auth.sqlite` has `users.stripe_customer_id` column (reserved, always NULL)
- `users.credits` column + `credit_transactions` ledger
- `grant_credits()`, `deduct_credits()`, `refund_credits()` in `auth_db.py`
- `InsufficientCreditsModal` with disabled "Coming Soon: Purchase" button
- `creditStore` with `fetchCredits()`, `setBalance()`, `canAffordExport()`

**What's missing:**
- No `payments.py` router
- No `BuyCreditsModal` component
- No Stripe package in requirements
- No Stripe env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`)

---

## Target State

```mermaid
flowchart LR
    User -->|clicks Buy Credits| BuyCreditsModal
    BuyCreditsModal -->|selects pack| FE["Frontend"]
    FE -->|POST /api/payments/checkout| Backend["payments.py"]
    Backend -->|stripe.checkout.Session.create| Stripe["Stripe API"]
    Stripe -->|returns checkout_url| Backend
    Backend -->|returns checkout_url| FE
    FE -->|window.location.href = url| StripeCheckout["Stripe Hosted Checkout"]
    StripeCheckout -->|payment complete| ReturnURL["App ?payment=success"]
    StripeCheckout -->|webhook POST| WebhookEndpoint["/api/payments/webhook"]
    WebhookEndpoint -->|verify signature| WebhookHandler
    WebhookHandler -->|grant_credits| AuthDB[(auth.sqlite)]
    ReturnURL -->|fetchCredits()| CreditRefresh["Balance Updated"]
```

---

## Implementation Plan

### Backend: `src/backend/app/routers/payments.py` (NEW)

**Credit Packs (constant dict, not DB):**
```python
CREDIT_PACKS = {
    "starter": {"credits": 120, "price_cents": 499, "name": "Starter"},
    "popular": {"credits": 400, "price_cents": 1299, "name": "Popular"},
    "pro":     {"credits": 1000, "price_cents": 2499, "name": "Pro"},
}
```

**Endpoint 1: `POST /api/payments/checkout`**
```python
# Request: { "pack": "popular" }
# Flow:
#   1. Validate pack exists in CREDIT_PACKS
#   2. Get/create Stripe customer for current user_id
#      - Check users.stripe_customer_id
#      - If NULL: stripe.Customer.create(metadata={"user_id": user_id})
#      - Save stripe_customer_id to users table
#   3. Create Stripe Checkout Session:
#      - mode="payment" (one-time, not subscription)
#      - line_items: [{price_data: {currency: "usd", unit_amount: price_cents, product_data: {name}}, quantity: 1}]
#      - metadata: {"user_id": user_id, "pack": pack_key, "credits": credits}
#      - success_url: "{frontend_url}?payment=success"
#      - cancel_url: "{frontend_url}?payment=cancelled"
#      - customer: stripe_customer_id
#   4. Return { "checkout_url": session.url }
# Response: { "checkout_url": "https://checkout.stripe.com/..." }
# Errors: 400 (invalid pack), 500 (Stripe API error)
```

**Endpoint 2: `POST /api/payments/webhook`**
```python
# Flow:
#   1. Read raw body (NOT parsed JSON — Stripe needs raw bytes for signature)
#   2. Verify Stripe signature: stripe.Webhook.construct_event(body, sig_header, webhook_secret)
#   3. Handle event type "checkout.session.completed":
#      a. Extract metadata: user_id, pack, credits
#      b. Idempotency check: SELECT FROM credit_transactions WHERE reference_id = session.id
#      c. If already processed → log + return 200 (don't double-grant)
#      d. grant_credits(user_id, credits, source="stripe_purchase", reference_id=session.id)
#   4. Return 200 for all event types (Stripe expects 200)
# Important:
#   - This endpoint must NOT go through auth middleware (no user session on webhooks)
#   - Stripe signature verification IS the auth
#   - Must accept raw body, not parsed JSON
```

**Stripe Customer Management (in auth_db.py):**
```python
def get_stripe_customer_id(user_id: str) -> Optional[str]:
    """Get stripe_customer_id from users table."""

def set_stripe_customer_id(user_id: str, stripe_customer_id: str):
    """Save stripe_customer_id to users table. Syncs to R2."""
```

### Backend: Middleware Exception for Webhook

The webhook endpoint must receive raw bytes (not parsed JSON) and must not require user auth. Two approaches:

**Chosen approach: Route-level raw body handling.**
- The webhook endpoint uses `request: Request` directly and calls `await request.body()` for raw bytes
- The existing `RequestContextMiddleware` already passes through requests without `X-User-ID` or `rb_session` — it just sets the default user. The webhook doesn't call `get_current_user_id()` so this is fine.
- No middleware changes needed.

### Backend: Environment Variables

```
STRIPE_SECRET_KEY=sk_test_...       # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...     # Webhook endpoint signing secret
```

Both optional — if not set, payment endpoints return 503 "Payments not configured". This keeps the app functional without Stripe in dev/test.

### Frontend: `BuyCreditsModal.jsx` (NEW)

```
┌──────────────────────────────────────┐
│  🪙 Buy Credits                   ✕  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Starter                       │  │
│  │  120 credits         $4.99     │  │
│  │  ~2 minutes of video           │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  ⭐ Most Popular               │  │
│  │  400 credits        $12.99     │  │
│  │  ~7 minutes of video           │  │
│  │  Save 22%                      │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  💎 Best Value                  │  │
│  │  1,000 credits      $24.99     │  │
│  │  ~17 minutes of video          │  │
│  │  Save 40%                      │  │
│  └────────────────────────────────┘  │
│                                      │
│  Credits never expire.               │
│                                      │
│           [ Cancel ]                 │
└──────────────────────────────────────┘
```

**Behavior:**
1. Clicking a pack → POST `/api/payments/checkout` with `{ pack: "popular" }`
2. On success → `window.location.href = checkout_url` (redirect to Stripe)
3. Loading state while waiting for checkout URL
4. Error handling if Stripe unavailable (show toast, don't crash)

### Frontend: Wire into InsufficientCreditsModal

Replace the disabled "Coming Soon: Purchase" button with a real "Buy Credits" button that opens `BuyCreditsModal`.

**Changes to `InsufficientCreditsModal`:**
- Add `onBuyCredits` prop (callback to open BuyCreditsModal)
- Replace disabled button with active `<Button onClick={onBuyCredits}>`
- Parent (ExportButtonContainer) manages state for showing BuyCreditsModal

### Frontend: Handle Return from Stripe

When user returns from Stripe checkout, the URL has `?payment=success` or `?payment=cancelled`.

**In App.jsx or a useEffect in the layout:**
- On `?payment=success`: `fetchCredits()` to refresh balance, show success toast, remove query param
- On `?payment=cancelled`: remove query param silently

### Frontend: Direct "Buy Credits" Access

Add a click handler on the `CreditBalance` pill in the header — clicking it opens BuyCreditsModal directly, so users can buy credits proactively (not just when they run out).

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/backend/app/routers/payments.py` | NEW | Checkout + webhook endpoints |
| `src/backend/app/routers/__init__.py` | MODIFY | Export payments_router |
| `src/backend/app/main.py` | MODIFY | Include payments_router |
| `src/backend/app/services/auth_db.py` | MODIFY | get/set stripe_customer_id helpers |
| `src/backend/requirements.txt` | MODIFY | Add `stripe` package |
| `src/frontend/src/components/BuyCreditsModal.jsx` | NEW | Pack selection UI |
| `src/frontend/src/components/InsufficientCreditsModal.jsx` | MODIFY | Wire "Buy Credits" button |
| `src/frontend/src/containers/ExportButtonContainer.jsx` | MODIFY | Add BuyCreditsModal state + handler |
| `src/frontend/src/components/CreditBalance.jsx` | MODIFY | Click to open BuyCreditsModal |
| `src/frontend/src/App.jsx` | MODIFY | Handle `?payment=success` return URL |

---

## Risks & Open Questions

### 1. Webhook Raw Body Access
**Risk:** FastAPI parses request body by default. Stripe webhook verification needs the raw bytes.
**Mitigation:** Use `request: Request` parameter and `await request.body()` — standard FastAPI pattern. Don't use a Pydantic model for the webhook endpoint.

### 2. Webhook Reaches Backend
**Risk:** On Fly.io, the webhook URL must be publicly accessible. The backend is behind CORS middleware.
**Mitigation:** CORS only affects browser requests. Stripe webhook POSTs are server-to-server — CORS headers are irrelevant. The webhook endpoint just needs to be reachable via the public Fly.io URL.

### 3. Idempotency
**Risk:** Stripe can send duplicate webhooks (retries on timeout).
**Mitigation:** Check `credit_transactions.reference_id = session.id` before granting. The `grant_credits` function already takes `reference_id`. Add an explicit check before calling it.

### 4. Race Condition on Checkout
**Risk:** User opens multiple checkout sessions, both complete.
**Mitigation:** Each session has a unique ID used as `reference_id`. Each successful payment grants credits independently — this is correct behavior (they paid twice, they get twice the credits).

### 5. Stripe Not Configured (Dev/Staging)
**Risk:** App crashes if Stripe env vars missing.
**Mitigation:** Guard both endpoints with `if not STRIPE_SECRET_KEY: raise HTTPException(503, "Payments not configured")`. App works without Stripe.

### 6. Success URL Timing
**Risk:** User returns to app before webhook fires → sees old balance.
**Mitigation:** On `?payment=success`, show a "Payment received! Updating balance..." message and poll `fetchCredits()` a few times with short delays. Webhook usually fires within seconds.
