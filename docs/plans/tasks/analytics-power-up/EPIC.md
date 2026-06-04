# Analytics Power-Up

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

A data analyst can zoom into any user's full action timeline, see pipeline funnel drop-offs by segment, compare campaign ROI (including viral descendants), and identify early predictors of LTV -- all from the admin panel, powered by clean normalized data.

## Why

Current analytics has three problems:

1. **Schema is muddled.** `user_milestones` is a 25-column wide table doing four jobs: segment info, milestone timestamps, lifetime counts, and session tracking. The milestone timestamps and counts are redundant with `user_flow_events`. This makes queries awkward and the table hard to extend.

2. **Tracking has gaps.** 7 significant user actions go unrecorded: session starts, quest completions, invite sends, share views (the viral conversion signal), payment attempts/completions, and export starts. These are critical funnel steps we're blind to.

3. **Admin UI is too cute.** The journey timeline is a horizontal dot visualization that shows events but not the story. The analytics tab has the right structure (pulse/funnel/channels/cohorts) but the data isn't rich enough and the user detail view doesn't let you actually analyze behavior patterns.

4. **No revenue attribution.** We don't track total spent per user or per segment. Can't answer "how much money has campaign X generated?" including its viral descendants.

## Design Decisions

### Origin Model

Every user has an **origin**: either `"organic"` or a **campaign ID** (e.g., `"ig_summer_camp"`).

**Rules:**
- Direct visitor (no `?ref=` param) -> origin = `"organic"`
- Visitor with `?ref=` that resolves to an invite code -> **viral**. Origin = the inviter's origin (inherited). Referrer user_id stored separately.
- Visitor with `?ref=` that does NOT resolve to an invite code -> treat the ref value as a campaign ID. Origin = that campaign ID.
- Share-attributed signup (no ref param, but existing share found) -> **viral**. Origin inherited from sharer.

This means campaign attribution propagates through viral chains:
- Campaign "ig_summer" -> User A (origin: ig_summer) -> invites User B (origin: ig_summer, referrer: A) -> invites User C (origin: ig_summer, referrer: B)
- `SELECT origin, SUM(total_spent_cents) FROM user_segments GROUP BY origin` naturally includes all viral descendants.

**Referral ID handling:**
- Frontend already captures `?ref=` from URL into sessionStorage (App.jsx)
- Frontend already sends `ref` param on Google/OTP auth requests
- Backend already resolves invite codes via `resolve_invite_code()`
- **New:** If ref does NOT resolve to an invite code, store it as a campaign ID origin
- **New:** Viral users look up their inviter's origin and inherit it

### Postgres: Segments + Actions (normalized)

Replace the wide `user_milestones` table with a clean separation:

**`user_segments`** -- one row per user, set at signup:
- user_id (PK)
- acquired_at (DATE)
- origin (TEXT) -- "organic" or a campaign ID
- referrer_id (TEXT, nullable, FK to users) -- who invited them (if viral)
- signup_method (TEXT) -- google | otp
- total_spent_cents (INTEGER DEFAULT 0) -- running total, incremented on payment

**`user_actions`** -- rename of `user_flow_events`, same shape:
- user_id + action (composite PK)
- count (INTEGER)
- first_at (TIMESTAMPTZ)

**`daily_counters`** -- keep as-is for fast dashboard queries.

This eliminates all redundancy. Milestone timestamps = `user_actions.first_at`. Lifetime counts = `user_actions.count`. Session tracking = `session_started` action rows. Segment info = `user_segments`.

### Revenue Queries

**Per-user spend:** `user_segments.total_spent_cents`

**Per-campaign revenue (including viral):**
```sql
SELECT origin, COUNT(*) AS users, SUM(total_spent_cents) AS revenue_cents
FROM user_segments
GROUP BY origin
ORDER BY revenue_cents DESC;
```
This automatically includes viral descendants because they inherit the campaign origin.

**Referral tree for a user:**
```sql
WITH RECURSIVE tree AS (
    SELECT user_id, referrer_id, origin, total_spent_cents, 0 AS depth
    FROM user_segments WHERE user_id = :root_user_id
    UNION ALL
    SELECT s.user_id, s.referrer_id, s.origin, s.total_spent_cents, t.depth + 1
    FROM user_segments s JOIN tree t ON s.referrer_id = t.user_id
    WHERE t.depth < 5
)
SELECT SUM(total_spent_cents) AS tree_revenue, COUNT(*) AS tree_size FROM tree;
```

### SQLite: Action Log (per-user timeline)

New table in user.sqlite:

**`user_action_log`** -- every action, individually timestamped:
- id (AUTOINCREMENT)
- action (TEXT)
- context (TEXT, JSON) -- game_id, clip_id, project_id, quest_id, etc.
- created_at (TEXT, datetime)

This is the "zoom into one user" data source. No aggregation, raw log.

### Actions to Track

Existing (already recorded):
- game_created, clip_created, annotation_completed
- framing_opened, framing_exported, overlay_exported
- gallery_viewed, video_downloaded
- share_completed, credit_purchased, credits_consumed
- pwa_installed, export_completed, export_failed

New (gaps to fill):
- session_started -- when 30min gap triggers new session
- quest_completed -- quest reward claimed
- invite_sent -- share/invite email sent
- share_viewed -- someone opened a shared link (viral conversion signal)
- payment_started -- Stripe intent created
- payment_completed -- Stripe payment verified
- export_started -- export job created (vs completed/failed)

### Admin UI: Power over Pretty

Replace the journey timeline dot visualization with a **vertical action log** -- like a git log for the user. Every action, timestamp, time delta from previous, context details. Scrollable, filterable.

Enhance the funnel/channels/cohorts views with richer data from the new action set. Channels view shows revenue per campaign including viral descendants.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3450 | [Normalize Postgres Schema](T3450-normalize-postgres-schema.md) | TODO |
| T3455 | [Campaign URL Parsing](T3455-campaign-url-parsing-spec.md) | SPEC IN PROGRESS |
| T3460 | [SQLite Action Log + Recording](T3460-sqlite-action-log.md) | TODO |
| T3470 | [Fill Tracking Gaps](T3470-fill-tracking-gaps.md) | TODO |
| T3480 | [Admin User Detail Redesign](T3480-admin-user-detail.md) | TODO |
| T3490 | [Admin Analytics Upgrade](T3490-admin-analytics-upgrade.md) | TODO |

## Completion Criteria

- [ ] `user_milestones` replaced by `user_segments` + `user_actions` in Postgres
- [ ] Origin propagation: viral users inherit inviter's origin (campaign or organic)
- [ ] Unresolved ref params stored as campaign ID origin
- [ ] `total_spent_cents` tracked per user, incremented on payment
- [ ] All 7 new events instrumented and recording
- [ ] SQLite `user_action_log` populated on every action with context JSON
- [ ] Admin user detail shows vertical action log (not dot timeline)
- [ ] Funnel view powered by new action set including new events
- [ ] Channels view shows revenue per origin (campaign) including viral descendants
- [ ] Referral ID flow tested end-to-end (invite code -> signup -> origin inheritance)
