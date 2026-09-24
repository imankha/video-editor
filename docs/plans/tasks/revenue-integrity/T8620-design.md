# T8620 Design — Append-only payments ledger + Stripe backfill

**Epic:** Revenue Record Integrity (1/6) — see [EPIC.md](EPIC.md)
**Task:** [T8620-payments-ledger.md](T8620-payments-ledger.md)
**Status:** APPROVED 2026-09-24 (with rulings below). Implementation proceeds.
**Author:** Architect (amended per user ruling)
**Date:** 2026-09-24

This doc confirms/amends the schema in the task file, makes the open decisions the task
left to the gate explicit, and specifies contracts precisely enough that the implementor
adds no design judgement. Mechanical details (exact SQL text, param tuples) are left to
implementation except where the exact shape is load-bearing.

---

## Approved rulings (2026-09-24)

The user approved the design with these rulings on the six Open Questions. This section
is the authority; where a ruling changes a recommendation made in the body below, the body
has been amended in place and this list is the index of what changed.

1. **Dispute rows (§2b): approved as recommended.** No live dispute rows; backfill writes
   `dispute_lost` for terminal-lost disputes only; `dispute_won` is never a row. A live
   dispute webhook is a follow-up task — **the supervisor files it, not this task.**
2. **Append-only enforcement (§3): approved as recommended** — convention + review grep,
   DB trigger is T8630's job. **Amended scope:** the grep AC now permits exactly TWO
   in-place writes in the whole codebase: T8630's future `account_deleted_at` stamp, and
   ruling 5's `fill_missing_charge_id`. Nothing may ever `UPDATE`
   `amount_cents`/`kind`/`stripe_object_id`/`user_id`/`occurred_at`, and nothing may
   `DELETE` a row.
3. **`increment_total_spent` (§6): approved as recommended.** CRITICAL log on a zero-row
   match; never creates a `user_segments` row.
4. **Failure-mode + write-path (§4/§5): CHANGED from the architect's recommendation.** The
   architect's webhook-re-raise alternative was flagged as viable but was actually WRONG as
   stated: a Stripe redelivery re-enters `if result["applied"]:` as `False` (the grant
   already processed), so a ledger insert nested inside that gate is never retried by a
   redelivery regardless of whether the handler re-raises. The approved fix changes where
   the ledger insert sits, not just how failure is handled — see the rewritten §4/§5/§6
   below for the full mechanics. Summary:
   - The ledger insert runs on **every observation** of a succeeded/paid payment at all 4
     purchase sites — **not gated on `result["applied"]`.** The grant is unchanged (still
     first, still its own transaction). The unique `(stripe_object_id, kind)` key makes
     repeat observations idempotent no-ops.
   - The `total_spent` cache bump happens **only when the ledger insert returns `True`**
     (newly inserted), in the same transaction as the insert. The cache moves exactly once
     per money event. This also closes the refund double-decrement gap. The old
     applied-gated `increment_total_spent`/`decrement_total_spent` call sites are removed;
     the cache bump is now driven by the ledger insert result.
   - Ledger-insert failure: **webhook sites** (`checkout.session.completed`,
     `payment_intent.succeeded`, `charge.refunded`) log CRITICAL and **re-raise** so the
     webhook returns non-2xx and Stripe redelivers (this is now a REAL self-heal path,
     because the insert is no longer nested inside the one-shot `applied` gate). **User-facing
     sites** (`confirm-intent`, `verify_session`) log CRITICAL and **swallow**; the user
     still gets success.
   - The backfill writes ledger rows only and **never** touches the `total_spent` cache
     (historical payments are already reflected in it from when they first landed).
