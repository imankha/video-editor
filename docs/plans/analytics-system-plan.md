# Analytics System Plan

> Complete requirements, architecture, and implementation plan for the Reel Ballers analytics system.
> This document is the single source of truth for what we're building, why, and how.

---

## 1. System Goals

### 1.1 What This System Must Answer

Every metric in this system exists to answer one of six questions:

| # | Question | Time to Answer | Who Asks |
|---|----------|---------------|----------|
| 1 | **Is the product healthy right now?** | 30 seconds | Founder, every morning |
| 2 | **Will this cohort be profitable?** | 5 minutes | Founder, weekly |
| 3 | **Where are users falling off?** | 2 minutes | PM/Founder, after releases |
| 4 | **Did we push a bad feature?** | < 4 hours | Engineer, after deploys |
| 5 | **Is the business growing?** | 5 minutes | Founder, weekly/monthly |
| 6 | **Are credits driving behavior or blocking it?** | 2 minutes | Founder, weekly |

### 1.2 Design Principles

1. **Tickers over snapshots.** Every key metric is a y-value vs. time chart, updating in real-time or near-real-time. Trends are more informative than point-in-time values.

2. **Summary -> drill-down.** One summary view with clickable sections that open the relevant dashboard beneath each summary card. Never more than 2 clicks to the data you need.

3. **Real-time where it matters.** Active connections, errors, and exports stream live. Cohort analysis and LTV can lag by hours.

4. **Computed intelligence pushed back.** OpenPanel handles raw events; our backend computes derived metrics (churn risk, LTV, engagement tier, stickiness, credit health) and pushes them back as user properties for filtering.

5. **No vanity metrics.** Every number on a dashboard must be a rate, ratio, or comparison -- never a cumulative total that only goes up.

6. **Weekly cadence awareness.** Reel Ballers usage follows a game-weekend pattern (upload Saturday/Sunday, edit Monday-Wednesday). Daily metrics can mislead -- always show weekly aggregates alongside daily, and track per-game-event retention as the primary retention signal.

---

## 2. Architecture Overview

```
+---------------------------------------------------------------------+
|                         DATA SOURCES                                 |
+------------------+------------------+--------------------------------+
|  Frontend (React) |  Backend (FastAPI) |  External (Stripe)          |
|  @openpanel/web   |  openpanel (Python) |  REST API webhooks          |
|  UX events        |  Business events    |  Credit purchase events     |
+--------+---------+--------+---------+----------+---------------------+
         |                  |                     |
         v                  v                     v
+---------------------------------------------------------------------+
|                    OPENPANEL (Self-Hosted)                            |
|  +----------+  +----------+  +----------+  +---------------------+  |
|  | Fastify   |  |ClickHouse|  | Redis    |  | PostgreSQL          |  |
|  | API       |  | Events   |  | Sessions |  | Dashboards/Config   |  |
|  | Ingestion |  | Profiles |  | Queues   |  | Orgs/Projects       |  |
|  +----------+  +----------+  +----------+  +---------------------+  |
|                                                                      |
|  Native Features:                                                    |
|  - Funnels (real-time, no sampling)                                  |
|  - Retention grids (day/week/month cohorts)                          |
|  - Revenue tracking (trends, cohort revenue)                         |
|  - Session replay (rrweb, privacy-first)                             |
|  - Realtime (live map, active sessions)                              |
|  - Web analytics (UTM, referrers, geo, device -- zero-config)        |
|  - AI insights (anomaly detection)                                   |
|  - 11 chart types on custom dashboards                               |
|  - User profiles with event timeline                                 |
|  - Export API (raw events + aggregated charts)                       |
+--------------------------------+------------------------------------+
                                 |
                                 | Export API (read client)
                                 v
+---------------------------------------------------------------------+
|                    ANALYTICS ENGINE (FastAPI)                         |
|                                                                      |
|  Nightly Job:                     Hourly Cron:                       |
|  - Compute churn risk scores      - Threshold alerts                 |
|  - Compute engagement tiers       - Absence alerts (zero exports)    |
|  - Compute estimated LTV          - Error rate checks                |
|  - Compute stickiness (DAU/WAU)   - Credit expiry warnings           |
|  - Compute credit health metrics                                     |
|  - Compute ARPU / revenue         Weekly Cron:                       |
|  - Push all back via identify()   - Health digest to Slack           |
|                                   - Cohort K-factor recalculation    |
|  Viral Tree Tracker:                                                 |
|  - shared_by chain depth          On-Demand:                         |
|  - Team share attribution         - Feature release impact analysis  |
|  - K-factor computation           - Magic number regression          |
+--------------------------------+------------------------------------+
                                 |
                                 | Slack webhook
                                 v
+---------------------------------------------------------------------+
|                    ALERT DESTINATIONS                                 |
|  - Slack channel (#analytics-alerts)                                 |
|  - Weekly health digest email                                        |
|  - OpenPanel event-match notifications (real-time per-event)         |
+---------------------------------------------------------------------+
```

### 2.1 What Lives Where

| Concern | Where | Why |
|---------|-------|-----|
| Event ingestion + storage | OpenPanel (ClickHouse) | Built for high-volume event analytics |
| Funnels, retention, session replay | OpenPanel (native) | First-class features, no sampling |
| Dashboards + charts | OpenPanel (custom dashboards) | Drag-and-drop, 11 chart types, shareable |
| UTM/referrer/geo/device | OpenPanel (auto) | Zero-config, best-in-class |
| Real-time active connections | OpenPanel (realtime view) | Live map, active sessions, geo |
| Churn risk, LTV, stickiness, credit health | FastAPI analytics engine | OpenPanel doesn't compute derived metrics |
| Threshold / absence alerts | FastAPI cron | OpenPanel only does per-event alerts |
| Viral tree tracking (shares + team shares) | FastAPI + Postgres | Custom data model for invite chains |
| Revenue ingestion (Stripe credit purchases) | FastAPI REST -> OpenPanel | Python SDK lacks `revenue()`; use REST API |
| Credit balance / expiry tracking | FastAPI + per-user SQLite | Credit state lives in user DBs, not OpenPanel |

---

## 3. Dashboard Hierarchy

### 3.1 L0: North Star

**One number. One question: "Are we winning?"**

| Metric | Definition | Target |
|--------|-----------|--------|
| **Weekly Exports Completed** | Count of `export_completed` events in trailing 7 days | Monotonically increasing WoW |

This is the number everything else feeds into. An export = a parent got a highlight reel of their kid's play. That is the core value delivery of Reel Ballers.

### 3.2 L1: Daily Pulse Dashboard

**Audience:** Founder. **Cadence:** Every morning. **Time to consume:** 30 seconds.

```
+--------------------------------------------------------------------------+
|  L1: DAILY PULSE                                            [Live] G     |
+------------------+------------------+------------------+-----------------+
|  DAU             |  Exports Today   |  Error Rate      |  New Signups    |
|  ## 47           |  ## 12           |  ## 0.3%         |  ## 3           |
|  ^ +12% vs LW   |  v -20% vs LW   |  . GREEN         |  ^ +50% vs LW  |
|  _/\/\___/\__    |  _/\__/\_/\_     |  ___________     |  __/\___/\_    |
|  [7d sparkline]  |  [7d sparkline]  |  [7d sparkline]  |  [7d sparkline] |
+------------------+------------------+------------------+-----------------+
|  ACTIVE NOW: 8 users | Map: US(5) UK(2) CA(1)  | Sources: direct(4)     |
|                       |                          | google(2) share(2)    |
+--------------------------------------------------------------------------+
  [Click any card to drill down to L2]
```

