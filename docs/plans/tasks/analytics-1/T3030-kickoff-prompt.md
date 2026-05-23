# T3030 Kickoff Prompt: Analytics Dashboards

Use this prompt to start a fresh AI session for implementing T3030.

---

## Prompt

Implement T3030: Analytics Dashboards

### Epic Context

This is task 4 of 4 in the Analytics 1 epic.
Read: `docs/plans/tasks/analytics-1/EPIC.md`

### Prior Task Learnings

- **T3010 (User Milestones + Acquisition Tracking): COMPLETE.** The `user_milestones` table exists in Postgres with all columns populated. Migration v005 has been applied, all existing users are backfilled. The `record_milestone()` and `create_user_milestones()` functions in `src/backend/app/analytics.py` are live and recording events from 8 handler instrumentation points. `update_session()` tracks session counts with a 30-minute gap threshold.
- **T3020 (Admin Panel Migration to Milestones): TESTING.** The admin panel user table now loads from a single Postgres JOIN against `user_milestones` instead of downloading per-user SQLite files from R2. Quest funnel chart, GPU drilldown, profile expansion, and summary stat cards were deleted. New columns: Origin, Joined, Exports, Shares, Sessions. Response shape is flat per-user (no nested profiles array). Load time went from multi-second to ~20ms. `get_credit_stats_for_admin(user_ids)` now accepts a `user_ids` filter to only scan paginated users' SQLite files.

### Task Details

Read: `docs/plans/tasks/analytics-1/T3030-analytics-dashboards.md`

### What This Task Does

Add 5 dashboard views to the admin panel, backed by Postgres queries against `user_milestones`. Add a `daily_counters` table for volume trends. No external chart libraries -- CSS-styled divs, tables, and inline SVG for sparklines.

### Current File Map (What Exists Today)

**Backend -- `src/backend/app/analytics.py` (87 lines):**

This is the file you will extend to also UPSERT `daily_counters` on each event.

```python
# Current imports
import logging
from app.services.pg import get_pg

# MILESTONE_EVENTS maps event names to (first_timestamp_col, count_col)
MILESTONE_EVENTS = {
    "game_created":     ("first_game_created_at",     "game_created_count"),
    "clip_created":     ("first_clip_created_at",     "clip_created_count"),
    "export_completed": ("first_export_completed_at", "export_completed_count"),
    "export_failed":    (None,                        "export_failed_count"),
    "share_completed":  ("first_share_completed_at",  "share_completed_count"),
    "credit_purchased": ("first_credit_purchase_at",  "credit_purchase_count"),
    "credits_consumed": (None,                        "credits_consumed_count"),
    "pwa_installed":    ("pwa_installed_at",           None),
}
```

`record_milestone(user_id, event)` (lines 34-59) does:
1. Looks up the event in MILESTONE_EVENTS
2. Builds SET clauses for the first_X timestamp (COALESCE so it only sets once) and count column (increment)
3. Also sets `last_active_at = now()` and `last_export_at = now()` for export_completed
4. Runs a single UPDATE on `user_milestones`

**You need to add:** After the milestones UPDATE, do an atomic UPSERT on `daily_counters`. This requires looking up the user's `origin_type` from `user_milestones` to know which daily_counters row to increment. UPSERT two rows: one for the user's origin_type and one for `'all'`.

**Mapping from event names to daily_counters columns:**

| Event | daily_counters column |
|-------|----------------------|
| `game_created` | `games_created` |
| `clip_created` | `clips_created` |
| `export_completed` | `exports_completed` |
| `export_failed` | `exports_failed` |
| `share_completed` | `shares_completed` |
| `credit_purchased` | `credit_purchases` |
| `credits_consumed` | `credits_consumed` |
| `pwa_installed` | (no daily counter -- too rare) |

Also: `create_user_milestones()` (lines 19-31) creates the milestones row on signup. Add a daily_counters UPSERT for `signups` here too.

**Backend -- `src/backend/app/routers/admin.py` (411 lines):**

