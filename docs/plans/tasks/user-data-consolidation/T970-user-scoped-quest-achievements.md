# T970: User-Scoped Quest Achievements

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-03
**Updated:** 2026-04-03

## Problem

Quest achievements (e.g., `played_annotations`, `viewed_gallery_video`) are stored in the per-profile `database.sqlite` `achievements` table. This means a user can:

1. Complete all quests on Profile A → earn 125 credits
2. Switch to Profile B → achievements table is empty
3. Complete all quests again → earn another 125 credits

Credits are user-level (user.sqlite) but achievement checks are profile-level — the mismatch enables double-granting.

The existing `credit_transactions` UNIQUE index prevents the same `quest_reward` + `quest_id` from being granted twice, but the quest progress API (`GET /api/quests/progress`) will show quests as incomplete on a new profile, misleading the user into thinking they can earn more.

### Expected Behavior
Quest achievements are tracked per-user. Switching profiles doesn't reset quest progress. Quest panel shows correct state regardless of active profile.

### Actual Behavior
Quest progress resets when switching profiles because achievements are in per-profile database.sqlite.

## Solution

1. Add `achievements` table to `user.sqlite`:
   ```sql
   CREATE TABLE achievements (
     key TEXT PRIMARY KEY,
     achieved_at TEXT DEFAULT (datetime('now'))
   );
   ```

2. Migrate existing achievements from all profile databases into user.sqlite (union, deduplicate by key, keep earliest achieved_at)

3. Update `POST /api/quests/achievements/{key}` to write to user.sqlite instead of profile database.sqlite

4. Update `GET /api/quests/progress` to read achievements from user.sqlite

5. Quest progress derivation also queries per-profile tables (games, raw_clips, export_jobs). These stay per-profile — only the explicit achievements move. Document which quest steps are user-scoped vs profile-scoped.

## Design Decisions

- **Quest step progress stays per-profile.** Derived steps (upload game, create clip, export) only check the active profile's database. Profiles represent different athletes — progress doesn't cross over.
- **Quest completion is user-scoped.** When all steps of a quest are done and the reward is claimed, that quest is marked complete in user.sqlite. This is permanent across all profiles.
- **Which quest to show is determined by completed quests.** The backend checks user.sqlite for which quests are already completed, then shows the next uncompleted one. Steps within that quest are still derived from the active profile's data.

## Context

### Relevant Files
- `src/backend/app/routers/quests.py` — quest progress and achievement endpoints
- `src/backend/app/services/user_db.py` — user.sqlite operations (add achievement functions here)
- `src/backend/app/database.py` — per-profile database.sqlite schema (achievements table ~line 448+)
- `src/frontend/src/stores/questStore.js` — frontend quest state (no changes expected)
- `src/frontend/src/config/questDefinitions.jsx` — quest step definitions

### Related Tasks
- T920: User-Level DB (created user.sqlite)
- T880: Quest Reward Double-Grant (UNIQUE index prevents credit double-grant, but progress still shows wrong)
- T960: Profiles to User DB (sibling task)
