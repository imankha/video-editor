# T1700: Analytics Foundation -- OpenPanel Deploy + SDK + L1 Dashboard

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-04-21
**Updated:** 2026-05-13
**Epic:** [Analytics System](EPIC.md)
**Depends on:** None

## Problem

Analytics are fragmented across Cloudflare Web Analytics (3 events, no identity), admin panel SQLite stats (no time series), and server logs (not queryable). No single place to see a user's journey or measure product health.

## Solution

Deploy OpenPanel self-hosted on a dedicated VPS and establish the foundation: SDK integration on both frontend and backend, 8 activation events, the L1 Daily Pulse dashboard, and removal of Cloudflare Web Analytics.

See [EPIC.md](EPIC.md) for epic-level design decisions. See [analytics-system-plan.md](../../analytics-system-plan.md) Sections 2, 3.2, 4.1 (Acquisition events), 10, 11 for full spec.

## Scope

### 1. Infrastructure -- OpenPanel on VPS

- Provision VPS (Hetzner/DigitalOcean, 4 vCPU, 8GB RAM, 100GB SSD)
- Deploy via Docker Compose (7 services: op-api, op-dashboard, op-worker, op-db, op-ch, op-kv, op-proxy)
- Configure domain `analytics.reelballers.com` via Cloudflare DNS -> VPS
- SSL via Caddy auto-provision (Let's Encrypt)
- Key env vars: `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL`, `API_URL`, `DASHBOARD_URL`, `COOKIE_SECRET`
- Set `ALLOW_REGISTRATION=false` (admin-only access)
- Set `ANTHROPIC_API_KEY` for AI insights
- Create 4 API clients:
  - `frontend-write` (write) -- clientId only, no secret, used by browser SDK
  - `backend-write` (write) -- clientId + clientSecret, used by Python SDK
  - `analytics-read` (read) -- for Export API queries in analytics engine
  - `admin-root` (root) -- for Manage API (references, project config)

### 2. Frontend SDK Integration

Install `@openpanel/web` and create analytics module:

```
src/frontend/src/analytics/
  openpanel.ts          # SDK init + singleton export
  events.ts             # Event name constants (TypeScript)
  properties.ts         # Property name constants
  track.ts              # Typed wrapper functions
  identify.ts           # User identification + property management
```

**SDK initialization** (`openpanel.ts`):
- `clientId` from `VITE_OPENPANEL_CLIENT_ID` env var
- `trackScreenViews: true` (auto page navigation)
- `trackAttributes: true` (data-track attribute support)
- Session replay: disabled in this phase (enabled in T1701)

**Identify on login** (`identify.ts`):
- `profileId`: user ID
- `firstName`, `email`
- Properties: `signup_method` (google/otp), `primary_sport`, `credits_remaining`, `has_purchased`
- Global properties: `app_version`, `environment`, `user_plan` (free/paid), `credits_remaining`, `active_sport`

**Clear on logout**: call `op.clear()`

### 3. Backend SDK Integration

Install `openpanel` Python package and create analytics module:

```
src/backend/app/analytics/
  __init__.py           # SDK init with client_id, client_secret, api_url
  events.py             # Event name constants (Python, matching frontend)
  tracker.py            # Typed track functions with profile_id parameter
```

Init at app startup. SDK is thread-safe for FastAPI async + threaded workloads.

### 4. Activation Events (8 events + error tracking)

| Event | Source | Handler Location | Key Properties |
|-------|--------|-----------------|---------------|
| `signup_completed` | Backend | Auth route (Google callback / OTP verify) | `method`, `referral_source`, `utm_*` |
| `onboarding_step_completed` | Frontend | Onboarding component | `step_name`, `step_number` |
| `first_video_uploaded` | Frontend | Upload handler in annotate mode | `video_duration`, `file_size_mb`, `sport`, `credits_cost` |
| `first_clip_created` | Frontend | Clip creation handler in annotate mode | `clip_duration`, `star_rating`, `method` |
| `first_export_completed` | Backend | Export completion handler | `format`, `resolution`, `aspect_ratio`, `has_overlay`, `has_crop` |
| `first_share_completed` | Frontend | Share handler | `share_method` (teammate/public_link/email) |
| `first_credit_purchase` | Backend | Stripe webhook | `pack_size`, `amount_cents`, `free_credits_remaining` |
| `session_started` | Frontend | Auto via `trackScreenViews` | `days_since_last_session` |
| `error_tracked` | Both | Global error handler (frontend), exception middleware (backend) | `error_type`, `message`, `component`, `severity`, `stack_hash` |

For `first_*` events: check `is_first` by querying user state (e.g., `total_exports == 0` before incrementing).

### 5. L1 Daily Pulse Dashboard

Create OpenPanel dashboard "Daily Pulse" with:

**4 Metric chart cards** (daily interval, 7-day range, period-over-period comparison):
1. **DAU** -- unique `session_started` profiles/day, compared to same day last week
2. **Exports Today** -- count of `export_completed`/day
3. **Error Rate** -- `error_tracked` / `session_started`
4. **New Signups** -- count of `signup_completed`/day

**Realtime strip** (bottom, links to OpenPanel's native realtime page):
- Active users count
- Geographic map
- Traffic sources

### 6. Remove Cloudflare Web Analytics

- Delete `src/frontend/src/utils/analytics.js` (contains `zaraz.track()` calls)
- Remove all `zaraz.track()` call sites (login, export_started, export_complete, quest_reward_claimed)
- Remove CF analytics token from frontend config/env
- Remove CF beacon script from `index.html`
- Verify no remaining references to `zaraz` or CF analytics

## Files Affected

| File | Change |
|------|--------|
| `src/frontend/src/analytics/` (new) | SDK init, events, tracking, identification |
| `src/backend/app/analytics/` (new) | SDK init, events, tracking |
| `src/frontend/src/utils/analytics.js` | DELETE |
| `src/frontend/index.html` | Remove CF beacon script |
| `src/frontend/.env` / `.env.production` | Add `VITE_OPENPANEL_CLIENT_ID` |
| `src/backend/.env` | Add `OPENPANEL_CLIENT_ID`, `OPENPANEL_CLIENT_SECRET`, `OPENPANEL_API_URL` |
| Auth route handlers (backend) | Add `signup_completed` tracking |
| Export completion handler (backend) | Add `first_export_completed` tracking |
| Stripe webhook handler (backend) | Add `first_credit_purchase` tracking |
| Frontend gesture handlers | Add `first_*` event tracking |
| Frontend error boundary / global handler | Add `error_tracked` |
| Backend exception middleware | Add `error_tracked` |
| `package.json` | Add `@openpanel/web` |
| `requirements.txt` | Add `openpanel` |

## Acceptance Criteria

- [ ] OpenPanel self-hosted on VPS, accessible at `analytics.reelballers.com`
- [ ] Docker Compose running 7 services (api, dashboard, worker, postgres, clickhouse, redis, caddy)
- [ ] 4 API clients created and configured
- [ ] Frontend SDK initialized, users identified on login with correct user properties
- [ ] Backend SDK initialized at app startup
- [ ] All 8 activation events + error tracking flowing to OpenPanel (verified in Event Explorer)
- [ ] User profiles created in OpenPanel with matching user IDs
- [ ] L1 Daily Pulse dashboard live with 4 metric cards + realtime strip
- [ ] Cloudflare Web Analytics fully removed (no `zaraz` references remain)
- [ ] `analytics.js` deleted, no CF beacon in `index.html`
- [ ] Events reliably delivered (no silent drops -- verify with SDK debug mode)
