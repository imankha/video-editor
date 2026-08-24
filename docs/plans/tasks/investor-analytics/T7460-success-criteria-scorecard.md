# T7460: Success-criteria scorecard (goal vs actual, green/yellow/red)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-20

## Problem

The user defined six app-level success criteria (2026-08-20) and wants them trackable at a glance in their own dashboard: each criterion shows the goal, our current number, and a green/yellow/red status. Without this, the epic's reports answer questions but nobody sees pass/fail drift week to week.

## Solution

A "Success Criteria" admin section: one card per criterion — goal line, current value, RAG chip, small trend where cheap. Goals and thresholds live in a backend constants file (they change rarely; no DB, no editor — keep-it-light directive). The endpoint reuses the SAME service-level query functions the report tasks build; this task adds no new metric math beyond composing them.

See [EPIC.md](EPIC.md) for directives and locked definitions.

## The six criteria (verbatim goals -> metric mapping)

| # | Criterion | Goal | Metric source | RAG rule |
|---|---|---|---|---|
| 1 | Active users | 1,000 WAU by month 6 (stretch 2,000), 4-wk trailing avg; in-season WoW growth ~10% | `user_usage_daily`: trailing-4-week avg of weekly distinct active users; WoW growth sub-metric | vs a linear ramp from baseline (WAU at epic start) to target at `TARGET_DATE`; green >= ramp, yellow >= 75% of ramp, red below. WoW sub-chip in season only |
| 2 | Growth | Sign-ups +15% MoM, essentially all organic, sources tracked | `user_segments` (T7440's bucket mapping) | green: last closed month >= +15% AND organic share >= 90%; yellow: >= +10% or organic 75-90%; red below. Partial months labeled, never scored |
| 3 | Activation | 40%+ of new sign-ups export a reel <= 14d of account creation; biggest drop-off shrinking MoM | `user_actions.first_at` (T7420) — PRIMARY activation = `export_completed` <= 14d (per these criteria; `share_completed` <= 14d stays tracked alongside as the value-moment metric) | green >= 40%, yellow >= 30%, red below — scored on the most recent MATURE monthly cohort. Drop-off sub-chip: green if the largest stall stage shrank MoM, yellow flat, red grew |
| 4 | Retention | 30%+ of activated users active 30 days later; in-season 50%+ of one week's actives return next week; curves flatten | `user_usage_daily` (T7430 queries); "activated" = criterion-3 definition | green >= 30% D30-of-activated / >= 50% WoW return (in season); yellow >= 75% of each; red below. Curve flattening NOT auto-scored — card links to T7430's curves |
| 5 | Engagement / stickiness | In-season WAU/MAU >= 40%; median active user exports 2+ reels/month | WAU/MAU from `user_usage_daily`; median exports/active-user/month from `rollup_engagement_monthly` (T7400) | green: both met; yellow: one met or WAU/MAU >= 30%; red: neither. Off-season: paused |
| 6 | Viral loop | 25%+ of new sign-ups via shared reel links or referrals | `user_segments.origin` in {share, invite, referral} over trailing closed month | green >= 25%, yellow >= 15%, red below |

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/success_criteria.py` (NEW) — goals, stretch values, yellow thresholds, `TARGET_DATE`, in-season windows import; every number a named constant with the criterion quoted in a comment
- `src/backend/app/routers/admin.py` — `GET /api/admin/analytics/scorecard`
- `src/backend/app/services/` — reuse T7420/T7430/T7440 query functions (factor them service-side if they landed router-inline)
- `src/frontend/src/components/admin/SuccessCriteriaScorecard.jsx` (NEW) + `adminStore.js` fetch; own tab/section in `AdminScreen.jsx` (the user asked for "their own dashboard")

### Related Tasks
- Depends on: T7420 (activation), T7430 (retention/WAU queries), T7440 (growth buckets), T7400 (`rollup_engagement_monthly` — added to its schema for criterion 5)
- This is the epic capstone — last in order.
- **Watch T7510** (attempted-vs-successful activity taxonomy, filed 2026-08-24, standalone
  P1, not part of this epic): it changes WHEN/WHETHER milestones like `annotation_completed`
  and `game_created`-adjacent events fire (moving success semantics to durable completion
  points). Criterion 3's activation metric already reads `user_actions.first_at` /
  `export_completed` — if T7510 renames or re-times any event this scorecard reads, that
  change must land as "T7460 scorecard inputs unaffected or migrated in the same change"
  (T7510's own acceptance criteria already say this); re-verify the scorecard's numbers
  don't silently shift when T7510 ships.

### Technical Notes
- **In-season gating**: criteria 1 (WoW), 4 (WoW return), 5 use the epic's season-window constants; off-season they render a grey "off-season (paused)" state showing the last in-season value — never a red that just means winter.
- **Assumption to confirm**: "month 6" anchored at epic filing => `TARGET_DATE = 2027-02-28` default. User can correct the constant.
- **Small-N honesty**: every % card shows the absolute numbers beneath (e.g. "3/7 users"); RAG chips suppress to grey "insufficient data" below a minimum denominator (default 10).
- **Engagement median freshness**: criterion 5 depends on T7400's rollup; card shows the rollup's `computed_at` and a "refresh" hint when stale (> 7 days).
- No new stored data: goals are code constants; all reads via existing queries + analytics.sqlite.

## Implementation

### Steps
1. [ ] `success_criteria.py` constants + RAG evaluator (pure functions, unit-tested against fixture values for every green/yellow/red/paused/insufficient branch)
2. [ ] Scorecard endpoint composing existing query functions
3. [ ] `SuccessCriteriaScorecard.jsx` — 6 cards, RAG chips, sub-metrics, off-season + insufficient-data states, as-of timestamps
4. [ ] Tests: RAG boundaries (exactly-at-target = green), ramp interpolation, in-season gating, mature-cohort selection

## Acceptance Criteria

- [ ] One screen answers "are we on track?" for all six criteria with goal, number, and color
- [ ] Off-season never shows false red; small N never shows false confidence
- [ ] Every threshold is a named constant a one-line diff can tune
- [ ] Activation card shows BOTH export<=14d (scored) and share<=14d (tracked)
