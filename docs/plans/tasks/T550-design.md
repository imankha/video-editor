# T550 Admin Panel — Architecture Design

## Current State

```
auth.sqlite
  ├── users (user_id, email, credits, last_seen_at, ...)
  ├── sessions (session_id → user_id)
  ├── otp_codes
  └── credit_transactions

per-user database.sqlite (per profile)
  └── export_jobs (id, type, status, ...) ← no GPU timing

modal_client.py
  └── call_modal_framing_ai()  ← tracks total_elapsed but returns only {status, output_key, ...}

Frontend
  ├── authStore: {isAuthenticated, email}  ← no isAdmin
  └── EDITOR_MODES: {FRAMING, OVERLAY, ANNOTATE, PROJECT_MANAGER}  ← no ADMIN
```

**No admin concept, no session duration tracking, no GPU cost visibility.**

---

## Target State

```
auth.sqlite (additions)
  └── admin_users (email PK)          ← table-driven admin list, seeded with imankh@gmail.com

per-user database.sqlite (additions)
  └── export_jobs: gpu_seconds REAL, modal_function TEXT   ← new columns via migration

modal_client.py
  └── call_modal_framing_ai() returns: {..., "gpu_seconds": total_elapsed, "modal_function": "framing"}
  └── call_modal_clips_ai() returns:   {..., "gpu_seconds": total_elapsed, "modal_function": "overlay"}

New backend: routers/admin.py
  ├── GET  /api/admin/me                             ← is_admin check (no 403, safe for all)
  ├── GET  /api/admin/users                          ← admin-gated
  ├── GET  /api/admin/users/{user_id}/gpu-usage      ← admin-gated
  └── POST /api/admin/users/{user_id}/grant-credits  ← admin-gated

Frontend (additions)
  ├── authStore: isAdmin, checkAdmin()
  ├── stores/adminStore.js (NEW)
  ├── screens/AdminScreen.jsx (NEW)
  ├── components/admin/UserTable.jsx (NEW)
  ├── components/admin/GpuUsagePanel.jsx (NEW)
  ├── components/admin/CreditGrantModal.jsx (NEW)
  ├── constants/editorModes.js: + ADMIN
  └── App.jsx: Admin button + AdminScreen routing
```

---

## Data Flow

### Admin Check
```
App startup:
  initSession() → setSessionState(isAuthenticated, email)
    └─ if isAuthenticated → authStore.checkAdmin()
         └─ GET /api/admin/me → {is_admin: bool}
              └─ set isAdmin in authStore
```

### GPU Tracking
```
framing.py: result = await call_modal_framing_ai(...)
  ↑ modal_client adds to return dict: {"gpu_seconds": total_elapsed, "modal_function": "framing"}

framing.py line ~852: UPDATE export_jobs SET ..., gpu_seconds=?, modal_function=? WHERE id=?
```

### Admin User List
```
GET /api/admin/users:
  1. SELECT * FROM auth.sqlite users (all registered users)
  2. For each user:
     a. gpu_seconds: scan user's profile databases → sum export_jobs.gpu_seconds
     b. quest_progress: scan user's profile databases → run _check_all_steps() → count per quest
```

---

## DB Schema

### auth.sqlite additions (in `init_auth_db()`)

```sql
CREATE TABLE IF NOT EXISTS admin_users (
    email TEXT PRIMARY KEY
);
-- Seed on first creation (skipped if already exists via INSERT OR IGNORE)
INSERT OR IGNORE INTO admin_users (email) VALUES ('imankh@gmail.com');
```

### per-user migrations (in `database.py` migrations list)

```python
"ALTER TABLE export_jobs ADD COLUMN gpu_seconds REAL",
"ALTER TABLE export_jobs ADD COLUMN modal_function TEXT",
```

---

## API Endpoints

### `GET /api/admin/me`
No auth gate (safe 200/200).
```json
{"is_admin": true}
```

### `GET /api/admin/users` (admin-gated → 403 for non-admin)
```json
[
  {
    "user_id": "abc-123",
    "email": "user@example.com",
    "created_at": "2026-03-01",
    "last_seen_at": "2026-03-17",
    "credits": 15,
    "quest_progress": {
      "quest_1": {"completed": 4, "total": 4, "reward_claimed": true},
      "quest_2": {"completed": 3, "total": 5, "reward_claimed": false},
      "quest_3": {"completed": 1, "total": 5, "reward_claimed": false}
    },
    "gpu_seconds_total": 450.5
  }
]
```

Per-quest breakdown (not aggregate) so the admin table can show `Q1: ✓ | Q2: 3/5 | Q3: 1/5`.

**Parallelism:** per-user stats (quest counts + GPU total) are fetched concurrently with `asyncio.gather`:

```python
async def _get_user_stats(user_id: str) -> dict:
    quest_progress, gpu_total = await asyncio.gather(
        _compute_quest_progress(user_id),   # scans per-user profile DBs
        _compute_gpu_total(user_id),        # scans export_jobs across profiles
    )
    return {..., "quest_progress": quest_progress, "gpu_seconds_total": gpu_total}

# All users in parallel
results = await asyncio.gather(*[_get_user_stats(u["user_id"]) for u in users])
```

