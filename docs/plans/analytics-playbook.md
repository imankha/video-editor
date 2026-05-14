# Analytics Playbook: From Zero to Data-Driven

> Reference guide for analytics architecture, LTV modeling, dashboard design, and feature impact detection.
> Tailored for a consumer video editor (sports parents, subscription-based).

---

## Table of Contents

1. [North Star & KPI Hierarchy](#1-north-star--kpi-hierarchy)
2. [Event Taxonomy](#2-event-taxonomy)
3. [LTV Prediction by Timeframe](#3-ltv-prediction-by-timeframe)
4. [Retention Benchmarks](#4-retention-benchmarks)
5. [The Aha Moment Framework](#5-the-aha-moment-framework)
6. [Monetization Analytics](#6-monetization-analytics)
7. [Churn Prediction](#7-churn-prediction)
8. [Detecting Bad Feature Pushes](#8-detecting-bad-feature-pushes)
9. [Dashboard Design](#9-dashboard-design)
10. [OpenPanel Setup](#10-openpanel-setup)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. North Star & KPI Hierarchy

### North Star Metric: **Weekly Exports Completed**

An export = a parent got a highlight reel of their kid. That's the core value delivery.

| Property | Check |
|----------|-------|
| Captures core value | Parent receives polished highlight |
| Leading indicator of revenue | Exports drive sharing, sharing drives growth |
| Actionable | Every pipeline improvement should increase exports |
| Combines quantity + quality + frequency | Counts output, requires quality (users only export if good), weekly cadence matches game schedule |

### Input Metrics (the levers you control)

| Input Metric | How It Drives North Star | Team Lever |
|-------------|------------------------|------------|
| Clips annotated per user per week | More clips = more potential exports | Improve annotate UX |
| Annotate-to-Export conversion rate | Higher = fewer abandoned projects | Fix pipeline drop-offs |
| New user activation rate (% first export in 7d) | Activated users become repeat exporters | Onboarding quality |
| D7 retention | Retained users export repeatedly | Overall product quality |
| Session-to-export ratio | Fewer sessions per export = less friction | Pipeline streamlining |

---

## 2. Event Taxonomy

### Naming Convention: `object_action` (snake_case, past tense)

Enforce via TypeScript constants file — never use raw strings.

```typescript
// src/frontend/src/analytics/events.ts
export const Events = {
  // Acquisition / Activation
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  FIRST_VIDEO_UPLOADED: 'first_video_uploaded',
  FIRST_CLIP_CREATED: 'first_clip_created',
  FIRST_EXPORT_COMPLETED: 'first_export_completed',
  FIRST_SHARE_COMPLETED: 'first_share_completed',

  // Engagement / Core Loop
  VIDEO_UPLOADED: 'video_uploaded',
  CLIP_CREATED: 'clip_created',
  CLIP_EDITED: 'clip_edited',
  ANNOTATION_ADDED: 'annotation_added',
  CROP_APPLIED: 'crop_applied',
  OVERLAY_APPLIED: 'overlay_applied',
  EXPORT_STARTED: 'export_started',
  EXPORT_COMPLETED: 'export_completed',
  EXPORT_FAILED: 'export_failed',
  CLIP_SHARED: 'clip_shared',
  GALLERY_VIEWED: 'gallery_viewed',

  // Retention Signals
  SESSION_STARTED: 'session_started',
  GAME_CREATED: 'game_created',
  PROJECT_OPENED: 'project_opened',
  FEATURE_DISCOVERED: 'feature_discovered',

  // Monetization
  PAYWALL_VIEWED: 'paywall_viewed',
  UPGRADE_STARTED: 'upgrade_started',
  PURCHASE_COMPLETED: 'purchase_completed',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',

  // Feature Adoption
  AI_FEATURE_USED: 'ai_feature_used',
  TEAM_SHARE_SENT: 'team_share_sent',
  SHARED_ANNOTATION_VIEWED: 'shared_annotation_viewed',
} as const;
```

### Global Properties (attached to every event)

| Property | Type | Example |
|----------|------|---------|
| `user_id` | string | UUID |
| `session_id` | string | UUID |
| `app_version` | string | `1.4.2` |
| `browser` | string | `Chrome 126` |
| `user_plan` | string | `free` / `premium` |
| `account_age_days` | int | `45` |

### User Properties (set once, updated over time)

| Property | Set When | Updated When |
|----------|----------|--------------|
| `signup_date` | signup | never |
| `signup_method` | signup | never |
| `plan` | signup | upgrade/downgrade |
| `total_exports` | first export | each export (increment) |
| `last_active_date` | first session | each session |
| `primary_sport` | first game | recalculated |
| `activation_status` | signup | when aha moment hit |
| `lifetime_revenue` | first purchase | each purchase |

### Key Event Properties (examples)

```
clip_created:
  clip_duration_seconds: 14.2
  game_sport: "soccer"
  method: "manual" | "ai_suggested"
  is_first: true
  lifetime_count: 1

export_completed:
  output_format: "mp4"
  output_resolution: "1080x1920"
  has_overlay: true
  has_crop: true
  export_duration_seconds: 8.3
  time_since_signup_hours: 2.4

paywall_viewed:
  trigger: "export_limit" | "feature_gate" | "settings"
  impression_count: 3
  current_plan: "free"
```

### Critical Rules

1. **Outcomes over interactions.** `clip_created` > `button_clicked`. Add interactions only to diagnose funnel drops.
2. **One event with properties, not many events.** `crop_applied { aspect_ratio: "16:9" }` not `crop_applied_16_9`.
3. **Always include `is_first` or `lifetime_count`** to distinguish activation from engagement.
4. **Business-critical events server-side** (signup, purchase, export). UX events client-side.
5. **If nobody will chart it in 30 days, don't track it.**

---

## 3. LTV Prediction by Timeframe

### Core Formula (Retention-Based)

```
LTV = ARPDAU x Lifetime
Lifetime = SUM(Retention(day_i) for i = 1 to N)
```

### Power Law Retention Model (Industry Standard)

```
Retention(day) = a * day^b
```

Fit from actual data:
- `b = SLOPE(LN(retention_values), LN(day_values))`
- `a = EXP(INTERCEPT(LN(retention_values), LN(day_values)))`

### Subscription LTV Formula

```
LTV = ARPU / Monthly Churn Rate
```

With discount rate:
```
LTV = SUM over t=1 to n of: ARPU * (1 - Churn_Rate)^(t-1) / (1 + Discount_Rate)^t
```

### The Coefficient Method (Recommended Starting Point)

After accumulating historical cohorts that have matured to D90:
```
K = D90_LTV / D7_LTV    (from historical data)
Predicted D90 LTV = Observed D7 LTV x K
```

Typical multiplier ranges:
- D90/D3 ratio: ~2.5-4x
- D90/D7 ratio: ~1.5-2.5x
- D90/D30 ratio: ~1.2-1.5x

### What You Can Predict at Each Window

#### Day 3

| Aspect | Detail |
|--------|--------|
| **Confidence** | Low (~40-50% accuracy for D90) |
| **Measurable** | Onboarding completion, first core action, session count, D2 return |
| **Useful for** | Killing bad UA channels fast |
| **Key signal** | D2 return is the single strongest early predictor of long-term retention |

**KPIs that matter at Day 3:**
- Onboarding completion rate
- First clip created (Y/N)
- Session count (target: 3+ by D3)
- Day 2 return (binary -- strongest early signal)
- Session duration (long D0 session + returns = high value)

#### Day 7

| Aspect | Detail |
|--------|--------|
| **Confidence** | Moderate (~60-70% accuracy) |
| **Measurable** | Retention curve forming, habit signals, engagement depth, trial intent |
| **Useful for** | UA optimization, early cohort quality assessment |
| **Key signal** | Users with 3+ active days out of 7 have 15% higher conversion |

**KPIs that matter at Day 7:**
- D7 retention rate (foundation of all LTV models)
- Feature breadth (users touching 3+ features retain at 2x)
- Consecutive day usage (3+ of 7 days)
- Sharing/inviting (strongest organic growth signal)
- Pricing page views + dwell time (conversion intent)
- D7 ROAS of 15-25% = healthy

#### Day 14

| Aspect | Detail |
|--------|--------|
| **Confidence** | Good (~75-85% accuracy) |
| **Measurable** | Trial conversions, second-week retention, feature adoption breadth |
| **Key signal** | D14/D7 retention ratio > 0.6 = retention curve is flattening (good) |

**KPIs that matter at Day 14:**
- D14/D7 retention ratio (if > 0.6, strong long-term outlook)
- Trial-to-paid conversion (for 7-day trials, decision point)
- Engagement frequency shift (from "trying" to "using regularly")
- Second-week depth (going deeper vs. plateauing)

#### Day 30

| Aspect | Detail |
|--------|--------|
| **Confidence** | High (~85-90% for D90, ~70-80% for D365) |
| **Measurable** | Monthly retention, first renewal, ARPPU stabilization, referral rates |
| **Key signal** | D30 retention confirms product-market fit |

**KPIs that matter at Day 30:**
- D30 retention rate (the PMF signal)
- First subscription renewal rate
- ARPPU (stabilizes by D30)
- Referral rate (referrers have 3-5x higher LTV)
- Content volume (clips exported, videos shared)

#### Day 60-90

| Aspect | Detail |
|--------|--------|
| **Confidence** | Very high (~90-95% for D180/D365) |
| **Additional precision** | Second/third renewal, seasonal patterns, churn stabilization |
| **What you gain** | Reliable power-law retention curves for cohort |

### Progression Summary

| Window | Accuracy for D90 LTV | Error Margin | Best Use |
|--------|---------------------|--------------|----------|
| D3 | ~40-50% | ~23%+ | Kill bad channels |
| D7 | ~60-70% | ~15% | UA optimization |
| D14 | ~75-85% | ~10% | Cohort quality grading |
| D30 | ~85-90% | ~6.5% | PMF validation |
| D60 | ~90-95% | ~4% | Reliable forecasting |
| D90 | ~95%+ | ~2% | Near-complete picture |

---

## 4. Retention Benchmarks

### Cross-Industry Median (All Consumer Apps)

| Metric | Median |
|--------|--------|
| D1 | 26% |
| D7 | 13% |
| D30 | 7% |

### By Category

| Category | D1 | D7 | D30 |
|----------|-----|-----|------|
| Gaming | 29-33% | 16% | 8.7% |
| Fintech | 22-30% | 17.6% | 11.6% |
| E-commerce | 18-24.5% | 10.7% | 4.8-5% |
| Health & Fitness | 20-27% | 7% | 3% |
| Social/Messaging | 25-29% | 9-10% | 5% |

### a16z "Lightning in a Bottle" (Social/Consumer High Bar)

| Rating | D1 | D7 | D30 |
|--------|-----|-----|------|
| OK | 50% | 35% | 20% |
| Good | 60% | 40% | 25% |
| Great | 70% | 50% | 30% |

### Targets for This App (Sports Video Editor)

| Metric | Floor | Target | Stretch |
|--------|-------|--------|---------|
| D1 | 25% | 30% | 40% |
| D7 | 12% | 18% | 25% |
| D30 | 6% | 10% | 15% |

**Important:** This app is event-driven (games on weekends). Daily retention metrics may mislead. Track **weekly active** and **per-game-event retention** as better proxies.

### LTV/CAC Benchmarks

| Ratio | Interpretation |
|-------|---------------|
| < 1:1 | Losing money on every user |
| 1-2:1 | Acceptable at seed stage only |
| 2-3:1 | Healthy for growth stage |
| 3:1 | Gold standard minimum |
| 3-4:1 | Strong, Series C+ expectation |
| > 5:1 | Very efficient or underinvesting in growth |

### ROAS Targets

| Timeframe | Healthy Target |
|-----------|---------------|
| D7 | 15-25% |
| D30 | 40-60% |
| D90 | 80-100%+ |

---

## 5. The Aha Moment Framework

### Famous Examples

| Company | Aha Moment | Impact |
|---------|-----------|--------|
| Facebook | 7 friends in 10 days | Drove growth to 1B users |
| Slack | 2,000 team messages | 93% team retention |
| Dropbox | 1 file in 1 folder on 1 device | Core activation |
| Twitter | Follow 30 people | "Active forever" |

### Discovery Process (Lenny Rachitsky's Framework)

**Step 1: List candidates** for this app:
- Created first clip from a game video
- Exported first highlight with crop + overlay
- Shared first clip with teammate/spouse
- Created clips from 2+ different games
- Exported 2+ videos in first week

**Step 2: Regression analysis.** Compare D30 retained vs. churned users. For each candidate, measure which action has the biggest gap between groups.

**Step 3: Causal experiments.** Push one cohort toward the action faster (better onboarding, prompts). If retention improves, it's causal. If not, it's a selection effect.

### Likely Aha Moments for This App (ranked)

1. **"Exported first highlight clip"** -- parent sees polished video of their kid's play
2. **"Shared first clip"** -- social commitment + external validation
3. **"Created clips from 2nd game"** -- signals recurring workflow, not novelty

### The Magic Number Concept

Find the threshold action count that predicts retention:

| Candidate | Hypothesis |
|-----------|-----------|
| Export 2 videos in first 7 days | Completing the pipeline twice builds habit |
| Share 1 highlight in first 7 days | Social commitment amplifies value |
| Create clips from 2 different games | Recurring workflow signal |

**To validate:** Need 200-500 users minimum. Split into "did it in first 7d" vs. "didn't." Compare D30/D60/D90 retention. Look for 2x+ gap.

---

## 6. Monetization Analytics

### Revenue Metrics

| Metric | Formula | When to Use |
|--------|---------|-------------|
| **ARPU** | Total Revenue / All Active Users | Evaluating blended economics, UA spend |
| **ARPPU** | Total Revenue / Paying Users Only | Evaluating pricing and upsell |
| **MRR** | Monthly Recurring Revenue | Business health |
| **Net New MRR** | New + Expansion - Contraction - Churned | Growth trajectory |

### RevenueCat 2025 Benchmarks

- Median 14-day ARPU: ~$0.31
- Health & Fitness median: $0.44, upper quartile: $1.31
- High-priced plans: median LTV $55.21 vs. low-priced $8.08 (7x gap)

### Trial-to-Paid Conversion Benchmarks

| Model | Good | Great |
|-------|------|-------|
| Freemium self-serve | 3-5% | 6-8% |
| Free trial (opt-in) | 8-12% | 15-25% |
| Hard paywall | ~12% median | Top apps 60%+ |

**Critical insight:** 80-90% of trial starts happen on Day 0. Onboarding IS your conversion funnel.

### Behavioral Predictors of Monetization (First 7 Days)

| Action | Why It Predicts Conversion |
|--------|---------------------------|
| Uploaded a game video | Committed personal content (sunk cost) |
| Created 3+ clips in first session | Engagement depth |
| Completed first export | Full value loop complete |
| Shared a highlight | Social investment = stickiness |
| Returned on Day 2 or 3 | Habit forming |
| Used 2+ pipeline stages | Breadth signal |

### Simple Early Value Score

```
Upload a video:         +1
Create a clip:          +1
Export a highlight:     +2
Share something:        +2
Return within 48 hours: +1
Use framing or overlay: +1
```

**Score 5+ in first 7 days** = high-conversion-probability segment. Target with premium prompts.
**Score 0-1** = at-risk, needs onboarding intervention.

### Paywall Analytics

Track these in order:
1. **Impression rate** -- % who see paywall (target: 80% in first 3 sessions)
2. **Engagement rate** -- % who interact vs. immediately dismiss
3. **Conversion rate** -- % who start payment
4. **Completion rate** -- % who finish payment
5. **Fatigue rate** -- does conversion decline after impression 3-4?

Key stats:
- Animated paywalls: 2.9x higher conversion vs. static
- Personalized paywalls: ~35% higher conversion
- Gap between best and worst paywall configs: 636% on LTV
- Apps running experiments consistently earn up to 40x more revenue

### Recommended Paywall Strategy

**Metered soft paywall:** Let users complete the full pipeline (annotate -> frame -> overlay -> export) for 1-2 videos free. Gate further exports. This lets them reach the aha moment before asking for money.

### Unit Economics

```
Payback Period (months) = CAC / (Monthly ARPU x Gross Margin %)
```

Example:
- CAC = $15 (organic/referral-heavy)
- Monthly sub = $9.99
- Gross margin = 70%
- Payback = $15 / ($9.99 x 0.70) = **2.1 months** (healthy; benchmark is <12 months)

### Blended LTV (Including Free Users)

```
Blended LTV per signup = (Conversion Rate x Paid LTV) + (K-factor x Value per Referred User)
```

Free users have value via referrals, content, and network effects.

---

## 7. Churn Prediction

### Behavioral Signals (7-14 Days Before Churn)

| Signal | Detection |
|--------|-----------|
| Session frequency drops >30% vs. personal baseline | Rolling 14-day vs. historical |
| Time between sessions increasing | Inter-session interval trend |
| Feature usage narrowing | Distinct features per week declining |
| Export rate declining | Fewer core actions per session |
| Failed payment | Involuntary churn precursor |

### Simple Churn Risk Score (0-100)

```python
churn_risk = (
    (days_since_last_session / 14) * 30 +               # Recency (30%)
    (1 - sessions_last_14d / sessions_prev_14d) * 25 +   # Frequency decline (25%)
    (1 - features_used_last_14d / features_first_30d) * 20 + # Depth decline (20%)
    (1 - exports_last_14d / exports_prev_14d) * 15 +     # Core action decline (15%)
    (failed_payments_last_30d > 0) * 10                   # Payment issues (10%)
)
```

- **0-30:** Healthy
- **31-60:** Medium risk -- 7-14 day re-engagement sequence
- **61-100:** High risk -- immediate intervention (24-48 hours)

### Churn Rate Benchmarks

- Average mobile subscription churn: 9% monthly
- Annual plans reduce churn by 51% vs. monthly
- Healthy target: under 5% monthly, under 3% ideal
- Reactivating a churned customer: 5x cheaper than acquiring new
- 5% retention improvement = 25-95% profit increase

---

## 8. Detecting Bad Feature Pushes

### Guardrail Metrics (monitor on EVERY release)

| Category | Metric | Alert Threshold |
|----------|--------|----------------|
| **Stability** | Error rate (JS + API 5xx) | >2x baseline or >1% of sessions |
| **Stability** | Page crash rate | Any increase >0.5% |
| **Engagement** | DAU/WAU stickiness | Drop >10% WoW |
| **Engagement** | Session duration (median) | Drop >15% |
| **Engagement** | Core action completion rate | Drop >10% |
| **Retention** | D1/D7 retention | Drop >5 percentage points |
| **Performance** | P95 page load time | Increase >500ms |
| **Performance** | P95 API response time | Increase >200ms |
| **Conversion** | Pipeline funnel completion | Drop >10% at any step |

Use **relative change from rolling 4-week baseline**, not absolute numbers (critical at <1000 users).

### Rollout Playbook (Feature Flag + Metrics)

Before writing code, define:
- **Success metric:** What goes UP? (e.g., "export completion +5%")
- **Guardrail metrics:** What must NOT go down?
- **Revert trigger:** Specific condition for rollback

Progressive rollout:

| Stage | % Users | Duration | Gate |
|-------|---------|----------|------|
| Dogfood | Team | 1-2 days | No crashes |
| Canary | 10% | 3-5 days | Guardrails hold |
| Beta | 25-50% | 5-7 days | Success metric trending positive, guardrails hold |
| GA | 100% | Ongoing | -- |

### Leading Indicators (first 24-48 hours)

**Hour 0-4 (technical):**
- Error rate spike correlated with feature flag
- P95 latency increase

**Hour 4-24 (behavioral):**
- Session duration drops
- Core action completion drops
- Rage clicks in session replay

**Hour 24-48 (engagement):**
- D1 retention drops
- Support ticket clustering (2+ about same issue from <1000 users = signal)

**Hour 48-168 (retention):**
- DAU/WAU declining
- Power user behavior changes (canary in the coal mine)

### Analysis Methods for Small User Base (<1000)

| Method | How | Best For |
|--------|-----|----------|
| **Interrupted Time Series** | Compare metric trend before/after release | Single-variable changes |
| **Cohort comparison** | Pre-launch vs. post-launch signups | Feature impact on new users |
| **Session replays** | Watch 10-20 sessions with new feature | UX friction identification |
| **Direct outreach** | Email 5-10 active users | Highest signal per effort |
| **Difference-in-Differences** | Compare users of affected stage vs. unaffected | Localized feature changes |

**Recommended combo:** ITS (daily funnel tracking) + 5-10 session replays + 5 user emails.

### Ship and Revert Protocol

```
SAFETY or DATA INTEGRITY issue?
  YES -> Revert IMMEDIATELY (<5 min)

Guardrail metrics regressed?
  Error/crash rate -> Revert within 1 hour
  Engagement metrics -> Investigate 24-48h, then decide

Success metric direction?
  Positive -> Advance rollout
  Flat after 1 week -> Consider reverting (complexity without value)
  Negative -> Revert or redesign
```

**Revert when:** Cause unclear, fix >20 min, behind feature flag (instant revert).
**Fix forward when:** Bug obvious, fix <20 min, rollback would cause data issues.
**Iterate when:** Guardrails hold but success flat, qualitative feedback says "like the idea, X is confusing."

---

## 9. Dashboard Design

### The Hierarchy

#### L1: Daily Pulse (30-second glance, every morning)

```
+------------------+  +------------------+  +------------------+  +------------------+
|   DAU: 47        |  |  Exports: 12     |  |  Error Rate: 0.3%|  |  Signups: 3      |
|   (vs 42 last wk)|  |  (vs 15 last wk) |  |  (baseline: 0.2%)|  |  (vs 2 last wk)  |
|   [sparkline]    |  |  [sparkline]     |  |  [GREEN]         |  |  [sparkline]      |
+------------------+  +------------------+  +------------------+  +------------------+
```

4 metrics. Big numbers. Green/yellow/red. No interactivity.

#### L2: Weekly Health (5-minute review, Monday morning)

| Metric | Chart Type | Time Range |
|--------|-----------|------------|
| WAU trend | Line | 8 weeks |
| Weekly exports (North Star) | Line | 8 weeks |
| Retention by cohort (D1/D7/D30) | Heatmap | By weekly cohort |
| Pipeline funnel (Upload->Annotate->Frame->Export) | Funnel | This week vs. prior |
| Stickiness (DAU/WAU) | Line | 8 weeks |
| Session duration (median) | Line | 4 weeks |
| Top errors | Table | Last 7 days |

5-9 metrics. Every chart has comparison baseline. Anomalies highlighted.

#### L3: Feature Deep-Dive (on demand, after releases)

| Analysis | Chart Type | Segmentation |
|----------|-----------|--------------|
| Feature adoption over time | Line since launch | New vs. existing users |
| Before/after core metrics | ITS with intervention marker | All, power, new users |
| User flow | Sankey | By segment |
| Session replays | Video | Completed vs. abandoned |
| Drop-off analysis | Funnel | By device, tenure |

Interactive, filterable. Built per-feature, not permanent.

#### L4: Debug (when something breaks)

Error logs, request traces, user session timelines, system metrics. Maximum detail, minimum aggregation.

### Dashboard Anti-Patterns

1. **Metric overload:** >9 metrics per dashboard = 40% engagement drop. "If this changed 20%, would I act?" If no, remove.
2. **Vanity metrics:** Total signups only goes up. Use RATES instead (signup rate this week vs. last).
3. **No baseline:** "47 DAU" means nothing. "47 vs. 42 last week (+12%)" is actionable.
4. **Wrong granularity:** Use weekly for retention, daily for errors. Match your app's natural cadence (weekend games).
5. **Dashboard rot:** Every dashboard needs an owner and 30-day review date.
6. **Missing "so what":** Add threshold indicators + links to investigation tools.

### Alert Setup (3 alerts to start)

1. Error rate > 1% of sessions (Sentry/PostHog)
2. Zero exports in 24h when baseline > 0 (simple query)
3. Weekly health email: this week vs. last (automated script)

**Rules:** False positive rate < 1/week. Suppress during known deploy windows. Every alert must have a clear next action.

---

## 10. OpenPanel: Complete Reference

### Why OpenPanel

| Feature | OpenPanel | Amplitude (Free) | Mixpanel (Free) |
|---------|-----------|-------------------|-----------------|
| Event tracking | Unlimited (self-host) | 10M/mo | 20M/mo |
| Funnels | Yes, real-time, no sampling | Yes | Yes |
| Retention/cohorts | Yes | Yes | Yes |
| Revenue tracking | Yes (`op.revenue()`) | Limited | Yes |
| Session replay | Yes (rrweb, 30-day retention) | No | No |
| Self-hosting | Yes (Docker Compose) | No | No |
| Cookie-free | Yes, GDPR-compliant | No | No |
| A/B analysis | Via property breakdowns | Yes (Experiment) | No |
| AI insights | Anomaly detection (needs API key) | Limited | No |
| MCP server | Yes (38 tools, read-only) | No | No |
| Cost | Free (self-host) | Free to $49+/mo | Free to custom |

### Architecture (Self-Hosted)

| Service | Technology | Purpose |
|---------|-----------|---------|
| op-dashboard | Next.js | UI (port 3000) |
| op-api | Fastify | Event ingestion + API |
| op-worker | Same as API | Background job processing |
| op-db | PostgreSQL 14 | App data (dashboards, orgs, clients) |
| op-ch | ClickHouse | Event/analytics data (the heavy lifter) |
| op-kv | Redis 7.2 | Caching, queues, session state |
| op-proxy | Caddy 2 | Reverse proxy + SSL |

Deploy: mid-range VPS (4 vCPU, 8GB RAM, SSD), Docker Compose. One command.

Key env vars: `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`, `API_URL`, `DASHBOARD_URL`, `COOKIE_SECRET`.

Scaling: PGBouncer for Postgres, increase `EVENT_JOB_CONCURRENCY` (default 10, up to 2000+), add worker replicas.

### Data Model

**Events** (ClickHouse): `id`, `name`, `profile_id`, `device_id`, `session_id`, `project_id`, `groups[]`, `path`, `origin`, `referrer`, `properties Map(String, String)`, `created_at`, geo fields, device fields. Partitioned by month.

**Sessions** (ClickHouse, VersionedCollapsingMergeTree): Deterministic ID from `projectId + deviceId + timeBucket`. 5-minute windows with 1-minute grace. 30-minute inactivity timeout. Tracks entry/exit pages, event count, duration, revenue, bounce status.

**Profiles** (ClickHouse, ReplacingMergeTree): `id`, `is_external` (identified vs anonymous), `first_name`, `last_name`, `email`, `avatar`, `properties Map(String, String)`, `groups[]`.

**Device ID**: SHA-256 of `userAgent + IP + projectId + dailySalt`. Salt rotates at midnight UTC (keeps previous day's salt for boundary).

**Session ID**: SHA-256 of `projectId + deviceId + timeBucket`.

**Profile ID fallback**: When no `profileId` provided, defaults to `deviceId`. After `identify()`, all events use the identified ID.

### Web SDK (`@openpanel/web`)

```typescript
import { OpenPanel } from '@openpanel/web';

const op = new OpenPanel({
  clientId: string,                    // Required. Project client ID.
  // --- Automatic tracking ---
  trackScreenViews?: boolean,          // Auto-track page navigation (pushState/popstate)
  trackOutgoingLinks?: boolean,        // Auto-track external link clicks
  trackAttributes?: boolean,           // Track elements with data-track attribute
  trackHashChanges?: boolean,          // Track hash changes instead of pushState
  // --- Session replay ---
  sessionReplay?: {
    enabled: boolean,
    sampleRate?: number,               // 0-1, fraction of sessions (default: 1)
    maskAllInputs?: boolean,           // Default: true
    maskAllText?: boolean,             // Default: true (replace with ***)
    unmaskTextSelector?: string,       // CSS selector to NOT mask
    blockSelector?: string,            // CSS selector to block entirely
    flushIntervalMs?: number,          // Chunk send interval (default: 10000ms)
    maxEventsPerChunk?: number,        // Default: 200
    maxPayloadBytes?: number,          // Default: 1MB
  },
  // --- Control ---
  disabled?: boolean,                  // Queue events until ready() (for consent)
  filter?: (payload) => boolean,       // Return false to suppress an event
  debug?: boolean,                     // Console-log all calls
  apiUrl?: string,                     // Default: "https://api.openpanel.dev"
});
```

#### All Methods

```typescript
// --- Core tracking ---
op.track(name: string, properties?: Record<string, unknown>)
// Merges global properties. Adds __path automatically.
// Properties can include profileId (override) and groups[] (merge with instance groups).

op.screenView()                        // Auto-detect path + title
op.screenView(properties?: object)     // With extra properties
op.screenView(path: string, props?)    // Explicit path override
// Deduplicates: won't fire twice for same path.

// --- User identification ---
op.identify({
  profileId: string | number,         // Required
  firstName?: string,
  lastName?: string,
  email?: string,                      // Validated format
  avatar?: string,                     // Validated URL
  properties?: Record<string, unknown>
})
// Sets profileId on instance. Flushes queued events. Sends identify event if payload has more than just profileId.

op.setGlobalProperties(props: Record<string, unknown>)
// Merged into this.global. Sent with every subsequent track() and identify(). Does NOT send to server immediately.

op.increment({ profileId, property: string, value?: number })
// Dot-notation supported (e.g., "stats.exports"). Defaults to +1.

op.decrement({ profileId, property: string, value?: number })
// Same as increment but subtracts.

// --- Revenue ---
op.revenue(amount: number, properties?: Record<string, unknown>)
// Sends event named "revenue" with __revenue: amount. Amount MUST be integer.
// Use profileId in properties to attribute to user.

op.pendingRevenue(amount: number, properties?: Record<string, unknown>)
// Stages in memory + sessionStorage. For frontend checkout flows.

op.flushRevenue()
// Sends all pending revenues as actual revenue() calls, then clears.

op.clearRevenue()
// Discards pending revenues without sending.

// --- Groups (B2B) ---
op.upsertGroup({ id, type, name, properties? })
op.setGroup(groupId: string)           // Link current profile to group
op.setGroups(groupIds: string[])       // Link to multiple groups

// --- Session / identity management ---
op.clear()                             // Resets profileId, groups, deviceId, sessionId. Does NOT clear global properties.
op.ready()                             // Sets disabled=false, flushes queue. Call after consent granted.
op.getDeviceId(): string               // Current device ID (empty if not yet assigned)
op.getSessionId(): string              // Current session ID

// --- HTML attribute tracking (when trackAttributes: true) ---
// <button data-track="cta_click" data-plan="pro" data-source-page="pricing">
// Fires: track("cta_click", { plan: "pro", sourcePage: "pricing" })
```

#### Queue Behavior

Events are queued (not sent) when:
- `disabled: true` (waiting for consent)
- `waitForProfile: true` and no profileId set (deprecated)
- Replay events with no sessionId yet

Queued events get `__timestamp` added so the server knows actual occurrence time. On flush, profileId and groups are backfilled from current instance state.

#### API Client Internals

- All events: `POST {apiUrl}/track` as JSON
- Retries: max 3, exponential backoff (500ms, 1s, 2s)
- `keepalive: true` on all requests except replay
- 401 responses: silent failure (no retry)
- Headers: `Content-Type`, `openpanel-client-id`, `openpanel-client-secret` (if set), `openpanel-sdk-name`, `openpanel-sdk-version`
- Response: `{ deviceId, sessionId }` — SDK stores these for subsequent calls

### React Integration

**No dedicated `@openpanel/react` package.** Use `@openpanel/web` directly:

```typescript
// src/analytics/openpanel.ts
import { OpenPanel } from '@openpanel/web';

export const op = new OpenPanel({
  clientId: import.meta.env.VITE_OPENPANEL_CLIENT_ID,
  trackScreenViews: true,
  trackOutgoingLinks: true,
  trackAttributes: true,
});

// Then in components/hooks:
import { op } from '@/analytics/openpanel';
op.track('clip_created', { ... });
```

### Python/FastAPI SDK (`openpanel`)

```bash
pip install openpanel
```

```python
from openpanel import OpenPanel

# Initialize once at app startup
op = OpenPanel(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",     # Required for server-side
    api_url="https://your-openpanel.com",    # For self-hosted
    filter=None,                             # Optional: callable(dict) -> bool
    disabled=False,
)

# Track server-side events
op.track("export_completed", {
    "format": "mp4",
    "duration_seconds": 120,
    "resolution": "1080p",
    "sport": "soccer",
}, profile_id="user_123")

# Identify/update user
op.identify("user_123", {
    "firstName": "Jane",
    "email": "jane@example.com",
    "properties": {"plan": "pro", "total_exports": 42},
})

# Increment profile counter
op.increment("user_123", "exports_count", 1)
op.decrement("user_123", "credits_remaining", 1)

# Clear state
op.clear()  # Resets profileId and global_properties
```

**SDK characteristics:**
- Thread-safe (safe for FastAPI async + threaded workloads)
- Background asyncio event loop for non-blocking HTTP
- Exceptions during send are caught and printed, never raised
- `identify()` signature differs from JS: `identify(profile_id, traits_dict)` not `identify({profileId, ...})`

**Python SDK does NOT have:** `revenue()`, group operations, `pendingRevenue`. Use REST API for revenue from Python.

### REST API (for gaps in Python SDK)

```
POST https://api.openpanel.dev/track
Headers:
  openpanel-client-id: YOUR_CLIENT_ID
  openpanel-client-secret: YOUR_CLIENT_SECRET
  x-client-ip: 1.2.3.4              # For geolocation (optional)
  user-agent: Mozilla/5.0 ...        # For device detection (optional)
  Content-Type: application/json
```

**Revenue from Python (REST):**
```python
import httpx

async def track_revenue(user_id: str, amount_cents: int, plan: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{OPENPANEL_API_URL}/track",
            headers={
                "openpanel-client-id": CLIENT_ID,
                "openpanel-client-secret": CLIENT_SECRET,
                "Content-Type": "application/json",
            },
            json={
                "type": "track",
                "payload": {
                    "name": "revenue",
                    "profileId": user_id,
                    "properties": {
                        "__revenue": amount_cents,  # Integer, in cents
                        "plan": plan,
                    },
                },
            },
        )
```

**All REST payload types:**
```json
// TRACK EVENT
{"type": "track", "payload": {"name": "str", "profileId": "str", "properties": {}, "groups": []}}

// IDENTIFY USER
{"type": "identify", "payload": {"profileId": "str", "firstName": "str", "lastName": "str", "email": "str", "avatar": "url", "properties": {}}}

// INCREMENT/DECREMENT PROFILE PROPERTY
{"type": "increment", "payload": {"profileId": "str", "property": "str", "value": 1}}
{"type": "decrement", "payload": {"profileId": "str", "property": "str", "value": 1}}

// UPSERT GROUP
{"type": "group", "payload": {"id": "str", "type": "company", "name": "Acme", "properties": {}}}

// ASSIGN GROUP TO PROFILE
{"type": "assign_group", "payload": {"groupIds": ["id"], "profileId": "str"}}
```

**Special properties (double-underscore):**
- `__revenue` — Revenue amount (integer). Only on event named `"revenue"`.
- `__deviceId` — Override device ID (for backend revenue linking).
- `__timestamp` — Client-side timestamp (ISO string, for queued events).
- `__path`, `__title`, `__referrer` — Auto-set by web SDK.
- `__utm_source`, `__utm_medium`, `__utm_campaign`, `__utm_content`, `__utm_term` — UTM params.

**Authentication tiers:**
| Type | Access |
|------|--------|
| `write` | Track API only (default) |
| `read` | Export + Insights APIs |
| `root` | All APIs + Manage |

**Rate limits:** Export/Insights: 100 req/10s. Manage: 20 req/10s.

**Server-side event note:** Server events do NOT create sessions (by design). They associate with the user profile but won't appear in session timelines unless a client session is also active.

### Dashboard & Analysis Features

#### 11 Chart Types

1. **Linear** — time-series line charts
2. **Area** — stacked time series with breakdowns
3. **Bar** — categorical comparisons, top-N
4. **Pie** — part-of-whole (max 6 slices)
5. **Metric** — single KPI number
6. **Funnel** — step-by-step conversion with drop-off
7. **Retention** — cohort retention grid
8. **Conversion** — A-to-B conversion rate over time
9. **Sankey** — multi-step user flow (3+ events)
10. **Map** — geographic breakdown
11. **Histogram** — distribution of numeric properties

#### Dashboards

- **Multiple custom dashboards** — create as many as needed
- **Grafana-style grid layout** — drag-and-drop, resizable widgets (min 3x3)
- **Global time range + interval** per dashboard
- **Sharing** — public or password-protected links, embeddable with `?header=0`
- **Auto-generated project overview** — 6-column grid with sources, pages, devices, events, geo

#### Funnel Analysis

- Select sequence of events as steps (e.g., 5-step activation funnel)
- Step-by-step conversion rates, drop-off volumes, time between steps
- Filter by any event/user property
- Segment comparison (breakdown by plan, campaign, device, etc.)
- Real-time, no sampling
- Save to dashboards

#### Retention Analysis

- Define initial event (e.g., `signup_completed`) and return event (e.g., `session_started`)
- Grid view: rows = cohorts, columns = time periods
- Day, week, or month granularity
- Segment by user properties (plan, source, etc.)
- Revenue retention across cohorts

#### Event Explorer

- Paginated event stream with infinite scroll
- Filter by event name, user, date range, properties
- Click into individual events for full context
- Report builder: pick events, apply filters, breakdowns, time-series with intervals
- Aggregation: sum, avg, min, max on numeric properties
- Period-over-period comparison

#### User Profiles

- **3 tabs:** Identified, Anonymous, Power Users (algorithmically detected)
- **Profile page:** first/last seen, metrics overview, properties, activity heatmap, latest events, most frequent events, popular pages
- **Sub-tabs:** Overview, Events (full history), Sessions (all sessions)
- Anonymous-to-identified merge on `identify()`
- Searchable, paginated (50/page)

#### Cohorts (User Segments)

- Define segments based on events and properties
- **Dynamic** (recalculates membership) and **Static** (fixed list)
- Export members as CSV
- View cohort: Overview, Events, Members tabs

#### Realtime

- Live map (geographic markers), active sessions, live histogram
- Realtime referrals, paths
- Live visitor count in header

#### Revenue in UI

- Revenue trends (daily/weekly/monthly)
- Breakdown by plan, source, campaign, custom properties
- Revenue per user/session (LTV, AOV, revenue per visit)
- Cohort-based revenue retention
- Revenue in funnel analysis (revenue at each stage)

#### Session Replay

- DOM mutations, clicks, scrolls, form interactions (via rrweb)
- All text masked by default, all inputs masked
- Selective unmasking via CSS selectors / `data-openpanel-unmask`
- Block elements with `data-openpanel-replay-block`
- Linked to user session timeline — jump from events to replay
- 30-day retention, unlimited recordings
- Async loading, zero bundle impact when disabled

#### Web Analytics (Zero-Config)

- Unique visitors, sessions, pageviews, bounce rate, session duration
- Top referrers, search engines, social networks
- Full UTM: source, medium, campaign, term, content (automatic)
- Country/region/city with interactive map
- Browser, OS, device brand/model
- Entry/exit pages, user path flow
- Every value clickable for instant filtering

#### AI Insights

- Automatic anomaly and trend detection
- Filterable by: time window, severity (severe/moderate/low), direction
- Grouped: Geographic, Devices, Referrers, Pages, Anomalies
- Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` env var

#### Alerts / Notifications

- **Event-match rules:** Fire on specific events (e.g., every `error_tracked`)
- **Property filters:** Stackable operators (equals, starts_with, etc.)
- **Channels:** Slack (OAuth), Discord (OAuth), Webhooks (custom URL + headers)
- **Template variables:** `{{country}}`, `{{browser}}`, `{{path}}`, custom properties
- **Notification log:** Searchable history of all fired notifications
- **NOT supported:** Threshold-based alerts, absence-based alerts, rate-based alerts

#### Export API

- **Raw events:** Paginated, filterable (`GET /export/events`, requires `read` client)
- **Aggregated charts:** Time-series with breakdowns (`GET /export/charts`)
- **Insights API:** Visitors, sessions, bounce rate, pages, sources, geo, tech, UTM
- **MCP Server:** 38 tools for querying via Claude/Cursor/VS Code (read-only)

### Concept-to-Feature Mapping

How every analytics playbook concept maps to OpenPanel:

| Playbook Concept | OpenPanel Feature | Quality | Notes |
|-----------------|-------------------|---------|-------|
| **North Star (weekly exports)** | Conversion chart + time series | Good | No "big number" KPI card; use time series with weekly interval |
| **Activation funnel** | Funnels (native) | Strong | 5-step funnel maps directly. No conversion window config. |
| **Cohort retention (D1/D7/D30)** | Retention grid (native) | Strong | Full matrix (D1, D2, D3...), cannot cherry-pick days |
| **User segmentation** | Property filtering + Cohorts | Moderate | No saved dynamic behavioral segments; push computed segments via `identify()` |
| **Revenue / ARPU / MRR** | Revenue events native; ARPU/MRR manual | Moderate | Revenue trends + cohort revenue yes; auto ARPU/MRR no |
| **Feature adoption %** | Conversion chart as proxy | Moderate | "% who did X given they did Y" — not cumulative all-time |
| **Paywall funnel** | Funnels (native) | Strong | Same as activation funnel |
| **Stickiness (DAU/WAU)** | Not native | Gap | Use Export API + external computation |
| **LTV calculation** | Not native | Gap | Revenue per user in profiles; no LTV curves or projections |
| **Churn detection** | Not native | Gap | Push `churn_risk` as user property from backend |
| **Feature flag integration** | Not native | Gap | Send variant as event property, breakdown in reports |
| **Threshold/absence alerts** | Not native (event-match only) | Gap | Use cron job + Export API + Slack webhook |
| **L1 daily pulse dashboard** | Custom dashboard | Moderate | No "big number" hero cards; use Metric chart type |
| **L2 weekly health dashboard** | Custom dashboard | Strong | Funnels, retention, time series all available |
| **L3 feature deep-dive** | Sankey, funnels, session replay | Strong | Build per-feature on demand |
| **UTM / acquisition** | Web analytics (zero-config) | Strong | Best-in-class; automatic UTM, referrer, geo, device |
| **Server-side Python** | Python SDK (thread-safe) | Strong | Missing `revenue()` — use REST API |
| **Session replay** | rrweb-based (native) | Strong | Privacy-first defaults, linked to event timeline |
| **A/B analysis** | Property breakdown in charts | Moderate | No experiment assignment/significance; external flag tool needed |

### Filling the Gaps (Backend Supplement)

For concepts OpenPanel doesn't compute natively, push computed values back as user properties:

```python
# Nightly job in FastAPI
async def compute_analytics_properties():
    for user in active_users:
        # Stickiness: query OpenPanel Export API for DAU/WAU
        dau_count = await query_active_days(user.id, days=7)
        stickiness = dau_count / 7

        # Churn risk score (from playbook formula)
        risk = compute_churn_risk(user)

        # Engagement tier
        tier = "power" if user.exports_30d > 10 else "active" if user.exports_30d > 2 else "casual"

        # Push back to OpenPanel
        op.identify(user.id, {
            "properties": {
                "stickiness_7d": round(stickiness, 2),
                "churn_risk": risk,
                "engagement_tier": tier,
                "ltv_estimated": compute_ltv(user),
                "days_since_last_active": user.days_inactive,
            }
        })
```

Then in OpenPanel: filter/breakdown any report by `engagement_tier`, `churn_risk`, etc.

### Threshold Alerts (External Cron)

Since OpenPanel only supports event-match alerts, build a lightweight cron for threshold/absence alerts:

```python
# scripts/analytics_alerts.py — run hourly via cron
async def check_guardrails():
    # 1. Zero exports in 24h
    exports_24h = await openpanel_export_api("export_completed", hours=24)
    if exports_24h == 0:
        await send_slack("Zero exports in last 24h")

    # 2. Error rate > 1%
    errors = await openpanel_export_api("error_tracked", hours=1)
    sessions = await openpanel_export_api("session_started", hours=1)
    if sessions > 0 and errors / sessions > 0.01:
        await send_slack(f"Error rate {errors/sessions:.1%} (threshold: 1%)")

    # 3. Weekly health digest (run Monday 9am)
    if is_monday_morning():
        this_week = await get_weekly_metrics()
        last_week = await get_weekly_metrics(offset=7)
        await send_slack(format_weekly_digest(this_week, last_week))
```

---

## 11. Implementation Checklist

### Phase 1: Foundation (Week 1-2)
- [ ] Deploy OpenPanel (self-hosted)
- [ ] Create events constants file (TypeScript + Python)
- [ ] Instrument activation funnel: signup -> first upload -> first clip -> first export -> first share
- [ ] Track time between each activation step
- [ ] Set up global properties and user identification
- [ ] Build L1 dashboard (4 metrics)

### Phase 2: Core Analytics (Week 3-4)
- [ ] Instrument remaining ~25 events from taxonomy
- [ ] Add event properties (duration, method, is_first, lifetime_count)
- [ ] Set up weekly cohort retention tracking
- [ ] Build L2 dashboard (weekly health)
- [ ] Set up 3 starter alerts

### Phase 3: Monetization (Week 5-6)
- [ ] Instrument paywall funnel (impression -> engagement -> conversion -> completion)
- [ ] Add revenue tracking via `op.revenue()`
- [ ] Build early value scoring (per user)
- [ ] Track trial-to-paid conversion

### Phase 4: Intelligence (Month 2-3)
- [ ] Run aha moment regression (need 200+ users)
- [ ] Compute D90/D7 K-factors from first cohorts
- [ ] Build churn risk score
- [ ] Build L3 feature deep-dive template
- [ ] Set up feature flag + guardrail metric pairing

### Phase 5: Optimization (Month 3+)
- [ ] A/B test paywall configurations
- [ ] Graduate to coefficient-based LTV prediction
- [ ] Refine magic number hypothesis
- [ ] Weekly North Star review cadence

---

## Key Formulas Quick Reference

```
LTV (subscription)       = ARPU / Monthly Churn Rate
LTV (retention-based)    = ARPDAU x SUM(Retention(day_i))
Retention (power law)    = a * day^b
Predicted D90 LTV        = D7 LTV x K_factor (K = 1.5-2.5x)
Payback Period (months)  = CAC / (Monthly ARPU x Gross Margin %)
Blended LTV              = (Conv Rate x Paid LTV) + (K-factor x Referral Value)
Stickiness               = DAU / MAU (or DAU / WAU)
Churn Risk Score          = weighted sum of recency, frequency, depth, action, payment signals
```
