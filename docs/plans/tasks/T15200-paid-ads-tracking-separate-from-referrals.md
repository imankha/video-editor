# T15200: Paid-ads tracking: registry spend entry, live-campaign block, kept separate from the referral programme

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** L (postgres migration on `campaigns`, Migration agent; one admin write gesture; admin read blocks)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Owner directives 2026-11-05: tracking of paid ads and of the referral programme are separate in the
admin; the current design focus is the funnel, so this is not prepared until the funnel gates read
green. Carved out of T14910's revision-2 design (sections 5 and 6 there) so T14910 stays read-only
and funnel-centred.

## Problem

`campaigns` (v038) has `id, name, created_by, created_at` and nothing else. Measured cost per
sign-up, attribution coverage (T14910 gate 10), the kickback cohort (gate 11), the paid
visit-to-sign-up read before T7410, and the flight's kill checks (revenue outlook 2026-11-04 §5)
all need spend, channel and platform-reported counts that nobody can enter. And once the referral
programme exists, a referred sign-up (`referrals`, origin from an invite code) and a paid sign-up
(origin from a registry id) must never share a row in the Channels table or the spend-readiness
ladder.

## Solution

- **v0NN migration** on `campaigns`: nullable `channel` (`coach_credits | coach_gift | reddit | meta
  | club`), `spend_cents`, `landing_views`, `platform_conversions`, `spend_updated_at`; `_SCHEMA_DDL`
  updated; column guard so readers serve benchmark-only rows before the migration runs.
- **One write gesture**: the campaign row in `CampaignsModal.jsx` gains the four fields and a Save
  button; `PATCH /api/admin/campaigns/{id}` accepts them. Never reactive.
- **Live campaigns block** in the spend-readiness panel, shown only when a campaign has spend:
  per campaign spend, attributed sign-ups, cost per sign-up with its Poisson interval, coverage,
  visit-to-sign-up, paid-cohort upload failure, first highlight 14 d against the organic comparator,
  with the kill chips and the settled/provisional rendering from T14910.
- **Ladder measured values**: a channel's benchmark rows are replaced by the measured cost at 43+
  attributed sign-ups with spend, naming the campaign.
- **Separation**: Channels table and Journey origin filter get two groups, "Paid ads" (registry
  ids) and "Referral programme" (invite-code referrals, T15070 end card); the spend-readiness ladder
  gets a referral-programme row whose cost is 50% of 60-day revenue per referred sign-up, GO by
  construction, with its own N and K beside it.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v0NN_campaign_spend.py` (new) + `services/pg.py`
- `src/backend/app/routers/admin.py` (PATCH fields; channel grouping)
- `src/backend/app/services/analytics_spend_readiness.py` (live block, measured ladder; from T14910)
- `src/frontend/src/components/admin/CampaignsModal.jsx`, `ChannelsTable.jsx`, `SpendReadinessPanel.jsx`
- Tests beside each

### Related Tasks
- Depends on: T14910 (panel, constants, confidence rendering), T15120 (per-dimension columns)
- Related: referral-programme epic (T15150 to T15190); T7410 (organic visit beacon)
- Design reference: `docs/plans/tasks/T14910-design.md` revision 2, sections 5 and 6, and the
  canvas's "Live campaigns" and "Campaign entry" boards as drawn on 2026-11-05

### Technical Notes
- Cumulative figures retyped by the owner from Ads Manager; day-count kill rules are expressed by
  spend reached, never by dates.
- Nearly every chip in a flight's first weeks is provisional; the block says so.

## Implementation

### Steps
1. [ ] Migration + DDL + guard
2. [ ] PATCH fields + modal Save gesture
3. [ ] Live block + measured ladder (pure functions over T15120 rows)
4. [ ] Paid ads vs referral grouping in Channels, Journey filter and ladder

### Progress Log

**2026-11-05**: Filed from T14910's design review and the owner's separation rule.

## Acceptance Criteria

- [ ] Spend saved on a campaign appears in the live block within a reload; nothing saves without the Save gesture
- [ ] A measured cost replaces the benchmark rows only at 43+ attributed sign-ups and names the campaign
- [ ] Referral-programme sign-ups never appear under Paid ads anywhere in the admin, proven by a seeded test
- [ ] Endpoint serves before the migration runs, with the registry-dependent parts grey and a logged error