5. **`stripe_charge_id` (§2c): CHANGED from the architect's recommendation.** Populate it
   everywhere, including B/D (and A when `latest_charge` isn't expanded) — but
   **asynchronously**, via a background task scheduled after the ledger row's transaction
   commits, that retrieves the charge id from Stripe and runs exactly one whitelisted
   UPDATE (`fill_missing_charge_id`, the second permitted in-place write from ruling 2).
   Full mechanics in the new §4a below.
6. **Backfill guardrail (§7): approved as recommended.** Dry-run default, prints target
   host, non-dev `--write` requires an explicit operator-confirmation flag.

Operational carry-over stands: prod owes v026; `migrate-postgres` must run before any
staging/prod backfill.

## Round-2 amendments (2026-09-24, proof round 2)

The independent proof verifier returned MORE_PROOF_REQUIRED. These amendments correct
two design statements that the first implementation followed literally and that were
wrong on current Stripe API versions. Where they conflict with the body below (§2a
"decision 2a", §4 refund diagram), THIS section is the authority.

- **G3 — refund resolution no longer reads the webhook payload's `refunds`.** The body
  (decision 2a, §4 diagram) said to key the refund row on
  `charge["refunds"]["data"][0]["id"]`. That is unsound: on current Stripe API versions
  a `Charge` object does NOT embed `refunds` (default since API version 2022-11-15) and a
  webhook payload cannot expand it, and the codebase pins no API version. Reading the
  payload therefore wrote NO ledger row, logged CRITICAL, returned 200 (no redelivery),
  and stopped decrementing the cache — strictly worse than pre-T8620's `amount_refunded`
  fallback. **Corrected mechanism (implemented):** the `charge.refunded` branch fetches the
  authoritative list with `stripe.Refund.list(charge=<ch id>, limit=100).auto_paging_iter()`
  and records EACH money-moved refund idempotently, keyed on its own `re_...` id. Partial
  and repeated refunds are each their own row; a redelivery or a later `charge.refunded`
  self-heals any refund a prior delivery missed. If `Refund.list` fails, the branch logs
  CRITICAL and **re-raises** (webhook non-2xx → Stripe redelivers, ruling 4c). The dead
  `_latest_refund` / `_latest_refund_amount` helpers are deleted; the payload's `refunds`
  key, if present, is ignored.

- **Refund status rule.** Only refunds whose `status == "succeeded"` are recorded;
  `pending` / `failed` / `canceled` are skipped. This matches the reconciler
  (`revenue_reconciliation.build_stripe_net_by_user`), which nets on the charge's cumulative
  `amount_refunded` — a field Stripe advances only for succeeded refunds. The reconciler has
  no explicit per-refund status predicate, so `succeeded`-only is the faithful match; a
  pending refund is deliberately left for a later delivery to record once it settles. The
  backfill's `_refund_rows` applies the identical rule. There is no `LOST_DISPUTE`-style
  status set for refunds; the single literal `"succeeded"` lives at both the live site and
  the backfill.

- **G6 — `occurred_at` is Stripe's timestamp, never `now()`.** Every live write site now
  sets `occurred_at` from the Stripe object's own `created`: the PaymentIntent's `created`
  for purchases (sites A/C), the checkout Session's `created` for B/D, and each refund's
  own `created` for refund rows. `now()` at write time drifts from actual money-movement
  time and would reorder history relative to the backfill (which already used Stripe's
  timestamps). A missing `created` logs loudly and falls back to `now()` only so an
  otherwise-valid row is not dropped (`_stripe_ts` helper). The `has_processed_payment`
  early-return at `confirm-intent` / `verify_session` is kept as-is; recovery of a missed
  ledger row at those two user-facing sites depends on the webhook path (C), which is the
  self-healing site — the user-facing sites swallow on failure by design (ruling 4c).

---

## 1. Current state (the holes)

All line numbers verified against current master (2026-09-24).

**No per-payment financial record exists.** The only local revenue value is
`user_segments.total_spent_cents`, a single mutable counter per user
(`increment_total_spent`, `analytics.py:1201-1211`). `credit_transactions` carries the PI
id but is an *entitlement* ledger, purged with the account on delete (`auth.py:116`). A
deleted payer therefore erases real revenue from our books while Stripe keeps the charge
forever — proven on prod with `pi_3U7p5aIxob3dHqK01QfOa5qu` ($3.99, user
`fb40690a-edcf-4504-a51f-f9df6f84ac4f`, account fully purged).

**Four purchase write sites, all sourcing amount from the LOCAL pricing table, never from
Stripe's captured amount** (`payments.py`, each inside `if result["applied"]:`):

| Site | Endpoint / event | `increment_total_spent` line | Object in hand | Amount available |
|------|------------------|------------------------------|----------------|------------------|
| A | `confirm_payment_intent` (POST /confirm-intent) | 293 | full `PaymentIntent` (retrieved bare at 259, `latest_charge` NOT expanded) | `intent.amount_received` free; charge id / `amount_captured` need `expand=["latest_charge"]` |
| B | webhook `checkout.session.completed` | 361 | only the `CheckoutSession` | `session["amount_total"]` free; charge amount + charge id need a PI/Charge retrieve; `session["payment_intent"]` = PI id (not extracted) |
| C | webhook `payment_intent.succeeded` | 397 | PI from webhook payload | `intent["amount_received"]` free; `intent["latest_charge"]` is a bare id string |
| D | `verify_session` (POST /verify, legacy redirect + local-dev) | 562 | `CheckoutSession` (retrieved bare) | `session.amount_total` free; charge needs expansion; `session.payment_intent` = PI id (not extracted) |

Every site uses `increment_total_spent(user_id, pack_info["price_cents"])` — the
repricing-sensitive local table (`CREDIT_PACKS` in `pricing.py`), not what Stripe captured.

**Refund site** (`payments.py:440-454`): `decrement_total_spent` at 452. Object: the
`Charge` from the event. `_latest_refund_amount(charge)` (477) reads the newest
`charge["refunds"]["data"][0]["amount"]`, falling back to cumulative `amount_refunded`.
user_id via `_user_id_for_charge(charge)` (460). **Documented idempotency gap
(payments.py:434-439): no processed-marker; a Stripe redelivery double-decrements**,
leaving local *below* Stripe net, only caught by the on-demand reconciler.

**`increment_total_spent` can fail silently** (`analytics.py:1201-1211`): a bare `UPDATE
… WHERE user_id=%s` with **no rowcount check**, logging `"[Analytics] Incremented"`
unconditionally on any non-raising execute. A payer with no `user_segments` row (segment
rows are created only in OAuth/OTP signup) records nothing and still logs success.
`decrement_total_spent` (1214-1249) already early-returns with a `logger.warning` on a
missing row and floors at 0 with a warning — keep that behavior.

**No dispute record anywhere.** payments.py has no `charge.dispute.created/closed`
branch; disputes are only classified offline in `services/revenue_reconciliation.py`.
Webhook fall-through is `return {"status":"ignored"}`.

**Precedent for the atomic write:** `add_usage_seconds(cur, user_id, seconds)`
(`analytics.py:969`) takes an ALREADY-OPEN cursor and joins the caller's transaction,
bumping two tables atomically. This is the model for a ledger-insert +
`total_spent` update in one `get_pg()` block.

---

## 2. Target state + schema

### Recommended schema (amended from the task draft)

```sql
CREATE TABLE IF NOT EXISTS payments (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            TEXT        NOT NULL,   -- opaque UUID, NEVER an email or name
    kind               TEXT        NOT NULL,   -- 'purchase' | 'refund' | 'dispute_lost' | 'dispute_won'
    amount_cents       INTEGER     NOT NULL,   -- signed: purchase > 0; refund/dispute_lost < 0; dispute_won > 0
    currency           TEXT        NOT NULL DEFAULT 'usd',
    stripe_object_id   TEXT        NOT NULL,   -- see id-per-kind table below
    stripe_charge_id   TEXT,                   -- ch_... when known (correlation across kinds)
    pack               TEXT,                   -- 'starter' | 'popular' | 'best_value' | NULL
    credits            INTEGER,                -- credits sold, purchase row only
    occurred_at        TIMESTAMPTZ NOT NULL,   -- Stripe's timestamp, not ours
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    source             TEXT        NOT NULL,   -- 'confirm_intent' | 'webhook' | 'verify' | 'backfill'
    account_deleted_at TIMESTAMPTZ             -- reserved for T8630; never filters revenue
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_object_kind
    ON payments(stripe_object_id, kind);
CREATE INDEX IF NOT EXISTS idx_payments_user
    ON payments(user_id, occurred_at DESC);
```

**Column-by-column verdict vs the draft:**

| Column | Verdict | Note |
|--------|---------|------|
| `id BIGSERIAL PK` | **keep** | Surrogate key; ordering/pagination. |
| `user_id TEXT NOT NULL` | **keep** | No FK to `users` — the whole point is the row outlives the user row (same reasoning as `upload_failures`/`credits`, which also carry no FK). Non-nullable: every money event we record has a resolvable user_id at write time; if we cannot resolve one we do not write a row (matches the refund branch, which already bails when `_user_id_for_charge` returns None). |
| `kind TEXT NOT NULL` | **keep** | Closed vocabulary, validated by the writer (see §type-safety). |
| `amount_cents INTEGER NOT NULL` | **keep**, sign convention below | INTEGER is fine (max Stripe cents << 2^31). |
| `currency TEXT NOT NULL DEFAULT 'usd'` | **keep** | Store the Stripe object's currency; do not assume usd at the write site. |
| `stripe_object_id TEXT NOT NULL` | **keep**, id-per-kind pinned below | |
| `stripe_charge_id TEXT` | **keep** | Nullable correlation field: the `ch_...` a purchase captured / a refund/dispute belongs to. Lets a human tie a refund row to its purchase row without a Stripe call. Not part of the unique key. |
| `pack TEXT` | **keep**, nullable | Metadata only. NULL is legal (historical PI without `metadata.pack`; refund/dispute rows). |
| `credits INTEGER` | **keep**, nullable | Purchase rows only; NULL on refund/dispute. |
| `occurred_at TIMESTAMPTZ NOT NULL` | **keep** | Stripe's event/charge timestamp. |
| `recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()` | **keep** | Our insert time. |
| `source TEXT NOT NULL` | **keep**, expand vocabulary | Draft listed `'confirm_intent'|'webhook'|'backfill'`; add `'verify'` so site D is distinguishable from the webhook. Closed vocabulary. |
| `account_deleted_at TIMESTAMPTZ` | **keep, reserved** | Written by nothing in T8620. See §3 and the forward-reference risk. |

**Two indexes confirmed:** unique `(stripe_object_id, kind)` (idempotency) and
`(user_id, occurred_at DESC)` (per-user revenue read). No others in this task.

### Open decision 2a — `stripe_object_id` per kind (idempotency key)

The unique key is `(stripe_object_id, kind)`. The id chosen must (i) be present/derivable
at the write site, (ii) make a Stripe **redelivery of the same event** a no-op, and (iii)
not collide across kinds for the same money movement. Pinned choices:

| kind | `stripe_object_id` | Rationale / availability |
|------|--------------------|--------------------------|
| `purchase` | **`pi_...`** (PaymentIntent id) | One PI == one purchase. All four sites can produce the PI id: A/C have it directly; B/D have it as `session["payment_intent"]` (must be **extracted** — currently unused). Keying on the PI (not the session) means the redirect `verify` path (D) and the `checkout.session.completed` webhook (B) for the *same* purchase collide on the same row — correct, they are the same money. Keying on the session would let B and D both insert. |
| `refund` | **`re_...`** (individual Refund id) | Keys on the specific refund, so partial + repeated refunds each get their own row and a redelivery of one refund is a no-op. **This requires extracting the refund id, which the branch does NOT do today** (it only reads the amount). The design REQUIRES adding that extraction: `charge["refunds"]["data"][0]["id"]` (same element `_latest_refund_amount` already reads). Keying on `ch_...` would collapse a second partial refund of the same charge into a conflict and lose it — unacceptable for a ledger. |
| `dispute_lost` / `dispute_won` | **`dp_...`** (Dispute id) | One dispute per row. **Deferred** — see 2b; the column vocabulary reserves these but T8620 writes no dispute rows except via backfill of already-final disputes (see below). |

Because `kind` is part of the key, a `pi_...` purchase and a hypothetical future row
carrying the same string in a different kind cannot collide. In practice each kind uses a
distinct id prefix, so cross-kind collision is impossible regardless.

### Open decision 2b — dispute rows: in-scope or deferred?

**Recommendation: DEFER live dispute-row writing to a later task; reserve the `kind`
values now; and let the BACKFILL write dispute rows for disputes that are already final in
Stripe.** Reasoning:

- There is **no dispute webhook branch today**. Adding `charge.dispute.created/closed`
  handling — with its lifecycle (open → won/lost), its own idempotency, and its
  interaction with the refund path — is a meaningfully separate change with its own tests.
  Bundling it here widens the diff past the task's intent (the task's write-path section
  names only the 4 purchase sites + the 1 refund site).