Current imports (lines 11-34):
```python
import asyncio
import logging
import math

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from ..storage import APP_ENV
from ..user_context import get_current_user_id
from ..services.auth_db import (
    is_admin, get_user_by_id,
    create_impersonation_session, find_or_create_admin_restore_session,
    log_impersonation, invalidate_session, validate_session,
    IMPERSONATION_TTL_MINUTES,
)
from ..services.user_db import (
    get_credit_stats_for_admin, grant_credits,
)
from ..services.pg import get_pg
```

Router setup: `router = APIRouter(prefix="/admin", tags=["admin"])` (line 38)

Existing endpoints (by line number):
- `GET /me` (line 77)
- `GET /users` (line 84) -- milestones JOIN, paginated
- `POST /users/{user_id}/grant-credits` (line 162)
- `POST /users/{user_id}/set-credits` (line 182)
- `POST /impersonate/stop` (line 229)
- `POST /impersonate/{target_user_id}` (line 252)
- `POST /cleanup-shares` (line 296)
- `POST /migrate` (line 322)
- `GET /referrals/leaderboard` (line 339)
- `GET /referrals/by-channel` (line 356)
- `GET /referrals/user/{user_id}` (line 372)
- `GET /referrals/tree/{user_id}` (line 389)

File ends at line 411.

Add new analytics endpoints after the existing endpoints (before the referrals section or at the end). All require `_require_admin()`.

**Backend -- `src/backend/app/services/pg.py`:**

`_SCHEMA_DDL` starts at line 20, ends at line 215. `daily_counters` does NOT exist yet -- add it after `user_milestones` (line 208) and before `schema_migrations` (line 210). `_SEED_SQL` is at line 217.

The `user_milestones` schema (lines 172-208) has these columns relevant to dashboards:
- Cohort: `install_day`, `origin_type`, `origin_channel`, `signup_method`
- Journey timestamps: `signup_completed_at`, `first_game_created_at`, `first_clip_created_at`, `first_export_completed_at`, `first_share_completed_at`, `first_credit_purchase_at`, `pwa_installed_at`
- Counts: `game_created_count`, `clip_created_count`, `export_completed_count`, `export_failed_count`, `share_completed_count`, `credit_purchase_count`, `credits_consumed_count`
- Activity: `session_count`, `pwa_session_count`, `last_active_at`, `last_export_at`
- Indexes: `idx_milestones_install_day`, `idx_milestones_origin`, `idx_milestones_cohort`

**Backend -- `src/backend/app/migrations/postgres/`:**

Existing migrations: v001 through v005. Create `v006_daily_counters.py`.

**Frontend -- `src/frontend/src/screens/AdminScreen.jsx` (70 lines):**

Currently renders only the UserTable inside a single "Users" section:
```jsx
<div className="bg-white/5 rounded-xl p-6 border border-white/10">
  <h2 className="text-gray-300 font-medium mb-4">Users</h2>
  {/* loading/error/empty guards */}
  {!loading && !error && knownUsers.length > 0 && (
    <UserTable users={knownUsers} />
  )}
</div>
```

You need to add tab navigation (Users | Analytics) so the admin can switch between the user table and the dashboards. The dashboard view has its own sub-tabs (Funnel / Channels / Cohorts / Pulse). The Journey view is accessed from the user table by clicking a user row.

**Frontend -- `src/frontend/src/stores/adminStore.js` (116 lines):**

Current state: `users`, `usersLoading`, `usersError`, `currentPage`, `totalPages`, `totalUsers`, `pageSize`, `grantState`. Actions: `fetchUsers`, `nextPage`, `prevPage`, `grantCredits`, `setCredits`.

Add analytics data fetching: `fetchFunnel()`, `fetchChannels()`, `fetchCohorts()`, `fetchPulse()`, `fetchJourney(userId)` with corresponding state slices.

**Frontend -- `src/frontend/src/components/admin/` (existing files):**
- `CreditGrantModal.jsx` (119 lines) -- no changes needed
- `UserTable.jsx` (~400 lines) -- add a click handler on user rows to open the Journey view

