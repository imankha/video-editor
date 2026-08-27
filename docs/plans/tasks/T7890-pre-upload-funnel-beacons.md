# T7890: Pre-upload funnel beacons (Add Game click -> file selected -> prepare)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-27 (from the 2026-08-27 drop-off report refresh)

## Problem

The funnel's biggest cliff (signup -> first upload attempt, 13 of 26 lost) is still dark
BEFORE `game_created` fires. T7510 made `games_created` mean upload ATTEMPTS, but that
milestone fires at the prepare call — everything earlier is invisible:

- **rogerio.klein.rsk** (2026-08-26): desktop, 4 sessions, **31 minutes engaged**, profile
  database completely empty — no game row was ever created. We cannot tell whether he
  clicked Add Game and the picker failed, picked a file that died pre-prepare, or never
  found the button.
- Bug report #18 ("I hit add your first game and nothing happened", iPhone) and #46
  (avi468870, NULL description, filed 17 s after the tutorial told him to upload) are the
  same blind spot from the mobile side.

T7515 (WIP) covers dialog/toast impressions and session-exit breadcrumbs; T7480's beacon
covers failures after an upload starts. Neither records the entry gesture.

Existing actions confirmed absent from `user_actions` on prod: no `add_game_opened`, no
file-selected event of any kind.

## Solution

Two (maybe three) new milestones through the existing `record_milestone` machinery — same
aggregates-only, impersonation-guarded pattern as T7510, platform captured via X-Platform:

1. **`add_game_opened`** — fired in the SAME gesture handler that opens the add-game flow
   (the auth-gated opener; T7840 is registering it in questStore, coordinate so both wire
   the same handler, not two parallel ones). Fire-and-forget, must never delay the picker.
2. **`upload_file_selected`** — file input change handler, after a file is actually chosen,
   before the prepare POST. Payload stays a counter (no filename/PII); size bucket optional
   via `reason=` if trivially cheap.
3. (Assess during implementation) **picker-abandoned** is NOT directly observable (browsers
   fire no reliable cancel event) — derive it as `add_game_opened - upload_file_selected`
   in reads; do not build a fake cancel listener.

Read side: no new admin UI required — `user_actions` rows (per-user first_at + count) are
enough to answer "did he try"; the funnel report already reads that table. New
`daily_counters` columns only if the report needs day-grain (decide in implementation;
T7510 added columns, so precedent exists either way).

Interpretation contract (write into analytics docs): `add_game_opened` without
`upload_file_selected` = picker/entry failure or bail; `upload_file_selected` without
`game_created` = pre-prepare death (JS error, validation, navigation). Together with the
T7510 attempt/outcome pair this makes the whole upload path attributable end to end.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` (or wherever the auth-gated add-game opener lives — T7840's task file names it) — `add_game_opened`
- `src/frontend/src/services/uploadManager.js` / the game upload drop zone component — `upload_file_selected`
- `src/backend/app/analytics.py` — FLOW_EVENTS additions + any ACTION_TO_DAILY_COL mapping
- `src/backend/app/services/pg.py` — only if daily columns are added (`_SCHEMA_DDL` + migration; include Migration agent then)

### Related Tasks
- Extends: T7510 (pattern + guards), coordinates with T7840 (same opener handler), complements T7515 (mid-funnel)
- Feeds: investor-analytics T7420 activation funnel (per-stage drop-off localization)

### Technical Notes
- Gesture-based persistence rule applies: milestones fire from the gesture handlers
  themselves, never from effects watching state.
- Impersonation guard: route through `record_milestone` (already guarded) — do NOT create
  a new unguarded sink.
- Mobile Safari: use the existing fire-and-forget milestone POST path; nothing may block
  the picker opening (that IS the bug being measured).

## Implementation

### Steps
1. [ ] Locate the single add-game opener + file-select handler (confirm with T7840's findings)
2. [ ] Add the two milestones frontend-side (fire-and-forget)
3. [ ] Register events backend-side (FLOW_EVENTS; daily columns decision)
4. [ ] Tests: milestone fires on gesture, impersonation leaves zero footprint, picker timing unaffected
5. [ ] Document the interpretation contract (which gap = which failure class)

## Acceptance Criteria

- [ ] A user who clicks Add Game but never picks a file is distinguishable from one who never clicked, in prod data
- [ ] A user who picks a file but dies pre-prepare is distinguishable from a prepare-reached attempt
- [ ] Impersonated sessions record nothing
- [ ] No added latency to the picker gesture (fire-and-forget verified)
