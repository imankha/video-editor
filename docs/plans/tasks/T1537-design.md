# T1537 Design — Consolidate Per-Gesture Achievement POSTs (+ fire-and-forget analytics)

**Status:** DEFERRED — blocked on the future single-machine / session-affinity epic.
**Branch:** `feature/perf-quests-latency` (Phase B, after T1536)

> 🚧 **Deferred 2026-06-18.** This design hinges on making the `record_milestone` emit
> fire-and-forget — a **persistence-model change**. Per project decision, fire-and-forget /
> persistence experiments wait until sessions are pinned to a single machine. Without it,
> folding the achievement into the awaited `/actions` POST regresses the edit gesture, so we
> do not ship a compromised version. This doc is the ready-to-revive plan for when that epic
> lands. The contextvar-propagation risk (§Risks #1) should be re-validated then, since
> single-machine affinity may change the safe approach (e.g. a local queue instead of
> `create_task`).
**Task:** [quests-latency/T1537-consolidate-achievement-posts.md](quests-latency/T1537-consolidate-achievement-posts.md)
**Epic:** [quests-latency/EPIC.md](quests-latency/EPIC.md)

## Decision driving this design (from attribution)

The ~610 ms server `wait` on `POST /quests/achievements/{key}` is **synchronous
`record_milestone`** (3–4 Fly Postgres round-trips + a user.sqlite open/write), not the
profile.sqlite INSERT (trivial) and not R2 (skipped via `SKIP_SYNC_PATHS`). The achievement
POST is already **fire-and-forget from the frontend** (T1531), so the user feels none of
that 610 ms today.

**User decision (2026-06-18):** analytics emits can be fire-and-forget — the user doesn't
rely on analytics visual state, so there's no desync risk. Therefore:

1. Fold the cheap `INSERT OR IGNORE` achievement row onto the action handler's
   already-open `profile.sqlite` connection (0 extra DB opens), and
2. Move the milestone analytics emit **off the response path** so the awaited `/actions`
   POST is never slowed by Postgres/analytics latency.

This avoids the regression trap (folding a synchronous emit onto the awaited edit path) and,
as a bonus, also strips the 610 ms from the existing `/achievements` HTTP route.

## Current State

```mermaid
sequenceDiagram
    participant FE as Frontend (gesture)
    participant ACT as POST /actions
    participant ACH as POST /quests/achievements/{key}
    participant PG as Fly Postgres
    FE->>ACT: edit (awaited; UI applies on response)
    ACT-->>FE: 200 (fast)
    FE-)ACH: fire-and-forget (keepalive)
    ACH->>ACH: profile.sqlite INSERT achievement (~ms)
    ACH->>PG: record_milestone: 3-4 round-trips (SYNC)
    ACH->>ACH: user.sqlite INSERT user_action_log (SYNC, 2nd open)
    ACH-->>FE: 200 (~610 ms) then fetchProgress(force)
```

Two POSTs + two CORS preflights per gesture. The achievement POST is slow but off the
user's critical path. Its slowness is `record_milestone`, called **outside** the
`[SLOW ACHIEVEMENT]` timed block (so current instrumentation doesn't measure it).

```python
# quests.py record_achievement (today)
with get_db_connection() as conn:
    conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES (?)", (key,))
    conn.commit()
    row = conn.execute("SELECT key, achieved_at FROM achievements WHERE key = ?", (key,)).fetchone()
milestone_event = ACHIEVEMENT_TO_MILESTONE.get(key)
if milestone_event:
    record_milestone(get_current_user_id(), milestone_event, {})   # <-- SYNC, the 610 ms
return {"key": row["key"], "achieved_at": row["achieved_at"]}
```

## Target State

```mermaid
sequenceDiagram
    participant FE as Frontend (gesture)
    participant ACT as POST /actions
    participant BG as background task
    participant PG as Fly Postgres
    FE->>ACT: edit (awaited)
    ACT->>ACT: edit work + INSERT OR IGNORE achievement (same conn, ~ms)
    ACT-)BG: schedule milestone emit (fire-and-forget)
    ACT-->>FE: 200 (fast; unchanged latency)
    FE->>FE: refreshProgressForGesture(key): fetchProgress(force) once/key/session
    BG->>PG: record_milestone off the response path
```

One POST + one preflight per gesture. The achievement row is written on the action's
existing connection (rides the action's normal R2 sync). The milestone analytics emit runs
fire-and-forget, so neither the action POST nor the (now-rare) `/achievements` POST waits on
Postgres.

### Backend pieces

```python
# quests.py
def record_achievement_internal(conn, key: str) -> str | None:
    """INSERT OR IGNORE the achievement on an EXISTING profile.sqlite connection.
    Returns the milestone event to emit (or None). Does NOT emit — caller schedules
    it fire-and-forget so analytics never blocks the response."""
    conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES (?)", (key,))
    return ACHIEVEMENT_TO_MILESTONE.get(key)

def emit_milestone_fire_and_forget(user_id: str, event: str, context: dict | None = None):
    """Schedule record_milestone off the request path. asyncio.create_task copies the
    current contextvars (user/profile/platform/impersonator) BEFORE middleware clears
    them in its finally, and asyncio.to_thread runs the sync DB work in that copied
    context. A module-level set holds task refs so they aren't GC'd."""
    loop = asyncio.get_running_loop()
    task = loop.create_task(asyncio.to_thread(record_milestone, user_id, event, context or {}))
    _PENDING_MILESTONES.add(task)
    task.add_done_callback(_PENDING_MILESTONES.discard)

ACTION_TO_ACHIEVEMENT = {            # near ACHIEVEMENT_TO_MILESTONE
    "add_crop_keyframe": "crop_adjusted",
    # set_segment_speed handled specially (only speed < 1)
}
```

```python
# clips.py framing_action (on the already-open `conn`, before _save_clip_framing_data commit)
try:
    key = None
    if action == "add_crop_keyframe":
        key = "crop_adjusted"
    elif action == "set_segment_speed" and data.get("speed", 1) < 1:
        key = "speed_segment_created"
    if key:
        event = record_achievement_internal(conn, key)   # 0 extra DB opens
        if event:
            emit_milestone_fire_and_forget(user_id, event)
except Exception:
    logger.warning(...)   # non-blocking: never fail the edit on the achievement write

# overlay.py overlay_action: same shape for set_highlight_color -> overlay_color_set,
#   set_highlight_shape -> overlay_shape_set, on its existing conn before conn.commit()

# quests.py record_achievement (HTTP route) -> thin wrapper:
with get_db_connection() as conn:
    event = record_achievement_internal(conn, key)
    conn.commit()
    row = conn.execute("SELECT key, achieved_at FROM achievements WHERE key = ?", (key,)).fetchone()
if event:
    emit_milestone_fire_and_forget(get_current_user_id(), event)   # was sync; now off-path
return {"key": row["key"], "achieved_at": row["achieved_at"]}
```

### Frontend pieces (Finding B — preserve the panel refresh)

```js
// questStore.js — no POST, just the refresh, dedup-gated like recordAchievement
refreshProgressForGesture: (key) => {
  if (_recordedAchievements.has(key)) return;
  _recordedAchievements.add(key);
  get().fetchProgress({ force: true });   // server already wrote the achievement via /actions
}
```

Replace the four gesture `recordAchievement` calls (crop, speed<1, color, shape) with
`refreshProgressForGesture`. Keep `recordAchievement` for lifecycle events (`opened_*`,
`overlay_players_assigned`, gallery/annotation views).

## Implementation Plan (files)

| File | Change |
|---|---|
| `app/routers/quests.py` | Add `record_achievement_internal(conn, key)`, `emit_milestone_fire_and_forget(...)`, `_PENDING_MILESTONES`, `ACTION_TO_ACHIEVEMENT`; rewire HTTP `record_achievement` to use them (emit now off-path) |
| `app/routers/clips.py` | In `framing_action`, on the existing `conn` before its commit: write `crop_adjusted` / `speed_segment_created` (speed<1), non-blocking; schedule milestone |
| `app/routers/export/overlay.py` | In `overlay_action`, on the existing `conn` before `conn.commit()`: write `overlay_color_set` / `overlay_shape_set`, non-blocking; schedule milestone |
| `src/frontend/.../questStore.js` | Add `refreshProgressForGesture(key)` |
| `src/frontend/.../FramingContainer.jsx` | Replace crop + speed `recordAchievement` with refresh helper |
| `src/frontend/.../OverlayScreen.jsx` | Replace color + shape `recordAchievement` with refresh helper |

## Tests (merit proof)

- **Backend connection count:** spy `get_db_connection` in `framing_action`/`overlay_action`;
  achievement write adds **0** opens (count unchanged).
- **Off-path emit:** spy `record_milestone` and `emit_milestone_fire_and_forget`; assert the
  action handler returns **without** having awaited `record_milestone` (it's scheduled, not
  inline). Assert the achievement row IS written synchronously (so `fetchProgress` sees it).
- **Behavior:** `set_segment_speed` with `speed >= 1` writes no achievement; an injected
  achievement-write failure still returns the action's success.
- **Frontend:** each gesture fires exactly **1** POST (`/actions`), **0** to
  `/quests/achievements/*`, and `fetchProgress({force:true})` fires exactly once per key.

## Risks & Open Questions

1. **Contextvars in the background task.** `record_milestone` reads `get_current_platform`
   / `get_current_impersonator_id` from contextvars. `asyncio.create_task` snapshots the
   context at creation (before the middleware's `finally: clear_request_context()`), and
   `asyncio.to_thread` runs in that copied context — so values are preserved. **Must verify**
   with a test that asserts the milestone is attributed to the right user/platform and that
   impersonation is still skipped.
2. **Task GC.** Bare `create_task` tasks can be garbage-collected before running; the
   `_PENDING_MILESTONES` set + done-callback prevents that.
3. **Ordering vs. fetchProgress.** The achievement row is written **synchronously** on the
   action connection, so the frontend's `fetchProgress` (after the action returns) always
   sees the new step. The milestone (analytics only) lagging is fine — user doesn't depend on
   it (the decision above).
4. **Scope of fire-and-forget.** Limit the async-emit change to the **achievement/quest
   path** (action handlers + the `/achievements` route). Do **not** convert the other ~40
   `record_milestone` call sites (payments, shares, etc.) — out of scope, and some may have
   different ordering needs.
5. **R2 persistence of the achievement row.** Folding onto the `/actions` connection means
   the achievement row rides the action's normal R2 sync push (the standalone `/achievements`
   POST is in `SKIP_SYNC_PATHS` and skips the push) — a minor consistency improvement, no
   action needed.

## Out of scope

- No persistence-model change; gesture-driven writes only (the achievement still traces to
  the edit gesture, riding the action POST).
- The ~200 ms R2/session baseline.
- T1536's single-`user.sqlite`-open change stays intact (do not reintroduce a second open).
