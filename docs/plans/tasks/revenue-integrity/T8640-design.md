# T8640 Design: Reconciliation understands deleted accounts and stops lying about heals

**Status:** Approved-by-directive (no user gate needed; see kickoff step 2 and the task's
2026-09-03 directives). Proceeding to Tester/implement.

Epic 3/6, Revenue Record Integrity. Depends on T8620 (`payments`), T8630
(`account_deletions`). Overlaps T8650 (aggregate reads); T8650 landed and is rebased under.

## Citation re-verification (current master 270e7ee0)

The task file's file:line citations predate T8620/T8630/T8650/T8657. Re-verified against
current master:

| Symbol | Task says | Actual (master) | Notes |
|--------|-----------|-----------------|-------|
| `DriftCause` enum | reconciliation.py:38 | :38 | 5 causes: ALIGNED, REFUND, DISPUTE, TEST_MODE_ERA, UNKNOWN. No ACCOUNT_DELETED. |
| `_classify_cause` | :129 | :129 | Pure over numbers. Signature `(delta, local, pi_count, refunded, disputed_lost)`. |
| `classify_users` | :149/158 | :149, union at :158 | `set(local) | set(stripe_agg)` union intact. |
| `_load_local_spent_positive` | admin.py:687/693 | :819 | Hardcodes `_test_exclusion(True)` in SQL, `JOIN users u` (inner). |
| `_emails_for` | :706 | :838 | `SELECT ... WHERE user_id = ANY(%s)`; no test filter. |
| `_compute_reconciliation` | :715 | :847 | Builds local, backfills stripe_only via `_emails_for`, calls `classify_users`. |
| heal endpoint | :775/813/816 | `heal_revenue_reconciliation` :907; `set_total_spent` :919/939 | `healed = old_cents is not None`. |
| `_test_exclusion` | :693/223 | :84 | `NOT COALESCE(u.is_test_account, s.was_test_account, false)` (T8630 r5). |
| `set_total_spent` | analytics.py:1037/1052 | :1232 | Returns prior value or `None` when no `user_segments` row. |
| `_ledger_revenue_total` / `_LEDGER_REVENUE_BY_USER` | (T8650) | admin.py:118 / :152 | Ledger is signed; SUM is net. Per-user pre-agg subquery. |
| `payments` / `account_deletions` schema | (T8620/T8630) | pg.py:415 / :442 | `payments.amount_cents` signed; `account_deletions` has `deleted_at`, `net_cents`, `had_payments`. |

Key correction vs the task's mental model: T8630 keeps a **de-identified `user_segments`
row** for a deleted account (carrying `was_test_account`), but drops the `users` row. The
incident account (bigajosue) was deleted BEFORE T8630, so it has neither `users` nor
`user_segments` — only a backfilled `payments` row. Both shapes must reconcile.

## Decision A — closing the row: OPTION 1 (derive local truth from the ledger)

No blocker found for option 1, so per the task recommendation we take it. No new column, no
acknowledge gesture, no schema change.

**Rule for the reconciler's "local truth" per user_id:**

- **Account exists** (`users` row present): `local_cents = user_segments.total_spent_cents`.
  This is exactly today's behavior and it is the point of the panel for LIVE accounts — it
  audits the mutable cache against Stripe (refund/dispute/test_mode_era/unknown detection
  is unchanged).
- **Account deleted** (no `users` row) but has ledger/Stripe history:
  `local_cents = SUM(payments.amount_cents)` for that user_id. The T8620 backfill made this
  equal to Stripe net, so `delta == 0` and the row is **aligned, not drifted** — it drops
  off the drift view by construction. This is the honest fix and it deletes UI rather than
  adding it (incident row bigajosue: ledger 399 vs Stripe net 399 -> aligned).

`account_deleted` as a *cause* still exists (Decision B) for the residual case where a
deleted account's ledger does NOT equal Stripe net (e.g. a Stripe refund not yet mirrored
into the ledger): then it is genuine drift, and `account_deleted` explains it instead of
`unknown`, with the deletion metadata rendered (Decision D).

## Decision B — cause classifier (stays pure)

Add `DriftCause.ACCOUNT_DELETED = "account_deleted"`. New pure parameter
`local_account_exists: bool` (default `True` for backward-compatible call sites/tests),
computed by the caller from the Postgres read — never a DB reach from inside the classifier.

Priority order (task-mandated):

```
delta == 0                                   -> ALIGNED
pi_count == 0 and local_cents > 0            -> TEST_MODE_ERA   (zero live history)
not local_account_exists and pi_count > 0    -> ACCOUNT_DELETED (deleted payer; wins over dispute/refund)
disputed_lost_cents > 0                      -> DISPUTE
refunded_cents > 0                           -> REFUND
otherwise                                    -> UNKNOWN
```

`ACCOUNT_DELETED` sits before `DISPUTE`/`REFUND` so a deleted payer that ALSO has a refund
classifies as `account_deleted` (acceptance criterion: "account_deleted wins"). It sits
after `TEST_MODE_ERA`, but the two are mutually exclusive on `pi_count` so order is moot
there.

`classify_users` passes `local.get("account_exists", True)` into `_classify_cause` and emits
`account_exists` on each row.

## Decision C — filter symmetry (REQUIRED; reintroduces the imankh incident if wrong)

