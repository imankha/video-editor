# T3020 Test & Fix: Admin Panel Migration to Milestones

## Task

Read this handoff document and help me test, debug, and fix T3020: admin panel migrated from R2/SQLite profile downloads to a single Postgres JOIN against `user_milestones`.

## What Was Built

The admin panel user table now loads from Postgres instead of downloading per-user SQLite databases from R2. Quest funnel chart, GPU drilldown, profile expansion, and summary stat cards were deleted. New columns show origin type, install day, shares, and sessions. The response shape is flat per-user (no nested profiles array). Load time should drop from multi-second to <200ms.

**Branch:** `feature/T3020-admin-panel-migration`
**Status:** TESTING (18 backend tests pass, frontend builds clean)

---

## Architecture

```
BEFORE (slow):
  Browser -> GET /api/admin/users
    -> auth.sqlite: list all users
    -> R2: discover profiles per user (S3 list_objects)
    -> R2: download profile.sqlite per profile (S3 download_file)
    -> SQLite: COUNT games, clips, exports, quests, GPU per profile
    <- Response with nested profiles[] array

AFTER (fast):
  Browser -> GET /api/admin/users
    -> Postgres: SELECT users LEFT JOIN user_milestones (single query)
    -> Local SQLite: get_credit_stats_for_admin() (reads user.sqlite files)
    <- Response with flat user rows (no profiles)
```

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `src/backend/app/routers/admin.py` | Deleted 10 R2/SQLite helper functions + GPU endpoint. Rewrote `list_users` as Postgres JOIN. Removed `sqlite3`, `pathlib`, R2, quest imports. Added `get_pg` import. |
| `src/backend/tests/conftest.py` | Added `monkeypatch.setattr("app.routers.admin.get_pg", mock_get_pg)` to `pg_conn` fixture |
| `src/backend/tests/test_admin.py` | Rewrote for new response shape. 18 tests: milestones data, LEFT JOIN, pagination, credits. Deleted GPU tests. |

### Frontend
| File | Change |
|------|--------|
| `src/frontend/src/components/admin/QuestFunnelChart.jsx` | **DELETED** (144 lines) |
| `src/frontend/src/components/admin/GpuUsagePanel.jsx` | **DELETED** (105 lines) |
| `src/frontend/src/components/admin/UserTable.jsx` | Removed StatCard, QuestBadge, ProfileRow, aggregateFromProfiles, funnelUsers, profile expansion, GPU click handler. Added OriginBadge component. New columns: Origin, Joined, Exports, Shares, Sessions. Removed quest/GPU columns. |
| `src/frontend/src/stores/adminStore.js` | Removed `gpuUsage` state and `fetchGpuUsage`. Changed `totalProfiles` -> `totalUsers`. Updated `fetchUsers` to read `total_users`. |
| `src/frontend/src/screens/AdminScreen.jsx` | Removed `allUsers` prop from UserTable. Minor cleanup. |

### Tests
| File | Tests |
|------|-------|
| `src/backend/tests/test_admin.py` | 18 tests (admin gate, is_admin, /me, /users shape, milestones data, LEFT JOIN, pagination, grant credits) |

---

## How to Test Manually

### Prerequisites

1. Start the backend: `cd src/backend && uvicorn app.main:app --reload`
2. Start the frontend: `cd src/frontend && npm run dev`
3. **Migration v005 must be applied** on your local Postgres (it creates `user_milestones`). If not applied, run: `POST /api/admin/migrate` from the admin panel or via curl.
4. **Backfill must have run** so existing users have milestones rows. The migration v005 backfills automatically.

### Auth Bypass (for browser testing)

```javascript
// In Playwright MCP or browser console:

// 1. Set headers
await page.setExtraHTTPHeaders({
  'X-User-ID': 'manual-test-user',
  'X-Test-Mode': 'true',
});

// 2. Get session cookie
await page.evaluate(async () => {
  await fetch('/api/auth/test-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
  });
});

// 3. Bypass frontend auth gate
await page.evaluate(async () => {
  const { useAuthStore } = await import('/src/stores/authStore.js');
  useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
});

// 4. Reload
await page.reload();
```

**Note:** The test-login user must be in the `admin_users` table to access the admin panel. Alternatively, impersonate the real admin account.

