# T3660: Quest 4 Rework: Season Highlights Funnel (New User Flow)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-12

## Problem

Quest 4 ("Highlight Reel", 45 credits) teaches the multi-clip custom project flow that T3650 demotes -- new users would be onboarded into a deprecated paradigm. The new-user flow must funnel into curation instead, and the 30s unlock threshold should BE a quest milestone so the quest walks users straight into T3640's unlock moment.

## Solution

Quests 1-3 unchanged (they drive the annotate->frame->overlay->publish engine the new paradigm feeds on). Replace Quest 4's steps; keep id `quest_4` and the 45-credit reward (claim idempotency keys on quest_id).

### New Quest 4 -- "Season Highlights"

| Step key | Title | Detection |
|---|---|---|
| `upload_game_2` | Add a Second Game | existing derived check (keep) |
| `annotate_game_2` | Annotate a Good or Great Play | existing derived check (keep) |
| `publish_30s` | Publish 30s of Highlights | derived: `SELECT COALESCE(SUM(duration),0) FROM final_videos WHERE published_at IS NOT NULL` >= 30 (needs T3600 stamping + backfill) |
| `unlock_season_highlights` | Unlock Season Highlights | achievement `season_highlights_optin` (recorded by T3640's accept) |
| `rank_first_reel` | Rank a Highlight | derived: `EXISTS(SELECT 1 FROM final_videos WHERE season_rank IS NOT NULL)` (T3630 column) |
| `share_season_highlights` | Share Your Season | achievement `copied_collection_link` -- recorded from the CollectionHeader Share verb (any collection type) |

Old multi-clip detection at [quests.py:188-199](../../../../src/backend/app/routers/quests.py) is deleted with the old steps.

### Definition sync (three places, must match)

1. Backend source of truth: [quest_config.py:9-62](../../../../src/backend/app/quest_config.py)
2. Frontend structure: [data/questDefinitions.js](../../../../src/frontend/src/data/questDefinitions.js) (embedded in bundle since T3330)
3. Frontend titles/descriptions: [config/questDefinitions.jsx](../../../../src/frontend/src/config/questDefinitions.jsx)

Add the two achievement keys to the known-keys list (quests.py:28). Rewrite the quest_4 completion modal copy ([QuestPanel.jsx:204-225](../../../../src/frontend/src/components/QuestPanel.jsx)): drop multi-clip messaging; celebrate the live season link.

### Rollout edge cases (handle explicitly)

- **Already-claimed quest_4**: `completed_quest_ids` persists; steps backfill as complete. No action needed -- verify with a test.
- **Mid-quest users**: derived steps re-derive against new definitions; old progress on removed steps is simply gone. Acceptable (new path is shorter); note in release comms.
- **Declined opt-in**: quest stalls at `unlock_season_highlights` visibly, no nagging (panel shows the quest as-is); the locked Collections card (T3640) is the re-entry. Track decline via existing analytics if available.
- **E2E new-user flow**: [e2e/new-user-flow.spec.js](../../../../src/frontend/e2e/new-user-flow.spec.js) walks the old quest 4 (create multi-clip reel). Rewrite its back half: publish to 30s -> unlock modal accept -> rank -> share. This is the canonical New User Flow regression test for the whole epic.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/quest_config.py` - quest 4 definition
- `src/backend/app/routers/quests.py` - step detection + achievement keys
- `src/frontend/src/data/questDefinitions.js` - structure
- `src/frontend/src/config/questDefinitions.jsx` - titles/descriptions
- `src/frontend/src/components/QuestPanel.jsx` - completion modal copy
- `src/frontend/src/components/collections/CollectionHeader.jsx` - record `copied_collection_link` on Share
- `src/frontend/e2e/new-user-flow.spec.js` - rewrite quest-4 segment

### Related Tasks
- Depends on: T3600 (`publish_30s` needs stamped duration), T3630 (`season_rank` column), T3640 (`season_highlights_optin` achievement + unlock flow), T3620 (Share verb to record `copied_collection_link`)
- Ships with: T3640 + T3650 (paradigm release, EPIC decision #12)

### Technical Notes
- Quest mechanics: tech-notes section 7. Steps are derived server-side from profile data; achievements are idempotent INSERT OR IGNORE; `recordAchievement` is session-deduped fire-and-forget.
- No migration: quest definitions are code, not schema.
- Reward stays 45 credits; claim flow untouched.

## Implementation

### Steps
1. [ ] Update quest_config.py + both frontend definition files
2. [ ] Replace step detection in `_check_all_steps`; register achievement keys
3. [ ] Record `copied_collection_link` from CollectionHeader Share
4. [ ] Rewrite quest_4 completion modal copy
5. [ ] Backend tests: each new detection (incl. already-claimed backfill case)
6. [ ] Rewrite e2e new-user-flow quest-4 segment

### Progress Log

## Acceptance Criteria

- [ ] Fresh user completes quest 4 end-to-end via the curation path (e2e proves it)
- [ ] Users who claimed old quest_4 still show it complete with reward claimed
- [ ] `publish_30s` flips exactly when stamped durations sum >= 30
- [ ] Declined opt-in shows a stalled (not broken) quest
- [ ] Backend + e2e tests pass
