# T5760: Stripe revenue reconciliation (Stripe as source of truth for money)

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-23
**Updated:** 2026-07-23

## Problem

User direction 2026-07-23 (day after Stripe go-live, T4940 Workstream C): "instead of double logging can our tools take from Stripe?"

Our analytics double-records revenue: every purchase increments `user_segments.total_spent_cents` in Postgres ([analytics.py:499](../../../src/backend/app/analytics.py#L499), called from all three fulfillment paths in [payments.py](../../../src/backend/app/routers/payments.py)). Stripe holds the authoritative record of the same money. The local copy exists for a good reason — admin views must not pay Stripe API latency/rate limits per page load — but nothing ever checks the two agree, and they WILL drift:

- **Refunds are not tracked at all.** `total_spent_cents` is increment-only; a refund issued from the Stripe dashboard silently leaves our number too high. Concretely: the go-live verification purchase (pi_3TwPFMIxob3dHqK044Ye5tgk, $3.99, 2026-07-23, imankh) may be refunded — that would create the first drift on day one.
- **Disputes/chargebacks** — same gap as refunds.
- **Partial fulfillment bugs** — a grant path that records the credit ledger but crashes before `increment_total_spent` (it's not atomic with the grant), or vice versa.
- **Pre-live test-mode noise** — test purchases before 2026-07-22 incremented `total_spent_cents` against fake money (arshia + imankh accounts). Live Stripe shows $0 for those; local shows > 0.

Decision already made with user (2026-07-23): **keep the local write for speed, treat Stripe as authority, reconcile instead of removing.** Do NOT replace local reads with live Stripe API calls in admin views. The milestone events (`payment_started`/`payment_completed`/`credit_purchased`) are product-funnel data joined against in-app events — Stripe cannot replace them; they are NOT in scope.

## Solution

A reconciliation pass that compares per-user Stripe truth against `user_segments.total_spent_cents`, surfaces drift in the admin tool, and offers an explicit heal action.

1. **Stripe truth builder** — paginate live-mode PaymentIntents (`status=succeeded`), group by `metadata.user_id` (every PI we create carries it; do NOT group by customer id — customers were wiped/recreated by user_db v007 and can churn again). Per user: `gross_cents = sum(amount_received)`, minus refunds via each PI's `latest_charge` (`amount_refunded`). Net = what `total_spent_cents` SHOULD be.
2. **Reconciliation report** — per user: local cents, stripe net cents, delta, classified cause where determinable (`refund`, `test_mode_era` (local > 0, zero live history, all local purchases pre-2026-07-22), `unknown`). Expose as `GET /api/admin/revenue-reconciliation` (admin-gated, on-demand — no cron; volume is tiny).
3. **Admin surface** — reconciliation panel/section in the admin tool: table of drifted users only, with an explicit per-user or all-users **"Adopt Stripe value"** heal button (`POST /api/admin/revenue-reconciliation/heal`) that sets `total_spent_cents` to the Stripe net figure. Heal is a deliberate admin gesture, never automatic (gesture-based persistence rule).
4. **Refund policy decision (with user, at kickoff):** does `total_spent_cents` mean gross-collected or net-of-refunds? Recommend NET (matches "how much has this user actually paid us"). Whichever is chosen, the reconciliation delta definition and heal both follow it.
5. **Optional hardening (same task, cheap):** handle `charge.refunded` in the existing webhook ([payments.py webhook](../../../src/backend/app/routers/payments.py)) to decrement at refund time — keeps steady-state drift near zero so reconciliation is a safety net, not a routine correction. Requires adding the event to the Stripe webhook endpoint config (dashboard, live mode — operator step, document it).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — `increment_total_spent` (~499); add decrement/set helpers
- `src/backend/app/routers/payments.py` — fulfillment paths that call `increment_total_spent`; webhook handler (for optional `charge.refunded`)
- `src/backend/app/routers/admin.py` — new reconciliation + heal endpoints (admin-gated, follow existing admin auth pattern)
- `src/frontend/src/components/admin/` — reconciliation panel (near UserTable revenue display)
- `src/backend/tests/` — reconciliation classification unit tests (mock Stripe responses)

### Related Tasks
- Epic: task 4/4 of [Monetization Pass](EPIC.md) (2026-07-24 restructure) — independent of the other three, lands last
- Grew out of: T4940 Workstream C (live-mode go-live, 2026-07-22/23)
- Related: T4870 (admin credit display), T4860 (bulk grants) — admin credit surfaces, read-only relation
- Related decision: prior test-mode credit GRANTS audit (open decision from T4940 — this task's `test_mode_era` classification supplies the data for it)

### Technical Notes
- **Stripe API:** `stripe.PaymentIntent.list(limit=100)` + auto-pagination; live mode only has real money (test-era PIs live in test mode, invisible to the live key — that's what makes `test_mode_era` classification work). Refunds: retrieve `latest_charge` per PI (`expand=['data.latest_charge']` to avoid N+1).
- **No schema change** — reads `user_segments.total_spent_cents` as-is. No Migration agent.
- **Rate limits:** volume is ~10 users / a handful of PIs; a full pass is a few API calls. Still paginate correctly.
- **Do not** store Stripe-derived aggregates in a new table (that would be a second duplicate); the report is computed on demand.
- Admin endpoint must not run on page load of the main user table — it's a separate on-demand panel (Stripe latency isolation, the reason the local column exists).

## Implementation

### Steps
1. [x] User gate: refund policy = NET of refunds AND lost disputes; `charge.refunded` webhook hardening included (resolved by supervisor at kickoff)
2. [x] Stripe truth builder + drift classifier (pure function over fetched data, unit-tested with fixtures)
3. [x] `GET /api/admin/revenue-reconciliation` + `POST .../heal` (explicit gesture)
4. [x] Admin panel UI (drifted users only, heal buttons)
5. [x] `charge.refunded` webhook branch + operator doc for adding the event in the Stripe dashboard
6. [ ] Verify on prod (supervisor/user): report shows imankh $3.99 aligned; test-mode-era drift classified for pre-go-live accounts

### Progress Log

**2026-07-23**: Task created from user direction after first live purchase verified end-to-end. Approach (local cache + Stripe-authoritative reconciliation, not live API reads) agreed in conversation.

**2026-07-25 (implemented, M-tier)**: Refund-policy gate resolved by supervisor at kickoff — `total_spent_cents` is **NET of refunds AND lost disputes/chargebacks** (Stripe Revenue Recognition standard); `charge.refunded` webhook hardening included.

- **Stripe truth builder + classifier** — `src/backend/app/services/revenue_reconciliation.py`. `build_stripe_net_by_user` + `classify_users` are PURE over fetched data (unit-tested with mocked Stripe; container has no live key). `net = Σ(amount_captured − amount_refunded − lost_dispute_amount)`, grouped by `metadata.user_id`. Lost dispute subtracted only when `dispute.status in {lost, charge_refunded}`; won/open never subtracted (open → `has_pending_dispute`). `DriftCause`: aligned → test_mode_era (pi_count==0 & local>0) → dispute → refund → unknown. `fetch_stripe_intents` auto-paginates with `expand=['data.latest_charge','data.latest_charge.dispute']`; status filtered client-side (`PaymentIntent.list` has no server-side status param — noted for the operator).
- **Endpoints** (admin.py, `_require_admin()` + `_require_stripe_configured()`): `GET /api/admin/revenue-reconciliation` (rows drifted-first + summary), `POST /api/admin/revenue-reconciliation/heal` (`{user_ids?|all_drifted}`; recomputes Stripe net server-side, sets `total_spent_cents` via new `analytics.set_total_spent`). Explicit gesture, never automatic. `list_users` load path unchanged — zero Stripe calls (asserted).
- **Webhook hardening**: `charge.refunded` branch in payments.py → `analytics.decrement_total_spent` (delta from newest refund; user_id via charge metadata then `PaymentIntent.retrieve`). `decrement_total_spent` floors at 0 with a WARNING.
- **Admin panel**: `src/frontend/src/components/admin/RevenueReconciliation.jsx` (drifted-only table, per-user + all "Adopt Stripe value" heal, confirm-gated). Collapsed section in AdminScreen — Stripe pass runs only on explicit click. Store: `fetchReconciliation` / `healReconciliation` in adminStore.js.
- **Tests**: `tests/test_revenue_reconciliation.py` — 25 tests, all green (classifier + endpoints + webhook). Full suite `test_revenue_reconciliation + test_admin + test_analytics` = 103 passed.

**Reviewer round (2026-07-25)**: fresh-context Reviewer raised two MAJORs; both addressed:
- **MAJOR (fixed)** — a dispute with status `charge_refunded` sets BOTH `amount_refunded` and the dispute amount for the same money, so `net = captured - refunded - lost_dispute` double-subtracted it (net went negative). Fixed in `build_stripe_net_by_user`: `lost_dispute = max(lost_dispute_raw - refunded, 0)` — a `charge_refunded` dispute nets to 0 (refund already counts it); a genuine lost dispute (refunded=0) still subtracts in full. Regression test `test_charge_refunded_dispute_not_double_subtracted`.
- **MAJOR (documented follow-up, not fixed by design)** — the `charge.refunded` decrement has no idempotency marker, so a Stripe redelivery double-decrements. A durable guard needs a new refund-ledger table, which T5760 explicitly forbids (no schema change). A double-decrement leaves local BELOW Stripe net, which the reconciliation pass detects (negative delta) and heal corrects — reconciliation is the stated safety net. Flagged in code + as a follow-up alongside dispute webhooks.
- **MINORs addressed**: heal now skips `user_ids` absent from the recomputed report instead of silently zeroing them; the per-user heal confirm warns when the user has an open dispute.

**OPERATOR STEP (prod, not done here)**: add `charge.refunded` to the **LIVE-mode** webhook endpoint in the Stripe dashboard (events are per-endpoint + per-mode) or the branch never fires. **Dispute webhooks + durable refund idempotency are deliberate follow-ups** — the on-demand pass is their safety net. **Prod verification (supervisor/user)**: run the report (imankh $3.99 should show aligned; pre-go-live accounts classified `test_mode_era`), then heal test_mode_era rows to zero.

## Acceptance Criteria

- [x] Reconciliation report lists per-user local vs Stripe-net revenue with delta + cause classification
- [x] Heal is an explicit admin gesture and sets local to Stripe truth per the agreed refund policy (net of refunds + lost disputes)
- [x] Main admin user table performance unchanged (no Stripe calls on its load path) — asserted in `test_list_users_makes_zero_stripe_calls`
- [x] Milestone events untouched (payment_started/payment_completed/credit_purchased unchanged)
- [x] `charge.refunded` webhook branch decrements at refund time (unit-tested)
- [ ] Prod run: current drift explained (test-mode era + any refunds), then healed to zero (supervisor/user step)
- [x] Tests pass (103 passed: reconciliation + admin + analytics)
