# T7990: Admin stat tiles show today-only, UTC-boundary values under a "vs last week" label

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

Found during a user-requested audit of the admin dashboard (2026-08-28) — the user read
"SIGNUPS 1" / "EXPORTS 0" as implausibly low weekly totals given 19 signups were visible in the
2026-08-24 cohort row.

Root cause (UI/labeling, not a bad query): `make_card()` (`admin.py:1697-1701`) sets
`today = sparkline[-1]` — a **single day**, not a week — and the subtitle "+X% vs last week"
(`PulseCards.jsx:61`) compares to `sparkline[-8]`, the same weekday one week prior. The tiles are
correctly computing "today" and "today vs same weekday last week"; they are just not labeled that
way, which reads as a weekly total to anyone glancing at the panel. The 2026-08-24 cohort row is
legitimately the *current* week (Postgres `date_trunc('week', ...)` is Monday-start, and 8/24 is a
Monday) — it is not being double-counted, hidden, or excluded; it simply isn't what the daily
tiles show.

Separate, smaller issue bundled here since it's the same "what day is 'today'" mechanism: the day
boundary is **UTC**. `today = date.today()` (`admin.py:1539`) runs on the Fly machine (UTC) while
counters are stamped `CURRENT_DATE` in Postgres (`analytics.py:100`). For a US-timezone admin,
"today" flips over 5-8 hours early relative to their own day, so late-evening activity lands in
what reads as "yesterday" on the panel.

## Solution

Relabel the stat tiles to say what they actually show ("Today" / "vs same day last week"), not
"vs last week" phrasing that implies a weekly rollup. If a true weekly (rolling-7-day or
calendar-week) total is also wanted, add it as a distinct value rather than overloading the
existing "today" card — decide with the founder whether that's in scope for this task or a
separate follow-up. For the UTC boundary, evaluate whether to admin-side-shift the day boundary to
a fixed reference timezone (simplest, no schema change) versus leaving UTC and just labeling it
explicitly — this is a product call on precision vs. effort, not purely technical.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `make_card()` (lines 1697-1701), `today = date.today()`
  (line 1539)
- `src/backend/app/analytics.py` — `CURRENT_DATE` stamping for daily_counters (~line 100)
- `src/frontend/src/**/PulseCards.jsx` — card subtitle rendering ("vs last week" copy, line ~61;
  confirm exact path via Explore)

### Related Tasks
- Sibling bugs from the same audit: T7960 (viral %), T7970 (upload success), T7980 (channels
  cartesian join)

### Technical Notes
- Lowest impact of the four audit findings (display/labeling, not wrong data) — sequence it last
  among the four if anything needs to be dropped for the current build.

## Implementation

### Steps
1. [ ] Relabel the stat-tile subtitle copy to accurately describe "today" / "same day last week"
2. [ ] Decide (with founder) whether a true weekly total is in scope here or deferred
3. [ ] Decide whether to shift the day boundary off UTC to a reference timezone; implement if yes
4. [ ] Verify cohort-table week grouping (Monday-start) is unaffected — it already reads correctly,
       just document the mismatch with the daily tiles' UTC boundary in a code comment if boundaries
       remain different

### Progress Log

**2026-08-28**: Filed from admin dashboard audit (code-expert agent finding).

## Acceptance Criteria

- [ ] Stat tile labels accurately describe the period they show (no "week" language on a
      single-day value, unless a genuine weekly total is added)
- [ ] Day-boundary behavior (UTC vs reference timezone) is a deliberate, documented choice, not an
      accident