Each coroutine opens its own SQLite connection (safe — existing pattern). Quest and GPU scans for a given user run in parallel with each other, and all users run in parallel.

### `GET /api/admin/users/{user_id}/gpu-usage` (admin-gated)
```json
{
  "total_gpu_seconds": 450.5,
  "by_function": {
    "framing": {"count": 8, "total_seconds": 420.0},
    "overlay":  {"count": 5, "total_seconds": 28.5}
  },
  "recent_jobs": [
    {"id": "job_123", "type": "framing", "gpu_seconds": 52.3, "status": "complete", "created_at": "..."}
  ]
}
```

### `POST /api/admin/users/{user_id}/grant-credits` (admin-gated)
Request: `{"amount": 50}`
Response: `{"balance": 65}`
Calls existing `grant_credits(user_id, amount, source="admin_grant")`.

---

## Backend Files

| File | Change |
|------|--------|
| `app/services/auth_db.py` | Add `admin_users` table, `is_admin()`, `get_all_users_for_admin()` |
| `app/database.py` | Add 2 migrations to existing `migrations` list |
| `app/services/modal_client.py` | Add `gpu_seconds` + `modal_function` to result dict in `call_modal_framing_ai` and `call_modal_clips_ai` |
| `app/routers/export/framing.py` | Extract `gpu_seconds` from result, add to export_jobs UPDATE |
| `app/routers/admin.py` | NEW: 4 endpoints, 1 APIRouter (`admin_router`) |
| `app/routers/__init__.py` | Export `admin_router` |
| `app/main.py` | Register admin_router (prefix `/api/admin`) |

---

## Frontend Files

| File | Change |
|------|--------|
| `stores/authStore.js` | Add `isAdmin: false`, `checkAdmin()` action |
| `stores/adminStore.js` | NEW: `fetchUsers`, `fetchGpuUsage`, `grantCredits` |
| `screens/AdminScreen.jsx` | NEW: admin panel screen |
| `components/admin/UserTable.jsx` | NEW: sortable user table |
| `components/admin/GpuUsagePanel.jsx` | NEW: GPU drilldown panel |
| `components/admin/CreditGrantModal.jsx` | NEW: simple amount input + grant button |
| `constants/editorModes.js` | Add `ADMIN: 'admin'` |
| `App.jsx` | Add Admin button, AdminScreen routing |
| `screens/index.js` | Export AdminScreen |

---

## Component Hierarchy

```
App.jsx
  └─ [editorMode === 'admin'] AdminScreen
       ├─ UserTable
       │    └─ row: email | credits [+] | quests | time | gpu_total [click→drilldown]
       ├─ GpuUsagePanel (modal, per-user drilldown)
       └─ CreditGrantModal (simple input modal)
```

AdminScreen is a full-page screen (no project context). Back button sets mode to PROJECT_MANAGER.

---

## Frontend State

```javascript
// authStore additions
isAdmin: false,
checkAdmin: async () => {
  const res = await fetch('/api/admin/me', { credentials: 'include' });
  const data = await res.json();
  set({ isAdmin: data.is_admin });
},

// adminStore (new)
users: [],               // GET /api/admin/users result
gpuUsage: {},            // { [userId]: gpu-usage object }
loading: false,
fetchUsers(), fetchGpuUsage(userId), grantCredits(userId, amount)
```

---

## App.jsx Changes

### Admin button
Added to the ProjectsScreen header via a prop or direct render in App.jsx `!selectedProject` path. Admin button is conditionally rendered based on `isAdmin`.

### AdminScreen routing
```javascript
if (editorMode === EDITOR_MODES.ADMIN) {
  return <AdminScreen onBack={() => setEditorMode(EDITOR_MODES.PROJECT_MANAGER)} />;
}
```
This goes BEFORE the `if (!selectedProject)` check so admin mode works regardless of project state.

---

## Risks & Open Questions

| Risk | Mitigation |
|------|-----------|
| Per-user DB scan for GPU/quests could be slow with many users | Acceptable for MVP (scan is O(n_users), fast local SQLite reads). Add caching if needed later. |
| `call_modal_clips_ai` is called from export/multi_clip path — need to trace completion to store gpu_seconds | Verify multi_clip export path stores gpu_seconds the same way. If it uses `complete_export_job()`, add params there too. For MVP, only framing.py is updated; overlay/multi_clip can be added later. |
| Admin button on ProjectsScreen vs inner header | Both need the button. Add to ProjectsScreen header via new prop `isAdmin` passed down. |

---

## Test Scope

**Backend (pytest):**
- `test_admin.py`: admin check returns 403 for non-admin, 200 for admin
- `test_admin.py`: session heartbeat creates row on first call, updates on second call
- `test_admin.py`: GPU aggregation sums correctly across completed export_jobs

**Frontend (vitest):**
- `adminStore.test.js`: Admin button hidden for regular user, visible for admin
