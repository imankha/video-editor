# T3040: Instrument Full User Flow Milestones

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-22
**Updated:** 2026-05-22

## Problem

The analytics dashboards (T3030) show a 6-step funnel: Signed Up -> Uploaded -> Clipped -> Exported -> Shared -> Purchased. But the actual user flow has ~12 meaningful steps. The middle of the pipeline (annotation completion, framing, overlay, gallery) is invisible -- a user who uploads but never opens framing looks identical to one who never came back.

Worse, the current `user_milestones` architecture requires a schema migration for every new event (each one needs its own `first_X_at` + `X_count` column pair). That's not scalable. Adding a new tracked event should be adding one string to a Python dict, not an ALTER TABLE.

## Solution

### Architecture: Normalized event table

Replace the per-event-column pattern with a normalized `user_flow_events` table:

```sql
CREATE TABLE user_flow_events (
    user_id TEXT NOT NULL REFERENCES users(user_id),
    event TEXT NOT NULL,
    first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, event)
);
CREATE INDEX idx_flow_events_event ON user_flow_events(event);
```

**Adding a new event = adding one string to a Python dict. No migration, no schema change.**

`record_milestone()` becomes a single UPSERT:
```python
INSERT INTO user_flow_events (user_id, event)
VALUES (%s, %s)
ON CONFLICT (user_id, event)
DO UPDATE SET count = user_flow_events.count + 1
```

The existing `user_milestones` wide columns stay as-is for backward compatibility (session tracking, cohort dimensions, `last_active_at`, `last_export_at`). But all event tracking (first-occurrence + count) moves to `user_flow_events`. The `MILESTONE_EVENTS` dict and `record_milestone()` function write to the new table instead of building dynamic UPDATE clauses.

### Backward compatibility

The existing 8 events (`game_created`, `clip_created`, etc.) get migrated into `user_flow_events` rows backfilled from the current `user_milestones` columns. The old columns can stay for now but nothing reads from them after this task. `record_milestone()` only writes to `user_flow_events` + `daily_counters`.

Special fields that stay on `user_milestones` (not events):
- `last_active_at`, `last_export_at` -- updated by `record_milestone` directly
- `session_count`, `pwa_session_count` -- updated by `update_session()`
- Cohort dimensions: `install_day`, `origin_type`, `origin_channel`, `signup_method`
- `signup_completed_at` -- set at row creation

### Single config dict

All events -- old and new -- defined in one place:

```python
# Every trackable event in the system. Adding an event here is ALL you need.
# record_milestone() handles the rest (UPSERT to user_flow_events + daily_counters).
FLOW_EVENTS = {
    # Original events (T3010)
    "game_created":         {"label": "Uploaded",           "daily_col": "games_created"},
    "clip_created":         {"label": "Clipped",            "daily_col": "clips_created"},
    "export_completed":     {"label": "Exported",           "daily_col": "exports_completed"},
    "export_failed":        {"label": None,                 "daily_col": "exports_failed"},
    "share_completed":      {"label": "Shared",             "daily_col": "shares_completed"},
    "credit_purchased":     {"label": "Purchased",          "daily_col": "credit_purchases"},
    "credits_consumed":     {"label": None,                 "daily_col": "credits_consumed"},
    "pwa_installed":        {"label": "PWA Installed",      "daily_col": None},

    # New flow events (T3040)
    "annotation_completed": {"label": "Annotation Done",    "daily_col": "annotations_completed"},
    "framing_opened":       {"label": "Framing Opened",     "daily_col": None},
    "framing_exported":     {"label": "Framing Exported",   "daily_col": "framing_exports"},
    "overlay_exported":     {"label": "Overlay Exported",   "daily_col": "overlay_exports"},
    "gallery_viewed":       {"label": "Gallery Viewed",     "daily_col": None},
    "video_downloaded":     {"label": "Downloaded",         "daily_col": "video_downloads"},
}

# Ordered funnel steps for dashboard display (subset of FLOW_EVENTS that form the funnel).
FUNNEL_STEPS = [
    "game_created",
    "clip_created",
    "annotation_completed",
    "framing_opened",
    "framing_exported",
    "overlay_exported",
    "gallery_viewed",
    "video_downloaded",
    "share_completed",
    "credit_purchased",
]
```

The funnel query becomes:
```sql
SELECT e.event, COUNT(DISTINCT e.user_id) AS users
FROM user_flow_events e
JOIN user_milestones m ON e.user_id = m.user_id
WHERE m.install_day BETWEEN %s AND %s
GROUP BY e.event
```

The journey query becomes:
```sql
SELECT event, first_at, count
FROM user_flow_events
WHERE user_id = %s
ORDER BY first_at NULLS LAST
```

### Instrumentation points

Each handler calls `record_milestone(user_id, "event_name")` -- same function, different string:

| Event | Where to call | Notes |
|-------|--------------|-------|
| `annotation_completed` | `POST /api/games/{id}/finish-annotation` | Find handler in clips.py or games router |
| `framing_opened` | `POST /api/quests/achievements/opened_framing_editor` | Achievement endpoint already called by frontend |
| `framing_exported` | Framing export completion in `export/framing.py` | When export job status -> complete |
| `overlay_exported` | Overlay/final export completion in `export/overlay.py` | When overlay export completes |
| `gallery_viewed` | `POST /api/quests/achievements/viewed_gallery_video` | Achievement endpoint already called by frontend |
| `video_downloaded` | Download/stream endpoint | Find the right handler |

