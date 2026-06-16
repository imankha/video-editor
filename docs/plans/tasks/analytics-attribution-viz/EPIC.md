# Analytics: Attribution & Access Visibility

**Status:** TODO
**Started:** (not started)

## Goal

Make it visually obvious in the admin panel **how every user originated and what they can actually see**. Two refinements on top of the existing analytics stack (Analytics Power-Up, Invite & Referral):

1. **Separate "games uploaded" from "games accessible."** Today admin counts games per user from one source. Because of sharing, the number of games a user *uploaded* differs from the number they *have access to*. Show both.
2. **A full attribution graph.** One visual that shows who invited whom (viral chains) and where each root user came from (ad campaigns / organic). The most visual way to understand user origination from the data we already collect.

## Why now

All the data already exists — `referrals` (who brought whom), `user_segments` (origin/campaign + referrer_id), `shares` + `share_games` (access grants). We have not yet surfaced it as (a) a per-user uploaded-vs-accessible split, or (b) a single attribution graph. This is presentation/aggregation work on existing tables, not new tracking.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3550 | [Games Uploaded vs Accessible](T3550-games-uploaded-vs-accessible.md) | TODO |
| T3560 | [User Attribution Graph](T3560-attribution-graph.md) | TODO |

## Shared Context

### Data sources (all Postgres, defined in `src/backend/app/services/pg.py`)
- **referrals** (pg.py:164) — `referrer_id`, `referred_id` (UNIQUE), `channel`, `source_id`. The who-brought-whom adjacency list.
- **user_segments** (pg.py:175) — `user_id`, `origin` (normalized campaign/channel string, default `'organic'`), `referrer_id`, `utm_*`, `signup_method`, `total_spent_cents`. Origin is computed by `_determine_origin()` in `src/backend/app/analytics.py:144`.
- **shares** + **share_games** (pg.py:98, pg.py:124) — `share_games.recipient_profile_id` / `recipient_email` define games a user has access to but did not upload. `shares.sharer_user_id` is the owner.
- **Games uploaded** — counted today from `user_actions` where `action='game_created'` (admin.py:140-203).

### Admin surfaces
- Backend router: `src/backend/app/routers/admin.py` (users list line 90; analytics endpoints 398+).
- Frontend store / API client: `src/frontend/src/stores/adminStore.js`.
- Frontend components: `src/frontend/src/components/admin/` (AnalyticsDashboard, UserTable, FunnelChart, ChannelsTable, CohortGrid, etc.).
- **No charting library is currently in the frontend** — existing charts are hand-rolled CSS/Tailwind bars. T3560 must choose and add one (graph/network viz).

## Completion Criteria

- [ ] Admin shows games-uploaded and games-accessible as distinct numbers per user
- [ ] Admin has an attribution graph view: nodes = users (+ campaign/origin roots), edges = invited-by, grouped/colored by origin
- [ ] The attribution graph lives on its own lazy-loaded page linked from the main analytics page (graph lib + payload do not load until requested; main page load unaffected)
- [ ] Both built on existing tables — no new tracking events required
- [ ] Tests pass (backend endpoint tests + frontend unit where applicable)
