# T8655: Remove the dead credit-amount-to-price map

**Status:** STAGING (merged 2026-09-25, PR #507; proof VERIFIED at 422d6a34, Branch CI 36088469665 green)
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-24
**Updated:** 2026-09-24

Epic follow-up. See [EPIC.md](EPIC.md). Filed 2026-09-24 from the T10220 proof verification.

## Problem

The T10220 proof verifier found that `CREDIT_AMOUNT_TO_CENTS` in `src/backend/app/analytics.py`
does not know the T780 ladder (40 / 85 / 180 credits at 399 / 699 / 1299 cents, live from
2026-03-31 until T4940). If the map were used, those historical purchases would be counted as
$0 spend.

Supervisor trace, same day: the map has **no production consumer**.
`_compute_money_spent_cents` (`routers/admin.py:72`) is its only reader, and no production
code has called that helper since T3450 moved admin revenue onto
`user_segments.total_spent_cents`. That cache was incremented with the real price at purchase
time, so no admin screen under-reports T780-era purchases today. Only tests exercise the map
(`test_t4940_pack_pricing.py`, `test_credit_ledger.py`). Every retired-ladder update to it
(T4940, and T10220's 80/160 entries) maintains dead code.

`credit_ledger.stats_for_admin` still returns `purchase_credit_amounts`, and nothing in
`admin.py` reads it.

## Solution

Delete the dead path:
- `_RETIRED_CREDIT_AMOUNT_TO_CENTS` and `CREDIT_AMOUNT_TO_CENTS` in `analytics.py`
- `_compute_money_spent_cents` in `routers/admin.py`
- the `purchase_credit_amounts` aggregate in `credit_ledger.stats_for_admin`, if a grep
  confirms no reader (frontend included)
- the tests that only exist to pin those, including T10220's `TestRetiredLadderPricesStayMapped`

Revenue needs no replacement here. T8620 adds the append-only `payments` ledger with the
captured amount per payment, and T8650 moves admin totals onto it. A credit-count-to-price
lookup is the wrong model anyway, because two ladders reuse the same credit counts at
different prices.

Do this after T10220 merges, since that branch adds entries and a test to the same code.

## Acceptance Criteria

- [x] Grep shows no remaining reference to `CREDIT_AMOUNT_TO_CENTS`,
      `_compute_money_spent_cents`, or (if removed) `purchase_credit_amounts`
- [x] Admin user list and revenue panels return the same figures before and after
      (characterization check on the admin endpoints' response)

## Knowledge doc follow-up (backend-services.md is locked by T8630, do not edit here)

`.claude/knowledge/backend-services.md` has two lines that now describe deleted code as
live and need fixing in a follow-up commit once T8630 lands:

- L831-833 (T10220 entry): "Retired T4940 sizes **80/160 were added to
  `analytics._RETIRED_CREDIT_AMOUNT_TO_CENTS`** (399/699) so historical purchase rows
  still map to a price (340 stayed live at 1299c)." -- `_RETIRED_CREDIT_AMOUNT_TO_CENTS`
  no longer exists; this line actively instructs a future reprice to edit a deleted dict.
- L848-849 (T10210 entry): "`analytics.CREDIT_AMOUNT_TO_CENTS` (admin money-spent)
  derives the current ladder from the same source on top of retired pre-T4940 amounts."
  -- `CREDIT_AMOUNT_TO_CENTS` no longer exists; admin money-spent reads the `payments`
  ledger (T8650), not this map.

Both sentences should be deleted or rewritten to note the map/helper were removed as
dead code (no production consumer since T3450; T8655, 2026-09-25).
