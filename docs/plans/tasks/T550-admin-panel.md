# T550: Admin Panel

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-03-17
**Updated:** 2026-03-17

## Problem

No visibility into user activity, credit usage, or GPU costs. The developer (admin) needs to see who's using the app, how much it's costing, and manually grant credits. Also no analytics integration to understand usage patterns.

## Solution

An admin panel accessible via a button in the app header (visible only to users in a configurable admin list). Shows user activity, quest progress, credit balances (with grant ability), and GPU usage. Integrates with Cloudflare Web Analytics for traffic data and tracks session duration server-side.

## Context

### Relevant Files

**Backend (new):**
- `src/backend/app/routers/admin.py` - NEW: admin API endpoints
- `src/backend/app/services/session_tracker.py` - NEW: session duration tracking
- `src/backend/app/services/analytics.py` - NEW: Cloudflare Analytics API client

**Backend (modify):**
- `src/backend/app/services/auth_db.py` - Add admin list, session tracking tables
- `src/backend/app/database.py` - Add GPU usage tracking fields to export_jobs
- `src/backend/app/main.py` - Add admin router, session tracking middleware
- `src/backend/app/services/modal_client.py` - Record GPU seconds on job completion
- `src/backend/app/routers/exports.py` - Populate GPU duration fields on export completion

**Frontend (new):**
- `src/frontend/src/screens/AdminScreen.jsx` - NEW: admin panel page
- `src/frontend/src/stores/adminStore.js` - NEW: admin data store
- `src/frontend/src/components/admin/UserTable.jsx` - NEW: user list with stats
- `src/frontend/src/components/admin/GpuUsagePanel.jsx` - NEW: GPU usage drilldown
- `src/frontend/src/components/admin/CreditGrantModal.jsx` - NEW: grant credits modal

**Frontend (modify):**
- Header/nav component - Add Admin button (conditional on admin status)
- Router/App.jsx - Add /admin route

### Related Tasks
- Depends on: T530 (Credit System — credit balance + grant API)
- Depends on: T540 (Quest System — quest progress data)
- Depends on: T405 (Central auth DB — DONE)

### Technical Notes

**Admin configuration (auth.sqlite):**
```sql
CREATE TABLE IF NOT EXISTS admin_users (
    email TEXT PRIMARY KEY
);
-- Seed: INSERT INTO admin_users (email) VALUES ('imankh@gmail.com');
```

**Admin check:**
```python
async def is_admin(user_id: str) -> bool:
    """Check if user's email is in admin_users table."""
    user = get_user(user_id)
    if not user or not user['email']:
        return False
    return db.execute("SELECT 1 FROM admin_users WHERE email = ?", (user['email'],)).fetchone() is not None
```

**Session duration tracking (auth.sqlite):**
```sql
CREATE TABLE IF NOT EXISTS session_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    session_start TEXT NOT NULL,
    last_heartbeat TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Heartbeat mechanism:**
- Frontend sends heartbeat every 60 seconds: `POST /api/session/heartbeat`
- Backend creates/updates `session_activity` row for current session
- If no heartbeat for 5+ minutes, session is considered ended
- Duration = `last_heartbeat - session_start`

**GPU usage tracking (add to export_jobs):**
```sql
ALTER TABLE export_jobs ADD COLUMN gpu_seconds REAL;
ALTER TABLE export_jobs ADD COLUMN modal_function TEXT;  -- 'framing', 'overlay', 'detection'
```

**Populating GPU seconds:**
- Modal client already tracks `job_start_time` and `total_elapsed` (modal_client.py lines 438, 535)
- On job completion, write elapsed time to `export_jobs.gpu_seconds`
- `modal_function` records which Modal function was called

**Admin API endpoints:**
```
GET /api/admin/users → [
  {
    user_id: "abc-123",
    email: "user@example.com",
    created_at: "2026-03-01",
    last_seen_at: "2026-03-17",
    credits: 15,
    quest_progress: { quest_1: { completed: 4, total: 5 }, quest_2: { completed: 1, total: 4 } },
    session_stats: {
      total_seconds: 14400,      // all time
      last_7_days_seconds: 3600,
      last_30_days_seconds: 10800,
      visit_count: 12
    }
  },
  ...
]

GET /api/admin/users/{user_id}/gpu-usage → {
  total_gpu_seconds: 450.5,
  by_function: {
    framing: { count: 8, total_seconds: 420.0 },
    overlay: { count: 5, total_seconds: 28.5 },
    detection: { count: 3, total_seconds: 2.0 }
  },
  recent_jobs: [
    { id: "job_123", type: "framing", gpu_seconds: 52.3, status: "complete", created_at: "..." },
    ...
  ]
}