For achievement-based events, add a mapping in `quests.py`:
```python
ACHIEVEMENT_TO_MILESTONE = {
    "opened_framing_editor": "framing_opened",
    "viewed_gallery_video": "gallery_viewed",
}
```

When `record_achievement()` is called with a mapped key, also fire `record_milestone()`. No new frontend code needed.

## Context

### Relevant Files

**Schema + Migration:**
- `src/backend/app/services/pg.py` -- Add `user_flow_events` table to `_SCHEMA_DDL`; add new daily_counters columns
- `src/backend/app/migrations/postgres/v007_user_flow_events.py` -- Create table, backfill from user_milestones columns, add daily_counters columns

**Analytics core (refactor):**
- `src/backend/app/analytics.py` -- Replace `MILESTONE_EVENTS` + column-building logic with `FLOW_EVENTS` config + single UPSERT to `user_flow_events`. Keep `last_active_at`/`last_export_at` updates on `user_milestones`. Keep `daily_counters` UPSERT.

**Backend instrumentation (add record_milestone calls):**
- `src/backend/app/routers/quests.py` -- `record_achievement()`: add `ACHIEVEMENT_TO_MILESTONE` bridge
- `src/backend/app/routers/clips.py` or games router -- Find `finish-annotation`, add `annotation_completed`
- `src/backend/app/routers/export/framing.py` -- Add `framing_exported` on completion
- `src/backend/app/routers/export/overlay.py` -- Add `overlay_exported` on completion
- Download endpoint (find it) -- Add `video_downloaded`

**Dashboard updates (backend queries):**
- `src/backend/app/routers/admin.py` -- Refactor funnel/journey/cohorts/pulse endpoints to query `user_flow_events` instead of `user_milestones` columns. `_FUNNEL_STEPS` and `_compute_last_step` read from `FUNNEL_STEPS` config in analytics.py.

**Dashboard updates (frontend):**
- `src/frontend/src/components/admin/FunnelChart.jsx` -- STAGES array becomes dynamic (driven by API response)
- `src/frontend/src/components/admin/CohortGrid.jsx` -- STAGE_COLS driven by API response
- `src/frontend/src/components/admin/JourneyTimeline.jsx` -- EVENT_LABELS updated for new events
- `src/frontend/src/components/admin/UserTable.jsx` -- STEP_STYLES updated for new steps

### Related Tasks
- Depends on: T3010 (user_milestones table), T3030 (analytics dashboards)
- Part of: Analytics follow-up

### Technical Notes

- **Backfill**: Migration v007 backfills the 8 existing events from `user_milestones` columns into `user_flow_events` rows. Example: for each user where `first_game_created_at IS NOT NULL`, INSERT `(user_id, 'game_created', first_game_created_at, game_created_count)`.
- **Achievement bridge**: `framing_opened` and `gallery_viewed` fire from the frontend via the existing `POST /api/quests/achievements/{key}` endpoint. The backend maps these to milestones -- no new frontend calls.
- **No backfill for new events**: Achievement data lives in per-user SQLite on R2, not accessible from Postgres. New events track going forward only. Journey view handles NULL gracefully (already does).
- **daily_counters**: Needs 4 new columns for events that have `daily_col` set. Events with `daily_col: None` (rare events like `framing_opened`, `gallery_viewed`) don't get daily counters.
- **`record_milestone()` still updates `user_milestones`**: It continues to set `last_active_at = now()` and `last_export_at = now()` (for export events) on the milestones row. Only the event tracking (first_at + count) moves to the new table.

## Implementation

### Steps
1. [ ] Create `user_flow_events` table in migration v007 + `_SCHEMA_DDL`
2. [ ] Add new daily_counters columns in migration v007 + `_SCHEMA_DDL`
3. [ ] Backfill `user_flow_events` from existing `user_milestones` columns in v007
4. [ ] Refactor `analytics.py`: replace `MILESTONE_EVENTS` with `FLOW_EVENTS` config, rewrite `record_milestone()` to UPSERT `user_flow_events`
5. [ ] Add `ACHIEVEMENT_TO_MILESTONE` bridge in `quests.py` `record_achievement()`
6. [ ] Instrument 4 new backend handlers (`annotation_completed`, `framing_exported`, `overlay_exported`, `video_downloaded`)
7. [ ] Refactor admin.py funnel/journey/cohorts endpoints to query `user_flow_events`
8. [ ] Update `_compute_last_step` to use `FUNNEL_STEPS` from analytics.py
9. [ ] Update frontend dashboard components for new event labels
10. [ ] Write tests for new event recording and refactored endpoints
11. [ ] Verify all existing tests pass

## Acceptance Criteria

- [ ] `user_flow_events` table exists with normalized (user_id, event) rows
- [ ] Adding a new tracked event requires only adding one entry to `FLOW_EVENTS` dict + one `record_milestone()` call at the handler -- no migration
- [ ] All 14 events flow through the same `record_milestone()` code path
- [ ] Funnel shows 12 steps (Signed Up through Purchased)
- [ ] Journey timeline shows all events per user from `user_flow_events`
- [ ] Cohort grid includes new step columns
- [ ] "Last Step" column shows intermediate steps
- [ ] Achievement-based milestones fire automatically via existing frontend calls
- [ ] Existing 8 events backfilled into `user_flow_events`
- [ ] `daily_counters` increments for applicable new events
- [ ] Existing tests unbroken