Root cause today: `_load_local_spent_positive` applies `NOT is_test_account` to the LOCAL
side only. The Stripe side (`build_stripe_net_by_user`) and `_emails_for` have no filter. A
flagged account with live Stripe history is dropped from local, re-enters via the
`stripe_only` backfill with `local_cents: 0`, and lands as a phantom drift `unknown` row.
Worse, its `user_segments` row still exists, so "Adopt Stripe value" writes 399, returns
`healed: true`, yet the one-sided filter makes it drift again next run — a heal that reports
success and changes nothing.

**Fix — resolve the excluded set ONCE, apply identically to both sides:**

1. `GET /api/admin/revenue-reconciliation` and `POST .../heal` take `exclude_test: bool =
   True` (default hides test accounts, matching `list_users`/`fetchUsers`).
2. New helper `_excluded_test_user_ids() -> set[str]` resolves the excluded id set once,
   faithful to the `_test_exclusion` COALESCE semantics:

   ```sql
   SELECT s.user_id FROM user_segments s
     LEFT JOIN users u ON u.user_id = s.user_id
     WHERE COALESCE(u.is_test_account, s.was_test_account, false)
   UNION
   SELECT user_id FROM users WHERE is_test_account
   ```

   (The second arm catches a live test user with no segment row.)
3. `_load_local_spent_positive()` **stops** hardcoding `_test_exclusion(True)` — it loads
   every positive-spend account. `_compute_reconciliation(exclude_test)` then removes
   `excluded` from BOTH the local map AND `stripe_agg` (and thus from `_emails_for`, which
   is only called on remaining stripe-only ids) before `classify_users`.

Result:
- **Filter ON:** imankh in `excluded` -> removed from local AND stripe -> absent from both
  -> nothing to drift.
- **Filter OFF:** imankh present in local (`total_spent_cents` 399, account exists) and in
  stripe (net 399) -> `delta 0` -> **aligned**, never a drift row, never a heal target.

A flagged account is never dropped from one side while surviving on the other. The lying
heal is structurally impossible because imankh is never drifted in either state.

**Heal guard (Decision B tie-in):** heal skips any row whose cause is `account_deleted`
(reconciled from the ledger; nothing to write) with an explicit
`{"skipped": "account deleted; reconciled from ledger", "healed": False}`, so heal never
touches a deleted account's cache.

## Decision D — id-only rows

Rows with no email carry deletion context sourced from `account_deletions` (latest row per
user_id): `deleted_at` (ISO date) and `net_cents`. `_compute_reconciliation` fetches these
once for all `not account_exists` ids and attaches `deleted_at` to each row. Frontend:

- email present -> render email (unchanged).
- no email, `deleted_at` present -> "account deleted 2026-08-24" under the id.
- no email, no deletion row (payments predating T8630) -> "no local account".

## Failed-heal visibility (task item 3 / Decision C-frontend)

`heal` already returns `results: [{user_id, healed, skipped?}]`. `adminStore.healReconciliation`
stores a `reconciliationHealResults` map (user_id -> {healed, skipped, new_cents}) and the
panel renders a per-row "Heal failed" / skip reason when `healed === false`, instead of a
silent refresh. Cause chip + label for `account_deleted` added
(`CAUSE_STYLES`/`CAUSE_LABELS`).

## Data flow (filter symmetry + cause priority)

```
             fetch_stripe_intents ─► build_stripe_net_by_user ─► stripe_agg {uid: net,...}
                                                                        │
 user_segments (total_spent_cents>0, JOIN users) ─► local {uid:{email,cents,exists=True}}
                                                                        │
 stripe_only = stripe_agg - local ─► _emails_for(stripe_only)          │
     email?  yes -> exists=True,  local_cents=0                        │
             no  -> exists=False, local_cents=SUM(payments)  (ledger)  │
                                                                        ▼
 excluded = _excluded_test_user_ids()  (only if exclude_test)   ─► drop from BOTH maps
                                                                        ▼
                                               classify_users(local, stripe_agg)
                                                       per uid: _classify_cause(..., exists)
                                    ALIGNED ▸ TEST_MODE_ERA ▸ ACCOUNT_DELETED ▸ DISPUTE ▸ REFUND ▸ UNKNOWN
                                                       ▼
                            enrich not-exists rows with account_deletions.deleted_at (Decision D)
```

## Files touched

- `src/backend/app/services/revenue_reconciliation.py` — `ACCOUNT_DELETED` enum;
  `local_account_exists` param + priority in `_classify_cause`; `classify_users` threads
  `account_exists`.
- `src/backend/app/routers/admin.py` — `_excluded_test_user_ids`; `_ledger_sum_for`;
  `_load_local_spent_positive` drops SQL test filter; `_compute_reconciliation(exclude_test)`
  merges ledger truth for deleted, applies symmetric exclusion, attaches `deleted_at`;
  both endpoints take `exclude_test`; heal skips `account_deleted`.
- `src/frontend/src/stores/adminStore.js` — thread `excludeTest`; store per-row heal results.
- `src/frontend/src/components/admin/RevenueReconciliation.jsx` — account_deleted chip,
  id-only deletion line, failed-heal indicator.
- Tests: `tests/test_revenue_reconciliation.py` (classifier + endpoint, incl. imankh
  regression through the REAL TestClient endpoint); `adminStore.reconciliation.test.js`;
  `RevenueReconciliation.test.jsx`.

## Risks

- **Reintroducing the one-sided filter** is the #1 risk — the imankh regression test is the
  guard and must go through the real endpoint (TestClient), both filter states.
- **Comparing live accounts against the ledger by mistake** would break T8650's separation
  (this panel audits the cache for live users). Live = cache; deleted = ledger. Explicit.
- **`account_exists` default `True`** keeps existing pure-classifier tests valid.
```