- `SUM(amount_cents)` correctness consequence, stated explicitly:
  - **A lost dispute is economically a refund** (Stripe pulls the funds). If we write no
    `dispute_lost` row and no offsetting row, then for a disputed-and-lost charge the
    ledger `SUM` will be **higher than Stripe net** by the dispute amount. This is a
    *known, bounded* gap, and it is exactly what the reconciler is for (it already
    computes dispute amounts offline via `_dispute_amounts`). So live dispute drift is
    detectable, not silent.
  - `dispute_won`: **needs no row.** A won dispute leaves the funds with us; the original
    `purchase` row already reflects that money. `dispute_won` is the *absence* of a
    `dispute_lost` row, not a positive posting. We reserve the `kind` value only so a
    future task can record the *event* for audit/history if desired; it must be written
    with `amount_cents = 0` if ever recorded, so it never affects `SUM`. **For T8620 we
    write no `dispute_won` rows at all.**
- **Backfill does cover final disputes.** `fetch_stripe_intents` expands
  `latest_charge.dispute` (status + amount). For a charge whose dispute is already in a
  terminal LOST status at backfill time, the backfill writes a `dispute_lost` row
  (negative) so historical `SUM(amount_cents)` matches Stripe net on day one. A terminal
  WON or still-open dispute writes no dispute row. This keeps the AC "`SUM(amount_cents)`
  per user equals the Stripe net the reconciler computes" true for history without
  building the live webhook.

Net: T8620 ships `purchase` + `refund` live writes and `purchase` + `refund` +
(terminal) `dispute_lost` backfill writes. Live dispute webhooks are a follow-up
(candidate: fold into T8640 reconciliation work or a dedicated task).

### Open decision 2c — `amount_cents` sign + per-site source

**Sign convention:** money **in** to us is **positive**, money **out** is **negative**.

