# T3040 Test & Fix: Instrument Full User Flow Milestones

## Task

Read this handoff document and help me test, debug, and fix T3040: normalized `user_flow_events` table replacing per-column milestone tracking, with 6 new instrumented events giving a 12-step funnel.

## What Was Built

The milestone tracking system was refactored from a wide-column pattern (each event = its own `first_X_at` + `X_count` column pair, requiring ALTER TABLE for every new event) to a normalized `user_flow_events` table where each event is a `(user_id, event)` row. Adding a new tracked event now requires only adding one entry to a Python dict -- no migration, no schema change.

Six new events were instrumented across the user flow, filling in the previously invisible middle of the pipeline (annotation, framing, overlay, gallery, download). The admin analytics dashboards were updated to display a 12-step funnel instead of the previous 6-step one.

**Branch:** `feature/T3040-instrument-full-user-flow`
**Status:** TESTING (25 backend tests pass, frontend builds clean)

---

## Architecture

```
BEFORE (wide columns):
  record_milestone("game_created")
    -> UPDATE user_milestones SET first_game_created_at = COALESCE(..., now()),
                                  game_created_count = game_created_count + 1
    -> UPDATE daily_counters SET games_created = games_created + 1
  Adding a new event = ALTER TABLE + new migration + new code in record_milestone()

AFTER (normalized rows):
  record_milestone("game_created")
    -> INSERT INTO user_flow_events (user_id, event) VALUES (%s, %s)
       ON CONFLICT (user_id, event) DO UPDATE SET count = count + 1
    -> UPDATE user_milestones SET last_active_at = now()  (+ last_export_at for exports)
    -> UPDATE daily_counters SET games_created = games_created + 1
  Adding a new event = add one entry to FLOW_EVENTS dict + one record_milestone() call
```

### Funnel: Before vs After

```
BEFORE (6 steps):
  Signed Up -> Uploaded -> Clipped -> Exported -> Shared -> Purchased

AFTER (12 steps):
  Signed Up -> Uploaded -> Clipped -> Annotation Done -> Framing Opened ->
  Framing Exported -> Overlay Exported -> Gallery Viewed -> Downloaded ->
  Shared -> Purchased
```

The 6 new events fill in the invisible middle: a user who uploads but never opens framing is now distinguishable from one who framed but never exported.

---

## Files Changed

### Backend -- Schema & Migration
| File | Change |
|------|--------|
| `src/backend/app/services/pg.py` | Added `user_flow_events` table to `_SCHEMA_DDL` (for fresh deployments). Added 4 new `daily_counters` columns: `annotations_completed`, `framing_exports`, `overlay_exports`, `video_downloads`. |
| `src/backend/app/migrations/postgres/v007_user_flow_events.py` | **NEW.** Creates `user_flow_events` table, backfills 8 existing events from `user_milestones` wide columns, adds 4 new `daily_counters` columns via ALTER TABLE. |
| `src/backend/app/migrations/postgres/__init__.py` | Registered V007 migration. |

### Backend -- Analytics Core
| File | Change |
|------|--------|
| `src/backend/app/analytics.py` | Replaced `MILESTONE_EVENTS` (8 event tuples) + `EVENT_TO_COUNTER_COL` dict with `FLOW_EVENTS` (14 event configs) + `FUNNEL_STEPS` list. Rewrote `record_milestone()` from dynamic UPDATE building to single UPSERT on `user_flow_events`. Keeps `last_active_at` + `last_export_at` updates on `user_milestones`. |

### Backend -- Instrumentation (new `record_milestone()` calls)
| File | Event | Trigger |
|------|-------|---------|
| `src/backend/app/routers/games.py` | `annotation_completed` | `POST /games/{id}/finish-annotation` when `viewed_duration > 0` |
| `src/backend/app/services/export_worker.py` | `framing_exported` | Framing export job completes successfully |
| `src/backend/app/routers/export/overlay.py` | `overlay_exported` | Overlay export completes |
| `src/backend/app/routers/downloads.py` | `video_downloaded` | `GET /{download_id}/file` (download click) |
| `src/backend/app/routers/quests.py` | `framing_opened`, `gallery_viewed` | Achievement bridge: existing `POST /quests/achievements/{key}` maps `opened_framing_editor` -> `framing_opened` and `viewed_gallery_video` -> `gallery_viewed` |

