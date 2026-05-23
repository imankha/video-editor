# T3020 Kickoff Prompt: Admin Panel Migration to Milestones

Use this prompt to start a fresh AI session for implementing T3020.

---

## Prompt

Implement T3020: Admin Panel Migration to Milestones

### Epic Context

This is task 3 of 4 in the Analytics 1 epic.
Read: `docs/plans/tasks/analytics-1/EPIC.md`

### Prior Task Learnings

- **T3010 (User Milestones + Acquisition Tracking): COMPLETE.** The `user_milestones` table exists in Postgres with all columns populated. Migration v005 has been applied, all existing users are backfilled. The `record_milestone()` and `create_user_milestones()` functions in `src/backend/app/analytics.py` are live and recording events from 8 handler instrumentation points. 19 backend tests pass in `src/backend/tests/test_analytics.py`.

### Task Details

Read: `docs/plans/tasks/analytics-1/T3020-admin-panel-event-migration.md`

### What This Task Does

Replace ALL R2 profile SQLite access in the admin panel with a single Postgres JOIN against `user_milestones`. Delete ~300 lines of R2 download + SQLite counting code. Delete quest funnel chart and GPU drilldown components. The admin page should go from multi-second loads to <200ms.

### Current File Map (What Exists Today)

**Backend -- `src/backend/app/routers/admin.py` (800 lines):**

Functions to DELETE entirely (lines 68-350, ~280 lines):
- `_admin_r2_profile_key()` (line 68) -- builds R2 key path
- `_admin_download_profile_db()` (line 73) -- downloads profile.sqlite from R2
- `_admin_discover_profiles()` (line 97) -- R2 prefix scan for profile IDs
- `_admin_ensure_profile_db()` (line 124) -- async wrapper for download
- `_check_steps_on_conn()` (line 133) -- quest step checking on SQLite
- `_compute_quest_progress_single()` (line 247) -- 20+ SQLite quest queries
- `_compute_activity_counts_single()` (line 287) -- COUNT queries on SQLite
- `_compute_gpu_total_single()` (line 318) -- SUM gpu_seconds on SQLite
- `_get_profile_stats()` (line 334) -- orchestrates all SQLite counting
- `_compute_money_spent_cents()` (line 352) -- keep this, still needed for credits

Endpoints to REWRITE:
- `GET /api/admin/users` (line 371) -- currently discovers profiles, downloads DBs, computes stats. Replace with single Postgres query joining `users` + `user_milestones`. Response shape changes (see below).

Endpoints to DELETE:
- `GET /api/admin/users/{user_id}/gpu-usage` (line 471) -- Modal dashboard replaces this

Endpoints that stay UNCHANGED:
- `GET /api/admin/me` (line 364)
- `POST /api/admin/users/{user_id}/grant-credits` (line 551)
- `POST /api/admin/users/{user_id}/set-credits` (line 571)
- `POST /api/admin/impersonate/{target_user_id}` (line 642)
- `POST /api/admin/impersonate/stop` (line 619)
- `POST /api/admin/cleanup-shares` (line 686)
- `POST /api/admin/migrate` (line 712)
- `GET /api/admin/referrals/*` (lines 729-800)

Imports to REMOVE after deletion:
- `sqlite3` -- no more SQLite access
- `USER_DATA_BASE` from `..database` -- no more local file paths
- `get_r2_client, R2_BUCKET, R2_ENABLED` from `..storage` (keep `APP_ENV`)
- `QUEST_DEFINITIONS` from `..quest_config` -- no more quest progress
- `get_credit_stats_for_admin` from `..services.user_db` -- credit data now comes from milestones

Imports to ADD:
- `get_pg` from `..services.pg` -- for the milestones JOIN query

**Frontend -- files to DELETE entirely:**
- `src/frontend/src/components/admin/QuestFunnelChart.jsx` (144 lines)
- `src/frontend/src/components/admin/GpuUsagePanel.jsx` (105 lines)

**Frontend -- files to SIMPLIFY:**

`src/frontend/src/components/admin/UserTable.jsx` (584 lines):
- DELETE: `StatCard` component (lines 36-56) and the 6 summary stat cards section
- DELETE: `QuestBadge` component (lines 23-33)
- DELETE: `ProfileRow` component (lines 139-180) and all profile expansion logic
- DELETE: `aggregateFromProfiles()` function
- DELETE: `funnelUsers` computation and QuestFunnelChart rendering
- DELETE: Quest columns (Q1-Q4 badges), GPU column, GPU click handler
- DELETE: Imports of QuestFunnelChart, GpuUsagePanel, useQuestStore
- ADD: Origin badge column (organic/viral with channel tooltip)
- ADD: Install day column
- ADD: Shares column
- KEEP: Search, filter, sort, pagination controls
- KEEP: CreditGrantModal integration
- KEEP: Email click -> impersonation
- SIMPLIFY: Pagination now by user count (not profile count), no `total_profiles`

`src/frontend/src/stores/adminStore.js` (149 lines):
- DELETE: `fetchGpuUsage()` action and `gpuUsage` state
- UPDATE: `fetchUsers()` to consume new response shape (no `profiles` array, flat user rows)
- UPDATE: pagination uses `total_users` instead of `total_profiles`