**Simpler alternative:** If the app is running in dev mode, just navigate to `http://localhost:5173` and log in normally. The `X-User-ID` header is added automatically by the dev fetch interceptor in `src/frontend/src/utils/sessionInit.js`.

### Test Flow

1. Navigate to the admin panel (gear icon or `/admin` route)
2. Verify the user table loads without errors
3. Check that these columns are visible: Email, Origin, Joined, Games, Clips, Exports, Shares, Credits, $ Spent, Sessions, Last active
4. Check that these are NOT visible: Q1-Q4 quest badges, GPU column, profile count, stat cards at the top, quest funnel chart
5. Click an email to verify impersonation still works
6. Click the + button next to Credits to verify credit grant modal still works
7. Grant credits and verify the balance updates in the table
8. Use the search box to filter by email
9. Click filter pills (All, Paying, Active 7d, Has Exports) and verify they work
10. Click column headers to sort and verify sort works
11. If there are enough users, verify pagination (Previous/Next) works
12. Check the "users total" count in the controls row

### Edge Cases to Test

1. **User with no milestones row** -- should appear in the table with dashes/zeros for milestone columns (LEFT JOIN)
2. **Origin badge colors** -- organic = green, viral = purple, ad_campaign = blue. Hover on viral badge should show channel tooltip if origin_channel is set
3. **Pagination boundary** -- page 1 with page_size=1 should show 1 user, navigation works
4. **Sort by last_active_at** -- default sort, most recently active first
5. **Sort by money_spent_cents** -- paying users should sort to top
6. **"Has Exports" filter** -- should filter to users with export_completed_count > 0

---

## Known Potential Issues

1. **`get_credit_stats_for_admin()` scans local user.sqlite files.** In dev, these files exist locally. In production (Fly.io), they exist because of R2 sync. If credit columns show all zeros, the function can't find the SQLite files -- check that `USER_DATA_BASE` points to the right directory.

2. **Missing milestones rows.** If migration v005 hasn't been applied, `user_milestones` table may not exist or may be empty. The LEFT JOIN means users still appear, but all milestone columns will be null/zero. Run `POST /api/admin/migrate` to apply.

3. **Response time.** The endpoint should respond in <200ms. If it's slow, check that the Postgres `idx_milestones_install_day` index exists. `get_credit_stats_for_admin()` adds latency proportional to user count since it opens each user's SQLite file.

4. **`total_profiles` in old frontend code.** If you see "totalProfiles" referenced anywhere, it's stale. The store now uses `totalUsers`. The build passes clean, so this shouldn't happen.

---

## Running Automated Tests

```bash
# Backend tests (18 tests)
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_admin.py -v

# Frontend build check (no admin-specific unit tests)
cd src/frontend && npx vite build
```

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| Admin users endpoint (Postgres query) | `src/backend/app/routers/admin.py:83-140` |
| Credit stats function (SQLite scan) | `src/backend/app/services/user_db.py:480-545` |
| user_milestones schema | `src/backend/app/services/pg.py:172-208` |
| Frontend user table component | `src/frontend/src/components/admin/UserTable.jsx` |
| Admin store (data fetching) | `src/frontend/src/stores/adminStore.js` |
| Admin screen (top-level) | `src/frontend/src/screens/AdminScreen.jsx` |
| OriginBadge component | `src/frontend/src/components/admin/UserTable.jsx:20-35` |

---

## Acceptance Criteria

- [ ] Admin panel loads without errors
- [ ] Response time is <200ms (was multi-second)
- [ ] User table shows: Origin, Joined, Games, Clips, Exports, Shares, Credits, $ Spent, Sessions, Last active
- [ ] Quest funnel chart is gone
- [ ] GPU drilldown is gone
- [ ] Summary stat cards are gone
- [ ] Profile expansion rows are gone
- [ ] Origin badge shows organic (green) / viral (purple) with channel tooltip
- [ ] Search by email works
- [ ] Filter pills work (All, Paying, Active 7d, Has Exports)
- [ ] Column sorting works
- [ ] Pagination shows "N users total" (not "N profiles total")
- [ ] Credit grant modal works (+ button, grant, balance updates)
- [ ] Impersonation works (click email)
- [ ] Users without milestones rows appear with zeros (not missing)
- [ ] No console errors in browser dev tools
