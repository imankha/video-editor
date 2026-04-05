# T1000 Design: DRY Quest Definitions

**Status:** APPROVED
**Author:** Architect Agent
**Approved:** 2026-04-04

## Current State ("As Is")

### Data Flow

```mermaid
flowchart TD
    subgraph Backend
        QP[quests.py<br>QUEST_DEFINITIONS<br>4 quests, 21 steps] -->|used by| API_PROGRESS[GET /quests/progress]
        QP -->|used by| API_CLAIM[POST /quests/{id}/claim-reward]
        ADM[admin.py<br>_QUEST_STEP_IDS<br>3 quests, STALE] -->|used by| API_USERS[GET /admin/users]
    end
    subgraph Frontend
        QD[questDefinitions.jsx<br>QUESTS array<br>4 quests + JSX] -->|imported by| QS[questStore.js]
        QD -->|imported by| QP2[QuestPanel.jsx]
        QD -->|imported by| QFC[QuestFunnelChart.jsx]
        UT[UserTable.jsx<br>hardcoded Q1-Q3]
    end
    API_PROGRESS -->|fetched by| QS
    API_USERS -->|fetched by| UT
```

### Current Behavior

```pseudo
BACKEND (quests.py):
  QUEST_DEFINITIONS = [{id, title, reward, step_ids}, ...] (4 quests, 21 steps)
  GET /quests/progress  → reads achievements table, maps against QUEST_DEFINITIONS
  POST /claim-reward    → verifies all steps complete using QUEST_DEFINITIONS

BACKEND (admin.py):
  _QUEST_STEP_IDS = {quest_1: [...], quest_2: [...], quest_3: [...]}  # STALE COPY
  _check_steps_on_conn  → SQL-based detection using _QUEST_STEP_IDS
  GET /admin/users      → returns quest_progress per user

FRONTEND (questDefinitions.jsx):
  QUESTS = [{id, title, reward, steps: [{id, title, description: JSX}]}]  # THIRD COPY
  QuestPanel renders from QUESTS + backend progress
  QuestFunnelChart derives steps from QUESTS, hardcoded 3-quest colors/legend
  UserTable hardcoded Q1/Q2/Q3 columns
```

### Code Smells

| Smell | Location | Impact |
|-------|----------|--------|
| **Shotgun Surgery** | Quest IDs in 3 files | Adding a quest requires 3+ file changes |
| **Divergent Change** | admin.py stale copy | Admin shows wrong progress for Q2/Q3, missing Q4 |
| **Hardcoded Magic** | UserTable L65-67, QuestFunnelChart L42-55 | Q4 invisible in admin |

### Specific Admin Drift