POST /api/admin/users/{user_id}/grant-credits → { amount: 50 }
  → Calls credit grant with source="admin_grant"

GET /api/admin/analytics → { cloudflare_dashboard_url: "..." }
```

**Cloudflare Web Analytics integration:**

*Setup required (one-time):*
1. Enable Cloudflare Web Analytics on the site (free, no proxy needed)
2. Add the JS beacon snippet to the frontend HTML
3. Create a Cloudflare API token with Analytics read permissions

*User identification:*
- Cloudflare Web Analytics doesn't track individual users natively
- Option A: Use Cloudflare's `cf-connecting-ip` header to correlate (approximate, shared IPs)
- Option B: Just link to the Cloudflare dashboard from the admin panel (simplest)
- **Recommended: Option B for now** — link to Cloudflare dashboard. Per-user analytics are better served by our own session tracking (heartbeat) which gives us exact user-level data. Cloudflare gives aggregate traffic patterns.

*Admin panel integration:*
- "View Cloudflare Analytics" button that opens the Cloudflare dashboard in a new tab
- Optionally pull aggregate stats via Cloudflare GraphQL Analytics API:
  ```
  GET /api/admin/analytics/traffic → {
    pageviews_24h: 150,
    unique_visitors_24h: 12,
    pageviews_7d: 800,
    unique_visitors_7d: 45
  }
  ```

**Admin UI layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Admin Panel                    [View Cloudflare Analytics]│
│─────────────────────────────────────────────────────────│
│                                                         │
│ Users (12 total)                                        │
│ ┌───────────────────────────────────────────────────────┐│
│ │ Email          │ Credits │ Quests │ Time    │ GPU   │ ││
│ │────────────────│─────────│────────│─────────│───────│ ││
│ │ user@mail.com  │ 15  [+] │ 4/9   │ 4h 12m  │ 7m 30s│ ││
│ │ other@mail.com │ 0   [+] │ 2/9   │ 45m     │ 0s    │ ││
│ │ ...            │         │       │         │       │ ││
│ └───────────────────────────────────────────────────────┘│
│                                                         │
│ [+] opens a simple input to grant N credits             │
│ Click GPU column → drilldown:                           │
│ ┌─────────────────────────────────────────┐             │
│ │ GPU Usage: user@mail.com                │             │
│ │                                         │             │
│ │ Framing:   8 calls, 420.0s total       │             │
│ │ Overlay:   5 calls, 28.5s total        │             │
│ │ Detection: 3 calls, 2.0s total         │             │
│ │                                         │             │
│ │ Recent Jobs:                            │             │
│ │  job_123 | framing | 52.3s | complete  │             │
│ │  job_124 | overlay | 5.7s  | complete  │             │
│ │  ...                                    │             │
│ └─────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

## Implementation

### Steps
1. [ ] Create admin_users table + seed admin email in auth.sqlite
2. [ ] Add admin check middleware/dependency
3. [ ] Add session_activity table + heartbeat endpoint
4. [ ] Add frontend heartbeat (60s interval on app mount)
5. [ ] Add gpu_seconds + modal_function columns to export_jobs
6. [ ] Instrument modal_client.py to record GPU seconds on completion
7. [ ] Create admin.py router with user list, GPU usage, credit grant endpoints
8. [ ] Set up Cloudflare Web Analytics (beacon snippet + API token)
9. [ ] Create AdminScreen.jsx with user table
10. [ ] Create GPU usage drilldown component
11. [ ] Create credit grant modal (simple input + button)
12. [ ] Add admin button to header (conditional on admin status)
13. [ ] Add /admin route to router
14. [ ] Pull Cloudflare aggregate stats (optional, if API token available)
15. [ ] Backend tests: admin check, session tracking, GPU aggregation
16. [ ] Frontend tests: admin visibility, credit grant, GPU drilldown

## Acceptance Criteria

- [ ] Admin button visible in header only for admin users
- [ ] User table shows all registered users with email, credits, quest progress, time on site, GPU usage
- [ ] Time on site shows per-visit, cumulative, and last 7/30 day breakdowns
- [ ] Credit balance shown per user with [+] button to grant more (simple input)
- [ ] GPU usage total shown per user; click reveals drilldown by call type (framing, overlay, detection)
- [ ] GPU drilldown shows count of calls + total seconds per call type
- [ ] Quest progress shown per user (completed steps / total steps)
- [ ] Cloudflare Analytics accessible via link/button from admin panel
- [ ] Admin list is configurable (not hardcoded to single email)
- [ ] Non-admin users cannot access admin endpoints (403)
- [ ] Session heartbeat tracks time on site accurately