**Frontend -- files to CREATE:**
- `src/frontend/src/components/admin/AnalyticsDashboard.jsx` -- container with sub-tabs
- `src/frontend/src/components/admin/FunnelChart.jsx` -- horizontal bar funnel
- `src/frontend/src/components/admin/ChannelsTable.jsx` -- acquisition channels table
- `src/frontend/src/components/admin/CohortGrid.jsx` -- color-coded cohort table
- `src/frontend/src/components/admin/JourneyTimeline.jsx` -- milestone timeline for single user
- `src/frontend/src/components/admin/PulseCards.jsx` -- metric cards with sparklines

### New Schema: daily_counters

```sql
CREATE TABLE IF NOT EXISTS daily_counters (
    counter_date DATE NOT NULL DEFAULT CURRENT_DATE,
    origin_type TEXT NOT NULL DEFAULT 'all',
    signups INTEGER NOT NULL DEFAULT 0,
    games_created INTEGER NOT NULL DEFAULT 0,
    clips_created INTEGER NOT NULL DEFAULT 0,
    exports_completed INTEGER NOT NULL DEFAULT 0,
    exports_failed INTEGER NOT NULL DEFAULT 0,
    shares_completed INTEGER NOT NULL DEFAULT 0,
    credit_purchases INTEGER NOT NULL DEFAULT 0,
    credits_consumed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_date, origin_type)
);
```

~3 rows/day (one per origin_type + 'all'). 1 year = ~1,100 rows.

### New API Endpoints

All under `/api/admin/analytics/`, all require admin session (`_require_admin()`).

**1. `GET /api/admin/analytics/funnel`**

Params: `?from=2026-01-01&to=2026-05-22&origin=all`

```json
{
  "funnel": [
    {
      "origin_type": "all",
      "signed_up": 100,
      "uploaded": 60,
      "clipped": 40,
      "exported": 25,
      "shared": 10,
      "purchased": 5
    }
  ],
  "from": "2026-01-01",
  "to": "2026-05-22"
}
```

Backend query:
```sql
SELECT
    origin_type,
    COUNT(*) as signed_up,
    COUNT(first_game_created_at) as uploaded,
    COUNT(first_clip_created_at) as clipped,
    COUNT(first_export_completed_at) as exported,
    COUNT(first_share_completed_at) as shared,
    COUNT(first_credit_purchase_at) as purchased
FROM user_milestones
WHERE install_day BETWEEN %s AND %s
GROUP BY origin_type;
```

When `origin=all`, also compute a totals row by running without GROUP BY (or sum the rows client-side). When `origin=organic|viral|ad_campaign`, add `AND origin_type = %s` filter.

**2. `GET /api/admin/analytics/channels`**

Params: `?from=2026-01-01&to=2026-05-22`

```json
{
  "channels": [
    {
      "origin_type": "organic",
      "origin_channel": null,
      "signups": 50,
      "exported": 20,
      "export_pct": 40.0,
      "purchased": 5,
      "purchase_pct": 10.0,
      "avg_exports": 2.3
    }
  ]
}
```

**3. `GET /api/admin/analytics/cohorts`**

Params: `?granularity=week&origin=all`

```json
{
  "cohorts": [
    {
      "cohort_period": "2026-05-19",
      "origin_type": "all",
      "signups": 12,
      "upload_pct": 58,
      "clip_pct": 42,
      "export_pct": 25,
      "share_pct": 8,
      "purchase_pct": 4
    }
  ],
  "granularity": "week"
}
```

**4. `GET /api/admin/analytics/journey/{user_id}`**

```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "origin_type": "viral",
  "origin_channel": "game_share",
  "install_day": "2026-05-01",
  "milestones": [
    { "event": "signup_completed", "at": "2026-05-01T10:00:00Z" },
    { "event": "game_created", "at": "2026-05-01T10:05:00Z", "count": 3 },
    { "event": "clip_created", "at": "2026-05-01T10:30:00Z", "count": 8 },
    { "event": "export_completed", "at": "2026-05-02T14:00:00Z", "count": 2 },
    { "event": "share_completed", "at": null, "count": 0 },
    { "event": "credit_purchased", "at": null, "count": 0 },
    { "event": "pwa_installed", "at": "2026-05-03T09:00:00Z" }
  ],
  "session_count": 15,
  "last_active_at": "2026-05-22T19:30:00Z"
}
```