| Quest | quests.py (correct) | admin.py (stale) |
|-------|-------------------|------------------|
| Q1 step 3 | `playback_annotations` | `create_annotated_video` |
| Q2 step 2 | `export_framing` | `extract_clip` (doesn't exist) |
| Q2 step 3 | `wait_for_export` | missing |
| Q3 | 6 steps (annotate_second_5_star, ...) | 10 completely different steps from old schema |
| Q4 | 7 steps | NOT DEFINED |

## Target State ("Should Be")

### Updated Flow

```mermaid
flowchart TD
    subgraph Backend
        QC[quest_config.py<br>QUEST_DEFINITIONS<br>Single source of truth] -->|imported by| QP[quests.py]
        QC -->|imported by| ADM[admin.py]
        QC -->|served by| API_DEFS[GET /quests/definitions]
        QP -->|uses| API_PROGRESS[GET /quests/progress]
        QP -->|uses| API_CLAIM[POST /quests/{id}/claim-reward]
        ADM -->|uses| API_USERS[GET /admin/users]
    end
    subgraph Frontend
        API_DEFS -->|fetched once| QS[questStore.js<br>stores definitions]
        QS -->|provides| QP2[QuestPanel.jsx]
        QS -->|provides| QFC[QuestFunnelChart.jsx<br>dynamic colors/legend]
        QS -->|provides| UT[UserTable.jsx<br>dynamic quest columns]
        JSX[questDefinitions.jsx<br>stepId → JSX description ONLY]
        JSX -->|descriptions for| QP2
    end
```

### Target Behavior

```pseudo
BACKEND (quest_config.py) — SINGLE SOURCE OF TRUTH:
  QUEST_DEFINITIONS = [
    {id: "quest_1", title: "Get Started", reward: 15,
     steps: ["upload_game", "annotate_brilliant", "playback_annotations"]},
    ...4 quests, 21 steps
  ]
  QUEST_BY_ID = {q.id: q for q in QUEST_DEFINITIONS}
  ALL_STEP_IDS = [step for q in QUEST_DEFINITIONS for step in q.steps]

BACKEND (quests.py) — imports from quest_config:
  from app.quest_config import QUEST_DEFINITIONS, QUEST_BY_ID
  # Delete inline QUEST_DEFINITIONS, use import

BACKEND (admin.py) — imports from quest_config:
  from app.quest_config import QUEST_DEFINITIONS
  # Delete _QUEST_STEP_IDS entirely
  # _check_steps_on_conn iterates QUEST_DEFINITIONS

NEW ENDPOINT: GET /api/quests/definitions
  → returns [{id, title, reward, steps: [step_id, ...], step_count}]
  → no auth required (no user data)

FRONTEND (questStore.js):
  fetchDefinitions() → GET /api/quests/definitions → store in state
  TOTAL_STEPS derived from definitions
  Quest structure available to all components

FRONTEND (questDefinitions.jsx) — JSX ONLY:
  STEP_DESCRIPTIONS = {
    upload_game: <span>Upload a game video...</span>,
    annotate_brilliant: <span>Click <MiniButton>...</MiniButton>...</span>,
    ...
  }
  STEP_TITLES = { upload_game: "Add Your First Game", ... }
  (These contain JSX/icons that can't come from API)

FRONTEND (QuestFunnelChart.jsx):
  Quest count, colors, legend derived from definitions array length

FRONTEND (UserTable.jsx):
  Quest columns generated from definitions.map(q => column)
```

## Implementation Plan ("Will Be")

### Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `src/backend/app/quest_config.py` | **NEW** — canonical definitions + helpers |
| 2 | `src/backend/app/routers/quests.py` | Import from quest_config, delete inline defs |
| 3 | `src/backend/app/routers/admin.py` | Import from quest_config, delete `_QUEST_STEP_IDS`, fix `_check_steps_on_conn` |
| 4 | `src/backend/app/routers/quests.py` | Add `GET /definitions` endpoint |
| 5 | `src/frontend/src/config/questDefinitions.jsx` | Keep only `STEP_DESCRIPTIONS` and `STEP_TITLES` maps |
| 6 | `src/frontend/src/stores/questStore.js` | Add `fetchDefinitions()`, store definitions, derive TOTAL_STEPS |
| 7 | `src/frontend/src/components/QuestPanel.jsx` | Read quest structure from store instead of imported QUESTS |
| 8 | `src/frontend/src/components/admin/QuestFunnelChart.jsx` | Derive quest count/colors/legend from store |
| 9 | `src/frontend/src/components/admin/UserTable.jsx` | Generate quest columns from store |

### Pseudo Code Changes

```pseudo
// 1. NEW: src/backend/app/quest_config.py
QUEST_DEFINITIONS = [
    {"id": "quest_1", "title": "Get Started", "reward": 15,
     "step_ids": ["upload_game", "annotate_brilliant", "playback_annotations"]},
    {"id": "quest_2", "title": "Export Highlights", "reward": 25,
     "step_ids": ["open_framing", "export_framing", "wait_for_export", "export_overlay", "view_gallery_video"]},
    {"id": "quest_3", "title": "Annotate More Clips", "reward": 40,
     "step_ids": ["annotate_second_5_star", "annotate_5_more", "export_second_highlight",
                   "wait_for_export_2", "overlay_second_highlight", "watch_second_highlight"]},
    {"id": "quest_4", "title": "Highlight Reel", "reward": 45,
     "step_ids": ["upload_game_2", "annotate_game_2", "create_reel", "export_reel",
                   "wait_for_reel", "overlay_reel", "watch_reel"]},
]
QUEST_BY_ID = {q["id"]: q for q in QUEST_DEFINITIONS}
ALL_STEP_IDS = [s for q in QUEST_DEFINITIONS for s in q["step_ids"]]

// 2. quests.py
- QUEST_DEFINITIONS = [...]  (delete ~50 lines)
+ from app.quest_config import QUEST_DEFINITIONS, QUEST_BY_ID

+ @router.get("/definitions")
+ async def get_definitions():
+     return [{"id": q["id"], "title": q["title"], "reward": q["reward"],
+              "step_ids": q["step_ids"]} for q in QUEST_DEFINITIONS]

// 3. admin.py
- _QUEST_STEP_IDS = {...}  (delete stale dict)
+ from app.quest_config import QUEST_DEFINITIONS

  _check_steps_on_conn:
-   iterate _QUEST_STEP_IDS  (stale IDs)
+   iterate QUEST_DEFINITIONS  (canonical IDs, includes Q4)

// 5. questDefinitions.jsx
- export const QUESTS = [{id, title, reward, steps: [{id, title, description}]}]
+ export const STEP_DESCRIPTIONS = {
+   upload_game: <span>...</span>,
+   annotate_brilliant: <span>Click <MiniButton>...</MiniButton></span>,
+   ...21 entries
+ }
+ export const STEP_TITLES = {
+   upload_game: "Add Your First Game",
+   ...21 entries
+ }

// 6. questStore.js
+ definitions: null,  // [{id, title, reward, step_ids}]
+ totalSteps: 0,
+ fetchDefinitions: async () => {
+   const res = await api.get('/api/quests/definitions');
+   set({ definitions: res.data, totalSteps: res.data.reduce((s,q) => s + q.step_ids.length, 0) });
+ }
- import { QUESTS, TOTAL_STEPS } from '../config/questDefinitions.jsx'

// 7. QuestPanel.jsx
- import { QUESTS } from '../config/questDefinitions.jsx'
+ const definitions = useQuestStore(s => s.definitions)
+ import { STEP_DESCRIPTIONS, STEP_TITLES } from '../config/questDefinitions.jsx'
  // Build step objects: { id, title: STEP_TITLES[id], description: STEP_DESCRIPTIONS[id] }

// 8. QuestFunnelChart.jsx
- hardcoded 3 colors + legend
+ const QUEST_COLORS = ['purple', 'blue', 'emerald', 'amber', ...]  // extensible palette
+ derive legend from definitions.map((q, i) => ({color: QUEST_COLORS[i], title: q.title}))

// 9. UserTable.jsx
- { key: 'quest_1', label: 'Q1' }, { key: 'quest_2', label: 'Q2' }, { key: 'quest_3', label: 'Q3' }
+ definitions.map((q, i) => ({ key: q.id, label: `Q${i+1}`, align: 'center' }))
- 3x hardcoded <td> for quest badges
+ definitions.map(q => <td><QuestBadge questId={q.id} progress={...} /></td>)
```

### Admin Detection Logic Fix

The `_check_steps_on_conn` function in admin.py needs its step-detection SQL updated to match the canonical step IDs. Key changes:

| Old Step (admin.py) | New Step (quest_config) | Detection Change |
|---------------------|------------------------|------------------|
| `create_annotated_video` | `playback_annotations` | Check achievements table instead of export_jobs |
| `extract_clip` | `export_framing` | Already checks framing exports — just rename |
| Q3 (10 old steps) | Q3 (6 new steps) | Rewrite detection for annotate_second_5_star, annotate_5_more, etc. |
| — | Q4 (7 steps) | Add detection for upload_game_2, create_reel, etc. |

For each step, the detection mirrors what quests.py checks: look up the step ID in the `quest_achievements` table in `user.sqlite`.

**Simplification opportunity:** Instead of complex SQL heuristics per step, admin.py can just read the achievements table directly (same as quests.py). The old approach tried to infer progress from data state; the new approach reads recorded achievements. This is simpler and guaranteed consistent.

## Design Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Where definitions live | quest_config.py vs quests.py | quest_config.py (new module) | Clean separation; both routers import same source |
| Frontend data source | Static import vs API fetch | API fetch | True single source of truth; quest changes need only backend + JSX descriptions |
| Admin detection method | SQL heuristics vs achievements table | Achievements table | Consistent with quests.py, simpler, no drift risk |
| JSX descriptions | API vs static | Static (questDefinitions.jsx) | JSX can't serialize over API; keep as stepId-keyed maps |
| API auth | Required vs public | Public (no auth) | Quest definitions are not sensitive; avoids loading-state issues for unauthenticated views |

## Risks

| Risk | Mitigation |
|------|------------|
| Frontend renders before definitions load | Fetch definitions early (alongside auth); guard QuestPanel with `if (!definitions)` |
| Admin detection rewrite breaks progress display | Compare old vs new output for test users before committing |
| Step ID typo in STEP_DESCRIPTIONS breaks rendering | Backend test asserting all step_ids have corresponding frontend entries (can't automate cross-stack, but backend test ensures config is valid) |

## Open Questions

- [ ] **Admin detection strategy:** Should admin.py read from the achievements table (simple, consistent) or keep SQL heuristics (can detect progress even without explicit achievements)? **Recommendation: achievements table** — it's what quests.py uses, and the heuristic approach already drifted.
