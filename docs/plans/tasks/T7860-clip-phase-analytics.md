# T7860: Clip Lifecycle Phase Analytics (per-user clip counts by phase)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-27
**Updated:** 2026-08-27 (open questions answered by user, see Design Decisions)

## Problem

The user wants to see, per user, **how many clips sit at each phase of the lifecycle** — created but not started, focused, completed (final render), published, intro attached, downloaded, shared. This is the core activation question ("where do clips stall?") and today it is invisible: there is **no clip-phase inventory anywhere** in the analytics surfaces.

Two sub-facts uncovered while filing this task:

1. **`clip_created` IS already tracked.** It is in `FLOW_EVENTS` ([analytics.py:124-187](../../../src/backend/app/analytics.py)), emitted at [clips.py:1292](../../../src/backend/app/routers/clips.py) on the new-clip branch of `POST /api/clips/raw/save`, and rolls into `daily_counters.clips_created`, `user_actions`, and per-user `user_action_log`. Admin `GET /api/admin/users` even exposes `clip_created_count` ([admin.py:241](../../../src/backend/app/routers/admin.py)). User confirmed 2026-08-27: they saw no data likely because no tracked user had created a clip yet — no surface fix needed; this task just verifies the event surfaces everywhere it should (funnel, user detail, pulse) once data exists.
2. **There is no `status` column for clips.** Phase is derived from row presence/timestamps across `raw_clips`, `working_clips`, `projects`, `final_videos` (canonical derivation: the projects list query at [projects.py:328-398](../../../src/backend/app/routers/projects.py)). "Downloaded" exists ONLY as the `video_downloaded` milestone in `user_action_log` (context `{"video_id"}`); "shared" lives in Postgres `shares`/`share_videos`.

Also requested: a future direct-upload path will need a **`clip_uploaded`** event distinct from `clip_created` (annotation-sourced). Reserve the name + funnel position now so the phase inventory's "created" bucket can carry an origin dimension from day one.

## Solution

**Derived, read-time inventory — no new persisted state.** Per the no-redundant-state rule and the analytics policy (aggregates-only, no new Postgres event state), phase counts are computed on demand from the tables that already encode them, following the existing pattern of `analytics.share_view_counts` (admin reads per-user SQLite at request time).

1. **Phase model (user-confirmed 2026-08-27, see Design Decisions).** Two-tier count: **clips** for the early phases (`created -> focus_started -> focused`), **reels** (final videos) from `completed` onward (`completed -> published`, plus orthogonal flags `intro_attached_explicit`, `intro_default_inherited`, `downloaded`, `shared`, `watched`). A 5-clip reel that publishes counts as 1 published, not 5. Derivations already exist:
   - created / not started: `raw_clips` row, no framing data yet
   - focus started: `working_clips.crop_data/segments_data/timing_data` non-null, `exported_at` null ([projects.py:374-378](../../../src/backend/app/routers/projects.py))
   - focused: `working_clips.exported_at` non-null / `projects.working_video_id` set
   - completed: `final_videos` row exists for the project
   - published: `final_videos.published_at` non-null
   - intro attached: `final_videos.intro_card_id` (raw semantics: `0` opted out, `NULL` inherit default, id = explicit — [downloads.py:240](../../../src/backend/app/routers/downloads.py)); tracked as TWO separate counts per user decision: explicit attachment vs inherit-default
   - downloaded: `video_downloaded` events in `user_action_log` joined on context `video_id`
   - shared: PG `share_videos.video_id` -> final video
