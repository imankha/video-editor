# T14940: Sport in the milestone context of profile-scoped events (no DB change)

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Tier:** M (backend only)
**Created:** 2026-11-03
**Updated:** 2026-11-03

Piece 2 of 3 of the sport dimension (T14930 arrival sport, T14940 this, T14950 rollup). Owner ruling
2026-11-03: get sport data without changing the DB or adding read-time cost; users can have several
sports, one per profile.

## Problem

Every usage event (`record_milestone` in `analytics.py`) is written to the Postgres aggregate
`user_actions` (keyed by user, action, platform) and to the per-user `user_action_log`, whose
`context` column is free-form JSON. The handlers that fire profile-scoped events already have the
profile loaded, but none of them puts the profile's sport into the context. So "which sport was this
export for" is lost at write time, and a two-sport parent's hockey and soccer exports are
indistinguishable.

## Solution

Add `"sport": <profile sport key>` to the `context` dict passed to `record_milestone` for every
profile-scoped event, at the gesture that fires it. No new table, no new column: the value lands in
the existing `user_action_log.context` JSON in the user's own SQLite. Postgres is untouched.

Events to tag (the profile is already in hand in each handler): `game_upload_succeeded`,
`game_upload_failed`, `clip_uploaded`, `clip_created`, `framing_opened`, `crop_adjusted`,
`framing_point_added`, `credits_consumed`, `export_completed` / `framing_exported` (once T14710
records them), `overlay_exported`, `video_downloaded`, `share_completed`, `credit_purchased` (the
profile active at purchase time, or `no_sport` if none). Events with no profile (sign-up, session
start) are not tagged.

- Sport key comes from the loaded profile row; `no_sport` stays `no_sport`. Never look it up with an
  extra DB open; if a handler does not already have the profile, it is not in this task's list.
- Register the tag's start date in `EVENT_INSTRUMENTED_AT` style metadata so readers (T14950) badge
  pre-tag history as "no sport recorded" rather than counting it as `no_sport`.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `record_milestone` (unchanged signature; context already free-form)
- `src/backend/app/routers/games_upload.py`, `games.py`, `clips*.py`, `routers/export/framing.py`,
  `routers/export/overlay*.py`, `shares.py`, `payments*.py` - add `sport` to the context at each call
- `src/backend/tests/test_analytics*.py` - each tagged event carries `sport`; untagged events do not

### Related Tasks
- Siblings: T14930, T14950 (reads the tag).
- After: T14710 (true export events exist to tag).
- Related: T7455 (editor-open events with clip context; same context mechanism).

### Technical Notes
- Write path unchanged: gesture -> handler -> `record_milestone`; this adds a key to a dict.
- Zero read-time cost: nothing reads the tag at request time; T14950's sweep reads it.
- Do not add sport to `user_actions` or `daily_counters`; that is a schema change and the owner
  ruled it out.

## Implementation

### Steps
1. [ ] Failing tests: one per tagged event asserting `context["sport"]` equals the profile's sport;
       sign-up and session start carry none.
2. [ ] Add the key at each call site; add the instrumented-at date.
3. [ ] Grep proof that every profile-scoped `record_milestone` call in `src/backend/app` carries it.

### Progress Log

**2026-11-03**: Filed.

## Acceptance Criteria

- [ ] Every listed event's `user_action_log.context` carries `sport`; tests cover each.
- [ ] No Postgres DDL diff; `_SCHEMA_DDL` untouched.
- [ ] Instrumented-at date recorded for the readers.
