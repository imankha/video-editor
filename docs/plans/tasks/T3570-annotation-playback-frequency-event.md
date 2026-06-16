# T3570: Track Annotation Playback as a Recurring Usage Event

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

We track that a user played back annotations **once** — but only as a quest achievement. The flow:
`useAnnotationPlayback.js:284` fires `recordAchievement('played_annotations')` → backend maps it to the `annotations_played` milestone ([quests.py:30-37](../../../src/backend/app/routers/quests.py#L30-L37)). Because it's achievement-gated, it fires once (after ~0.5s of virtual playback) and never again — the achievement already exists on subsequent playbacks.

So we can answer *"did this user ever play back annotations?"* but **not** *"how often do they rewatch?"* — there's no engagement-frequency signal for annotation playback. Annotation playback is a core "aha"/value loop (watch your athlete's clips back), so frequency matters for retention analysis and for the lifecycle emails (T3580/T3590) that key off where a user is in the funnel.

## Solution

Add a distinct, **non-achievement-gated** flow event that fires **once per playback session** (not once ever). Keep the existing `annotations_played` achievement milestone as-is (it's the one-time activation signal); add a new event for frequency.

- New event name: `annotation_playback_started` (distinct from the one-time `annotations_played`).
- Fires each time the user enters playback mode (debounced to once per playback session so rapid re-entry / loop restarts don't spam).
- Recorded via the same path other non-achievement flow events use (e.g. how `framing_opened` / `gallery_viewed` get recorded from the frontend) so `user_actions.count` accumulates frequency and `user_action_log` gets a timestamped row each time.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` — `enterPlaybackMode()` (~line 309) and the 0.5s achievement trigger (~line 284). Add the new per-session event fire here, debounced.
- `src/backend/app/analytics.py` — `FLOW_EVENTS` dict (lines 79-109). Add `annotation_playback_started` with a label (e.g. "Annotation Playback Started"). `record_milestone()` (line 218) writes to Postgres `user_actions` + per-user SQLite `user_action_log`.
- Whatever frontend → backend path records existing non-achievement flow events like `framing_opened`/`gallery_viewed` — **reuse it** (find the call site for `framing_opened` in the frontend and mirror it). Do NOT route this through the quest achievement endpoint (that's for one-time achievements).

### Related Tasks
- Feeds T3580/T3590 (lifecycle emails) — the activity classifier reads playback frequency to tell engaged-but-not-converting users from those stuck earlier.
- Sibling to the analytics tracking work (T3470 fill-tracking-gaps pattern).

### Technical Notes
- **Debounce once per session:** fire on `enterPlaybackMode()` entry (or first frame of a playback run), not on every loop iteration / seek. A simple "already fired for this playback session" ref is enough — reset when playback mode exits.
- Keep `annotations_played` achievement untouched (one-time activation), `annotation_playback_started` is additive (frequency). Don't reuse the same string — that would conflate the two signals.
- Follow the existing analytics pattern; this is gesture-driven (user clicked "Playback Annotations"), so it complies with the gesture-based persistence rule.

## Implementation

### Steps
1. [ ] Backend: add `annotation_playback_started` to `FLOW_EVENTS` in `analytics.py`.
2. [ ] Frontend: fire the event once per playback session from `useAnnotationPlayback.js`, reusing the `framing_opened`-style flow-event call path.
3. [ ] Verify it increments `user_actions.count` per session and appends a `user_action_log` row.
4. [ ] Test: unit/integration confirming repeat playbacks increment the count (vs the one-time achievement which does not).

## Acceptance Criteria

- [ ] Entering annotation playback fires `annotation_playback_started` each session (debounced once per session)
- [ ] `user_actions` count for the event increases on repeat playbacks
- [ ] The one-time `annotations_played` achievement/milestone is unchanged
- [ ] Event appears in the per-user action log timeline
- [ ] Tests pass
