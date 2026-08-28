# T7455: Editor-open event coverage: per-open Focus/Overlay/Annotate entries with clip context

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-27

## Problem

The user asked (2026-08-27): "can we currently tell how many users and which users opened a clip in Focus or in Overlay? I want that as an event in their activity." Audit verdict: **partially, with four concrete gaps.**

What exists today: `framing_opened` ("Focus Opened") and `overlay_opened` are in `FLOW_EVENTS`, land in PG `user_actions` (which users + lifetime counts + `first_at`) and in the per-user `user_action_log` journey shown in the admin UserDetailPanel. So "did user X ever enter Focus" is answerable now.

The gaps:

1. **Once-per-page-load, not per-open.** Both events fire ONLY through the quest achievement bridge: `App.jsx:506-517` useEffects watching `editorMode` -> `questStore.recordAchievement()` -> `POST /api/quests/achievements/{key}` -> `ACHIEVEMENT_TO_MILESTONE` (quests.py:62) -> `record_milestone`. The client dedupes via a module-level `_recordedAchievements` Set (questStore.js:12), so a user opening 5 clips in Focus in one browser session emits **1** event. Counts approximate "page-load sessions that touched Focus at least once," not clip opens. Analytics is also structurally coupled to the quest system: any quest refactor silently changes these funnel numbers.
2. **No clip/project context.** The bridge calls `record_milestone(user_id, milestone_event, {})` (quests.py:472) with an EMPTY context. "WHICH clip did they open" is unanswerable; the activity-log row is bare. Contrast the export side, which already carries it: `framing_exported`/`overlay_exported` include `{export_id, project_id}` (export_worker.py:186, export/overlay.py:280).
3. **`overlay_opened` is missing from the funnel.** It exists as an event (T3700) but is absent from both backend `FUNNEL_STEPS` (analytics.py:205) and the admin `FunnelChart` STAGES (FunnelChart.jsx:3). The funnel jumps Focus Opened -> Focus Exported -> Overlay Exported, so the Focus-export -> Overlay-entry drop-off is invisible.
4. **Annotate entry is untracked.** Nothing fires between `game_upload_succeeded` and `clip_created`. Opening a game in Annotate (the first post-upload engagement gesture) has no event, so an "uploaded but never started annotating" cohort is indistinguishable from "opened Annotate and bounced."

Same-pattern note: `gallery_viewed` and the other bridged achievement events share shape (session-deduped, contextless). This task fixes the two editor opens + adds annotate-open; a wholesale bridge overhaul is out of scope.

## Solution

Fire the editor-open milestones directly from the real open gesture, once per open, with project/clip context - decoupled from the quest achievement bridge (which stays as-is for quest progress, minus its now-duplicate milestone side effect). Add the two missing funnel stages. All through the EXISTING `record_milestone` path: new rows land only in the existing `user_actions` upsert + per-user `user_action_log`. `daily_col: None` for any new event - zero new PG columns/tables (epic directive 4).

### Design points (confirm at implementation)

- **Fire point:** the navigation gesture handler that enters Focus/Overlay (the click), NOT the existing `useEffect` watching `editorMode` - the persistence rule (gesture -> handler) applies to analytics too. Server-side is preferred (T7450 rule) if a per-open project-load endpoint exists on that path; otherwise a client beacon from the gesture handler (T7515 impression-beacon precedent) to a small authenticated sink that calls `record_milestone`. Decide against the real code paths.
- **Context:** `{project_id}` minimum, `{clip_id}` where the gesture is clip-scoped; annotate-open carries `{game_id}` (mirrors `annotation_completed`).
- **Count semantics, no dedup machinery** (T7450 rule): opening the same clip 5x = 5 counts. `user_actions` stays bounded (one row per user x action x platform).
- **No double-count:** when the direct fire lands, REMOVE `opened_framing_editor`/`opened_overlay_editor` from `ACHIEVEMENT_TO_MILESTONE` (quests.py:62). The achievement POST itself stays (quest steps depend on the achievements table); only its milestone bridge goes.
- **New event:** `annotate_opened` ("Annotate Opened", `daily_col: None`) between Uploaded and Clipped in `FUNNEL_STEPS` + FunnelChart STAGES (+ the admin funnel query feeding it). Add `overlay_opened` ("Overlay Opened") between Focus Exported and Overlay Exported in both lists.
- **Activity view:** UserDetailPanel journey/engagement lists get labels for `annotate_opened` and the context-bearing rows (it already labels `framing_opened`/`overlay_opened`).
- Impersonation guard, platform attribution, and the SQLite dual-write are inherited from `record_milestone` - nothing new needed.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `FLOW_EVENTS` entry for `annotate_opened`; `FUNNEL_STEPS` additions (`annotate_opened`, `overlay_opened`)
- `src/backend/app/routers/quests.py` - remove the two editor-open keys from `ACHIEVEMENT_TO_MILESTONE`
- `src/backend/app/routers/telemetry.py` or the project-load/game-open endpoints - the per-open milestone sink (decide server vs beacon at implementation)
- `src/frontend/src/App.jsx` - editor-mode entry gesture handlers (current useEffects at 506-517 are the map of where mode entry happens)
- `src/frontend/src/components/admin/FunnelChart.jsx` - two new STAGES rows
- `src/backend/app/routers/admin.py` - funnel query keys for the new stages
- `src/frontend/src/components/admin/UserDetailPanel.jsx` - journey labels
- Tests: backend milestone-fire tests + FunnelChart/UserDetailPanel unit tests

### Related Tasks
- Sibling: T7450 (same flow-event-coverage shape for collections; same rules apply)
- Feeds: T7420 (drop-off localization gets the two missing stages), T7430 via T7400's rollup (per-open rows in `user_action_log` enter the weekly action rollup)
- Related: T7515 (impression beacon precedent if the client-beacon route is chosen)

### Technical Notes
- Epic directives bind: aggregates only, no new PG state, extend `record_milestone` - never a parallel system.
- The quest achievements table is idempotent (`INSERT OR IGNORE`) and user-scoped-once; it was never a valid per-open counter. Do not try to make it one.
- `gallery_viewed` and other bridged events keep their current bridge behavior in this task; note any observed weirdness in the task's progress log for a possible follow-up.

## Implementation

### Steps
1. [ ] Confirm fire points against real code paths (server endpoint vs gesture beacon) for Focus, Overlay, Annotate entry
2. [ ] Add `annotate_opened` to `FLOW_EVENTS`; add both missing stages to `FUNNEL_STEPS`, admin funnel query, FunnelChart
3. [ ] Wire per-open `record_milestone` calls with context; remove the two keys from `ACHIEVEMENT_TO_MILESTONE`
4. [ ] UserDetailPanel labels for new/updated events
5. [ ] Tests: per-open fire (no dedup), context present, no bridge double-count, funnel renders new stages

## Acceptance Criteria

- [ ] Admin can answer "how many users and which users opened a clip in Focus/Overlay," with per-open counts (not once-per-session) and which project/clip, from `user_actions` + the UserDetailPanel journey
- [ ] Each Focus/Overlay/Annotate open appears as a timestamped event with context in the user's activity (`user_action_log`)
- [ ] Funnel (backend + admin chart) shows Annotate Opened and Overlay Opened stages
- [ ] Quest progress unaffected; no double-counted milestones from the achievement bridge
- [ ] Zero new PG columns/tables; all new events `daily_col: None`