- `purchase`: `+amount` (captured).
- `refund`: `-refund_amount` (the individual refund's amount).
- `dispute_lost`: `-dispute_amount`.
- `dispute_won` (never written in T8620): would be `0`.

Then **net revenue for a user is `SUM(amount_cents)`**, derivable at any time, and the AC
compares it directly to the reconciler's Stripe net.

**Amount SOURCE per site — record the Stripe-CAPTURED amount, not the pack price.** The
pack price is repricing-sensitive (`pricing.json`/`CREDIT_PACKS`; changed once in T4940);
the ledger must record what was actually charged. Decisions:

| Site | Captured amount source | Extra Stripe call? |
|------|------------------------|--------------------|
| A `confirm-intent` | `intent.amount_received` (already in hand at 259) | **No.** Free. For `stripe_charge_id` we can read `intent.latest_charge` — but it is a bare id here (not expanded), which is fine: we store the id, we do not need the charge object. |
| C webhook `payment_intent.succeeded` | `intent["amount_received"]` (in the payload) | **No.** Free. `intent["latest_charge"]` (bare id) → `stripe_charge_id`. |
| B webhook `checkout.session.completed` | **`session["amount_total"]`** is present and is the captured total for a completed checkout. | **No extra call needed for the amount.** `session["payment_intent"]` gives the PI id for `stripe_object_id` (extract it). `stripe_charge_id` is not directly on the session; leave it NULL here (correlation still possible via the PI). **Decision: do NOT add a retrieve on B** — `amount_total` on a completed session is the captured amount, so a retrieve buys only the charge id, which is optional. |
| D `verify_session` | **`session.amount_total`** (session retrieved bare at 530). | **No extra call needed for the amount** — same as B. `session.payment_intent` → PI id (extract it). `stripe_charge_id` NULL. |

**Why not expand/retrieve on B/D for `amount_captured`?** The task hint suggested B/D may
need an expand/retrieve for the true charge amount. On review, `checkout.Session.amount_total`
IS the captured total for a `payment_status == "paid"` / `completed` session (partial
captures are not used in this product — a single full capture per PI), so `amount_total`
equals `amount_received` equals the captured amount. Adding a SYNCHRONOUS retrieve would
cost a Stripe round-trip on every purchase and is not needed for the amount.

**`stripe_charge_id` — RULING 5 (changed from the architect's recommendation).** The
architect's original recommendation was to leave it NULL on B/D. The user ruled instead to
populate it everywhere, but asynchronously so it can never block or fail the payment: insert
the row with `stripe_charge_id = NULL` where not already in hand, then schedule a background
task (after the transaction commits) that retrieves the charge id from Stripe and fills it
via a single whitelisted UPDATE (`payments_ledger.fill_missing_charge_id`). See §4a.

> Guard: if a site ever finds `amount_received`/`amount_total` is `None`/`0` on an
> otherwise-applied purchase, that is an internal inconsistency (we only reach the applied
> branch after a succeeded/paid check). Per the no-silent-fallback rule, log CRITICAL and
> **do not** silently substitute the pack price; still insert nothing rather than a wrong
> amount. (This is an edge that should never fire; it must be loud if it does.)

---

## 3. Append-only enforcement

**Recommendation: code-level convention in T8620, NO Postgres trigger / REVOKE in this
task.** Enforce append-only by construction and by the grep AC; defer any DB-level guard.

Weighing the DB-level options:

- **Blanket `REVOKE UPDATE, DELETE`** is **too broad**: design decision 4 (T8630) needs
  exactly ONE permitted in-place write — the `account_deleted_at` stamp. A blanket revoke
  would break T8630. Rejected.
- **A trigger that raises on `UPDATE OF amount_cents` (and `DELETE`)** while allowing an
  `account_deleted_at`-only update is *possible*, but it **couples T8620 to T8630's
  column semantics** now, before T8630's stamp contract is designed and approved. It also
  needs its own migration + tests here for a guard whose one legitimate exception does not
  yet exist. That is premature.
- **Application role** in this codebase is a single connection string (`DATABASE_URL`);
  there is no separate low-privilege writer role to REVOKE against without new infra.

**Chosen:** the ledger is append-only by the fact that the only writers introduced
(`payments_ledger.record_*` + the backfill) issue INSERT … ON CONFLICT DO NOTHING, plus
exactly ONE whitelisted metadata-only UPDATE (`fill_missing_charge_id`, ruling 5 — see
§4a). The reviewer verifies (grep AC): **no `UPDATE payments` exists anywhere in the
codebase except the single `fill_missing_charge_id` statement, and no `DELETE FROM
payments` exists anywhere.** A DB-level immutability guard is a natural item for T8630 (or
a later hardening task) to add *together with* its `account_deleted_at` exception; **its
trigger allow-list must include BOTH permitted in-place writes** —
`account_deleted_at` (T8630) and `stripe_charge_id` via `fill_missing_charge_id` (T8620,
ruling 5) — so a future DB-level guard does not itself break this task's background fill.

**Ruling 2 (amended scope):** the grep AC now permits exactly TWO in-place writes in the
whole codebase: T8630's future `account_deleted_at` stamp, and this task's
`fill_missing_charge_id`. Nothing may ever `UPDATE` `amount_cents` / `kind` /
`stripe_object_id` / `user_id` / `occurred_at`, and nothing may `DELETE` a row — that
remains absolute.

The grep AC holds and is the enforcement mechanism this task ships:
> No code path updates `amount_cents`/`kind`/`stripe_object_id`/`user_id`/`occurred_at` or
> deletes a `payments` row; the only UPDATE statement touching `payments` is the single
> `fill_missing_charge_id` function, which sets `stripe_charge_id` alone, gated on
> `stripe_charge_id IS NULL` (grep-verified in review).

---

## 4. The write path (AMENDED per ruling 4)

**The ledger insert is NOT gated on `result["applied"]`.** It runs on every observation of
a succeeded/paid payment — including a redelivery where `applied` is `False` because the
grant already processed. This is the mechanical fix behind ruling 4: nesting the insert
inside the one-shot `applied` gate (the original recommendation) made a redelivered event,
which is exactly when a prior ledger write is most likely to have failed, unable to ever
retry the insert. Moving the insert above/outside that gate makes the unique
`(stripe_object_id, kind)` key the ONLY thing standing between "every observation" and
"every event" — which is precisely idempotency, so this is safe.

### Diagram

```
purchase (sites A/C free amount; B/D read session.amount_total):

  gesture / webhook event
        │
        ▼
  _grant_or_503(...)            ← credits granted here (its OWN Postgres write,
        │                          credits/credit_transactions; UNCHANGED, still gated
        │                          on its own idempotency, e.g. has_processed_payment)
        ▼
  on EVERY observation of a succeeded/paid payment (NOT gated on result["applied"]):
        │
        ▼
  with get_pg() as conn:
      cur = conn.cursor()
      inserted = payments_ledger.record_purchase(cur, ...)  # INSERT … ON CONFLICT DO NOTHING
      if inserted:
          payments_ledger.bump_total_spent(cur, user_id, amount_cents)   # §6, same txn
      # else: redelivery / already observed — cache already bumped the first time, skip
  # single transaction: ledger insert + conditional cache bump commit/rollback together
        │
        ▼
  if stripe_charge_id not already in hand:
      schedule_background(fill_missing_charge_id, pi_id)   # §4a, AFTER commit, never blocks

refund (charge.refunded branch):

  webhook charge.refunded
        │
        ▼
  user_id = _user_id_for_charge(charge)   (bail if None)
  refund_cents, refund_id = _latest_refund(charge)   ← now also extract re_... id
        │
        ▼
  with get_pg() as conn:
      cur = conn.cursor()
      inserted = payments_ledger.record_refund(cur, ..., amount_cents=-refund_cents, re_id)
      if inserted:
          payments_ledger.bump_total_spent(cur, user_id, -refund_cents)   # §6, same txn
      # else: redelivered refund — already decremented once, skip (closes the double-decrement gap)
```

### `services/payments_ledger.py` helper signatures

Modeled on `add_usage_seconds(cur, …)`: take an ALREADY-OPEN cursor so the insert joins
the caller's transaction (no extra round-trip, atomic with the cache bump).

```python
def record_purchase(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,   # pi_...
    amount_cents: int,       # > 0, captured
    currency: str,
    stripe_charge_id: str | None,   # None if not in hand synchronously; see fill_missing_charge_id
    pack: str | None,
    credits: int | None,
    occurred_at,             # datetime from Stripe (int epoch → tz-aware)
    source: str,             # 'confirm_intent' | 'webhook' | 'verify' | 'backfill'
) -> bool: ...               # True if a row was inserted, False if ON CONFLICT no-op

def record_refund(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,   # re_...
    amount_cents: int,       # < 0
    currency: str,
    stripe_charge_id: str | None,   # ch_... the refund belongs to
    occurred_at,
    source: str,
) -> bool: ...

# used by the backfill only in T8620 (no live dispute webhook):
def record_dispute_lost(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,   # dp_...
    amount_cents: int,       # < 0
    currency: str,
    stripe_charge_id: str | None,
    occurred_at,
    source: str = "backfill",
) -> bool: ...

def bump_total_spent(cur, user_id: str, amount_cents: int) -> None: ...
    # thin cursor-taking wrapper: the existing UPDATE body of increment_total_spent (amount_cents
    # > 0) or decrement_total_spent (amount_cents < 0, floors at 0), called ONLY when the caller's
    # record_* just returned True. Joins the caller's open transaction. See §6.

def fill_missing_charge_id(cur, *, stripe_object_id: str, stripe_charge_id: str) -> bool: ...
    # THE ONLY UPDATE statement this module (or anything else) issues against `payments`.
    # UPDATE payments SET stripe_charge_id = %s
    #   WHERE stripe_object_id = %s AND kind = 'purchase' AND stripe_charge_id IS NULL
    # Returns True if it changed a row. See §4a.
```

Each `record_*` helper issues exactly one `INSERT INTO payments (...) VALUES (...) ON
CONFLICT (stripe_object_id, kind) DO NOTHING`, setting `kind` itself, and returns whether a
row was written (`cur.rowcount == 1`). `kind`/`source` values are validated against a
closed `str, Enum` (type-safety skill) so a typo can't create a new vocabulary silently.

### Call sites (5)

| Site | File / line (current) | Helper | `source` | Gated on `applied`? |
|------|-----------------------|--------|----------|---------------------|
| A | payments.py ~293 | `record_purchase` | `'confirm_intent'` | **No** — every observation |
| B | payments.py ~361 | `record_purchase` | `'webhook'` | **No** — every observation |
| C | payments.py ~397 | `record_purchase` | `'webhook'` | **No** — every observation |
| D | payments.py ~562 | `record_purchase` | `'verify'` | **No** — every observation |
| Refund | payments.py ~452 | `record_refund` | `'webhook'` | **No** — every observation |

The grant (`_grant_or_503`, credits/`credit_transactions`) is UNCHANGED — still its own
transaction, still gated on its own idempotency. Only the ledger-insert-plus-cache-bump
block moves outside the `applied` gate.

**`increment_total_spent` / `decrement_total_spent` are REMOVED as standalone applied-gated
call sites.** Their UPDATE bodies survive as `bump_total_spent(cur, ...)`, called only when
`record_purchase`/`record_refund` returns `True`, inside the SAME transaction as the
insert. See §6.

### "0 rows inserted = success" contract

`ON CONFLICT DO NOTHING` returns `rowcount == 0` when the row already exists (a redelivery,
or the B/D-vs-webhook overlap for the same PI). **This is a SUCCESSFUL no-op, not an
error**, AND it is now also the signal that the cache was already bumped — so `inserted ==
False` means "do nothing further," not just "don't error." The helper returns `False`; the
caller logs at INFO ("ledger row already present, skipping") and proceeds normally. It must
never raise, never retry, never treat 0 as a failure. This is the durable idempotency the
refund branch was documented as lacking, and it now also closes the "does the cache bump
exactly once" question directly — the cache moves if and only if the row was new.

---

## 4a. `stripe_charge_id` background fill (ruling 5)

**Populate `stripe_charge_id` everywhere, but never synchronously and never in a way that
can affect the payment.** Where the charge id is already in hand at insert time (C's
`intent["latest_charge"]`, the refund's charge id), set it directly on the INSERT — no
background task needed there. Where it is NOT in hand (B, D, and A when `latest_charge`
isn't expanded), insert with `stripe_charge_id = NULL` and schedule a background fill:

1. **After** the ledger row's transaction has committed (never inside it — the background
   task must not be able to delay or fail the response), schedule a task that retrieves the
   PaymentIntent's `latest_charge` id from Stripe. Use the codebase's existing pattern for
   post-response work: FastAPI `BackgroundTasks` on the request where the site has a
   `Request`/`Response` in scope (sites A/D, user-facing HTTP handlers); for the webhook
   sites (B), which return a plain dict from a handler without a `BackgroundTasks`
   parameter threaded through, use the same `run_in_context`/fire-and-forget idiom already
   established for other post-response Stripe/email work in this router (see
   `poster_warmer.fire_and_forget` precedent noted in backend-services.md's T7670 entry) —
   the implementor picks whichever of these two the site already has wired and names it in
   the PR description; do not introduce a third mechanism.
2. The task calls `stripe.PaymentIntent.retrieve(pi_id, expand=["latest_charge"])` (or
   equivalent) and, if a charge id is returned, calls
   `payments_ledger.fill_missing_charge_id(cur, stripe_object_id=pi_id, stripe_charge_id=ch_id)`
   in its own `get_pg()` block.
3. **The whole background block is wrapped in try/except:** any exception (Stripe error,
   DB error, timeout) is `logger.warning`/`logger.exception` with the PI id and the block
   simply ends. **Never raises, never retries, never touches any other column.**
4. `fill_missing_charge_id` runs EXACTLY:
   ```sql
   UPDATE payments SET stripe_charge_id = %s
     WHERE stripe_object_id = %s AND kind = 'purchase' AND stripe_charge_id IS NULL
   ```
   Gated on `stripe_charge_id IS NULL` so it is naturally idempotent (a second run, or a
   race with a synchronous set, is a no-op) and it can NEVER touch `amount_cents`, `kind`,
   `user_id`, `stripe_object_id`, or `occurred_at` — it is syntactically incapable of it,
   which is what makes this the one grep-whitelisted exception to append-only (§3, ruling
   2).
5. **The backfill script also calls `fill_missing_charge_id`** for any existing row where
   `stripe_charge_id IS NULL` (§7) — same function, same guarantee, one code path for both
   the live background fill and the backfill's own charge-id completion.

This is the second of exactly two permitted in-place writes in the whole codebase (the
first is T8630's future `account_deleted_at` stamp). Both must be named in T8630's
DB-trigger allow-list if/when that trigger is built.

---

## 5. Failure-mode design (AMENDED per ruling 4)

**Transaction boundaries:**

- The **credit grant** (`_grant_or_503` → `credits`/`credit_transactions`) happens FIRST,
  in its own Postgres transaction, gated on its own idempotency, and is **already
  committed** by the time the ledger-insert block runs. The ledger is **not** coupled to
  the grant service (EPIC decision: credits and money are separate ledgers on purpose) —
  this is unchanged by ruling 4; only WHERE the ledger block sits relative to `applied`
  changed, not its relationship to the grant.
- The **ledger insert and the conditional `total_spent` cache bump** run together in ONE
  `get_pg()` transaction (§4 diagram). They commit or roll back as a unit, so the cache can
  never move without a matching new ledger row, and vice versa.

**If the ledger insert raises** (e.g. Postgres unavailable mid-request), the failure must
be **LOUD: `logger.critical`** with the PI/charge id, user_id, amount, and kind — alertable,
and the row is reconstructable (the backfill re-derives it from Stripe, which remains
source of truth). The ledger failure must **NEVER undo or affect the credit grant** — the
grant already committed in its own transaction before the ledger block runs, so there is
nothing to undo; the transaction structure guarantees this by construction, not by a
try/except discipline.

**Does a ledger failure fail the HTTP response / re-raise? RULING 4c — split by site type,
now that the insert is no longer nested inside the one-shot `applied` gate:**

- **Webhook sites** (`checkout.session.completed`, `payment_intent.succeeded`,
  `charge.refunded`): log CRITICAL and **RE-RAISE**, so the webhook handler returns
  non-2xx and Stripe redelivers. This is now a genuine, working self-heal path — because
  the ledger insert runs on every observation (not gated on `applied`), a redelivery WILL
  re-attempt the insert, and `ON CONFLICT DO NOTHING` makes a redelivery of an event whose
  ledger write actually succeeded a safe no-op. (This is the exact mechanism ruling 4 fixes:
  under the original applied-gated design, re-raising bought nothing on redelivery because
  the redelivery's `applied` was `False` and never reached the insert at all.)
- **User-facing sites** (`confirm_payment_intent`, `verify_session`): log CRITICAL and
  **SWALLOW** — the endpoint still returns its normal success. A paying user must never see
  an error for a payment that actually succeeded and was fulfilled; there is no
  "redelivery" concept on these HTTP endpoints for the ledger write to retry via, so
  re-raising here would only produce user-visible pain with no compensating self-heal.
  Recovery for a persistent failure at these two sites is the backfill.

This resolves the tension the architect's original recommendation flagged (redelivery vs.
retry-loop noise) by making redelivery an actually-functional recovery path for the three
webhook sites, while keeping the two user-facing sites failure-transparent to the payer.

---

## 6. `increment_total_spent` / cache-bump fix (AMENDED per ruling 4b, ruling 3 unchanged)

**Ruling 3, unchanged: rowcount-CRITICAL, NOT upsert.** The upsert (`INSERT … ON CONFLICT
(user_id) DO UPDATE SET total_spent_cents = total_spent_cents + excluded…`) would *create* a
bare `user_segments` row for a payer who has none. Rejected because:

- `user_segments` carries more than `total_spent_cents` (segmentation/attribution columns,
  populated during the OAuth/OTP signup flow). A bare row created from the payment path
  would have defaulted/empty segmentation, which other analytics/admin queries read (the
  admin LEFT JOIN note exists precisely because segment-less users are a real, expected
  state). Manufacturing a half-populated row from the payment path risks polluting those
  reads and inventing a signup-shaped record that never had a signup. The single-source
  rule says don't create canonical rows from a side path.
- The **ledger** (this task's whole point) is now the durable financial record. The
  `total_spent_cents` cache being un-bumped for a segment-less payer is no longer a data
  loss — the `payments` row captured the money. So the cache write only needs to be
  *honest about missing*, not to self-repair.

**Ruling 4b, changed shape: the cache bump is no longer a standalone applied-gated call.**
`increment_total_spent(user_id, amount_cents)` and `decrement_total_spent(user_id,
amount_cents)` as free functions called from `payments.py` are **removed**. Their UPDATE
bodies move into `payments_ledger.bump_total_spent(cur, user_id, amount_cents)` (§4), a
cursor-taking helper called ONLY when `record_purchase`/`record_refund` just returned
`True`, inside that same `get_pg()` transaction:

- Execute the existing `UPDATE … WHERE user_id=%s` (adding for a negative `amount_cents`
  the existing `decrement_total_spent` floor-at-0 behavior: read current, floor the new
  value at 0, warn if the refund exceeded recorded spend).
- If `cur.rowcount == 0` on the UPDATE (no `user_segments` row): `logger.critical`
  ("[Analytics] bump_total_spent matched no user_segments row: user=%s amount_cents=%s —
  payment recorded in payments ledger, cache not updated"). **Do NOT raise** — the
  ledger insert already committed (or will, in the same transaction) regardless; only the
  cache is affected. The success `INFO` line only logs when `rowcount == 1`.
- The refund floor-at-0 warning behavior is preserved exactly (`decrement_total_spent`'s
  existing logic), now living inside `bump_total_spent` for the negative-amount case.

**Because the cache bump is now conditional on `inserted == True`, the redelivery/double-
decrement problem is structurally closed**: a redelivered purchase or refund event never
reaches `bump_total_spent` at all (its `record_*` call returns `False`), so the cache can
never move twice for the same money event. This is a direct, load-bearing consequence of
ruling 4a — the cache bump was moved from "the `applied` gate ran" to "the ledger row was
NEW," and those are no longer the same condition in this design.

This satisfies the AC ("logs CRITICAL instead of a success line") without the risk of
minting bare segment rows, and closes the refund idempotency gap as a side effect of the
same mechanism, not a separate fix.

---

## 7. Backfill script shape

`scripts/backfill_payments_ledger.py` — standalone, dry-run by default, idempotent.

**CLI + env selection (reuse the project convention):** mirror `scripts/reset-test-user.py`:
`--env {dev,staging,prod}` (required), loading `.env` / `.env.{env}` and connecting via
`DATABASE_URL` (`psycopg2.connect(config["DATABASE_URL"], RealDictCursor)`). Add
`--write` (default off → dry run). Get Stripe from the loaded `STRIPE_SECRET_KEY` (set
`stripe.api_key` from it, same key `fetch_stripe_intents` relies on process-wide). **Test
vs live is purely which key/env is loaded** — no code-level mode switch (matches
`fetch_stripe_intents`).

**Iteration:** call `fetch_stripe_intents()` (auto-paginates PIs with
`expand=["data.latest_charge","data.latest_charge.dispute"]`). Per PI:

1. **Purchase row** for every `status == "succeeded"` PI:
   - `stripe_object_id = pi id`, `amount_cents = amount_received` (captured), `currency`,
     `stripe_charge_id = latest_charge.id` (expanded), `occurred_at = created`,
     `user_id = metadata.user_id`, `source = 'backfill'`.
   - `pack`/`credits` from `metadata` **if present** (historical PIs may lack them — the
     audit flags this; when absent, insert with `pack=NULL, credits=NULL`, do NOT
     back-derive from the amount). Confirm presence before relying; a missing user_id on a
     succeeded PI is logged and skipped (can't key the row to a user).
2. **Refund rows** from the expanded charge: `fetch_stripe_intents` exposes cumulative
   `amount_refunded` but **not** the per-refund list. For backfill we need individual
   `re_...` ids to key rows. **Decision:** the backfill retrieves the charge's refund list
   (`stripe.Refund.list(charge=ch_id)` or a charge retrieve with `expand=["refunds"]`) for
   any charge with `amount_refunded > 0`, and writes one negative `refund` row per
   `re_...`. This keeps backfilled refund rows on the SAME idempotency key
   (`re_...`, `refund`) the live path uses, so live + backfill converge with no dupes.
3. **Dispute row** (terminal LOST only, per §2b): if the expanded
   `latest_charge.dispute` is in a LOST terminal status, write one negative `dispute_lost`
   row keyed `(dp_..., 'dispute_lost')`. WON/open → no row.

**Idempotency:** every insert is the same `record_*` helper (ON CONFLICT DO NOTHING), so a
re-run inserts only genuinely new rows. Re-runnable safely by construction (AC).

**Ruling 4d — the backfill NEVER touches `total_spent_cents`.** Every historical payment
the backfill inserts is already reflected in the cache from when it first happened live
(or, for genuinely pre-cache-era history, the cache was never going to include it and the
ledger is now the correct place to look — see EPIC decision 5, the cache stops being the
source for aggregates). The backfill calls only `record_purchase` / `record_refund` /
`record_dispute_lost`; it never calls `bump_total_spent`. This also means the backfill has
no `applied`-vs-`inserted` distinction to worry about — it simply writes rows.

**Ruling 5 — the backfill also fills `stripe_charge_id`.** After the row-insert pass, for
any `payments` row (live-written or just backfilled) where `stripe_charge_id IS NULL`, the
backfill calls the SAME `payments_ledger.fill_missing_charge_id(cur, stripe_object_id=pi_id,
stripe_charge_id=ch_id)` used by the live background fill (§4a), sourcing `ch_id` from the
already-fetched `latest_charge.id` (no extra Stripe call needed here, since
`fetch_stripe_intents` already expands it). One code path, one guarantee, for both the live
async fill and the backfill's completion pass.

**Output:** dry run prints, per would-be row: kind, user_id, amount, stripe_object_id, and
whether it already exists (a cheap pre-check SELECT, or infer from a post-`--write`
rowcount), plus a count of `stripe_charge_id` fills that would happen. `--write` prints a
summary: rows inserted / skipped-existing per kind, charge-ids filled, and total net
`SUM(amount_cents)` compared against the reconciler's Stripe net as a built-in sanity check.

**The 2026-08-24 orphan is in scope and is the point:** `pi_3U7p5aIxob3dHqK01QfOa5qu`,
user_id `fb40690a-edcf-4504-a51f-f9df6f84ac4f` backfills into a `payments` row whose
`user_id` matches **no** `users` row. Because `payments.user_id` has **no FK**, this
inserts cleanly. That row with no matching user IS the tombstone working as designed — not
an error, not something to skip. The backfill must not filter rows by "user exists".

**Operator guardrail (must be in the script):** `--write` against a non-dev `--env` is an
**operator step, never run from the container.** The script refuses `--write` when
`--env != dev` unless an explicit `--i-am-the-operator` (or equivalent) confirmation flag
is passed, and prints the intended DB host so the operator can confirm. Staging then prod,
in that order, as a human-driven step after deploy + migration. (Dry-run against any env is
always allowed.)

---

## 8. Migration + DDL

**New migration `v030_payments_ledger.py`** (v030 is free — verified on master + all three
remote feature branches, no collision):

- `class V030PaymentsLedger(BaseMigration)`, `version = 30`, `description = "T8620:
  append-only payments ledger — one row per money event (purchase/refund/dispute), never
  updated or deleted; Stripe-captured amounts; pseudonymous (user_id only)."`
- `up(self, conn)`: `cur = conn.cursor()`; execute the exact `CREATE TABLE IF NOT EXISTS
  payments (...)` + the two `CREATE … INDEX IF NOT EXISTS` from §2.
- Register in `migrations/postgres/__init__.py`: import `V030PaymentsLedger`, append to
  `MIGRATIONS`. `RUNNER = MigrationRunner(MIGRATIONS, floor=0)` stays (postgres is floor=0
  forever).

**Mirror into `_SCHEMA_DDL`** (`services/pg.py`): add the identical `CREATE TABLE IF NOT
EXISTS payments (...)` + both indexes so fresh deploys get the table. Follow the v029
convention already documented in that file ("the two texts must match"): add a comment
naming `payments_ledger.py` as the sole writer and pointing at
`migrations/postgres/v030_payments_ledger.py`. **The DDL text in the migration and in
`_SCHEMA_DDL` must be byte-for-byte identical** (reviewer checks this).

**Operator step (postgres is NOT JIT):** postgres migrates only on `POST
/api/admin/migrate-postgres` after deploy. Per the EPIC operational note, **prod is at v25
and still owes v026**; running the endpoint after this deploy applies v026 → v030 in order.
The operator step for this task therefore covers both. Document in the task's completion
notes that the migrate-postgres call is required before the backfill runs against
staging/prod (the table must exist first).

---

## 9. Risks

| Risk | Mitigation / stance |
|------|---------------------|
| **Repricing** would make a pack-price-sourced ledger wrong retroactively. | Ledger stores the Stripe-**captured** amount (`amount_received`/`amount_total`), never `CREDIT_PACKS[...]["price_cents"]`. Pack/credits are metadata only. |
| **`stripe_charge_id` not in hand at B/D/A-unexpanded**. | Ruling 5: filled asynchronously via a background task + the single whitelisted `fill_missing_charge_id` UPDATE, after the row's transaction commits. Never blocks or can fail the payment; wrapped so a Stripe/DB error there is logged and dropped. |
| **Historical PIs missing `pack`/`credits` metadata**. | Backfill inserts `pack=NULL, credits=NULL` rather than back-deriving from amount. Amount + user_id + PI id are always present and are all the ledger needs for revenue truth. |
| **Dispute rows deferred**. | Live dispute webhook is out of scope (ruling 1; supervisor files the follow-up task); backfill covers terminal LOST disputes. Consequence: a *newly* lost dispute between now and the follow-up task leaves `SUM` above Stripe net by that amount — bounded and caught by the reconciler, which already computes dispute amounts. |
| **`account_deleted_at` forward-reference to T8630**. | Column reserved, written by nothing in T8620. If T8630's stamp contract changes shape, only that later task touches it; T8620 ships it nullable and inert. |
| **Append-only enforced by convention, not DB guard**. | Grep AC (now permitting exactly the two ruling-2 exceptions) + single-writer module. A DB immutability trigger is deferred to T8630, and MUST allow-list both `account_deleted_at` and `fill_missing_charge_id` when built. |
| **Ledger insert moved outside the `applied` gate (ruling 4)**. | Runs on every observation, not just the first; safe because `(stripe_object_id, kind)` is unique and `ON CONFLICT DO NOTHING` makes repeats free. The cache bump is now conditioned on `inserted == True`, so it still fires exactly once per money event. |
| **Webhook re-raise on ledger failure (ruling 4c)**. | Now a real self-heal (redelivery re-attempts the un-gated insert) instead of the architect's original concern about a "retry loop against a request that keeps 500-ing" — that concern applied to the OLD applied-gated design, where redelivery couldn't reach the insert at all; it does not apply here. |
| **Backfill `--write` against prod from the container**. | Script refuses non-dev `--write` without an explicit operator confirmation flag and prints the target host. Staging→prod is a human operator step. |

---

## 10. Test plan (for Tester Phase 1)

Failing-first tests to author, each mapped to an AC. Backend tests under
`src/backend/tests/` (pg-backed; follow the existing pg test-harness pattern).

| # | Test | Proves / AC |
|---|------|-------------|
| T1 | **Purchase insert + redelivery idempotency**: drive a purchase observation → exactly one `payments` row (kind=`purchase`, `amount_cents = captured`, `stripe_object_id = pi_...`) AND one cache bump. Re-drive the same event (simulating redelivery, `applied` now False) → still one row, no error, helper returns False, cache NOT bumped again. | AC: "a live purchase writes exactly one row; a webhook redelivery writes none and does not error." |
| T2 | **B/D-vs-webhook convergence**: `verify_session` and `checkout.session.completed` for the SAME PI → one row keyed on the PI (not two keyed on the session), cache bumped exactly once across both. | Confirms the PI-keyed idempotency decision (§2a) and the ruling-4b conditional bump. |
| T3 | **Refund negative row + redelivery no-op**: `charge.refunded` → a second row, kind=`refund`, `amount_cents < 0`, keyed on `re_...`, cache decremented once. Redeliver → no new row, no double-decrement (cache unchanged on the second delivery). | AC: "a refund writes a second, negative row; a redelivered refund writes none (idempotency gap closed)." |
| T4 | **Per-user `SUM(amount_cents)` == reconciler net**: seed purchase + refund (+ terminal `dispute_lost` from backfill), assert `SUM` equals the Stripe net the reconciler computes for that user. | AC: "`SUM(amount_cents)` per user equals the Stripe net the reconciler computes." |
| T5 | **`bump_total_spent` missing segment → CRITICAL**: drive a purchase for a user with no `user_segments` row → the ledger row IS written, but asserts a CRITICAL log (not an "Incremented" success line), no exception raised, no bare segment row created. | AC: "`increment_total_spent` against a missing `user_segments` row logs CRITICAL instead of a success line" (ruling 3). |
| T6 | **Ledger failure does not touch the grant, and re-raise behavior is site-type-correct (ruling 4c)**: (a) webhook site — simulate the ledger insert raising → grant/credits unchanged, CRITICAL logged, handler RE-RAISES (non-2xx response); (b) user-facing site (confirm-intent/verify) — same injected failure → grant/credits unchanged, CRITICAL logged, HTTP response is still success. | Failure-mode contract (§5, ruling 4c). |
| T7 | **Redelivery-after-failure self-heals on webhook sites (ruling 4, new)**: inject a ledger-insert failure on the FIRST webhook delivery of a purchase or refund event (grant/decrement still applies via its own idempotency) → no `payments` row yet. Redeliver the SAME event (now `applied` is False, or a redundant refund note) → the ledger insert is retried (because it is not gated on `applied`) and succeeds this time, row now exists, cache bumped exactly once total. | Ruling 4e: "redelivery after an injected first-attempt ledger failure writes the row on the second delivery." Proves the core mechanism ruling 4 fixes. |
| T8 | **confirm-intent + webhook for the same PI produce one row and one cache bump (ruling 4e)**: drive site A (confirm-intent) then site C (webhook `payment_intent.succeeded`) for the SAME PI → exactly one `payments` row, exactly one cache bump (not two). | Ruling 4e. Overlaps with T2's principle but specifically the A/C pairing named in the ruling. |
| T9 | **Backfill idempotency + orphan** (integration/script test with a stubbed `fetch_stripe_intents`): run backfill twice → no duplicate rows; the `fb40690a…` orphan PI produces a `payments` row despite no `users` row; backfill never calls `bump_total_spent`/touches `total_spent_cents` (ruling 4d). | AC: "backfill re-runnable with no duplicate rows; after prod run the 2026-08-24 orphan has a row." |
| T10 | **`fill_missing_charge_id` fills only when NULL, background Stripe error is swallowed, never touches other columns (ruling 5)**: (a) row with `stripe_charge_id IS NULL` → call fills it; (b) row with `stripe_charge_id` already set → call is a no-op (doesn't overwrite); (c) simulate a Stripe error in the background block → logged, response/row unaffected; (d) assert the fill never changes `amount_cents`/`kind`/`user_id`/`stripe_object_id`/`occurred_at` (schema-level check on the UPDATE's column list). | Ruling 5's required tests. |
| T11 | **Grep: exactly the two permitted in-place writes, nothing else (ruling 2, amended)** — a repo grep asserting no `UPDATE payments` outside `fill_missing_charge_id` (this task) and the future `account_deleted_at` stamp (not present yet, so: none but `fill_missing_charge_id`), and no `DELETE FROM payments` anywhere. | AC: "no code path updates or deletes a ledger row (grep-verified)." Append-only enforcement (§3, ruling 2). |

Tests T1, T3, T5, T6, T7, T10 must be observed failing against pre-change master for the
intended reason (per the Landing Policy) before implementation, then passing after.

---

## Non-goals (T8620)

- Live dispute webhook handling (deferred; see §2b).
- Deletion behavior / `account_deleted_at` stamping / delete-path audit (T8630).
- Reconciliation classifying deleted-payer rows (T8640).
- Admin revenue totals reading the ledger (T8650).
- Stripe receipts (T8660). Scheduled reconciliation (T8670).
- A DB-level immutability trigger/REVOKE (deferred; §3).
- Changing what reads `total_spent_cents` (cache stays; T8650 decides).

---

## Open Questions — RESOLVED 2026-09-24

All six open questions were resolved by the user's approval. See "Approved rulings
(2026-09-24)" at the top of this document for the index, and §2c/§3/§4/§4a/§5/§6/§7 for
where each ruling is worked into the design body. Nothing below this line is still open;
implementation proceeds against the amended design as written above.
