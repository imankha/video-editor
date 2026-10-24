# T13330: Paywall + buy-modal funnel events and pack-mix admin view

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-23
**Updated:** 2026-10-23

Epic: [Pricing Rebalance](EPIC.md). Epic 3/3. Independent of T13310/T13320 but ships in the same deploy.

## Problem

Nothing records when a user hits the paywall. We know purchases (`credit_purchased`,
`daily_counters.credit_purchases`, the `payments` ledger) but not how many users saw the
insufficient-credits modal or opened the buy modal and walked away. Without that denominator the
T10220 experiment could not be read (zero purchases could mean nobody reached the wall), and the
new ladder will be just as unreadable. The user's pricing question is "what converts at the
wall", and that needs tries and successes side by side (standing rule: never show one without
the other).

## Solution

Two new flow events through the EXISTING aggregate system (`record_milestone` ->
`user_actions` + `daily_counters`; no per-event rows, no new Postgres tables, per the analytics
directives):

| Event | Fires | `daily_col` | Funnel label |
|---|---|---|---|
| `paywall_shown` | `InsufficientCreditsModal` opens (one fire per open, every opener: export, upload storage, extension) | `paywall_shown` | Hit paywall |
| `buy_modal_opened` | `BuyCreditsModal` opens from any entry point | `buy_modal_opened` | Opened buy |

Admin panel:
- Funnel: "Hit paywall" and "Opened buy" rows placed before "Purchased", with the step-over-step
  conversion. Pair them visually with Purchased (tries vs success rule).
- New "Pack mix" block: purchases by `pack` for the last 30 / 90 days and all time, from the
  `payments` ledger (`kind='purchase'`, respecting the `is_test_account` filter the way
  `list_users` does). Counts and gross cents per pack, nothing per user.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `FLOW_EVENTS` (two entries), `record_funnel_event` whitelist
- `src/backend/app/services/pg.py` - `_SCHEMA_DDL` `daily_counters` two new INTEGER NOT NULL DEFAULT 0 columns
- `src/backend/app/migrations/postgres/v036_daily_counters_paywall.py` - next free version after v035; check unmerged siblings for a collision before committing
- `src/backend/app/routers/admin.py` - funnel rows + pack-mix query over `payments`
- `src/frontend/src/utils/funnelEvents.js` - `recordFunnelEvent('paywall_shown' | 'buy_modal_opened')`
- `src/frontend/src/components/InsufficientCreditsModal.jsx`, `BuyCreditsModal.jsx` - fire on open (one place each, on mount of the open modal)
- Admin frontend: the funnel component and a small pack-mix table (`src/frontend/src/components/admin/`)
- Tests: backend analytics funnel tests (event whitelist, daily column mapping), admin pack-mix query test, frontend modal tests asserting one beacon per open (route fetch mocks by URL; positional mocks break on fire-and-forget beacons)

### Related Tasks
- Ships with: T13310, T13320
- History: T3010/T3040 flow events, T7510 attempt-vs-success taxonomy, T11010 funnel user counts, T8620 payments ledger, T8655

### Technical Notes
- Postgres track: `_SCHEMA_DDL` + migration file + `POST /api/admin/migrate-postgres` after
  deploy (admin-triggered; nothing auto-runs). Migration agent included in classification.
- **Deploy order (hazard):** the new `daily_counters` columns are written by the 15s buffered
  flush. Until v036 runs, every flush raises `UndefinedColumn` and re-queues forever, stalling ALL
  daily counters. Run `POST /api/admin/migrate-postgres` immediately after the backend deploy and
  before users can open a modal; verify `error: null` and no `Failed to flush daily counters` log.
  (Not hardened in code: making the flush skip unknown columns would silently hide a missing
  migration, against the no-silent-fallback rule.)
- The beacon is a read-only analytics request fired on a user-visible modal open; it writes
  aggregates server-side through the sanctioned `record_milestone` path. It is NOT editor
  persistence; no store or DB write flows from it on the client.
- Dedupe: one fire per open, not per render. Guard with a ref keyed on the open transition.
- `is_test_account` is a filter input for the pack-mix view (user directive 2026-09-03), same
  treatment as `list_users`.
- The epic's 6-week review reads: paywall_shown users, buy_modal_opened users, credit_purchases,
  pack mix, ARPPU.

## Implementation

### Steps
1. [ ] Backend: `FLOW_EVENTS` entries + DDL + migration v036 + tests
2. [ ] Frontend: fire on modal open (both modals) + tests
3. [ ] Admin: funnel rows + pack-mix block + tests
4. [ ] Staging: open the paywall once, confirm `daily_counters` increments and the admin row shows it

### Progress Log

**2026-10-23**: Filed from the pricing analysis. Ruling P6.

## Acceptance Criteria

- [ ] Opening the insufficient-credits modal increments `daily_counters.paywall_shown` and the user's `user_actions` row once per open
- [ ] Opening the buy modal increments `buy_modal_opened` once per open
- [ ] Admin funnel shows Hit paywall, Opened buy, Purchased adjacent, with step conversion
- [ ] Admin pack-mix table shows counts and cents per pack for 30 / 90 days / all time, test accounts filterable
- [ ] Postgres migration v036 applies on a fresh DB and on staging; `_SCHEMA_DDL` matches
- [ ] Curated tests pass
