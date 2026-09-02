# Investor-Grade Analytics

**Status:** TODO
**Created:** 2026-08-20

## Goal

Make the four "investor-grade" claims producible **on demand** from our own admin panel, with zero external tools and near-zero new stored data:

1. **Full-funnel instrumentation** (requirement 2.1): visit → sign-up → first upload → first tagged play → first exported reel → first shared reel → repeat usage. If we cannot produce a cohort retention chart on demand, nothing else counts.
2. **Activation metric** (2.2): % of new sign-ups reaching a **first shared reel within 14 days**, with per-stage drop-off localization (upload friction, tagging effort, export, sharing).
3. **Retention as the headline** (2.3): cohort retention curves (30/60/90-day) that visibly **flatten**, adjusted for sport seasonality so off-season dormancy is not misread as churn; clip-library (collections) usage tracked as the structural retention asset.
4. **Organic growth trend** (2.4): MoM sign-up growth with sources attributed (community, referral/shared links, social, SEO, partnerships) — "we grew X% monthly organically."

## User Directives (2026-08-20) — binding design principles

1. **In-house only.** No external analytics tools/SDKs (PostHog, OpenPanel, Mixpanel, GA all rejected): they require subscriptions and make privacy difficult. The playbook's OpenPanel plan (analytics-playbook.md §10, analytics-system-plan.md) is **superseded** on the tooling choice; its metric definitions and benchmarks remain valid.
2. **Keep it light.** Extend the existing home-grown milestone system (`record_milestone` → `user_actions`/`daily_counters`/`user_segments`), don't build a parallel one.
3. **No data blow-up.** Aggregates only — counts + first/latest timestamps. Never store per-event rows in any shared store. (The existing per-user `user_action_log` in each user's SQLite remains the only event-grain data, exactly as today.)
4. **No new Postgres data.** Postgres is the costliest part of the stack. Reports READ existing PG tables; all NEW analytics state lives in a flat **`analytics.sqlite`** (drip.sqlite precedent from the [lifecycle-drip epic](../lifecycle-drip/EPIC.md): env-prefixed R2 key, single-writer, etag-asserted upload, never enters the per-user CAS/sync machinery).

## What already exists (don't rebuild)

Surveyed 2026-08-20. The system is further along than the requirements assume:

| Piece | Where | Status |
|---|---|---|
| 30 server-side flow events + 15-step funnel | `app/analytics.py` `FLOW_EVENTS`/`FUNNEL_STEPS`, `record_milestone` | Live |
| Per-user lifetime counts + **first_at** per action | PG `user_actions` (user, action, platform, count, first_at) | Live |
| Per-user per-day activity (the retention spine) | PG `user_usage_daily` (user_id, day, seconds) via session heartbeat | Live (since v022) |
| Global daily aggregates by origin | PG `daily_counters` (15s-batched buffer) | Live |
| Signup attribution: UTM, click-IDs, invite codes, share-origin | PG `user_segments` + `referrals`; capture in `App.jsx:139-171`, landing param relay `PageLayout.astro:41-64` | Live |
| Admin dashboard: funnel, channels, signup cohorts, share funnel, pulse, referral tree | `routers/admin.py` `/analytics/*` + `components/admin/*` | Live |
| Per-event timeline per user | per-user SQLite `user_action_log` (action, context, created_at) | Live (dual-write in `record_milestone`) |

## The gaps this epic closes

1. **Top of funnel is invisible.** The landing site emits nothing; visit → sign-up conversion is unmeasurable. (The Cloudflare beacon in `utils/analytics.js` is inert without `VITE_CF_ANALYTICS_TOKEN` and is not our answer.)
2. **No activation report.** Sign-up → first-share-within-14d is computable from `user_actions.first_at` today, but nothing computes or displays it, and there is no per-stage drop-off view.
3. **No retention curves.** `/analytics/cohorts` shows per-cohort "% ever did X" + a single 7-day return flag — no triangle, no curve over time, no flattening evidence, no seasonality handling.
4. **No cohort × action × time view** (e.g. "% of Fall cohort still exporting in week N", clip-library usage over time). Event-grain data exists only inside each user's SQLite, not queryable in aggregate.
5. **No growth report.** MoM sign-ups by source with growth rates and the referral loop (K-factor) is not assembled anywhere, and nothing is exportable to hand an investor.

## Architecture

```
READS (existing PG, read-only, no schema change):
  user_segments (acquired_at, origin, utm_*)   -> cohort keys + attribution
  user_actions  (first_at, count)              -> activation, funnel stages, depth
  user_usage_daily (user_id, day, seconds)     -> active-day spine for retention
  referrals, daily_counters                    -> growth + K-factor

NEW WRITES (analytics.sqlite ONLY — aggregates, no per-event rows):
  visit_daily   (day, source, count)                     <- T7410 beacon buffer
  rollup_action_weekly (cohort_week, action, week_index,
                        distinct_users)                  <- T7400 on-demand sweep of
                                                            per-user user_action_log
  rollup_meta   (key, value)                             <- computed_at, coverage

analytics.sqlite: PRAGMA user_version; created lazily; local file + debounced
R2 upload with etag assert (single app server today; refuse loudly on etag
mismatch). Not in the 3 migration tracks; no _SCHEMA_DDL change; no Migration agent.
```

## Success criteria (user, 2026-08-20) — the scorecard targets

Tracked in their own dashboard (T7460): goal + our number + green/yellow/red per criterion.

| # | Criterion | Target |
|---|---|---|
| 1 | Active users | 1,000 WAU by month 6 (stretch 2,000), 4-week trailing avg; in-season WoW growth ~10% |
| 2 | Growth | Sign-ups +15% MoM, essentially all organic (>=90%), sources tracked (community, shared reel links, social, clubs/champions) |
| 3 | Activation | 40%+ of new sign-ups export a reel <= 14d of account creation; biggest drop-off point shrinking MoM |
| 4 | Retention | 30%+ of activated users still active 30 days later; in-season 50%+ WoW return; cohort curves flatten |
| 5 | Engagement | In-season WAU/MAU >= 40%; median active user exports 2+ reels/month |
| 6 | Viral loop | 25%+ of new sign-ups via shared reel links or referrals |

## Locked metric definitions (defaults — flag disagreement at design review)

- **Activation (primary, scored)** = `export_completed` within **14 days** of `user_segments.acquired_at`, target 40%+ (success criterion 3). **Value-moment metric (tracked alongside)** = `share_completed` ≤ 14d (requirement 2.2's "first shared reel within two weeks"). Both computed per cohort; the scorecard scores export, the share metric tells us whether the sharing story holds.
- **Active (day)** = a `user_usage_daily` row with seconds > 0.
- **Retention bins = weekly** (games are weekly; daily retention is noise for this product — playbook §4). Report both **classic** (active in week N) and **unbounded/activity-based** (active in week ≥ N); unbounded is the headline for a seasonal product.
- **Seasonality**: cohort by **join season**; season-over-season return rate ("% of last-season active parents back this season") is the long-horizon headline; MoM comparisons are YoY-first. Off-season dormancy is surfaced as a labeled band on charts, never silently dropped.
- **Stickiness** = WAU and WAU/MAU (never DAU/MAU — wrong ratio for weekly-cadence products).
- **Benchmarks to print next to numbers** (research 2026-08-20: a16z 16 Metrics, Sequoia retention, Lenny/Casey Winters): activation median ~30%, 50%+ = fundable talking point; consumer-transactional 6-month retention 30% good / 50% great; organic growth 10-15% MoM = strong seed signal; K-factor 0.15-0.5 typical consumer.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T7400 | [analytics.sqlite store + on-demand cohort rollup sweep](T7400-analytics-sqlite-rollup.md) | TODO |
| T7410 | [First-party visit beacon (landing + app, aggregate-only)](T7410-first-party-visit-beacon.md) | TODO |
| T7420 | [Activation & funnel drop-off report](T7420-activation-funnel-report.md) | TODO |
| T7430 | [Retention curves & triangle, seasonality-adjusted](T7430-retention-cohort-curves.md) | TODO |
| T7440 | [Organic growth & attribution report + investor export](T7440-organic-growth-report.md) | TODO |
| T7450 | [Flow-event coverage: clip-library & repeat-usage signals](T7450-compounding-value-event-coverage.md) | TODO |
| T7455 | [Editor-open event coverage: per-open Focus/Overlay/Annotate entries with clip context](T7455-editor-open-event-coverage.md) | TODO |
| T7460 | [Success-criteria scorecard (goal vs actual, green/yellow/red)](T7460-success-criteria-scorecard.md) | TODO |
| T7465 | [Journey Flow graph replaces the admin bar funnel](T7465-journey-flow-graph.md) | TODO |
| T7466 | [Deploy-comparison view (segment any metric by deploy, before vs after)](T7466-deploy-comparison-view.md) | TODO |

Order is dependency-driven: T7400 (store + rollup) unlocks T7430's action-level views; T7410 unlocks T7440's visit→signup conversion; T7420 needs nothing new (reads existing `first_at`) and can run in parallel with T7400/T7410. T7450 is independent and small. T7460 is the capstone — it composes the query functions the other tasks build, so it goes last. T7465 (filed 2026-09-02) is pure-read like T7420 and can start anytime; it coordinates with T7455 on future node coverage but does not depend on it. T7466 (deploy log + before/after comparison, also filed 2026-09-02) depends on T7400's store and layers onto the report endpoints/components T7410-T7465 build, so it is sequenced last to avoid merge churn on files still being actively shaped.

## Completion Criteria

- [ ] From the admin panel, on demand: cohort retention triangle + curves (weekly, classic AND unbounded, season-cohort view), activation rate + stage drop-off, MoM growth by source, WAU chart.
- [ ] The success-criteria scorecard: all six criteria with goal, current number, and green/yellow/red — off-season and small-N states honest (grey, never false red/green).
- [ ] Landing visit → sign-up conversion measurable by source.
- [ ] Every investor view exports (CSV or print-clean) — the "produce it on demand" bar.
- [ ] Zero new Postgres tables/columns; zero per-event rows outside existing per-user `user_action_log`; no external SDK in any package.json / requirements.
- [ ] Clip-library (collections) usage visible as a tracked retention signal.