2. **Backend:** new admin analytics endpoint (e.g. `GET /api/admin/analytics/user/{user_id}/clip-phases`) that opens the user's profile DB(s) read-only and returns the counts; optionally an all-users aggregate for a dashboard column. Read-only DB access must go through the existing shared connection-opening path (restore-if-newer guard) — no writes, no sync side effects.
3. **Frontend:** surface in the admin `UserDetailPanel` (phase breakdown bar/table) and, if cheap, a summary column in `UserTable`. Follow the dataviz conventions already used by `FunnelChart`/`CohortGrid`.
4. **`clip_uploaded` reservation:** add to `FLOW_EVENTS` + `FUNNEL_STEPS` (adjacent to `clip_created`) and a `daily_counters.clips_uploaded` column only if the schema change is warranted now — otherwise document the reserved name in the taxonomy comment and add the counter column when the direct-upload feature ships (avoid a dead PG column; decide at design time with the Migration agent's input, since `daily_counters` is Postgres track).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - event taxonomy (`FLOW_EVENTS`, `FUNNEL_STEPS`), `share_view_counts` pattern to mirror
- `src/backend/app/routers/admin.py` - analytics endpoints; new clip-phases endpoint lands here
- `src/backend/app/routers/clips.py` - `clip_created` emit site (reference; verify update-branch semantics)
- `src/backend/app/routers/projects.py` - canonical phase-derivation SQL to reuse/extract (lines ~328-398)
- `src/backend/app/database.py` - profile DB schema (`raw_clips`, `working_clips`, `projects`, `final_videos`)
- `src/backend/app/services/user_db.py` - `user_action_log` (downloaded events)
- `src/backend/app/services/pg.py` - `shares`/`share_videos` (shared flag), `daily_counters` (only if `clips_uploaded` column is added now)
- `src/frontend/src/components/admin/UserDetailPanel.jsx` - phase breakdown display
- `src/frontend/src/components/admin/UserTable.jsx` - optional summary column
- `src/frontend/src/stores/adminStore.js` - data fetching

### Related Tasks
- T7400-T7460 Investor-Grade Analytics epic (T7400 analytics.sqlite rollup is still TODO — this task does NOT depend on it; read-time derivation needs no rollup store)
- T7510/T7515 funnel instrumentation (same aggregates-only + impersonation-guard constraints)
- T3550 games uploaded-vs-accessible (same admin-visibility flavor)

### Technical Notes
- **No new persisted clip state.** Phase is derivable; storing it would violate the no-redundant-state rule and invite drift. If the all-users aggregate proves too slow to compute live (N profile DBs per user), THAT is the moment to discuss a cached rollup (analytics.sqlite, per T7400's direction) — not before.
- **Unit of count is resolved (user 2026-08-27):** clips for early phases, reels from `completed` onward — a multi-clip publish counts as 1. UI labels must make the tier switch explicit (e.g. "clips: 12 created / 5 focused; reels: 3 completed / 2 published"). A clip that is a member of a completed/published reel leaves the clip-tier ladder's "focused" bucket only if we choose mutually exclusive buckets — prefer furthest-phase-exclusive within each tier so the numbers sum sensibly; needs the project-membership join (`raw_clips.auto_project_id` + custom-project membership).
- Impersonation guard: read endpoint only, so no milestone writes — nothing to guard, but confirm no accidental `record_milestone` calls in the read path.
- `clip_created` is NOT emitted on the idempotent update branch of `save_raw_clip` ([clips.py:1199-1269](../../../src/backend/app/routers/clips.py)) — correct behavior; do not change.

## Classification (pre-filled)

**Tier:** M (no schema change if `clips_uploaded` column is deferred; new endpoint + UI panel, ~6 files, 1-2 layers)
**Stack Layers:** Backend + Frontend
**Files Affected:** ~6-8
**LOC Estimate:** ~250-400
**Test Scope:** Backend (endpoint + derivation SQL against fixture profile DB) + Frontend Unit (panel rendering)
**Knowledge Docs:** backend-services.md, persistence-sync.md (read-only profile DB access rules), export-pipeline.md (final_videos semantics)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Audit already done at filing time (findings embedded above) |
| Architect | No | Design settled at filing time; all open questions answered by user 2026-08-27 |
| Tester | Yes | Derivation SQL is the risk surface — fixture DB with clips at every phase |
| Reviewer | Yes | M-tier default |
| Migration | Only if `clips_uploaded` PG column is added now | `daily_counters` is postgres track |

## Design Decisions (user, 2026-08-27)

1. **clip_created gap was empty data, not a broken surface.** No fix needed; verify comprehensiveness (event flows to funnel/user-detail/pulse) as part of testing.
2. **Unit of count:** a multi-clip reel publishing counts as **1**. Hence the two-tier model: clips for created/focus phases, reels for completed/published and the flags.
3. **Intro attached:** track explicit attachment and inherit-default as **two separate counts**.

## Implementation

### Steps
1. [x] Extract/reuse the phase-derivation SQL into a shared helper (`services/clip_phases.py`; projects list query carries a cross-ref comment — single source of truth)
2. [x] Backend endpoint `GET /api/admin/analytics/user/{user_id}/clip-phases`: per-user phase counts — clip tier + reel tier + flags (downloaded via user_action_log, shared via PG join scoped by sharer_profile_id, intro split explicit/inherited)
3. [x] Backend tests against a fixture profile DB covering every phase + flag (incl. a multi-clip reel counting as 1) — `tests/test_clip_phases.py` (16 tests)
4. [x] Verify clip_created surfaces correctly in funnel/user-detail/pulse — confirmed via passing `test_analytics_dashboards.py` (27) + existing surfaces (FLOW_EVENTS/FUNNEL_STEPS, FunnelChart 'clipped', UserDetailPanel PIPELINE_STEPS). No code fix needed, as expected.
5. [x] UserDetailPanel phase breakdown UI (ClipPhaseBreakdown band + adminStore best-effort fetch). UserTable summary column deferred (optional; keeps the panel the single surface).
6. [x] Reserve `clip_uploaded` in the taxonomy (FLOW_EVENTS + FUNNEL_STEPS; daily_counters.clips_uploaded PG column DEFERRED — no dead column)
7. [x] Update `.claude/knowledge/backend-services.md` (new endpoint)

### Progress Log

**2026-08-27**: Task filed. Codebase audit embedded (event taxonomy, emit sites, phase derivations, admin surfaces). Same day: user answered all 3 open questions (see Design Decisions) — task is fully specced and ready to implement.

## Acceptance Criteria

- [ ] Admin can see, for any user, clip counts per early phase and reel counts per late phase + downloaded/shared/intro(explicit vs inherited)/watched flags
- [ ] A multi-clip reel publishing counts as 1 published
- [ ] clip_created verified to surface in funnel/user-detail/pulse with fixture data
- [ ] `clip_uploaded` name + funnel position reserved (implementation per design decision)
- [ ] No new persisted derivable state; read path is write-free
- [ ] Tests pass (fixture DB covers every phase and flag)