`src/frontend/src/screens/AdminScreen.jsx` (79 lines):
- DELETE: Guest user filtering logic (if applicable after response shape change)
- Minor: may need to remove `allUsers` prop if quest funnel is gone

**Frontend -- file UNCHANGED:**
- `src/frontend/src/components/admin/CreditGrantModal.jsx` (119 lines) -- no changes needed

### New API Response Shape

**`GET /api/admin/users` -- new response:**

```json
{
  "users": [
    {
      "user_id": "uuid",
      "email": "user@example.com",
      "origin_type": "organic",
      "origin_channel": null,
      "install_day": "2026-05-22",
      "game_created_count": 5,
      "clip_created_count": 12,
      "export_completed_count": 3,
      "export_failed_count": 0,
      "share_completed_count": 1,
      "credit_purchase_count": 2,
      "credits": 80,
      "credits_spent": 40,
      "credits_purchased": 120,
      "money_spent_cents": 499,
      "last_active_at": "2026-05-22T19:30:00Z",
      "session_count": 15
    }
  ],
  "page": 1,
  "page_size": 10,
  "total_users": 42,
  "total_pages": 5
}
```

Key changes from old response:
- No `profiles` array -- flat user-level data
- No `quest_progress`, `gpu_seconds_total`, `games_annotated`, `clips_annotated`, `projects_framed`, `projects_completed`
- New: `origin_type`, `origin_channel`, `install_day`, `share_completed_count`, `session_count`, `export_failed_count`
- `total_profiles` -> `total_users`
- `last_seen_at` -> `last_active_at` (from milestones)
- `created_at` -> `install_day` (from milestones)

### Backend SQL Query

The core of the new endpoint is a single query:

```sql
SELECT
    u.user_id, u.email,
    m.origin_type, m.origin_channel, m.install_day,
    m.game_created_count, m.clip_created_count,
    m.export_completed_count, m.export_failed_count,
    m.share_completed_count, m.credit_purchase_count,
    m.credits_consumed_count, m.session_count,
    m.last_active_at
FROM users u
LEFT JOIN user_milestones m ON u.user_id = m.user_id
ORDER BY m.last_active_at DESC NULLS LAST
LIMIT %s OFFSET %s
```

Credit balance (`credits`, `credits_spent`, `credits_purchased`, `money_spent_cents`) still comes from `get_credit_stats_for_admin()` since credit ledger lives in per-user SQLite. This function already works without R2 downloads -- it queries the user's SQLite directly.

**Important:** Use `LEFT JOIN` (not `JOIN`) so users without a milestones row still appear. Users created before T3010's migration who somehow weren't backfilled should still show up with NULL milestone data.

**Important:** `get_credit_stats_for_admin()` in `src/backend/app/services/user_db.py` downloads user SQLite DBs from R2 to read credit balances. This function STAYS -- it's the credit ledger, not analytics. Only the admin.py R2 download functions (profile discovery/download) are deleted.

### Gotchas From Prior Tasks

1. **Postgres uses `%s` params, not `?`.** Use `get_pg()` context manager from `app.services.pg`.
2. **`get_pg()` returns `RealDictCursor`** -- rows are dicts, access via `row["column"]`.
3. **`_compute_money_spent_cents()` stays.** It maps Stripe purchase amounts to dollar values. It's called with data from `get_credit_stats_for_admin()`, not from milestones.
4. **The admin panel is behind an admin gate** (`_require_admin()`). Test by impersonating or setting up an admin user in `admin_users` table.
5. **Dev environment quirk:** The frontend has a global fetch interceptor (`src/frontend/src/utils/sessionInit.js`) that adds `X-User-ID` to all requests. This bypasses normal session auth in dev. When testing the admin panel via Playwright, use the existing auth bypass pattern (see `src/frontend/CLAUDE.md`).
6. **`get_credit_stats_for_admin()`** requires per-user SQLite access. Check if this function triggers R2 downloads -- if so, it's a dependency that needs to stay working. Don't accidentally remove storage imports it needs.

### Implementation Order

1. Backend first: rewrite `GET /api/admin/users`, delete GPU endpoint, delete R2/SQLite functions
2. Frontend second: update UserTable to consume new response, delete QuestFunnelChart + GpuUsagePanel
3. Update adminStore to match new response shape
4. Backend tests: verify admin endpoint returns correct milestones data
5. Manual test: load admin panel in browser, verify <200ms response

### Test Strategy

- **Backend tests:** Create test users with milestones rows, call `GET /api/admin/users`, assert response shape and data correctness. Test pagination. Test users with no milestones row (LEFT JOIN).
- **Frontend:** Verify admin panel renders correctly with new columns, CreditGrantModal still works, impersonation still works.
- **No E2E tests needed** -- admin panel is internal tooling.

### Acceptance Criteria

- Admin panel loads in <200ms (was multi-second)
- User table shows origin_type, channel, install_day, shares (new columns)
- Zero R2 profile SQLite downloads in admin.py (all R2 download functions deleted)
- QuestFunnelChart.jsx and GpuUsagePanel.jsx deleted
- No remaining imports of deleted components or functions
- Pagination by user count (not profile count)
- Credit grant functionality unchanged
- No regressions in non-admin endpoints
