# T1537: Consolidate Per-Gesture Achievement POSTs into the Action Endpoints

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-17
**Updated:** 2026-06-17

## Problem

Today a single user gesture in framing/overlay fires **two** POSTs from the frontend — the
edit action *and* a separate gamification write — each with its own CORS preflight. From the
prod HAR (`Downloads/app.reelballers.com.har`, 2026-06-17), a crop adjust produced:

```
POST /api/clips/projects/46/clips/48/actions          (the edit)
POST /api/quests/achievements/crop_adjusted           (the achievement)
+ an OPTIONS preflight for each
```

The frontend already knows the gesture; the backend can derive the achievement from the
action type. Folding the achievement write into the action endpoint removes ~half the
per-gesture requests (and their preflights) for the four most common edit gestures. This is
the "easy cleanup" — the action already carries everything the achievement needs.

## Scope (deterministic action → achievement mapping)

| Frontend gesture | Action POST (kept) | Achievement POST (fold in) |
|---|---|---|
| Adjust crop | `add_crop_keyframe` → [clips.py framing_action](../../../src/backend/app/routers/clips.py#L318) | `crop_adjusted` |
| Add slow-mo | `set_segment_speed` (speed < 1) → same | `speed_segment_created` |
| Pick highlight color | overlay `set_highlight_color` → overlay actions endpoint | `overlay_color_set` |
| Pick highlight shape | overlay `set_highlight_shape` → same | `overlay_shape_set` |

**Out of scope — these are NOT action-driven, keep their own POST:**
`opened_framing_editor`, `opened_overlay_editor`, `overlay_players_assigned` (derived from
"all detections assigned" state, not a single gesture), and the gallery/annotation view
events. Only the four gesture-bound achievements above consolidate.

## Solution

1. **Backend — extract a reusable helper.** Pull the achievement body out of
   `record_achievement` ([quests.py:324](../../../src/backend/app/routers/quests.py#L324))
   into `record_achievement_internal(conn, key)` that does the `INSERT OR IGNORE` + the
   `ACHIEVEMENT_TO_MILESTONE` analytics emit ([quests.py:49-65](../../../src/backend/app/routers/quests.py#L49)).
   The existing HTTP route becomes a thin wrapper around it (keeps backward compatibility for
   the lifecycle achievements still posted directly).

2. **Backend — derive + record inside the action handlers.** Add an `ACTION_TO_ACHIEVEMENT`
   map and call `record_achievement_internal` from:
   - `framing_action` ([clips.py:318](../../../src/backend/app/routers/clips.py#L318)) for
     `add_crop_keyframe` → `crop_adjusted`, and `set_segment_speed` → `speed_segment_created`
     **only when speed < 1** (matches the current frontend condition at
     [FramingContainer.jsx:1023-1035](../../../src/frontend/src/containers/FramingContainer.jsx#L1023)).
   - the overlay actions handler (`POST /api/export/projects/{pid}/overlay/actions`) for
     `set_highlight_color`/`set_highlight_shape`.
   - **Efficiency bonus:** `framing_action` already holds an open profile.sqlite connection
     (it writes crop keyframes), so the achievement `INSERT` reuses that connection — no
     extra DB open. The achievement write must NOT block / fail the action (wrap so an
     achievement error is logged but the action still returns success).

3. **Frontend — drop the redundant `recordAchievement` calls** for the four gestures:
   - [FramingContainer.jsx:320](../../../src/frontend/src/containers/FramingContainer.jsx#L320) (crop)
   - [FramingContainer.jsx:1023-1035](../../../src/frontend/src/containers/FramingContainer.jsx#L1023) (speed)
   - [OverlayScreen.jsx:671](../../../src/frontend/src/screens/OverlayScreen.jsx#L671) (color)
   - [OverlayScreen.jsx:718-722](../../../src/frontend/src/screens/OverlayScreen.jsx#L718) (shape)

   Leave `questStore.recordAchievement` in place for the lifecycle/non-action achievements.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/quests.py` — extract `record_achievement_internal`; `KNOWN_ACHIEVEMENT_KEYS`, `ACHIEVEMENT_TO_MILESTONE`
- `src/backend/app/routers/clips.py` — `framing_action` (L318); add achievement derivation on the existing profile connection
- overlay actions endpoint (`POST /api/export/projects/{pid}/overlay/actions`) — add color/shape achievement derivation
- `src/frontend/src/containers/FramingContainer.jsx` — remove crop (L320) + speed (L1023-1035) `recordAchievement` calls
- `src/frontend/src/screens/OverlayScreen.jsx` — remove color (L671) + shape (L718-722) `recordAchievement` calls
- `src/frontend/src/stores/questStore.js` — `recordAchievement` (L139); stays for lifecycle events
- Evidence: `Downloads/app.reelballers.com.har` (2026-06-17)

### Related Tasks
- Pairs with: **T1536** (quests endpoint latency — fewer `/achievements` calls means its cost is paid less often)
- Background: **T1531** (achievement R2-sync skip + fire-and-forget frontend), **T3700** (the achievements these track)

### Technical Notes
- Per [[feedback_leverage_existing_systems]]: reuse the existing achievement helper + milestone map; don't build a parallel path.
- Quest *progress* still updates the same way — `_check_all_steps` reads the `achievements`
  table regardless of which endpoint wrote the row. No quest-logic change, only the write entry point.
- Idempotency preserved: `INSERT OR IGNORE` means re-recording is safe if a gesture repeats.

## Implementation

### Steps
1. [ ] Extract `record_achievement_internal(conn, key)` in quests.py; rewire the HTTP route to it.
2. [ ] Add `ACTION_TO_ACHIEVEMENT` derivation in `framing_action` (crop + speed<1), on the existing connection, non-blocking.
3. [ ] Add color/shape derivation in the overlay actions handler.
4. [ ] Remove the four frontend `recordAchievement` calls; keep lifecycle ones.
5. [ ] Tests: backend asserts the action endpoints write the achievement row + emit the milestone; frontend asserts the gesture fires one POST, not two.

### Progress Log

**2026-06-17**: Created from prod HAR + code investigation. Mapping confirmed deterministic; action endpoints already carry the needed data. Identified that `framing_action` can write the achievement on its existing profile.sqlite connection (no extra DB open). Lifecycle achievements (`opened_*`, `overlay_players_assigned`, gallery/annotation views) explicitly excluded.

## Acceptance Criteria

- [ ] Crop / speed / color / shape gestures each fire exactly ONE POST (no separate `/quests/achievements/*`).
- [ ] The corresponding achievement row + analytics milestone are still recorded (now server-derived).
- [ ] Lifecycle achievements still post directly and are unaffected.
- [ ] An achievement write failure does not fail the underlying edit action.
- [ ] Frontend + backend tests pass.
