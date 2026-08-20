# T7440: Organic growth & attribution report + investor export

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-20

## Problem

Requirement 2.4: "Sustained month-over-month sign-up growth with zero or minimal paid spend, with sources attributed... 'we grew X% monthly organically.'" Attribution data already exists (`user_segments.origin`/utm columns, `referrals`, share-origin inference) and `/analytics/channels` lists signups by channel — but nothing assembles the investor narrative: MoM growth rates, organic vs paid split, the referral loop's conversion (share view → signup), or a K-factor estimate. And nothing is exportable to hand to an investor.

## Solution

A growth report endpoint + admin section that assembles existing attribution data into the growth story, plus visit→signup conversion once T7410's counters exist. Reads existing PG + analytics.sqlite only; zero new stored data.

See [EPIC.md](EPIC.md) for directives and benchmarks (10-15% MoM organic = strong seed signal; K-factor 0.15-0.5 typical consumer).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `GET /api/admin/analytics/growth` (new; `/analytics/channels` at :957 stays, this aggregates over time not just totals)
- `src/backend/app/services/analytics_store.py` — read `visit_daily` (T7410)
- `src/frontend/src/stores/adminStore.js` — fetch action
- `src/frontend/src/components/admin/GrowthReport.jsx` (NEW), wired into `AnalyticsDashboard.jsx`

### Related Tasks
- Depends on: T7410 (visit→signup conversion section only; ship the rest without it, render that card as "needs visit beacon")
- Related: T3560 (attribution graph viz) is a different, deferred deliverable — a node-link exploration tool; this is the investor summary table. Don't merge them.

### Report contents
1. **MoM sign-ups by source bucket** (map `origin` values into: organic/SEO, community, referral/shared-link, social content, partnerships, paid) with MoM % growth per bucket and overall, **organic-only growth rate** called out, and YoY comparison where >12mo of data exists (seasonality rule from EPIC.md).
2. **Referral loop**: shares created → share views (`share_viewed` counts) → signups with share/invite origin → **K-factor estimate** = invited-or-share-attributed signups per active user per period, with the honest caveat that share-origin inference undercounts dark social.
3. **Visit → signup conversion** by source (needs T7410's `visit_daily`).
4. **Paid spend line**: we currently spend ~$0 — state it explicitly in the report (the "zero paid spend" half of the claim is a number too: make it visible, e.g. a manually-maintained constant or env value shown with its as-of date).
5. **CSV export + print-clean layout** — this report IS the hand-to-investor artifact.

### Technical Notes
- Bucket mapping from raw `origin`/utm values lives in ONE backend constant with an explicit `other/unattributed` bucket — never silently fold unknowns into organic (that would inflate the organic claim; honesty > flattery, an investor WILL ask).
- Small-N: show absolute counts next to every % (growth % on single-digit bases is noise; print both).
- MoM growth on the current partial month must be labeled partial or projected, never presented as a closed month.

## Implementation

### Steps
1. [ ] Bucket-mapping constant + growth endpoint (signups by bucket by month, growth rates, referral loop, K-factor)
2. [ ] Visit-conversion section reading `visit_daily` (graceful absence pre-T7410)
3. [ ] `GrowthReport.jsx` + CSV + print stylesheet check
4. [ ] Tests: bucket mapping (incl. unattributed), MoM/YoY math, partial-month labeling, K-factor formula on fixtures

## Acceptance Criteria

- [ ] On demand: "we grew X% MoM organically" with the source table backing it, absolute counts alongside every %
- [ ] Unattributed signups visible as their own bucket
- [ ] Referral-loop funnel (share → view → signup) + K-factor with caveat rendered
- [ ] CSV export + print-clean; zero new stored data
