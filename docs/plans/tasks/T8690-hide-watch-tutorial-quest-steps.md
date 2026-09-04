# T8690: Hide the quest_1-4 "Watch tutorial video" steps for now (keep code intact)

**Status:** STAGING (merged to master 2026-09-04, PR #334)
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-04

## Problem

User directive (2026-09-04): turn off the quest_1-4 "Watch tutorial video" steps
(`watch_annotate_tutorial`, `watch_framing_tutorial`, `watch_overlay_tutorial`,
`watch_publish_tutorial` — `src/backend/app/quest_config.py`) for now. **Explicit
constraint: do not delete or gut the code, just make it not show/run.**

Confirmed via investigation: this is a DIFFERENT mechanism from the T7620/T7630/T7640
"guided tour" epic (that engine — `GUIDANCE_MAP`, `data-tutorial-target`, etc. — has not
been implemented at all; nothing to disable there). The thing actually live today is the
older quest-video mechanism:
- Backend: `quest_config.py` — each of the 4 quests has a `watch_*_tutorial` step as its
  FIRST step; `routers/quests.py:197-200` marks each complete via a recorded achievement
  event (`'watched_X_tutorial' in achieved`), not a derived condition.
- Frontend: `src/frontend/src/config/questDefinitions.jsx` — `WatchTutorialButton`
  (renders the CTA that opens `TutorialVideoModal` via `useTutorialStore.openTutorial`),
  `TUTORIAL_STEP_QUEST` map, title/description copy for all 4 steps.
- All 4 quests' credit rewards are already retired/zeroed (T8120 — the full chain total
  is granted upfront at signup), so an incomplete/never-completable step has **no credit
  consequence**.

## Solution (needs a Code Expert pass to find the rendering call sites — not scoped in
depth here)

Hide the "Watch tutorial" CTA (and ideally the step itself) from whatever component
renders the quest checklist (likely `QuestPanel.jsx` or similar — not yet located), behind
a single, clearly-named, off-by-default flag — e.g. a constant like
`TUTORIAL_VIDEOS_ENABLED = false` in a constants file, checked at the render site(s).
**Do not remove `watch_*_tutorial` from `quest_config.py`'s `step_ids` lists** (that
changes quest structure/completion tracking, not just visibility) and **do not delete
`WatchTutorialButton`, `TutorialVideoModal`, `useTutorialStore`, or the achievement-event
completion logic** — all of it stays in place, just not shown/reachable by a real user for
now.

Open design question for whoever picks this up: with the step hidden, does the quest
checklist show it as skipped/absent (cleanest), or does the panel need explicit handling
so a permanently-incomplete-but-hidden step doesn't leave the checklist looking "stuck" at
that item? Depends on how the quest panel currently renders step lists — investigate before
choosing.

## Context

### Relevant Files (anticipated)
- `src/backend/app/quest_config.py` (definitions, DO NOT restructure)
- `src/backend/app/routers/quests.py:197-200` (completion check, DO NOT remove)
- `src/frontend/src/config/questDefinitions.jsx` (`WatchTutorialButton`, step copy)
- Whatever component renders the quest step checklist (find via Code Expert — likely
  `QuestPanel.jsx` or similar under `src/frontend/src/components/`)

## Acceptance Criteria

- [ ] A real user sees no "Watch tutorial" video CTA/step anywhere in the quest UI
- [ ] Zero code deleted — `WatchTutorialButton`, `TutorialVideoModal`,
      `useTutorialStore`, and the backend achievement-completion logic are all
      unchanged, just unreached
- [ ] Toggling the new flag back on (manual code edit) restores prior behavior exactly,
      verified by a quick before/after check
- [ ] No other quest step's completion/reward logic is affected
