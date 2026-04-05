# T1000: DRY Quest Definitions — Single Source of Truth

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-04
**Updated:** 2026-04-04

## Problem

Quest definitions are duplicated in three places with **no shared source of truth**:

1. **Frontend** — `src/frontend/src/config/questDefinitions.jsx` (4 quests, 21 steps, with UI metadata)
2. **Backend quests router** — `src/backend/app/routers/quests.py` `QUEST_DEFINITIONS` (4 quests, 21 steps, step IDs + rewards)
3. **Backend admin router** — `src/backend/app/routers/admin.py` `_QUEST_STEP_IDS` (3 quests, stale step IDs from old schema)

The admin copy is **already broken** — it uses old step IDs (`create_annotated_video`, `extract_clip`, completely different Q3) and is missing Q4 entirely. This means admin panel quest progress is wrong for Q3 and invisible for Q4.

The frontend admin components also have hardcoded assumptions:
- `UserTable.jsx` has hardcoded columns for Q1, Q2, Q3 only (no Q4)
- `QuestFunnelChart.jsx` has hardcoded colors for 3 quests and a legend that omits Q4

Any future quest change requires updating 3+ files manually, with no compile-time or test-time check that they're in sync.

## Solution

Create a **single canonical quest definition** in the backend and derive everything else from it. The frontend should fetch quest metadata from an API endpoint rather than maintaining its own copy.

### Architecture

```
Backend (single source of truth):
  src/backend/app/quest_config.py          ← NEW: canonical quest definitions
    - Quest IDs, step IDs, rewards, titles
    - Imported by quests.py, admin.py

  quests.py                                ← imports from quest_config.py (remove inline QUEST_DEFINITIONS)
  admin.py                                 ← imports from quest_config.py (delete _QUEST_STEP_IDS)

  GET /api/quests/definitions              ← NEW: serves quest metadata to frontend

Frontend (derives from backend):
  questDefinitions.jsx                     ← fetch from API on app init, keep only JSX descriptions/icons
  QuestFunnelChart.jsx                     ← derive quest count, colors, legend from fetched definitions
  UserTable.jsx                            ← derive columns from fetched definitions
```

### Key Decisions

1. **Backend owns the definition** — step IDs, rewards, quest count, titles all live in one Python file
2. **Frontend keeps JSX only** — step descriptions with icons/formatting can't come from the API, so `questDefinitions.jsx` keeps a map of `stepId → JSX description` but gets the quest structure from the API
3. **Admin components become dynamic** — UserTable columns and QuestFunnelChart colors/legend derive from the quest count, not hardcoded arrays
4. **Immediate fix for admin.py** — even before the full refactor, `admin.py` should import from the same source as `quests.py`

## Context

### Relevant Files
- `src/backend/app/routers/quests.py` — Current `QUEST_DEFINITIONS` (lines 26-76), step checking logic
- `src/backend/app/routers/admin.py` — Stale `_QUEST_STEP_IDS` (lines 37-45), `_check_steps_on_conn` (lines 71-157)
- `src/frontend/src/config/questDefinitions.jsx` — Frontend `QUESTS` array with full UI metadata
- `src/frontend/src/stores/questStore.js` — Loads `QUESTS`, calculates `TOTAL_STEPS`
- `src/frontend/src/components/admin/QuestFunnelChart.jsx` — Imports `QUESTS`, hardcoded 3-quest colors/legend
- `src/frontend/src/components/admin/UserTable.jsx` — Hardcoded Q1/Q2/Q3 columns (lines 65-67)
- `src/frontend/src/components/QuestPanel.jsx` — Renders quest UI from `QUESTS`

### Related Tasks
- T540 (Quest System) — Original implementation
- T780 (Quest Redesign) — Redesigned quests 3 & 4, updated frontend + backend but not admin
- T550 (Admin Panel) — Original admin implementation with now-stale quest copy
- T970 (User-Scoped Quest Achievements) — Quest achievements moved to user.sqlite

### Current Duplication Detail

| Data | questDefinitions.jsx | quests.py | admin.py |
|------|---------------------|-----------|----------|
| Quest IDs | quest_1–4 | quest_1–4 | quest_1–3 (missing Q4) |
| Step IDs | 21 steps | 21 steps (matches) | **Old schema** (wrong) |
| Rewards | 15/25/40/45 | 15/25/40/45 | N/A |
| Titles | Yes | Yes | N/A |
| Step count | Derived | Derived | **Wrong** |

## Implementation

### Steps
1. [ ] Create `src/backend/app/quest_config.py` with canonical quest definitions (IDs, step IDs, rewards, titles)
2. [ ] Update `quests.py` to import from `quest_config.py` instead of inline `QUEST_DEFINITIONS`
3. [ ] Update `admin.py` to import from `quest_config.py` — delete `_QUEST_STEP_IDS`, fix `_check_steps_on_conn` to use canonical step IDs
4. [ ] Add `GET /api/quests/definitions` endpoint that serves quest structure (no auth required)
5. [ ] Update `questStore.js` to fetch definitions from API on init
6. [ ] Refactor `questDefinitions.jsx` to only contain step-level JSX descriptions keyed by step ID
7. [ ] Update `QuestFunnelChart.jsx` to derive quest count, colors, and legend dynamically
8. [ ] Update `UserTable.jsx` to derive quest columns dynamically from definitions
9. [ ] Add a backend test asserting `quest_config.py` is the only place quest IDs/steps are defined
10. [ ] Verify admin panel shows correct quest progress for all 4 quests

## Acceptance Criteria

- [ ] Quest definitions exist in exactly ONE place (`quest_config.py`)
- [ ] `quests.py` and `admin.py` both import from `quest_config.py`
- [ ] Admin panel shows progress for all 4 quests (not just 3)
- [ ] Admin panel quest progress matches user-facing quest progress
- [ ] Adding a new quest requires changes to only `quest_config.py` + JSX descriptions
- [ ] QuestFunnelChart and UserTable adapt automatically to quest count changes
- [ ] No hardcoded quest IDs remain in admin components
- [ ] Existing quest progress/rewards unaffected (no user-facing behavior change)
