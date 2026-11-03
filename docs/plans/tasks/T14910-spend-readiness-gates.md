# T14910: Spend-readiness gates (admin panel + read-only endpoint): "can we spend on ads yet?"

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** L (new admin endpoint + constants module shared with T7460; short design gate)
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "Is there a particular value we are waiting in the analytics for before we
can spend money? ... color code values ... so it's clear what we need to focus on ... and when we can
spend."

## Problem

The 2026-11-03 ad-spend model ([ua-roi-model-2026-11-03.md](../ua-roi-model-2026-11-03.md)) found
paid acquisition loses money in every product state: contribution per sign-up is $0.15 measured,
$0.32 after the fix list, $1.56 optimistic, against $9 to $58 per paid sign-up. The decision to
spend therefore hangs on a short list of measurable values, each with a target. Today those values
are spread over the Journey map, the pulse cards, the money ladder and a one-off read-only query.
Nobody can see at a glance which gate is red and whether spending is allowed.

## Solution

One admin panel, "Spend readiness", with one row per gate: current value (with its N), target,
green / yellow / red / grey chip, one line on why it matters, and the computed-at time. Above the
rows, one verdict line:

- **NO**: at least one measurement gate (1 to 5) is red or grey.
- **TEST ONLY ($1,500 measurement test)**: gates 1 to 5 are green or yellow and gate 10 is green.
- **SCALE**: gates 6, 7 and 8 are green AND the computed break-even CAC per sign-up is at or above
  the channel cost constant for at least one channel. The panel prints the break-even number
  ("paid breaks even below $X per sign-up") next to the verdict so the owner sees the gap.

### Gates (thresholds are named constants; values below are what prod showed on 2026-11-03)

| # | Gate | Source (read only) | Green | Yellow | Red | 2026-11-03 |
|---|---|---|---|---|---|---|
| 1 | Visit -> sign-up | T7410's `visit_daily` once it exists; until then grey "not instrumented" | >= 5% | 2 to 5% | < 2% | no data |
| 2 | Sign-up -> true export <= 14 d, trailing 90 d of MATURE cohorts | `user_actions` `credits_consumed` `first_at` vs `users.created_at` | >= 25% | 15 to 25% | < 15% | 17.8% (Oct cohort) |
| 3 | Upload failure share, 90 d | `daily_counters` failed / (succeeded + failed) | < 10% | 10 to 20% | >= 20% | 18.7% |
| 4 | Finished -> took away | `overlay_exported` or true export vs `video_downloaded` / `share_completed` | >= 80% | 60 to 80% | < 60% | 42% (undercount until T14840) |
| 5 | Money ladder has a denominator since the reprice (`REPRICE_DATE = 2026-10-24`) | `paywall_shown` users, `credit_purchased` users | >= 20 paywall users AND >= 5 purchases | >= 10 and >= 2 | below | 1 and 0 |
| 6 | Payers per 100 sign-ups, trailing 90 d cohorts | `payments` kind = purchase vs `users` | >= 5 | 2 to 5 | < 2 | 1.07 (all time) |
| 7 | Revenue per payer, trailing 180 d | `payments` gross cents / distinct payers | >= $35 | $20 to $35 | < $20 | $18.99 (n = 4, so grey) |
| 8 | Repeat purchase: share of payers whose first purchase is 6+ months old who bought again at least 120 days after it (sport-agnostic; the product serves every recorded sport, so "next soccer season" is the wrong window) | `payments` | >= 25% | 15 to 25% | < 15% | grey until at least 20 payers are 6+ months old (first reading around May 2027) |
| 9 | K-factor, trailing 90 d: referred sign-ups / all sign-ups | `user_segments.referrer_id`, `users` | >= 0.25 | 0.05 to 0.25 | < 0.05 | 0.008 |
| 10 | Attribution coverage, last 30 d: sign-ups carrying any utm or ref | `user_segments` | informational for organic; a paid cohort must be 100% | | | 0 of 375 ever |

Small-N rule: any gate whose denominator is under 20 renders grey "insufficient data (n = …)", never a
colour. There is no product-wide off-season: ReelBallers serves every recorded sport and hockey or
basketball parents are in season when soccer parents are not, so gates never "pause". If sign-up
volume in the trailing window is under the small-N floor the gate goes grey, which is the only
volume-related suppression.