The milestones array should include ALL event types, with `at: null` for events that haven't happened yet. Sort by timestamp (non-null first, chronologically, then nulls).

**5. `GET /api/admin/analytics/pulse`**

Params: `?days=30`

```json
{
  "cards": {
    "signups": { "today": 5, "last_week_same_day": 3, "change_pct": 66.7, "sparkline": [1,2,3,4,2,5,...] },
    "exports": { "today": 12, "last_week_same_day": 8, "change_pct": 50.0, "sparkline": [...] },
    "active_users": { "today": 25, "last_week_same_day": 20, "change_pct": 25.0, "sparkline": [...] },
    "purchases": { "today": 2, "last_week_same_day": 1, "change_pct": 100.0, "sparkline": [...] }
  },
  "days": 30
}
```

For `active_users`, compute from `user_milestones` not `daily_counters`:
```sql
SELECT COUNT(*) FROM user_milestones WHERE last_active_at::date = CURRENT_DATE;
```

For sparklines, return an array of daily values for the last N days from `daily_counters`.

### Frontend Component Architecture

```
AdminScreen.jsx (add top-level tab navigation: Users | Analytics)
  ├── UserTable.jsx (existing, add click → JourneyTimeline)
  │   └── JourneyTimeline.jsx (NEW, rendered as a modal/overlay when user is selected)
  └── AnalyticsDashboard.jsx (NEW, container with sub-tabs)
      ├── PulseCards.jsx (always visible at the top of the Analytics tab)
      └── (sub-tab content below the cards)
          ├── FunnelChart.jsx
          ├── ChannelsTable.jsx
          └── CohortGrid.jsx
```

**AdminScreen.jsx changes:**
- Add two top-level tabs: "Users" and "Analytics"
- "Users" shows the existing UserTable
- "Analytics" shows the AnalyticsDashboard

**AdminStore.js changes -- add analytics state:**
```javascript
// New state slices
funnelData: null, funnelLoading: false,
channelsData: null, channelsLoading: false,
cohortsData: null, cohortsLoading: false,
pulseData: null, pulseLoading: false,
journeyData: null, journeyLoading: false,
journeyUserId: null,

// New actions
fetchFunnel: async (from, to, origin) => { ... },
fetchChannels: async (from, to) => { ... },
fetchCohorts: async (granularity, origin) => { ... },
fetchPulse: async (days) => { ... },
fetchJourney: async (userId) => { ... },
clearJourney: () => set({ journeyData: null, journeyUserId: null }),
```

### UI Design Notes

Follow the existing admin panel design language (dark theme, `bg-white/5` cards, `border-white/10` borders, purple accent). See `src/frontend/src/components/admin/UserTable.jsx` for the established patterns.

**FunnelChart:** Horizontal bars. Each stage is a row with a label, a colored bar (width = % of previous stage), and a count + conversion % label. Use the purple gradient for bars. Stages: Signed Up → Uploaded → Clipped → Exported → Shared → Purchased.

**ChannelsTable:** Standard table like UserTable. Columns: Channel, Signups, Exported (%), Purchased (%), Avg Exports. Color-code the export % cell (green >50%, yellow 20-50%, red <20%).

**CohortGrid:** Table with rows = install periods, columns = milestone stages. Cells show %. Color-code cells: green (>60%), light-green (40-60%), yellow (20-40%), red (<20%). Header row shows stage names. First column shows the cohort period + signup count.

**JourneyTimeline:** Horizontal timeline with dots connected by lines. Each milestone is a dot with a label below it. Completed milestones are filled (purple), pending milestones are gray outlines. Show the timestamp and time-gap between steps above the connecting line. Show lifetime count below the milestone label. Render as a modal/drawer over the user table.