**4 ticker cards** (real-time line charts, y vs. time):

| Card | Event/Metric | Chart | Comparison | Alert Threshold |
|------|-------------|-------|------------|-----------------|
| **DAU** | Unique `session_started` profiles/day | Sparkline (7d) | vs. same day last week | Drop >20% WoW |
| **Exports Today** | Count of `export_completed` / day | Sparkline (7d) | vs. same day last week | Zero in 24h |
| **Error Rate** | `error_tracked` / `session_started` | Sparkline (7d) | vs. 4-week rolling avg | >1% of sessions |
| **New Signups** | Count of `signup_completed` / day | Sparkline (7d) | vs. same day last week | -- |

**Real-time strip** (bottom of L1):

| Widget | OpenPanel Feature | Data |
|--------|-------------------|------|
| Active users count | Realtime -> live visitor count | Live |
| Geographic map | Realtime -> live map | Active sessions by country |
| Traffic sources | Realtime -> realtime referrals | Current traffic origins |

**OpenPanel implementation:**
- Create dashboard "Daily Pulse"
- 4x Metric chart type (one per card) with daily interval, 7-day range
- Period-over-period comparison enabled (vs. previous period)
- Realtime view linked from bottom strip (OpenPanel's native realtime page)

### 3.3 L2: Weekly Health Dashboard

**Audience:** Founder doing weekly planning. **Cadence:** Monday morning. **Time to consume:** 5 minutes.

Clicking any L1 card opens the relevant L2 section. L2 has 7 sections:

#### Section A: Growth (feeds L1 -> DAU + Signups)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| WAU trend | Linear (line) | 8 weeks | Are we growing? |
| New signups per week | Linear (line) | 8 weeks | Is acquisition working? |
| Signup method breakdown | Bar | 4 weeks | Google vs. OTP split |
| Signup sources breakdown | Bar | 4 weeks | Organic vs. share-link vs. paid |
| Organic vs. paid ratio | Area (stacked) | 8 weeks | Are we building organic? |

#### Section B: Activation & Funnels (feeds L1 -> Exports)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Activation funnel | Funnel | This week vs. prior week | Where do new users fall off? |
| Pipeline funnel | Funnel | This week vs. prior week | Upload->Annotate->Frame->Overlay->Export |
| Activation rate ticker | Linear (line) | 8 weeks | % completing first export within 7d |
| Time-to-first-export | Histogram | 4 weeks | Distribution of hours to first export |
| Quest completion rates | Bar | 4 weeks | Which quest steps stall users? |

**Activation funnel steps:**
1. `signup_completed`
2. `first_video_uploaded` (first game uploaded, costs free credits)
3. `first_clip_created` (first annotation marked on timeline)
4. `first_export_completed` (first polished highlight reel)
5. `first_share_completed` (first share to teammate, social, or link)

**Pipeline funnel steps** (all users, not just new):
1. `video_uploaded` (game uploaded to Annotate mode)
2. `clip_created` (clip marked on timeline with start/end regions)
3. `crop_applied` (Framing mode: crop keyframes or aspect ratio set)
4. `overlay_applied` (Overlay mode: highlight ellipse placed)
5. `export_completed` (final reel downloaded or available in Gallery)

#### Section C: Retention & LTV (feeds L1 -> DAU)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Retention grid (D1/D7/D14/D30) | Retention | By weekly cohort | Are users coming back? |
| Weekly active rate (WAU/MAU) | Linear (line) | 8 weeks | Is usage becoming habitual? |
| Per-game-event retention | Linear (line) | 8 weeks | Do users return for their next game? |
| Revenue per cohort | Area (stacked) | By weekly cohort | Are recent cohorts monetizing? |
| Estimated LTV by cohort | Linear (line) | Monthly cohorts | Is LTV improving? |
| D14/D7 retention ratio | Linear (line) | 8 weeks | Is the retention curve flattening? |

**Retention grid config:**
- Initial event: `signup_completed`
- Return event: `session_started`
- Granularity: Weekly cohorts (matches game-weekend cadence)
- Segment by: `has_purchased` (free vs. paid)

**Per-game-event retention:** Measures "after uploading game N, did they upload game N+1?" This is the truest retention signal for a weekend-game-driven app where daily return doesn't always apply.

**Stickiness, LTV** -- computed by backend analytics engine, pushed as user properties, charted as time series of cohort averages.

#### Section D: Monetization -- Credits (feeds -> Revenue)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Weekly credit revenue | Linear (line) | 8 weeks | Revenue trajectory |
| ARPU ticker (revenue / active users) | Linear (line) | 8 weeks | Revenue per user trending |
| Credits purchase funnel | Funnel | 4 weeks | Where does purchase flow break? |
| Free-to-paid conversion rate | Conversion | 8 weeks | % of free users who buy credits |
| Credit pack distribution | Pie | Current month | 1-pack vs. 5-pack vs. 20-pack split |
| Repurchase rate (30d) | Linear (line) | 8 weeks | % who buy again after credits run out |
| Credit utilization rate | Linear (line) | 8 weeks | Credits used / credits purchased |

**Credits purchase funnel steps:**
1. `credits_modal_viewed` (insufficient credits modal shown)
2. `credit_purchase_started` (user clicks a pack option)
3. `credits_purchased` (Stripe payment succeeds)
4. `video_uploaded` (user spends credits on a game)

**Repurchase rate** is the credit-economy equivalent of subscription retention. A user "churns" when their credits expire and they don't buy more within 30 days.

**Credit utilization** matters because unused-but-expired credits mean the user paid but didn't get value -- a leading indicator of non-repurchase.

#### Section E: Quality & Stability (feeds L1 -> Error Rate)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Error rate ticker | Linear (line) | 4 weeks | Is stability improving? |
| Top errors table | Bar | Last 7 days | What's breaking most? |
| P95 API latency ticker | Linear (line) | 4 weeks | Is the backend fast enough? |
| Export success rate | Conversion | 4 weeks | % of started exports that complete |
| GPU job success rate | Conversion | 4 weeks | Modal upscale reliability |
| Session duration (median) | Linear (line) | 4 weeks | Engagement depth |

#### Section F: Virality & Sharing (feeds -> Growth)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Shares per user per week | Linear (line) | 8 weeks | Is sharing increasing? |
| Share type breakdown | Bar | 4 weeks | Reel shares vs. team shares vs. public links |
| Team share adoption | Linear (line) | 8 weeks | % of annotators using teammate tagging |
| Viral tree depth | Bar | 4 weeks | How many degrees of sharing? |
| K-factor ticker | Linear (line) | 8 weeks | Is growth viral? |
| Share-to-signup conversion | Conversion | 8 weeks | Do share recipients become users? |
| Acquisition by source | Area (stacked) | 8 weeks | Channel mix evolution |

**K-factor** = invites sent per user x invite conversion rate. Computed by backend.

**Viral tree** -- tracked via `shared_by` attribution chain in Postgres. Properties pushed to OpenPanel:
- `share_depth` (how many degrees from original sharer)
- `ultimate_source` (first user in the chain)
- `share_chain_length` (total chain length)

**Team sharing metrics** -- the T2800 epic's teammate tagging creates a natural viral loop: parent tags teammates -> teammates get clips -> teammates sign up to view/edit. Track the full funnel from tag to signup.

#### Section G: Engagement -- Quests & Features (feeds -> Retention)

| Widget | Chart Type | Time Range | What It Answers |
|--------|-----------|------------|-----------------|
| Quest funnel (5-step) | Funnel | 4 weeks | Where do users stall in progression? |
| Quest completion rate by step | Bar | 4 weeks | Which quests need UX work? |
| Feature adoption by mode | Bar | 4 weeks | Annotate vs. Framing vs. Overlay usage |
| Star rating distribution | Histogram | 4 weeks | How users rate their clips |
| AI upscale adoption | Linear (line) | 8 weeks | Is the premium feature gaining traction? |
| Streak distribution | Histogram | Current | How many consecutive active days? |
| Aspect ratio preferences | Pie | 4 weeks | 9:16 vs. 16:9 vs. 1:1 vs. 4:5 |

**Quest funnel steps:**
1. Upload first game
2. Annotate first clips
3. Create first reel
4. Export first highlight
5. Share first highlight

### 3.4 L3: Feature Deep-Dive Dashboard

**Audience:** PM/Engineer after a release. **Cadence:** On demand. **Time to consume:** 10-15 minutes.

Built per-feature, not permanent. Template:

| Widget | Chart Type | Segmentation |
|--------|-----------|--------------|
| Feature adoption over time | Linear (line) | New vs. existing users |
| Before/after core metrics (ITS) | Linear with vertical line at release | All users, power users, new users |
| User flow through feature | Sankey (3+ events) | By user segment |
| Session replays | Session replay | Users who completed vs. abandoned |
| Drop-off analysis | Funnel per feature step | By device, by user tenure |
| Feature usage by engagement tier | Bar | power / active / casual |

**Per-release checklist:**
1. Mark release date as an OpenPanel Reference (via Manage API)
2. Create L3 dashboard with feature-specific events
3. Compare 7-day pre/post metrics
4. Watch 5-10 session replays of users hitting the new feature
5. Archive dashboard after 30 days if no issues found

### 3.5 L4: Debug Dashboard

**Audience:** Engineer hunting a bug. **Cadence:** When something breaks.

This lives mostly outside OpenPanel:

| Tool | Purpose |
|------|---------|
| OpenPanel -> Event Explorer | Filter events by user, session, time |
| OpenPanel -> User Profiles -> Events tab | Full event timeline for specific user |
| OpenPanel -> Session Replay | Watch what the user did |
| Sentry (or equivalent) | Stack traces, error grouping |
| FastAPI logs (via reduce_log) | Backend error context |
| Browser DevTools | Network waterfall, console errors |
| Admin Panel -> User lookup | Credit balance, export count, quest progress |

**OpenPanel's role in L4:** Start with the user profile, see their event timeline, jump to session replay at the moment of the error. Then switch to Sentry/logs for the technical details.

---

## 4. Event Instrumentation Plan

### 4.1 Complete Event Catalog

Every event, where it's tracked, what properties it carries, and which dashboard uses it.

#### Acquisition / Activation Events (8 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `signup_completed` | Backend | `method` (google/otp), `referral_source`, `utm_*`, `referred_by` | L2-A, L2-B |
| `onboarding_step_completed` | Frontend | `step_name`, `step_number`, `total_steps` | L2-B |
| `first_video_uploaded` | Frontend | `video_duration`, `file_size_mb`, `sport`, `credits_cost`, `time_since_signup_min` | L2-B |
| `first_clip_created` | Frontend | `clip_duration`, `star_rating`, `method`, `time_since_signup_min` | L2-B |
| `first_export_completed` | Backend | `format`, `resolution`, `aspect_ratio`, `has_overlay`, `has_crop`, `time_since_signup_hours` | L2-B |
| `first_share_completed` | Frontend | `share_method` (teammate/public_link/email), `time_since_signup_hours` | L2-B, L2-F |
| `first_credit_purchase` | Backend | `pack_size` (1/5/20), `amount_cents`, `time_since_signup_days`, `free_credits_remaining` | L2-D |
| `feature_discovered` | Frontend | `feature_name` (framing/overlay/team_share/upscale/quests), `discovery_method` (organic/tooltip/onboarding) | L3 |

#### Engagement / Core Loop Events (14 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `video_uploaded` | Frontend | `duration_seconds`, `file_size_mb`, `sport`, `credits_cost`, `game_video_count` (multi-video game), `is_first`, `lifetime_count` | L2-B |
| `clip_created` | Frontend | `clip_duration`, `game_id`, `star_rating` (1-5), `tags[]`, `has_note`, `is_first`, `lifetime_count` | L2-B |
| `clip_rated` | Frontend | `rating` (1-5), `rating_label` (brilliant/good/interesting/mistake/blunder), `clip_id` | L2-G |
| `crop_applied` | Frontend | `aspect_ratio` (9:16/16:9/1:1/4:5), `keyframe_count`, `has_speed_changes`, `is_first` | L2-B |
| `overlay_applied` | Frontend | `highlight_count`, `effect_type` (brightness/dark), `has_transition`, `is_first` | L2-B |
| `export_started` | Frontend | `format`, `resolution`, `has_upscale`, `clip_count` (multi-clip project) | L2-E |
| `export_completed` | Backend | `duration_seconds`, `output_size_mb`, `format`, `resolution`, `aspect_ratio`, `has_upscale`, `is_first`, `lifetime_count` | L1, L2-B, L2-E |
| `export_failed` | Backend | `error_type`, `stage` (ffmpeg/upscale/encode), `duration_before_failure` | L2-E |
| `clip_shared` | Frontend | `method` (teammate_tag/public_link/email/copy_link), `recipient_count`, `is_first` | L2-F |
| `team_share_sent` | Frontend | `tag_count`, `recipient_count`, `clips_per_recipient_avg` | L2-F |
| `gallery_viewed` | Frontend | `reel_count`, `filter_applied` | L3 |
| `project_opened` | Frontend | `project_age_days`, `clip_count`, `current_mode` (annotate/framing/overlay) | L3 |
| `auto_project_created` | Frontend | `clip_count`, `trigger` (5_star_clip) | L2-G |
| `segment_speed_changed` | Frontend | `speed_value`, `segment_count` | L3 |

#### Retention Signal Events (5 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `session_started` | Frontend (auto) | `days_since_last_session`, `session_number`, `return_source` | L1, L2-C |
| `game_created` | Frontend | `sport`, `video_count` (multi-video), `game_count_lifetime`, `is_first` | L3 |
| `profile_created` | Frontend | `sport`, `is_additional` (2nd+ athlete), `profile_count` | L2-G |
| `profile_switched` | Frontend | `from_sport`, `to_sport` | L2-G |
| `recap_mode_viewed` | Frontend | `game_age_days`, `clip_count`, `credits_expired_days_ago` | L2-C, L2-G |

#### Monetization Events -- Credits (5 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `credits_modal_viewed` | Frontend | `trigger` (upload_insufficient/expiry_warning/manual), `credits_remaining`, `credits_needed`, `current_pack_expiry_days` | L2-D |
| `credit_purchase_started` | Frontend | `pack_size` (1/5/20), `trigger`, `modal_impression_count` | L2-D |
| `credits_purchased` | Backend | `pack_size`, `amount_cents`, `currency`, `credits_remaining_before`, `is_first_purchase`, `time_since_signup_days` | L2-D |
| `credits_consumed` | Backend | `credits_used`, `trigger` (game_upload/upload_surcharge), `credits_remaining_after`, `game_id` | L2-D |
| `credits_expired` | Backend | `credits_expired_count`, `credits_remaining`, `days_since_last_purchase` | L2-D |

#### Revenue Event (1 event, special)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `revenue` | Backend (REST API) | `__revenue` (integer, cents), `pack_size`, `currency` | L2-D |

#### Quest & Achievement Events (3 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `quest_step_completed` | Frontend | `quest_name`, `step_number`, `total_steps`, `time_since_prev_step_hours` | L2-G |
| `quest_completed` | Frontend | `quest_name`, `total_time_hours`, `is_first_quest` | L2-G |
| `streak_milestone` | Frontend | `streak_days`, `milestone` (3/7/14/30) | L2-G |

#### Feature Adoption Events (4 events)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `ai_upscale_requested` | Frontend | `resolution`, `estimated_time`, `clip_duration` | L2-G, L3 |
| `teammate_tagged` | Frontend | `tag_name`, `clip_count_for_tag`, `is_new_tag` | L2-F |
| `shared_annotation_viewed` | Frontend | `viewer_is_registered`, `time_to_view_hours`, `clips_in_share` | L2-F |
| `aspect_ratio_selected` | Frontend | `ratio` (9:16/16:9/1:1/4:5), `platform_intent` (ig_reels/youtube/tiktok/other) | L2-G |

#### Error Tracking (1 event)

| Event | Source | Key Properties | Dashboard |
|-------|--------|---------------|-----------|
| `error_tracked` | Frontend + Backend | `error_type`, `message`, `component`, `severity`, `stack_hash` | L1, L2-E |

**Total: 41 events.**

### 4.2 User Properties

Set via `identify()` and `increment()`. Used for segmentation across all dashboards.

| Property | Set When | Updated When | Type | Used By |
|----------|----------|--------------|------|---------|
| `signup_date` | signup | never | string (ISO) | L2-C cohorts |
| `signup_method` | signup | never | string (google/otp) | L2-A segmentation |
| `has_purchased` | first purchase | never (sticky) | boolean | All dashboards |
| `primary_sport` | first game | recalculated from game history | string | Segmentation |
| `athlete_count` | first profile | on profile create/delete | int | Segmentation |
| `activation_status` | signup (`not_activated`) | on aha moment | string | L2-B |
| `total_exports` | first export | `increment()` each export | int | Segmentation |
| `total_shares` | first share | `increment()` each share | int | L2-F |
| `total_games` | first game | `increment()` each game | int | Segmentation |
| `total_credits_purchased` | first purchase | `increment()` each purchase | int | L2-D |
| `lifetime_revenue_cents` | first purchase | `increment()` each purchase | int | L2-D |
| `credits_remaining` | signup (8 free) | on purchase/consume/expire | int | L2-D, churn |
| `last_active_date` | first session | each session | string (ISO) | Churn detection |
| `last_game_upload_date` | first upload | each upload | string (ISO) | Retention |
| `quest_progress` | signup | on quest step completion | string (step description) | L2-G |
| **Computed (nightly push):** | | | | |
| `engagement_tier` | D7 | nightly | string (power/active/casual) | All segmentation |
| `churn_risk` | D14 | nightly | int (0-100) | L2-C, alerts |
| `stickiness_7d` | D7 | nightly | float (0-1) | L2-C |
| `ltv_estimated` | D30 | nightly | float ($) | L2-C, L2-D |
| `days_since_last_active` | D1 | nightly | int | Churn detection |
| `days_since_last_game` | D1 | nightly | int | Retention |
| `early_value_score` | D3 | nightly (first 7d only) | int (0-8) | L2-B |
| `credit_health` | D1 | nightly | string (healthy/expiring_soon/expired/depleted) | L2-D |
| `repurchase_probability` | D30 | nightly | float (0-1) | L2-D |
| `share_depth` | on share | on new downstream share | int | L2-F |
| `ultimate_source` | on viral signup | never | string (user_id) | L2-F |
| `referred_by` | signup via share link | never | string (user_id) | L2-F |

### 4.3 Global Properties (Attached to Every Event)

Set via `setGlobalProperties()` on the frontend SDK:

| Property | Source | Example |
|----------|--------|---------|
| `app_version` | Build config | `"1.4.2"` |
| `environment` | Build config | `"production"` |
| `user_plan` | Credit state | `"free"` / `"paid"` |
| `account_age_days` | Computed from signup_date | `45` |
| `credits_remaining` | Auth state | `6` |
| `active_sport` | Current profile | `"soccer"` |

OpenPanel auto-captures (no instrumentation needed): browser, OS, device, screen resolution, referrer, UTM params, country, region, city.

---

## 5. Real-Time Requirements

### 5.1 What Must Be Real-Time (< 5 seconds)

| Data | Source | Display |
|------|--------|---------|
| Active connections count | OpenPanel realtime | L1 bottom strip |
| Active connections by geography | OpenPanel realtime live map | L1 bottom strip |
| Active connections by traffic source | OpenPanel realtime referrals | L1 bottom strip |
| Error events | OpenPanel event-match notification | Slack alert |
| Export completions | OpenPanel event stream | L1 exports card (auto-refresh) |

### 5.2 What Should Be Near-Real-Time (< 5 minutes)

| Data | Source | Display |
|------|--------|---------|
| DAU count | OpenPanel time series (auto-refresh) | L1 DAU card |
| Funnel conversion rates | OpenPanel funnels (no sampling) | L2-B |
| Revenue events (credit purchases) | Backend REST -> OpenPanel | L2-D |
| Session replay | rrweb chunks (10s flush interval) | L4 |
| Credit balance changes | Backend events | L2-D |

### 5.3 What Can Be Batched (hourly/nightly)

| Data | Source | Display |
|------|--------|---------|
| Churn risk scores | Nightly analytics engine | User properties |
| Engagement tiers | Nightly analytics engine | User properties |
| Stickiness (DAU/WAU) | Nightly analytics engine | L2-C |
| LTV estimates | Nightly analytics engine | L2-C |
| ARPU / revenue metrics | Nightly analytics engine | L2-D |
| K-factor | Nightly analytics engine | L2-F |
| Credit health status | Nightly analytics engine | User properties |
| Repurchase probability | Nightly analytics engine | User properties |
| Threshold/absence alerts | Hourly cron | Slack |
| Weekly health digest | Weekly cron (Monday 9am) | Slack |

---

## 6. Virality Tracking

### 6.1 Two Viral Loops

Reel Ballers has two distinct viral channels:

**Loop 1: Reel Sharing** -- Parent exports a highlight -> shares via email/public link -> recipient watches -> some sign up to make their own reels.

**Loop 2: Team Sharing** -- Parent annotates a game -> tags teammates -> teammates receive only clips they appear in -> teammates sign up to view/edit their clips. This is the stronger loop because it delivers immediate personal value to the recipient.

```
REEL SHARING:
  Parent A exports reel -> shares link -> Viewer B watches
    -> B signs up (depth 1) -> B exports own reel -> shares
      -> Viewer C watches -> C signs up (depth 2) -> ...

TEAM SHARING:
  Parent A annotates game -> tags "Tommy", "Sarah"
    -> Maps tags to emails -> Sends share
    -> Tommy's parent receives clips of Tommy -> signs up (depth 1)
      -> Tommy's parent annotates their own game -> tags teammates -> ...
```

### 6.2 Data Model (Postgres)

```sql
-- In the auth/sharing Postgres DB (extends existing shares table)
CREATE TABLE share_attribution (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),      -- the new user
    referred_by TEXT NOT NULL REFERENCES users(id),   -- who shared with them
    share_type TEXT NOT NULL,                          -- 'reel' or 'team'
    share_link_id TEXT,                                -- which specific share link
    share_depth INT NOT NULL DEFAULT 1,                -- degrees from original
    ultimate_source TEXT NOT NULL REFERENCES users(id),-- root of the chain
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 Metrics Derived

| Metric | Formula | Dashboard |
|--------|---------|-----------|
| **K-factor** | (shares sent per user per period) x (share-to-signup conversion rate) | L2-F |
| **K-factor by type** | Separate K for reel shares vs. team shares | L2-F |
| **Viral depth** | MAX(share_depth) across all chains | L2-F |
| **Chain conversion** | % of share link views that result in signup | L2-F |
| **Team share adoption** | % of users who tag at least 1 teammate | L2-F |
| **Tag-to-signup rate** | % of teammate tags that result in a new user | L2-F |
| **Referral LTV premium** | LTV of referred users / LTV of organic users | L2-F, L2-C |

### 6.4 Push to OpenPanel

On each signup via share link:
```python
op.identify(new_user_id, {
    "properties": {
        "referred_by": referrer_user_id,
        "share_depth": depth,
        "share_type": "team" or "reel",
        "ultimate_source": root_user_id,
        "acquisition_type": "viral",
    }
})
```

Then in OpenPanel: breakdown retention, conversion, and revenue by `acquisition_type` (viral vs. organic vs. paid) and by `share_type` (reel vs. team).

---

## 7. Computed Intelligence (Analytics Engine)

### 7.1 Nightly Job: `compute_analytics_properties()`

Runs at 2am UTC. For each active user (active in last 90 days):

```python
async def compute_analytics_properties():
    users = await get_active_users(days=90)
    for user in users:
        # --- Engagement tier ---
        # Accounts for game-weekend cadence: "active" means engaged
        # around game days, not necessarily daily
        exports_30d = await count_events(user.id, "export_completed", days=30)
        games_30d = await count_events(user.id, "game_created", days=30)
        sessions_30d = await count_events(user.id, "session_started", days=30)
        tier = classify_engagement(exports_30d, games_30d, sessions_30d)
        # power:  exports_30d >= 8 or games_30d >= 4
        # active: exports_30d >= 2 or games_30d >= 1
        # casual: everything else

        # --- Stickiness (weekly, not daily -- matches game cadence) ---
        active_days_7d = await count_active_days(user.id, days=7)
        stickiness = active_days_7d / 7

        # --- Churn risk (0-100) ---
        churn_risk = compute_churn_risk(
            days_since_last_session=user.days_inactive,
            days_since_last_game=user.days_since_last_game,
            sessions_last_14d=await count_events(user.id, "session_started", days=14),
            sessions_prev_14d=await count_events(user.id, "session_started", days=28, offset=14),
            features_last_14d=await count_distinct_events(user.id, days=14),
            features_first_30d=user.features_in_first_30d,
            exports_last_14d=await count_events(user.id, "export_completed", days=14),
            exports_prev_14d=await count_events(user.id, "export_completed", days=28, offset=14),
            credits_remaining=user.credits_remaining,
            credits_expiry_days=user.days_until_credit_expiry,
        )

        # --- Credit health ---
        credit_health = classify_credit_health(
            credits_remaining=user.credits_remaining,
            days_until_expiry=user.days_until_credit_expiry,
            has_ever_purchased=user.has_purchased,
        )
        # healthy:       credits > 3 and expiry > 14 days
        # expiring_soon: credits > 0 and expiry <= 7 days
        # depleted:      credits == 0 and had credits recently
        # expired:       credits == 0 and last expiry > 30 days ago

        # --- Repurchase probability ---
        if user.has_purchased and user.credits_remaining <= 2:
            repurchase_prob = predict_repurchase(user)

        # --- Early value score (first 7 days only) ---
        if user.account_age_days <= 7:
            evs = compute_early_value_score(user)

        # --- Estimated LTV ---
        if user.account_age_days >= 30:
            ltv = estimate_ltv(user)

        # --- Push to OpenPanel ---
        op.identify(user.id, {
            "properties": {
                "engagement_tier": tier,
                "stickiness_7d": round(stickiness, 2),
                "churn_risk": churn_risk,
                "credit_health": credit_health,
                "days_since_last_active": user.days_inactive,
                "days_since_last_game": user.days_since_last_game,
                "ltv_estimated": ltv,
                "early_value_score": evs,
                "repurchase_probability": repurchase_prob,
            }
        })
```

### 7.2 Churn Risk Formula (Credit-Economy Adjusted)

```python
def compute_churn_risk(
    days_since_last_session,
    days_since_last_game,
    sessions_last_14d, sessions_prev_14d,
    features_last_14d, features_first_30d,
    exports_last_14d, exports_prev_14d,
    credits_remaining, credits_expiry_days,
):
    risk = (
        (days_since_last_session / 14) * 20 +                  # Recency (20%)
        (days_since_last_game / 21) * 15 +                     # Game recency (15%)
        safe_decline(sessions_last_14d, sessions_prev_14d) * 15 + # Frequency decline (15%)
        safe_decline(features_last_14d, features_first_30d) * 10 + # Depth decline (10%)
        safe_decline(exports_last_14d, exports_prev_14d) * 10 +   # Core action decline (10%)
        credit_risk_score(credits_remaining, credits_expiry_days) * 30  # Credit health (30%)
    )
    return clamp(risk, 0, 100)

def credit_risk_score(credits_remaining, expiry_days):
    """Credits are the strongest churn signal in a credit economy.
    No credits + no recent purchase = very likely to churn."""
    if credits_remaining == 0:
        return 1.0  # Maximum risk component
    if credits_remaining <= 2 and expiry_days <= 7:
        return 0.7  # High risk: about to run out
    if expiry_days <= 3:
        return 0.5  # Expiring soon
    return 0.0  # Healthy
```

### 7.3 Early Value Score (Reel Ballers Specific)

```python
def compute_early_value_score(user):
    """Score 0-8. Users scoring 5+ in first 7 days are high-conversion.
    Tuned for the Annotate -> Frame -> Overlay -> Export pipeline."""
    score = 0
    if user.has_uploaded_game:          score += 1  # Committed content
    if user.clips_created >= 3:         score += 1  # Engagement depth
    if user.has_exported:               score += 2  # Full value loop
    if user.has_shared:                 score += 2  # Social investment
    if user.returned_within_48h:        score += 1  # Habit signal
    if user.used_framing_or_overlay:    score += 1  # Pipeline depth
    return score
```

### 7.4 Hourly Cron: `check_guardrails()`

```python
async def check_guardrails():
    # 1. Zero exports in 24h
    exports_24h = await query_openpanel("export_completed", hours=24)
    if exports_24h == 0 and is_business_hours():
        await alert_slack("P1: Zero exports in last 24h")

    # 2. Error rate > 1%
    errors_1h = await query_openpanel("error_tracked", hours=1)
    sessions_1h = await query_openpanel("session_started", hours=1)
    if sessions_1h > 10 and (errors_1h / sessions_1h) > 0.01:
        await alert_slack(f"P0: Error rate {errors_1h/sessions_1h:.1%} in last hour")

    # 3. Export failure rate > 10%
    started = await query_openpanel("export_started", hours=4)
    failed = await query_openpanel("export_failed", hours=4)
    if started > 5 and (failed / started) > 0.10:
        await alert_slack(f"P1: Export failure rate {failed/started:.0%} in last 4h")

    # 4. Credit purchase failures (Stripe issues)
    purchase_started = await query_openpanel("credit_purchase_started", hours=4)
    purchase_completed = await query_openpanel("credits_purchased", hours=4)
    if purchase_started > 3 and (purchase_completed / purchase_started) < 0.5:
        await alert_slack(f"P1: Credit purchase completion rate {purchase_completed/purchase_started:.0%} in last 4h")
```

### 7.5 Weekly Cron: `weekly_health_digest()` (Monday 9am)

```python
async def weekly_health_digest():
    this_week = await get_period_metrics(days=7)
    last_week = await get_period_metrics(days=7, offset=7)

    digest = f"""
    *Weekly Health Digest -- Reel Ballers*

    *North Star:* {this_week.exports} exports ({delta(this_week.exports, last_week.exports)})
    *WAU:* {this_week.wau} ({delta(this_week.wau, last_week.wau)})
    *Signups:* {this_week.signups} ({delta(this_week.signups, last_week.signups)})
    *Activation:* {this_week.activation_rate:.0%} ({delta_pct(this_week.activation_rate, last_week.activation_rate)})
    *D7 Retention:* {this_week.d7_retention:.0%} ({delta_pct(this_week.d7_retention, last_week.d7_retention)})
    *Credit Revenue:* ${this_week.revenue/100:.0f} ({delta(this_week.revenue, last_week.revenue)})
    *Credits Purchased:* {this_week.credits_purchased} ({delta(this_week.credits_purchased, last_week.credits_purchased)})
    *Repurchase Rate:* {this_week.repurchase_rate:.0%} ({delta_pct(this_week.repurchase_rate, last_week.repurchase_rate)})
    *Shares:* {this_week.shares} ({delta(this_week.shares, last_week.shares)})
    *Error Rate:* {this_week.error_rate:.2%} ({delta_pct(this_week.error_rate, last_week.error_rate)})
    *Quest Completion:* {this_week.quest_completion_rate:.0%} ({delta_pct(this_week.quest_completion_rate, last_week.quest_completion_rate)})
    """
    await send_slack(digest)
```

---

## 8. Alert System

### 8.1 Alert Tiers

| Tier | Trigger | Channel | Response Time |
|------|---------|---------|---------------|
| **P0: Immediate** | Error rate >2x baseline, page crash, data integrity, Stripe webhook failure | Slack (immediate) | < 30 min |
| **P1: Urgent** | Zero exports 24h, export failure >10%, P95 latency >2s, credit purchase completion <50% | Slack (hourly check) | < 4 hours |
| **P2: Warning** | D1 retention drop >5pp, funnel conversion drop >10%, credit utilization drop >20% | Weekly digest | Next Monday review |
| **P3: Info** | New anomaly detected by AI insights, unusual traffic pattern | OpenPanel AI page | Ad hoc review |

### 8.2 Alert Sources

| Source | What It Catches | Mechanism |
|--------|----------------|-----------|
| **OpenPanel event-match rules** | Per-event alerts (e.g., every `export_failed`) | Slack/Discord webhook, fires immediately |
| **Hourly cron** (`check_guardrails`) | Threshold + absence alerts | Queries Export API, sends Slack |
| **Weekly cron** (`weekly_health_digest`) | Trend regressions | Compares WoW metrics, sends Slack |
| **OpenPanel AI Insights** | Anomaly detection (spikes, drops, new patterns) | Manual review in dashboard |
| **Sentry** | JS/Python exceptions with stack traces | Slack integration (existing) |
| **Stripe webhooks** | Payment failures, disputes | Backend handler -> Slack |

### 8.3 Rules

- False positive rate must stay under 1 per week. Above that, alerts get ignored.
- Suppress alerts during known deploy windows (add `deploy_started` event as suppression signal).
- Every alert must include: what happened, how bad it is, and what to do next.
- Start with 4 alerts (zero exports, error rate, credit purchase failures, weekly digest). Add more only after these prove useful for 30 days.

---

## 9. Feature Release Impact Detection

### 9.1 Pre-Release Protocol

Before shipping any feature:

1. **Define metric contract:**
   - Success metric: what goes UP? (e.g., "export completion rate +5%")
   - Guardrail metrics: what must NOT go down? (from Section 8 guardrails)
   - Revert trigger: specific condition for rollback

2. **Mark the release in OpenPanel** via References API (vertical line on all charts)

3. **Create L3 dashboard** for this feature with:
   - Feature-specific funnel (if multi-step)
   - Before/after time series of success metric
   - Session replay filter for users hitting the feature

### 9.2 Post-Release Monitoring

| Timeframe | Check | Method |
|-----------|-------|--------|
| +1 hour | Error rate spike? | Hourly cron alert |
| +4 hours | P95 latency increase? Export failures? | Hourly cron alert |
| +24 hours | Session duration drop? Core action drop? | L3 dashboard review |
| +24 hours | Watch 5-10 session replays | OpenPanel session replay |
| +48 hours | D1 retention for post-release cohort? | L2-C retention grid |
| +7 days | Full guardrail review. Credit purchase rate stable? | L3 dashboard + weekly digest |

### 9.3 Decision Framework

```
SAFETY or DATA INTEGRITY issue (clip data loss, credit miscounting)?
  YES -> Revert IMMEDIATELY (< 5 min, flip feature flag)

Guardrail metrics regressed?
  Error/crash rate -> Revert within 1 hour
  Engagement metrics -> Investigate 24-48h, then decide

Success metric direction after 7 days?
  Positive -> Keep, advance rollout
  Flat -> Consider reverting (complexity without value)
  Negative -> Revert or redesign
```

### 9.4 Analysis Methods for Small User Base (<1000)

| Method | When | How |
|--------|------|-----|
| **Interrupted Time Series** | Always | Compare metric trend 4 weeks before vs. after. Mark release as intervention. |
| **Session replays** | Always | Watch 5-10 users hitting the feature. Look for confusion, rage clicks. |
| **Direct outreach** | On ambiguous results | Email 5 active users: "We shipped X. Did you notice? Thoughts?" |
| **Cohort comparison** | When feature affects new users | Compare pre-release signup cohort vs. post-release on D7 retention. |

---

## 10. Instrumentation Architecture

### 10.1 Frontend (React + @openpanel/web)

```
src/frontend/src/analytics/
  openpanel.ts          # SDK initialization + singleton export
  events.ts             # Event name constants (TypeScript enum)
  properties.ts         # Property name constants
  track.ts              # Wrapper functions with typed properties
  identify.ts           # User identification + property management
```

**Key design decisions:**

1. **Single SDK instance**, exported as `op` from `openpanel.ts`. No React context/provider needed.

2. **Typed event functions** in `track.ts`:
```typescript
export function trackClipCreated(props: {
  clipDuration: number;
  gameId: string;
  starRating: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  hasNote: boolean;
  isFirst: boolean;
  lifetimeCount: number;
}) {
  op.track(Events.CLIP_CREATED, {
    clip_duration: props.clipDuration,
    game_id: props.gameId,
    star_rating: props.starRating,
    tags: props.tags,
    has_note: props.hasNote,
    is_first: props.isFirst,
    lifetime_count: props.lifetimeCount,
  });
}

export function trackCreditsModalViewed(props: {
  trigger: 'upload_insufficient' | 'expiry_warning' | 'manual';
  creditsRemaining: number;
  creditsNeeded: number;
  currentPackExpiryDays: number | null;
}) {
  op.track(Events.CREDITS_MODAL_VIEWED, {
    trigger: props.trigger,
    credits_remaining: props.creditsRemaining,
    credits_needed: props.creditsNeeded,
    current_pack_expiry_days: props.currentPackExpiryDays,
  });
}
```

3. **Identify on login**, update on credit changes:
```typescript
export function identifyUser(user: AuthUser) {
  op.identify({
    profileId: user.id,
    firstName: user.firstName,
    email: user.email,
    properties: {
      has_purchased: user.hasPurchased,
      signup_method: user.signupMethod,
      primary_sport: user.primarySport,
      athlete_count: user.profiles.length,
      credits_remaining: user.creditsRemaining,
    },
  });
  op.setGlobalProperties({
    app_version: APP_VERSION,
    environment: import.meta.env.MODE,
    user_plan: user.hasPurchased ? 'paid' : 'free',
    credits_remaining: user.creditsRemaining,
    active_sport: user.activeProfile?.sport,
  });
}
```

4. **Clear on logout:**
```typescript
export function clearAnalytics() {
  op.clear();
}
```

5. **Track from gesture handlers, never from effects.** Follows the app's persistence principle: every tracked event must trace back to a specific user gesture.

### 10.2 Backend (FastAPI + openpanel Python SDK)

```
src/backend/app/analytics/
  __init__.py           # SDK initialization
  events.py             # Event name constants (Python)
  tracker.py            # Track functions with typed parameters
  engine.py             # Nightly/hourly computation jobs
```

**SDK initialization** (in `__init__.py`):
```python
from openpanel import OpenPanel

op = OpenPanel(
    client_id=settings.OPENPANEL_CLIENT_ID,
    client_secret=settings.OPENPANEL_CLIENT_SECRET,
    api_url=settings.OPENPANEL_API_URL,
)
```

**Track from route handlers:**
```python
# In the export completion handler
from app.analytics.tracker import track_export_completed

@router.post("/clips/{clip_id}/export")
async def export_clip(clip_id: str, user: User = Depends(get_current_user)):
    result = await process_export(clip_id)
    track_export_completed(
        user_id=user.id,
        format=result.format,
        duration_seconds=result.duration,
        resolution=result.resolution,
        aspect_ratio=result.aspect_ratio,
        has_upscale=result.used_upscale,
        is_first=(user.total_exports == 0),
        lifetime_count=user.total_exports + 1,
    )
    return result
```

**Revenue tracking** (REST API, on Stripe webhook for credit purchases):
```python
# In the Stripe webhook handler
from app.analytics.tracker import track_revenue, track_credits_purchased

@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    event = await parse_stripe_event(request)
    if event.type == "checkout.session.completed":
        pack_size = event.metadata["pack_size"]  # 1, 5, or 20
        amount_cents = event.amount_total

        track_credits_purchased(
            user_id=event.customer_metadata["user_id"],
            pack_size=int(pack_size),
            amount_cents=amount_cents,
            is_first_purchase=not user.has_purchased,
        )
        track_revenue(
            user_id=event.customer_metadata["user_id"],
            amount_cents=amount_cents,
            pack_size=pack_size,
        )
```

**Credit consumption tracking** (on game upload):
```python
from app.analytics.tracker import track_credits_consumed

@router.post("/games")
async def create_game(game: GameCreate, user: User = Depends(get_current_user)):
    credits_cost = calculate_credit_cost(game.file_size)
    result = await process_game_upload(game, user)
    track_credits_consumed(
        user_id=user.id,
        credits_used=credits_cost,
        trigger="game_upload",
        credits_remaining_after=user.credits_remaining - credits_cost,
        game_id=result.id,
    )
    return result
```

### 10.3 Session Replay Configuration

```typescript
const op = new OpenPanel({
  clientId: VITE_OPENPANEL_CLIENT_ID,
  trackScreenViews: true,
  trackAttributes: true,
  sessionReplay: {
    enabled: true,
    sampleRate: 1.0,              // Record all sessions (at <1000 users)
    maskAllInputs: true,          // Hide form values
    maskAllText: false,           // Show text (video editor needs visible labels)
    unmaskTextSelector: '[data-openpanel-unmask]',
    blockSelector: '[data-openpanel-replay-block]',  // Block video canvas
    flushIntervalMs: 10000,
  },
});
```

**Privacy rules:**
- Video canvas elements: BLOCKED (too heavy + privacy -- game footage is personal)
- Form inputs: MASKED
- UI text/labels: VISIBLE (needed to understand navigation)
- Athlete names, game names, clip names: MASKED unless explicitly unmasked
- Star ratings, tags: VISIBLE (needed for UX analysis)

---

## 11. OpenPanel Deployment

### 11.1 Infrastructure

| Component | Spec | Where |
|-----------|------|-------|
| VPS | 4 vCPU, 8GB RAM, 100GB SSD | Hetzner / DigitalOcean / Fly.io |
| Docker Compose | 7 services (api, dashboard, worker, postgres, clickhouse, redis, caddy) | On the VPS |
| Domain | `analytics.reelballers.com` | Cloudflare DNS -> VPS |
| SSL | Caddy auto-provision (Let's Encrypt) | Caddy proxy |
| Backups | Daily ClickHouse + Postgres snapshots | To R2 or VPS snapshots |

### 11.2 Key Configuration

```env
# Required
DATABASE_URL=postgresql://openpanel:xxx@op-db:5432/openpanel
CLICKHOUSE_URL=http://op-ch:8123
REDIS_URL=redis://op-kv:6379
API_URL=https://api.analytics.reelballers.com
DASHBOARD_URL=https://analytics.reelballers.com
COOKIE_SECRET=<random>

# Features
ALLOW_REGISTRATION=false         # Only admin creates accounts
ANTHROPIC_API_KEY=<key>          # For AI insights
MAXMIND_LICENSE_KEY=<key>        # For geo-IP (optional, zero-cost fallback exists)

# Scaling
EVENT_JOB_CONCURRENCY=20        # Start at 20, increase if queue backs up
OP_WORKER_REPLICAS=2            # 2 workers to start
```

### 11.3 API Clients to Create

| Client Name | Type | Purpose |
|-------------|------|---------|
| `frontend-write` | write | Frontend SDK (clientId only, no secret) |
| `backend-write` | write | Backend Python SDK (clientId + clientSecret) |
| `analytics-read` | read | Export API for analytics engine cron jobs |
| `admin-root` | root | Manage API for references, project config |

---

## 12. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal:** OpenPanel running, basic events flowing, L1 dashboard live.

| Task | Details |
|------|---------|
| Deploy OpenPanel | VPS + Docker Compose + domain + SSL |
| Create project + API clients | frontend-write, backend-write, analytics-read |
| Frontend SDK setup | `@openpanel/web` init, identify on login, clear on logout |
| Backend SDK setup | `openpanel` Python package, init at app startup |
| Event constants files | TypeScript `events.ts` + Python `events.py` |
| Instrument 8 activation events | signup, onboarding steps, first upload/clip/export/share/purchase |
| Instrument `session_started` | For DAU tracking |
| Instrument `error_tracked` | Frontend JS errors + backend API errors |
| Build L1 dashboard | 4 metric cards + realtime strip |
| Verify data flow | Check events appear in OpenPanel, profiles created |

**Exit criteria:** L1 dashboard shows live DAU, exports, errors, signups with sparklines.

### Phase 2: Core Analytics (Week 3-4)

**Goal:** Full event taxonomy flowing, L2 dashboard live, retention tracking.

| Task | Details |
|------|---------|
| Instrument remaining ~33 events | All engagement, credit, quest, feature adoption events |
| Add `is_first` + `lifetime_count` to all repeating events | Via backend counter or frontend state |
| Set up user properties | Identify with plan, signup_method, sport, credits_remaining |
| Set up `increment()` calls | total_exports, total_shares, total_games, total_credits_purchased |
| Build L2-A (Growth) | WAU trend, signup sources, signup method breakdown |
| Build L2-B (Activation) | Activation funnel, pipeline funnel, activation rate |
| Build L2-C (Retention) | Retention grid, stickiness placeholder, per-game-event retention |
| Build L2-E (Quality) | Error rate, top errors, export success rate, GPU job success |
| Build L2-G (Engagement) | Quest funnel, feature adoption, star rating distribution |
| Enable session replay | Configure privacy rules, verify recordings, block video canvas |
| Set up OpenPanel event-match alerts | Alert on every `export_failed` via Slack |

**Exit criteria:** All 41 events flowing. L2 dashboard shows funnels, retention grid, error tracking, quest funnel. Session replays recording.

### Phase 3: Monetization + Intelligence (Week 5-8)

**Goal:** Credit revenue tracking, computed metrics, alerts operational.

| Task | Details |
|------|---------|
| Instrument credit events | credits_modal_viewed, credit_purchase_started, credits_purchased, credits_consumed, credits_expired |
| Revenue tracking via REST API | Stripe webhook -> OpenPanel revenue event |
| Build L2-D (Monetization) | Credit purchase funnel, repurchase rate, credit utilization, pack distribution |
| Build nightly analytics engine | Churn risk, engagement tier, stickiness, early value score, credit health |
| Push computed properties to OpenPanel | Via nightly `identify()` batch |
| Build hourly cron (`check_guardrails`) | Zero exports, error rate, export failure, credit purchase failures |
| Build weekly digest cron | Monday 9am Slack summary with credit metrics |
| Build L2-F (Virality) | Shares per user, team share adoption, reel vs. team share breakdown |
| Share attribution tracking | `share_attribution` table, depth + ultimate source + share_type |
| LTV estimation (if enough data) | Coefficient method from first cohorts |

**Exit criteria:** Revenue appearing in OpenPanel. Churn risk + credit health scores on user profiles. Hourly + weekly alerts firing to Slack. Viral attribution chain tracked with reel vs. team share distinction.

### Phase 4: Optimization (Month 3+)

**Goal:** Feature release protocol active, LTV predictions, magic number validation.

| Task | Details |
|------|---------|
| L3 dashboard template | Per-feature deep-dive template with Sankey + replays |
| OpenPanel References API integration | Mark releases on all charts |
| Feature release protocol | Checklist: define metrics -> mark release -> create L3 -> monitor |
| K-factor computation (by share type) | Reel K-factor + team K-factor, computed in nightly job |
| ARPU / revenue computation | From credit purchase events -> weekly digest |
| Aha moment regression | When 200+ users: compare retained vs. churned on candidate actions |
| Magic number hypothesis testing | See candidates below |
| Credit pricing experiments | Property-based breakdown by pack_size purchase patterns |
| Credit expiry optimization | Analyze: do users who extend credits retain better? |

**Aha moment candidates** (ranked by expected signal strength):
1. **"Exported first highlight reel"** -- parent sees polished video of their kid's play
2. **"Shared first clip to a teammate's parent"** -- social commitment + team viral loop
3. **"Created clips from 2nd game"** -- signals recurring weekly workflow, not novelty
4. **"Bought first credit pack"** -- financial commitment validates value

**Magic number hypotheses:**
- Export 2+ reels in first 14 days -> high repurchase probability
- Share 1+ clips in first 7 days -> high retention
- Upload games from 2+ different dates -> recurring workflow signal
- Tag 1+ teammates -> team viral loop entry

**Exit criteria:** Feature releases follow the protocol. LTV estimates within 10% of actual. Aha moment identified and onboarding optimized toward it.

---

## 13. Key Formulas Reference

```
North Star               = COUNT(export_completed) per week
Activation Rate          = users with first_export in 7d / signups in same period

CREDIT ECONOMY:
Weekly Credit Revenue    = SUM(credits_purchased.amount_cents) per week / 100
ARPU                     = total_credit_revenue / all_active_users
ARPPU                    = total_credit_revenue / paying_users
Repurchase Rate (30d)    = users who buy again within 30d of credit depletion / all purchasers
Credit Utilization       = credits consumed / credits purchased (target > 0.8)
Free-to-Paid Conversion  = users with first_credit_purchase / total signups
Credit Revenue per Game  = total_credit_revenue / total games uploaded

LTV ESTIMATION:
LTV (credit-based)       = avg_purchases_per_user x avg_purchase_value x avg_active_months
Predicted D90 LTV        = D7_LTV x K_factor (typical K = 1.5-2.5x)
Payback Period (months)  = CAC / (monthly ARPU x gross margin %)
Blended LTV per signup   = (conv_rate x paid_LTV) + (K_factor x referral_value)

RETENTION (weekly cadence):
Stickiness               = active_days_7d / 7 (target > 0.25)
Per-Game Retention       = users uploading game N+1 / users who uploaded game N
D14/D7 Ratio             = D14 retention / D7 retention (target > 0.6 = curve flattening)

VIRALITY:
K-factor                 = (shares per user per period) x (share-to-signup rate)
K-factor (team)          = (team shares per annotator) x (teammate-tag-to-signup rate)
Viral Depth              = MAX(share_depth) across all attribution chains

ENGAGEMENT:
Early Value Score        = upload(+1) + 3_clips(+1) + export(+2) + share(+2) + return_48h(+1) + framing_or_overlay(+1)
Quest Completion Rate    = users completing all 5 steps / signups in period

RISK:
Churn Risk (0-100)       = recency(20%) + game_recency(15%) + frequency_decline(15%)
                           + depth_decline(10%) + action_decline(10%) + credit_health(30%)
Credit Health            = f(credits_remaining, days_until_expiry, has_purchased)
Error Rate               = error_tracked / session_started
Export Success Rate      = export_completed / export_started
```

---

## 14. Success Criteria

### The system is working when:

1. **30-second morning check** -- Founder opens L1, sees 4 tickers + realtime strip, knows product health without clicking anything.

2. **Feature confidence** -- Every release has a defined success metric and guardrails. Bad features are detected within 48 hours and reverted within 72.

3. **Cohort visibility** -- For any weekly cohort, can see D1/D7/D14/D30 retention, credit revenue contribution, and activation rate within 2 clicks.

4. **Funnel clarity** -- Pipeline drop-offs (Upload->Annotate->Frame->Overlay->Export) are visible in real-time. Can answer "where are users falling off?" in under 60 seconds.

5. **Churn anticipation** -- Users at risk of churning are identified 7-14 days before they leave. Credit health (expiring, depleted, expired) surfaces proactively.

6. **Credit economy visibility** -- Repurchase rate, credit utilization, pack size distribution, and free-to-paid conversion are all tracked weekly. Can answer "is the credit model working?" instantly.

7. **Growth tracking** -- K-factor (reel shares + team shares separately), share depth, and acquisition channel mix are computed and visible weekly. Team sharing viral loop is measured end-to-end.

8. **Quest & engagement tracking** -- Quest funnel shows where users stall. Feature adoption by mode (Annotate/Framing/Overlay) is visible. Star rating distribution informs clip quality.

9. **Alert hygiene** -- Fewer than 1 false positive per week. Real issues surface within 4 hours. Weekly digest is the Monday morning starting point for planning.