Break-even CAC per sign-up (printed, not gated): payers per sign-up (gate 6) x revenue per payer
(gate 7) minus variable cost per sign-up, where variable cost = export rate x plays per exporter x
`GPU_PER_PLAY` + games per sign-up x `STORAGE_PER_GAME` + payers x (revenue x 2.9% + purchases x
$0.30). Cost constants and the channel cost constants (Meta $25, partnership $5.50 benchmark
midpoints, to be replaced by measured values after the first test) live in the same constants file.

### Backend

- New read-only service `src/backend/app/services/analytics_spend_readiness.py` composing SQL over
  `users`, `user_segments`, `user_actions`, `payments`, `daily_counters`, `referrals`. Excludes test
  accounts via the existing admin `_test_exclusion` helper. No new tables, no new Postgres state, no
  writes.
- New endpoint `GET /api/admin/analytics/spend-readiness` on the admin router (admin session), one
  JSON payload: `verdict`, `break_even_cac`, `gates[]` with `{key, label, value, n, target, rag,
  why, paused, computed_at}`.
- Constants module `src/backend/app/services/spend_readiness_constants.py`: thresholds, reprice
  date, repeat-purchase windows, cost constants. Plain module-level constants, greppable, no DB editor.

### Frontend

- `src/frontend/src/components/admin/SpendReadinessPanel.jsx` at the top of the Journey tab (above
  the loss ranking strip), collapsible; the verdict line is always visible when collapsed.
- Reuse the RAG chip from T14900 (one component, one palette).
- Each row: label, value with n, target, chip, why (one sentence), paused tag if applicable.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_spend_readiness.py` (new)
- `src/backend/app/services/spend_readiness_constants.py` (new)
- `src/backend/app/routers/admin.py` - mount the endpoint next to the journey endpoint
- `src/backend/tests/test_admin_spend_readiness.py` (new) - seeded fixtures per gate, RAG boundaries, small-N, paused
- `src/frontend/src/components/admin/SpendReadinessPanel.jsx` (new) + test
- `src/frontend/src/components/admin/JourneyTab.jsx` - placement
- `src/frontend/src/stores/adminStore.js` - fetch

### Related Tasks
- After: T14710 (true export event), T14720 (counts), T14840 (download unblocked; gate 4 is an
  undercount until then).
- Needs for gate 1: T7410 (visit beacon). Until it lands the gate is grey, by design.
- Shares pattern with: T7460 (success-criteria scorecard). Design gate decides whether T7460's six
  criteria render in this panel (one scorecard) or stay separate; either way ONE constants pattern and
  ONE chip component.
- Feeds: T14920 (Next Step panel reads the verdict and the reddest gate).

### Technical Notes
- Read only. The panel never writes. Gestures: none.
- "Trailing 90 d of mature cohorts" means sign-ups between 104 and 14 days ago, so every counted
  user had the full 14-day window.
- The "today" values in the table are a dated snapshot for the task reader; the panel computes live.
- Thresholds come from the model's checklist (section 7 of the linked doc) and from the founder's
  activation targets; changing one is a one-line constant edit with a commit message saying why.

## Implementation

### Steps
1. [ ] Design doc (short): payload shape, constants module, T7460 fold-or-not decision, placement.
2. [ ] Failing backend tests per gate with seeded rows (green, yellow, red, grey, paused), verdict
       logic, break-even arithmetic.
3. [ ] Service + constants + endpoint.
4. [ ] Frontend panel with collapsed verdict line; chip shared with T14900.
5. [ ] Screenshot desktop and phone; hand over with the live values.

### Progress Log

**2026-11-03**: Filed from the ad-spend ROI session. Prod values in the table are from the read-only
aggregate pull of the same day.

## Acceptance Criteria

- [ ] Endpoint returns all ten gates with rag in {green, yellow, red, grey}, never a missing gate.
- [ ] Verdict follows the rule above; tests cover NO, TEST ONLY and SCALE with seeded data.
- [ ] Break-even CAC printed with the formula's inputs visible on hover or in a details row.
- [ ] Small-N rendering per the honesty convention; no season-based pausing anywhere.
- [ ] Test accounts excluded; no writes; backend test file in the CI shard durations list.