**PulseCards:** 4 cards in a row. Each card: big number (today's value), smaller text showing WoW change (green up-arrow / red down-arrow + percentage), and a 30-day sparkline below. Sparkline is an inline `<svg>` with a `<polyline>` -- 30 data points, ~120px wide, ~40px tall. No axis labels needed.

**No external chart libraries.** CSS widths for the funnel bars, CSS background-color for the cohort grid, inline SVG polyline for sparklines. Keep it simple.

### Gotchas From Prior Tasks

1. **Postgres uses `%s` params, not `?`.** Use `get_pg()` context manager from `app.services.pg`.
2. **`get_pg()` returns `RealDictCursor`** -- rows are dicts, access via `row["column"]`.
3. **The admin panel is behind an admin gate** (`_require_admin()`). All new endpoints must call this.
4. **Dev environment quirk:** The frontend has a global fetch interceptor (`src/frontend/src/utils/sessionInit.js`) that adds `X-User-ID` to all requests. This bypasses normal session auth in dev.
5. **Migration files follow the pattern** in `src/backend/app/migrations/postgres/v005_user_milestones.py`. Each has `VERSION`, `DESCRIPTION`, and a `run(conn)` function.
6. **`_SCHEMA_DDL` in pg.py must also be updated** -- it's used for fresh database initialization. Add `daily_counters` there AND in the migration file.
7. **`record_milestone()` uses a single `get_pg()` connection.** The daily_counters UPSERT should happen in the SAME connection/transaction to ensure atomicity. The user's `origin_type` can be fetched from the same UPDATE using `RETURNING` or via a subquery.
8. **`date_trunc('week', ...)` in Postgres returns Monday-based weeks by default.** This is fine for the cohort grid.
9. **Admin store uses `API_BASE` from config** -- match the same pattern for new fetch calls.
10. **T3020 performance fix:** `get_credit_stats_for_admin()` now accepts `user_ids` parameter. The `/users` endpoint passes only the paginated user IDs. Don't regress this.

### Implementation Order

1. **Schema first:** Create migration `v006_daily_counters.py` + update `_SCHEMA_DDL` in pg.py
2. **analytics.py:** Extend `record_milestone()` and `create_user_milestones()` to UPSERT daily_counters
3. **Backfill:** Add a backfill step to v006 migration that creates historical `signups` rows from `user_milestones.install_day` (other counts not available historically)
4. **Backend endpoints:** Add 5 analytics endpoints to admin.py
5. **Backend tests:** Verify each endpoint returns correct data shape
6. **Frontend store:** Add analytics fetch actions to adminStore.js
7. **Frontend components:** Build AnalyticsDashboard, PulseCards, FunnelChart, ChannelsTable, CohortGrid, JourneyTimeline
8. **AdminScreen:** Add tab navigation between Users and Analytics
9. **UserTable:** Add click handler to open JourneyTimeline
10. **Manual test:** Load admin panel, verify all 5 dashboards render with data

### Test Strategy

- **Backend tests:** Create test users with varied milestones data, call each analytics endpoint, assert response shape and data correctness. Test date filtering, origin filtering, empty states. Test daily_counters increment via record_milestone.
- **Frontend:** Verify all 5 dashboard views render correctly. Test empty states (no data). Test tab navigation. Test Journey modal open/close.
- **No E2E tests needed** -- admin panel is internal tooling.

### Acceptance Criteria

- [ ] `daily_counters` table exists with real-time increments from `record_milestone()`
- [ ] Activation funnel shows drop-off between stages, filterable by origin and date range
- [ ] Acquisition channels table shows signup/export/purchase rates by origin_type and channel
- [ ] Cohort grid shows weekly milestone completion rates, color-coded
- [ ] User journey timeline accessible from user table click
- [ ] Daily pulse cards show today's metrics with WoW comparison and 30-day sparklines
- [ ] All endpoints admin-only, parameterized SQL (no injection)
- [ ] Dashboard loads in < 500ms on staging
- [ ] No external chart library dependencies
- [ ] Tab navigation between Users and Analytics in admin panel
