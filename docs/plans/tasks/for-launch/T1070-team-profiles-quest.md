# T1070: Team & Profiles Quest

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The current quest flow (4 quests) doesn't teach users about profiles or team features. With T1050 (Team Invitations) and T1060 (Coaches View) adding team/roster functionality, users need guidance on:

1. What profiles are and why they matter (each profile = one athlete's data)
2. How to upload team data to invite teammates
3. The social/viral benefits of bringing their team onto the platform

## Solution

Add a new quest (Quest 5 or inserted between existing quests) that walks users through:

### Quest Steps (draft)

1. **Create a second profile** — "Add another athlete's profile" (teaches multi-profile)
2. **Upload your team** — "Add your team roster to invite teammates"
3. **Send an invitation** — "Invite at least one teammate"
4. **Teammate joins** — "A teammate signed up through your invite" (may take time — quest stays open)

### Reward

Credits for completing the quest, plus the per-referral credits from T1050.

## Context

### Relevant Files
- `src/backend/app/quest_config.py` — Quest definitions (add new quest)
- `src/frontend/src/config/questDefinitions.jsx` — Frontend quest step titles/descriptions
- `src/backend/app/routers/quests.py` — Step completion checks
- `src/frontend/src/components/QuestPanel.jsx` — Quest UI

### Related Tasks
- Depends on: T1050 (Team Invitations), T85 (Multi-Athlete Profiles — DONE)
- Related: T1060 (Coaches View — has own quest flow)
- T540 (Quest System) — DONE — existing quest infrastructure
- T780 (Quest Redesign) — DONE — current quest structure

### Technical Notes
- Step "Teammate joins" is async — user can't control when it completes
- Consider making this step optional or having a fallback (e.g., "or share your invite link")
- Quest should be positioned after Quest 2 (Export Highlights) so user already knows the core flow

## Implementation

### Steps
1. [ ] Design quest steps and copy
2. [ ] Add quest definition to quest_config.py
3. [ ] Add step completion checks in quests.py
4. [ ] Add frontend step titles/descriptions
5. [ ] Test full quest flow

## Acceptance Criteria

- [ ] New quest appears after user completes Quest 2
- [ ] Steps guide user through profiles → team → invitation
- [ ] Credits awarded on quest completion
- [ ] Quest works alongside existing quests without conflicts
