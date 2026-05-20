# Epic: Open Panel Analytics

**Status:** TODO
**Created:** 2026-05-13

## Goal

Replace the fragmented analytics setup (Cloudflare Web Analytics with 3 events, admin panel SQLite stats, server logs) with OpenPanel Cloud analytics that answers five questions: Is the product healthy? Will this cohort be profitable? Where are users falling off? Did we push a bad feature? Is the business growing?

## Why

We currently have zero ability to track user journeys, measure retention, see funnel drop-offs, or detect bad feature pushes. Three events via `zaraz.track()` with no user identity tells us almost nothing. The admin panel computes stats on the fly from SQLite with no time series. Product decisions are made by gut feel, not data.

## Design Decisions

All design decisions are documented in the full spec:
- **[analytics-system-plan.md](../../analytics-system-plan.md)** -- Architecture, dashboards, event catalog, computed intelligence, alerts, implementation phases
- **[analytics-playbook.md](../../analytics-playbook.md)** -- LTV models, retention benchmarks, aha moments, churn prediction, dashboard design patterns

Key decisions:
1. **OpenPanel Cloud** ($20/mo at 100K events). Eliminates self-hosting ClickHouse/Redis/Postgres. SDK code is identical to self-hosted -- can migrate to VPS later if event volume warrants it.
2. **41 events total** covering acquisition, engagement, retention, monetization (credits), quests, and feature adoption.
3. **Credit-economy metrics** throughout (not subscription). Repurchase rate, credit utilization, credit health replace MRR/subscription churn.
4. **Computed intelligence engine** in FastAPI: churn risk, engagement tiers, credit health, LTV, early value score -- pushed back to OpenPanel as user properties nightly.
5. **4-tier dashboard hierarchy**: L1 Daily Pulse (30s) -> L2 Weekly Health (5min) -> L3 Feature Deep-Dive (on demand) -> L4 Debug.
6. **Track from gesture handlers, never from effects.** Follows the app's persistence principle.

## Shared Context

### Files affected across tasks
- `src/frontend/src/utils/analytics.js` -- DELETE (Cloudflare Web Analytics)
- `src/frontend/src/analytics/` -- NEW directory (OpenPanel SDK, events, tracking)
- `src/backend/app/analytics/` -- NEW directory (Python SDK, events, engine)
- `src/backend/app/routers/admin.py` -- Remove stats computation, add OpenPanel links
- `src/frontend/index.html` -- Remove CF beacon script
- Various gesture handlers across frontend (annotate, framing, overlay, gallery, sharing, quests, credits)
- Stripe webhook handler (revenue tracking)

### Infrastructure
- OpenPanel Cloud (managed SaaS, EU-hosted on Hetzner Germany)
- 4 API clients: `frontend-write`, `backend-write`, `analytics-read`, `admin-root`
- DPA signed with OpenPanel (data processor, EU data residency)

## Tasks

| ID | Task | Status | Description |
|----|------|--------|-------------|
| T1700 | [Foundation](T1700-foundation.md) | TODO | OpenPanel Cloud setup, SDK integration, 8 activation events, L1 dashboard, remove CF analytics |
| T1705 | [Privacy Policy Update](T1705-privacy-policy-update.md) | TODO | Update privacy policy for user identification, custom events, session replay. Sign DPA. Must ship before analytics goes live. |
| T1701 | [Core Analytics](T1701-core-analytics.md) | TODO | Full 41-event taxonomy, L2 dashboard (7 sections), session replay, quest funnels, admin panel links |
| T1702 | [Monetization + Intelligence](T1702-monetization-intelligence.md) | TODO | Credit events, revenue tracking, computed intelligence engine (churn/LTV/tiers), alerts, viral attribution |
| T1703 | [Optimization](T1703-optimization.md) | TODO | L3 deep-dive template, feature release protocol, aha moment regression, magic number testing |

## Task Order Rationale

Strict sequential -- each phase depends on the prior:
1. **T1700 Foundation** must be first: sets up OpenPanel Cloud account and establishes SDK + event infrastructure
2. **T1705 Privacy Policy Update** must ship before analytics goes live in production -- update disclosures for user identification, custom events, session replay; sign DPA
3. **T1701 Core Analytics** builds on SDK to instrument all 41 events and build dashboards
4. **T1702 Monetization + Intelligence** requires events flowing to build computed metrics and alerts
5. **T1703 Optimization** requires 200+ users and weeks of data to run regressions

## Completion Criteria

- [ ] OpenPanel Cloud account active with 4 API clients configured
- [ ] Privacy policy updated for analytics disclosures, DPA signed
- [ ] Cloudflare Web Analytics fully removed
- [ ] All 41 events instrumented with typed wrappers (frontend + backend)
- [ ] L1 Daily Pulse dashboard answering "is the product healthy?" in 30 seconds
- [ ] L2 Weekly Health dashboard with 7 sections (Growth, Activation, Retention, Monetization, Quality, Virality, Engagement)
- [ ] Credit-economy metrics tracked end-to-end (purchase -> consume -> expire -> repurchase)
- [ ] Nightly computed intelligence running (churn risk, engagement tiers, credit health, LTV)
- [ ] Hourly guardrail alerts + weekly health digest firing to Slack
- [ ] Viral attribution chain tracked for both reel shares and team shares
- [ ] Admin panel links to OpenPanel per-user views (SQLite stats computation removed)
- [ ] Session replay recording with privacy rules (canvas blocked, names masked)
- [ ] Feature release protocol active with L3 deep-dive template