### Backend -- Admin Dashboard Queries
| File | Change |
|------|--------|
| `src/backend/app/routers/admin.py` | Refactored `_compute_last_step()` to walk `FUNNEL_STEPS` list on `user_flow_events` instead of checking wide columns. Refactored `/analytics/funnel` to aggregate from `user_flow_events JOIN user_milestones`. Refactored `/analytics/cohorts` similarly. Refactored `/analytics/journey/{user_id}` to `SELECT * FROM user_flow_events WHERE user_id = %s`. Refactored `/analytics/channels` to LEFT JOIN `user_flow_events`. Refactored `/users` endpoint to read counts from `user_flow_events`. |

### Frontend -- Dashboard Components
| File | Change |
|------|--------|
| `src/frontend/src/components/admin/FunnelChart.jsx` | `STAGES` array expanded from 6 to 11 entries (Signed Up through Purchased with 5 new intermediate steps). |
| `src/frontend/src/components/admin/CohortGrid.jsx` | `STAGE_COLS` expanded from 5 to 10 columns. Keys updated from `upload_pct` to `uploaded_pct` etc. to match new backend response. |
| `src/frontend/src/components/admin/JourneyTimeline.jsx` | `EVENT_LABELS` expanded from 7 to 15 entries (6 new events + `export_failed` + `credits_consumed`). |
| `src/frontend/src/components/admin/UserTable.jsx` | `STEP_STYLES` expanded from 6 to 12 entries with new color gradients for intermediate steps. |

### Tests
| File | Change |
|------|--------|
| `src/backend/tests/conftest.py` | Added `user_flow_events` cleanup to setup and teardown in `pg_conn` fixture. |
| `src/backend/tests/test_analytics_dashboards.py` | Updated `analytics_with_journey` fixture to use `record_milestone()` instead of direct SQL. Updated journey test assertions (count changed from 7 to dynamic). Updated funnel/cohort key assertions. Added `TestUserFlowEvents` class (7 tests: UPSERT, count increment, daily counter, unknown event, export events). Added `TestMigrationV007` class (2 tests: backfill, column existence). |

---

## Post-Deploy Steps

1. **Run migration v007** -- `POST /api/admin/migrate` (admin session required). This creates the `user_flow_events` table and backfills existing events from the wide `user_milestones` columns.
2. **Verify backfill** -- Admin panel journey view should show existing user events (Upload, Clip, Export, Share, Purchase) with their original timestamps preserved.

---

## Test Plan

### Automated Tests (already passing)

```bash
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_analytics_dashboards.py -v
```

25 tests covering:
- Daily counter increments (signups, milestones, PWA)
- Funnel endpoint (shape, origin filter, stage ordering)
- Channels endpoint
- Cohorts endpoint (weekly, monthly)
- Journey endpoint (milestones, 404, 403)
- Pulse endpoint (cards, custom days)
- V006 migration backfill
- **NEW:** user_flow_events UPSERT, count increment, daily counter columns
- **NEW:** unknown event ignored, export events update last_export_at
- **NEW:** V007 migration backfill, column existence

### Manual Testing -- Admin Dashboard

**Prerequisites:** Deploy to staging, run `POST /api/admin/migrate`, sign in as admin.

#### 1. Funnel Chart
- [ ] Navigate to Admin -> Analytics tab
- [ ] Funnel shows ~11 bars: Signed Up, Uploaded, Clipped, Annotation Done, Framing Opened, Framing Exported, Overlay Exported, Gallery Viewed, Downloaded, Shared, Purchased
- [ ] Numbers decrease monotonically from top to bottom (or stay equal)
- [ ] Origin filter dropdown works (organic, viral, all)
- [ ] Date range picker works

#### 2. Cohort Grid
- [ ] Cohort grid shows columns for all new steps (Annotated, Framing, Framed, Overlay, Gallery, Download, Shared, Purchased)
- [ ] Percentages have color coding (green > yellow > red)
- [ ] Week/Month granularity toggle works

