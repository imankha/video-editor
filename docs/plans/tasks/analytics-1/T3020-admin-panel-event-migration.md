# T3020: Admin Panel Migration to Milestones

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-20
**Updated:** 2026-05-20
**Epic:** [Analytics 1](EPIC.md)
**Depends on:** T3010 (User Milestones)

## Problem

The admin panel downloads profile SQLite files from R2 on every page load to compute activity counts (games, clips, framed, completed, GPU seconds, quest progress). This is:
- **Slow:** Multi-second page loads as N profile DBs are downloaded from R2
- **Doesn't scale:** More users = more downloads = slower pages
- **Fragile:** Depends on R2 availability and local disk for admin functionality
- **Redundant:** T3010's `user_milestones` table already has the same data in Postgres

## Solution

Replace ALL R2 profile SQLite access in the admin panel with a simple JOIN against `user_milestones`. Delete the R2 download functions, SQLite counting functions, quest progress display, GPU drilldown panel, and summary stat cards. These are all superseded by T3030's dashboards.

### What's Removed and Why

| Removed Feature | Replacement |
|----------------|-------------|
| Per-profile activity counts (games, clips, framed, completed) | `user_milestones` per-user counts (JOIN in admin query) |
| Summary stat cards (aggregated across page) | T3030 Daily Pulse (global daily totals) |
| Quest progress Q1-Q4 badges | T3030 Activation Funnel (aggregate drop-off) + User Journey Inspector (per-user milestones) |
| Quest funnel chart | T3030 Activation Funnel (better: shows all milestone stages, not just quest steps) |
| GPU drilldown (by_function, recent_jobs) | Export count in milestones + Modal dashboard for cost-per-function |
| GPU seconds total | `export_completed_count` in milestones (cost analysis moves to Modal's native dashboard) |
| Per-profile expandable rows | Dropped. Most users have 1-2 profiles; user-level totals are sufficient for admin |
| R2 download + SQLite counting (~300 lines) | Deleted entirely. Zero profile SQLite access in admin after this task. |

### Admin Table After Migration

| Column | Source | Notes |
|--------|--------|-------|
| Email | `users.email` | Unchanged |
| Origin | `user_milestones.origin_type` | **NEW** -- organic/viral badge |
| Channel | `user_milestones.origin_channel` | **NEW** -- invite_link/reel_share/game_share |
| Games | `user_milestones.game_created_count` | Was from R2 SQLite |
| Clips | `user_milestones.clip_created_count` | Was from R2 SQLite |
| Exports | `user_milestones.export_completed_count` | Replaces framed + completed (combined) |
| Shares | `user_milestones.share_completed_count` | **NEW** |
| Credits | Credit balance from Postgres | Unchanged |
| Purchased | `user_milestones.credit_purchase_count` | Was from credit_transactions |
| Money Spent | Derived from purchases | Unchanged |
| Install Date | `user_milestones.install_day` | **NEW** -- was created_at |
| Last Active | `user_milestones.last_active_at` | Was last_seen_at |

**Single query replaces entire admin endpoint:**

```sql
SELECT
    u.user_id, u.email,
    m.origin_type, m.origin_channel, m.install_day,
    m.game_created_count, m.clip_created_count,
    m.export_completed_count, m.export_failed_count,
    m.share_completed_count, m.credit_purchase_count,
    m.last_active_at,
    -- credit balance from existing credit query (unchanged)
FROM users u
JOIN user_milestones m ON u.user_id = m.user_id
ORDER BY m.last_active_at DESC NULLS LAST
LIMIT %s OFFSET %s;
```

Millisecond response. No R2. No SQLite. Paginated by user count (not profile count).

## Code Removal

### Backend: `src/backend/app/routers/admin.py`

**Delete these functions entirely:**
- `_admin_discover_profiles()` -- R2 prefix scan to find profile IDs
- `_admin_download_profile_db()` -- Downloads profile.sqlite from R2
- `_admin_ensure_profile_db()` -- Async wrapper for download
- `_compute_activity_counts_single()` -- SQLite COUNT queries
- `_compute_gpu_total_single()` -- SQLite SUM query
- `_compute_quest_progress_single()` -- 20+ SQLite quest step queries
- `_check_steps_on_conn()` -- Quest step checking helper
- `_get_profile_stats()` -- Orchestrates all SQLite counting

**Rewrite these endpoints:**
- `GET /api/admin/users` -- Replace with user_milestones JOIN query (above)
- `GET /api/admin/users/{user_id}/gpu-usage` -- Delete entirely (Modal dashboard)

**Estimated removal:** ~300 lines of R2 download + SQLite counting code

### Frontend: `src/frontend/src/components/admin/`

**Delete these components:**
- `QuestFunnelChart.jsx` -- Quest completion bar chart (superseded by T3030 Activation Funnel)
- `GpuUsagePanel.jsx` -- GPU drilldown modal (superseded by Modal dashboard)

**Simplify `UserTable.jsx`:**
- Remove summary stat cards section (superseded by T3030 Daily Pulse)
- Remove quest progress columns (Q1-Q4 badges)
- Remove GPU column + click handler
- Remove profile expandable rows
- Add origin_type badge column (organic/viral with channel tooltip)
- Add install_day column
- Add shares column
- Simplify pagination (user count, not profile count)

## Implementation

### Steps

1. [ ] Rewrite `GET /api/admin/users` to use user_milestones JOIN (single SQL query)
2. [ ] Delete `GET /api/admin/users/{user_id}/gpu-usage` endpoint
3. [ ] Delete all R2 download functions from admin.py
4. [ ] Delete all SQLite counting functions from admin.py
5. [ ] Delete `QuestFunnelChart.jsx` and `GpuUsagePanel.jsx`
6. [ ] Simplify `UserTable.jsx`: remove quest/GPU/summary cards, add origin/install/shares columns
7. [ ] Remove `CreditGrantModal.jsx` import of any deleted admin helpers (if applicable)
8. [ ] Update pagination: paginate by user count instead of profile count
9. [ ] Backend tests: verify admin endpoint returns correct data from milestones
10. [ ] Verify admin page loads in < 200ms on staging (was multi-second)

## Acceptance Criteria

- [ ] Admin panel loads in < 200ms (down from multi-second R2 downloads)
- [ ] User table shows origin_type, channel, install_day, and share count (new columns)
- [ ] Zero R2 profile SQLite downloads in admin.py (all download/counting functions deleted)
- [ ] QuestFunnelChart.jsx and GpuUsagePanel.jsx deleted
- [ ] No remaining imports of deleted components or functions
- [ ] Pagination by user count (simpler, no profile-count constraint)
- [ ] Credit grant functionality unchanged (CreditGrantModal still works)
- [ ] No regressions in non-admin endpoints
