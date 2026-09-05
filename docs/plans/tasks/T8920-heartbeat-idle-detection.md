# T8920: Heartbeat Must Require Real User Interaction, Not Just Tab Visibility

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

The admin "Usage" / time-on-site metric can massively overstate engaged time. Found while
auditing vasima.imran42@gmail.com's dashboard entry, which showed almost 3 hours on site
against an activity log of 1 game upload + 1 annotation:

```
01:30:37  watched_annotate_tutorial
01:33:44  add_game_opened
01:34:21  upload_file_selected
01:34:39  game_created
01:36:22  session_exit
02:04:57  game_upload_succeeded        (~29m after prior event)
04:18:48  add_clip_opened              (~2h14m after prior event)
04:19:38  clip_save_attempted
...
04:32:59  session_exit
```

`session_engaged_seconds()` (`src/backend/app/analytics.py:32`) computes `confirmed = last_active
- session_start` UNCAPPED, on the documented assumption that no idle gap inside a session can
exceed `SESSION_IDLE_CAP_SECONDS` (30 min) — because `is_new_session` in `update_session()`
(`analytics.py:837`) would otherwise close the session. That assumption depends entirely on
"last_active" meaning "the user was doing something."

It doesn't. `useSessionHeartbeat.js` (`src/frontend/src/hooks/useSessionHeartbeat.js:30-36`) POSTs
`/api/auth/heartbeat` every 60s purely on `document.visibilityState === 'visible'` — there is no
check for actual mouse/keyboard/scroll/touch activity. An open, foregrounded, but idle tab (e.g.
left open during a slow background upload, or just left open while the user steps away) keeps
`last_active_at` fresh indefinitely, so `is_new_session` never trips and the whole idle stretch
gets counted as engaged time.

Confirmed root cause via code read; see conversation from 2026-09-05 for the full trace. This is
NOT a background-upload-specific bug — any idle-but-visible tab has the same effect. Fixing the
heartbeat to require real interaction repairs the invariant `session_engaged_seconds` already
assumes, everywhere, rather than special-casing uploads.

## Solution

Gate the heartbeat (and the visibility-regain heartbeat) on real user interaction, not just tab
visibility. Track a "last interaction" timestamp updated by mousemove/keydown/scroll/touchstart
(passive, throttled — don't fire on every mousemove tick), and only send the heartbeat if an
interaction happened within the last ~90s (comfortably above the 60s tick interval, so a user who
is genuinely reading/watching without touching input for one tick isn't punished, but a truly
idle tab stops refreshing `last_active_at`). No backend change needed — the existing 30-min
`is_new_session` boundary and `session_engaged_seconds` uncapped-confirmed-span logic already do
the right thing once `last_active_at` accurately reflects engagement; the bug is entirely in what
feeds it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useSessionHeartbeat.js` - add interaction listeners + gate `sendHeartbeat`/`onVisibilityChange`'s resume-heartbeat branch on interaction recency
- `src/frontend/src/hooks/useSessionHeartbeat.test.js` - new test file (none currently exists); cover: heartbeat fires with recent interaction, heartbeat withheld after interaction goes stale, visibility-regain path also respects the gate
- `.claude/knowledge/backend-services.md` - update the T5660 "Engaged-time / admin Usage model" note (line ~385-407) to describe the interaction-gated heartbeat, since it currently documents (and now over-claims) "visibility-gated 60s heartbeat" as sufficient

### Related Tasks
- Extends the T5660 engaged-time model (see `.claude/knowledge/backend-services.md` and `test_analytics.py::TestHeartbeatGapCap`)

### Technical Notes
- `analytics.py`'s `session_engaged_seconds` and `SESSION_IDLE_CAP_SECONDS` need NO changes — this
  is a pure frontend signal-quality fix, not a backend policy change.
- Don't overcorrect: a user who is watching a preview video or reading without touching the
  mouse for one 60s tick should not have their session prematurely closed. The interaction-recency
  window should be generous relative to the heartbeat interval (e.g. 90s window vs 60s tick), not
  a hair-trigger idle timeout.
- Listeners must be passive and cheap (timestamp write only, no re-render) — this runs for the
  entire lifetime of every authenticated session.

## Implementation

### Steps
1. [ ] Add throttled interaction listeners (mousemove/keydown/scroll/touchstart) to `useSessionHeartbeat.js` tracking a `lastInteractionRef` timestamp
2. [ ] Gate `sendHeartbeat` and the visibility-regain call in `onVisibilityChange` on `Date.now() - lastInteractionRef.current < INTERACTION_WINDOW_MS`
3. [ ] Write `useSessionHeartbeat.test.js` covering the gated and un-gated paths
4. [ ] Update `.claude/knowledge/backend-services.md`'s T5660 note to reflect the interaction gate

### Progress Log

**2026-09-05**: Task filed from an analytics audit (see conversation) that traced
vasima.imran42@gmail.com's ~3h dashboard reading to a 2h14m idle-but-visible-tab stretch during
a slow game upload, fully counted as engaged time.

## Acceptance Criteria

- [ ] Heartbeat (both the interval tick and the visibility-regain call) only fires when the user
      interacted within the last ~90s
- [ ] A tab left open and visible but untouched for >30 min correctly closes its session (i.e.
      `is_new_session` trips on the next real interaction) instead of extending indefinitely
- [ ] Existing backend tests (`test_analytics.py::TestHeartbeatGapCap` etc.) still pass unchanged
- [ ] New frontend unit tests for the interaction gate pass
- [ ] Manually verify: leave a tab open+idle past 30 min, confirm the admin panel's Usage figure
      for a test account stops growing during the idle stretch