#### 3. User Journey Timeline
- [ ] Click a user row to open journey
- [ ] Timeline shows all events the user has completed with dates
- [ ] Pending events shown as unfilled circles
- [ ] New events (annotation, framing, overlay, gallery, download) appear with correct labels
- [ ] Time gaps between events displayed correctly

#### 4. User Table
- [ ] "Last Step" badge shows intermediate steps (Annotation Done, Framing Opened, etc.) not just the old 6
- [ ] Badge colors are distinct for each step (blue -> cyan -> teal -> emerald -> green -> purple -> yellow gradient)
- [ ] Counts columns still show correct numbers (games, clips, exports, shares, purchases)

#### 5. Pulse Cards
- [ ] Sparklines still render for signups, exports, active users, purchases
- [ ] No errors in console

### Manual Testing -- Event Recording

These require using the app as a normal user and then checking the admin panel.

#### 6. annotation_completed
- [ ] Upload a game video, enter annotation mode, watch some of it (viewed_duration > 0), leave annotation
- [ ] Admin journey for that user should show "Annotate" event

#### 7. framing_opened
- [ ] Open the framing editor for any clip
- [ ] Admin journey should show "Open Framing" event

#### 8. framing_exported
- [ ] Complete a framing export (crop + upscale)
- [ ] Admin journey should show "Frame Export" event
- [ ] daily_counters should increment `framing_exports`

#### 9. overlay_exported
- [ ] Complete an overlay export (add highlights, export)
- [ ] Admin journey should show "Overlay Export" event
- [ ] daily_counters should increment `overlay_exports`

#### 10. gallery_viewed
- [ ] View a completed video in the gallery
- [ ] Admin journey should show "Gallery" event

#### 11. video_downloaded
- [ ] Download a final video from the gallery
- [ ] Admin journey should show "Download" event
- [ ] daily_counters should increment `video_downloads`

### Regression Check

- [ ] Existing events still tracked: game_created, clip_created, export_completed, share_completed, credit_purchased, pwa_installed
- [ ] Session counts still incrementing on user_milestones
- [ ] last_active_at still updating
- [ ] last_export_at updates on export_completed, framing_exported, overlay_exported

---

## Risks

| Risk | Mitigation |
|------|------------|
| V007 migration fails on prod | Migration uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING` -- safe to re-run. Backfill only touches new table. |
| Backfilled timestamps wrong | Backfill copies exact `first_X_at` values from `user_milestones`. Counts use `GREATEST(count, 1)` to avoid zero-count rows. |
| Frontend breaks if backend returns old shape | Frontend hardcodes new keys but has fallback (`STEP_STYLES` defaults to "Signed Up" style for unknown steps, `EVENT_LABELS` falls back to raw event name). |
| `annotation_completed` fires too often | Only fires when `viewed_duration > 0` (user actually watched some video). Zero-duration exits are skipped. Count column tracks repeat annotations per user. |
| Achievement bridge double-records | Bridge only fires for mapped keys (`opened_framing_editor`, `viewed_gallery_video`). UPSERT increments count -- idempotent for first occurrence. |

---

## Key Design Decisions

1. **Normalized table over wide columns.** The old pattern (`first_X_at` + `X_count` per event) required ALTER TABLE for each new event. The new `user_flow_events` table stores `(user_id, event, first_at, count)` -- adding an event is a dict entry + handler call.

2. **user_milestones stays for non-event data.** Session counts, cohort dimensions (`install_day`, `origin_type`, `origin_channel`), `last_active_at`, `last_export_at` remain on `user_milestones`. Only event tracking (first-occurrence + count) moved.

3. **Achievement bridge avoids frontend changes.** `framing_opened` and `gallery_viewed` fire from existing frontend `POST /quests/achievements/{key}` calls. The backend maps achievement keys to milestone events -- no new frontend code.

4. **Export events are additive, not replacing.** `framing_exported` and `overlay_exported` fire *alongside* `export_completed`, not instead of it. The funnel uses the more granular events; `export_completed` stays for backward compat.

5. **No backfill for new events.** Achievement data lives in per-user SQLite on R2 (not accessible from Postgres). New events track going forward only. Journey view handles missing events gracefully.
