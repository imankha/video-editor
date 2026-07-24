# T5840: Move Credits Out of the Last-Write-Wins Blob (credits → Postgres)

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-24
**Design-gated:** Architect approval required before implementation

## Problem

A money balance is the highest-stakes data in the product, and it currently lives in
`user.sqlite` — a per-user SQLite file replicated to R2 by **whole-file, last-write-wins
overwrite**, with conflict detection compiled out (`skip_version_check=True`). That model has
no idempotency key, no cross-writer atomicity, and its failure mode is **silent loss of paid
value**. Concrete consequences already hit or narrowly avoided:

- **Silent loss (hit, prod 2026-07-24):** a 400-credit admin grant never reached R2 and was
  destroyed by a deploy. See [durability-sync/T4315](durability-sync/T4315-local-authoritative-restore-staleness.md).
- **Double-grant (structural):** `admin_grant` writes `reference_id = NULL`, and SQLite treats
  NULLs as distinct under the UNIQUE idempotency index, so any retry double-grants. This is why
  `admin_grant_credits` cannot safely return a 5xx (a retry = free credits) — the no-idempotency
  -key problem has nowhere good to live in the current model.
- **Concurrent deduction:** two in-flight exports both read balance, both deduct, and last write
  wins — a lost debit or an over-spend, invisible.

The blast radius of any bad sync is the user's *entire* balance and ledger, not one transaction.

## Solution

Move `credits`, `credit_transactions`, and `credit_reservations` to Fly Postgres (already the
home of auth/sharing/sessions), where the correctness this needs is available by construction:

- **Balance mutations in a single transaction** (`BEGIN … UPDATE credits … INSERT
  credit_transactions … COMMIT`) — atomic across writers, no whole-file race.
- **Real idempotency:** every grant/deduct carries a non-null idempotency key (e.g.
  `admin:{admin_id}:{uuid}`, `stripe:{payment_intent}`, `export:{export_id}`) under a UNIQUE
  constraint, so retries are safe and `admin_grant_credits` can finally use the durable-sync 503
  pattern without risking a double-grant.
- **Concurrent deduction correct:** conditional `UPDATE credits SET balance = balance - :n WHERE
  user_id = :u AND balance >= :n` returning affected rows — no read-modify-write race.

This removes the single highest-stakes dataset from the risky path entirely; the R2/SQLite model
stays for editing data (clips/projects/keyframes), where single-writer + large-blob + offline is
the right fit.

## Context

### Relevant Files
- `src/backend/app/services/user_db.py` — `grant_credits`, `deduct_credits`, `reserve_credits`, `get_credit_balance`, `get_credit_transactions`, `set_credits`, `get_credit_stats_for_admin`
- `src/backend/app/routers/credits.py`, `payments.py`, `admin.py` — callers
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL`, `get_pg`; migration lives in `migrations/postgres/`
- `src/backend/app/services/export_helpers.py`, `export_worker.py`, `exports.py`, `export/*` — deduct/refund/reserve call sites
- `src/backend/app/session_init.py` — signup grant + reservation recovery

### Design questions (resolve at the Architect gate)
1. **Migration of existing balances.** Per-user `user.sqlite` in R2 is the current source of
   truth. One-time backfill: read each user's `credits` + `credit_transactions` from R2 →
   Postgres, idempotently (keyed on the existing tx ids). Reconcile against Stripe truth
   (coordinate with **T5760** revenue reconciliation) for purchase rows.
2. **Reservations.** `credit_reservations` (held credits for in-progress exports, T890) move
   too, or the atomic deduct makes reservations unnecessary — decide.
3. **Read-path latency.** `get_credit_balance` becomes a Postgres round-trip on hot paths
   (export button, admin table). Acceptable? Cache? Keep in mind the staging PG dead-connection
   500 (memory).
4. **Analytics coupling.** `increment_total_spent` / `record_milestone` fire alongside grants;
   keep them in the same transaction or after commit.
5. **Cutover.** Dual-write window vs hard switch; how to make the migration self-sufficient
   (CLAUDE.md migration doctrine: run prerequisite migrations, don't fallback-read the source).

### Related Tasks
- **T5760** (Stripe revenue reconciliation) — Stripe as revenue truth; the purchase-row backfill
  should reuse its Stripe-truth builder.
- **T4940** (monetization pass) — the "prior test-mode grants" decision intersects the backfill.
- **T4315 / T4310** (durability epic) — this REMOVES money from the blob those tasks harden; do
  not block on them, but note the reduced stakes once this lands.

### Technical Notes
- Postgres migration → **Migration agent** + manual `POST /api/admin/migrate` per env post-deploy
  (migrations do not auto-run — memory). Update `_SCHEMA_DDL` for fresh deploys.
- Backend tests TRUNCATE the real dev Postgres (memory) — guard + warn.

## Acceptance Criteria

- [ ] `credits` / `credit_transactions` / `credit_reservations` live in Postgres; balance
      mutation is a single atomic transaction
- [ ] Every grant/deduct carries a non-null idempotency key under a UNIQUE constraint; retries
      are provably safe (test: double-submit grants once)
- [ ] Concurrent deduction cannot over-spend or lose a debit (test: two parallel deducts)
- [ ] `admin_grant_credits` returns a durable 503 on failure without double-grant risk
- [ ] Existing balances migrated with zero net change per user (backfill reconciled against the
      R2 ledger; purchases reconciled against Stripe)
- [ ] Balance read latency measured; no regression on the export-button hot path
