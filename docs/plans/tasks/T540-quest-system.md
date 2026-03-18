# T540: Guided Tutorial / Quest System

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-03-17
**Updated:** 2026-03-17

## Problem

New users don't know what the app does or how to use it. There's no guided path from upload to final export. Without onboarding, users drop off before experiencing the core value. Users also need a way to earn credits (T530) to use paid features.

## Solution

A quest system with 2 quests (5 steps each) that teach users the full pipeline while rewarding them with credits. Progress is derived from existing data where possible (games, clips, exports) and tracked via a lightweight achievement table for non-derivable actions. UI uses the existing slide-out panel pattern (same as Gallery) triggered by a header icon.

### Quest Definitions

**Quest 1: "Get Started" — Earns 10 credits**

| # | Step | Title | Description | Derivable? | How to Check |
|---|------|-------|-------------|------------|-------------|
| 1 | Upload a game | "Upload Your First Game" | "Drop a game video to start annotating your best plays" | Yes | `games` table has ≥1 row |
| 2 | Annotate a brilliant clip | "Mark a Brilliant Play" | "Find your best moment and rate it 5 stars" | Yes | `raw_clips` table has ≥1 row with rating=5 |
| 3 | Annotate an unfortunate clip | "Mark an Unfortunate Play" | "Every player has off moments — mark one with 1 or 2 stars to learn from it" | Yes | `raw_clips` table has ≥1 row with rating IN (1,2) |
| 4 | Create annotated video | "Create Your Highlight Reel" | "Compile your annotated clips into a single video" | Yes | `export_jobs` table has ≥1 row with type='annotate' AND status='complete' |
| 5 | Log in | "Create Your Account" | "Sign in to save your work across devices and earn credits" | Yes | User is authenticated (has email in auth.sqlite) |

**Quest 2: "Master the Pipeline" — Earns 10 credits**

| # | Step | Title | Description | Derivable? | How to Check |
|---|------|-------|-------------|------------|-------------|
| 1 | Open project for framing | "Open the Framing Editor" | "Select a project and enter Framing mode to crop and upscale your clips" | No | Achievement: `opened_framing_editor` |
| 2 | Export framing | "Export Your First Frame Job" | "Click Export to render your cropped, upscaled video" | Yes | `export_jobs` table has ≥1 row with type='framing' AND status='complete' |
| 3 | Export overlay | "Add Highlight Overlays" | "Use the Overlay editor to spotlight key moments, then export" | Yes | `export_jobs` table has ≥1 row with type='overlay' AND status='complete' |
| 4 | View video from gallery | "Watch Your Finished Video" | "Open the Gallery and play back your completed highlight reel" | No | Achievement: `viewed_gallery_video` |
| 5 | (Reserved — TBD) | TBD | TBD | — | — |

*Note: Quest 2 step 5 is a placeholder — user can decide later. If only 4 steps, adjust reward trigger accordingly.*

### Design Principles

1. **Data-driven step definitions** — Steps are defined as a config array, not hardcoded UI. Adding/removing/reordering steps means editing one config object.
2. **Derive where possible** — 8 of 10 steps check existing data (games, clips, exports, auth). Only 2 need achievement tracking.
3. **Achievement table is minimal** — Simple key-value store for non-derivable actions. Keys are descriptive strings.
4. **No sequential ordering** — Steps can be completed in any order. Both quests visible from the start.
5. **Reward on completion** — Credits granted atomically when all steps in a quest are done.

## Context

### Relevant Files

**Backend (new):**
- `src/backend/app/routers/quests.py` - NEW: quest progress API
- Achievement table in per-user SQLite

**Backend (modify):**
- `src/backend/app/database.py` - Add achievements table schema
- `src/backend/app/routers/credits.py` - Grant credits on quest completion (from T530)

**Frontend (new):**
- `src/frontend/src/stores/questStore.js` - NEW: Zustand store for quest state
- `src/frontend/src/components/QuestPanel.jsx` - NEW: slide-out panel
- `src/frontend/src/components/QuestIcon.jsx` - NEW: header icon with progress badge
- `src/frontend/src/config/questDefinitions.js` - NEW: data-driven step config

**Frontend (modify):**
- Header/nav component - Add QuestIcon
- Framing screen entry point - Fire achievement `opened_framing_editor`
- Gallery video playback - Fire achievement `viewed_gallery_video`

### Related Tasks
- Depends on: T530 (Credit System — quest rewards are credits)
- Depends on: T405 (Central auth DB — DONE)
- Related: T550 (Admin Panel — shows quest progress per user)

### Technical Notes

**Achievement table (per-user SQLite):**
```sql
CREATE TABLE IF NOT EXISTS achievements (
    key TEXT PRIMARY KEY,           -- e.g., 'opened_framing_editor', 'viewed_gallery_video'
    achieved_at TEXT DEFAULT (datetime('now'))
);
```

**Quest definition config (frontend):**
```javascript
// src/frontend/src/config/questDefinitions.js
export const QUESTS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    description: 'Learn the basics and create your first highlight reel',
    reward: 10, // credits
    steps: [
      {
        id: 'upload_game',
        title: 'Upload Your First Game',
        description: 'Drop a game video to start annotating your best plays',
        checkType: 'derived',  // checked via API
      },
      {
        id: 'annotate_brilliant',
        title: 'Mark a Brilliant Play',
        description: 'Find your best moment and rate it 5 stars',
        checkType: 'derived',
      },
      {
        id: 'annotate_unfortunate',
        title: 'Mark an Unfortunate Play',
        description: 'Every player has off moments — mark one with 1 or 2 stars to learn from it',
        checkType: 'derived',
      },
      {
        id: 'create_annotated_video',
        title: 'Create Your Highlight Reel',
        description: 'Compile your annotated clips into a single video',
        checkType: 'derived',
      },
      {
        id: 'log_in',
        title: 'Create Your Account',
        description: 'Sign in to save your work across devices and earn credits',
        checkType: 'derived',  // checked via auth state
      },
    ],
  },
  {
    id: 'quest_2',
    title: 'Master the Pipeline',
    description: 'Take your highlights to the next level with framing and overlays',
    reward: 10,
    steps: [
      {
        id: 'open_framing',
        title: 'Open the Framing Editor',
        description: 'Select a project and enter Framing mode to crop and upscale your clips',
        checkType: 'achievement',  // stored in achievements table
        achievementKey: 'opened_framing_editor',
      },
      {
        id: 'export_framing',
        title: 'Export Your First Frame Job',
        description: 'Click Export to render your cropped, upscaled video',
        checkType: 'derived',
      },
      {
        id: 'export_overlay',
        title: 'Add Highlight Overlays',
        description: 'Use the Overlay editor to spotlight key moments, then export',
        checkType: 'derived',
      },
      {
        id: 'view_gallery_video',
        title: 'Watch Your Finished Video',
        description: 'Open the Gallery and play back your completed highlight reel',
        checkType: 'achievement',
        achievementKey: 'viewed_gallery_video',
      },
    ],
  },
];
```

**Quest progress API:**
```
GET /api/quests/progress → {
  quests: [
    {
      id: 'quest_1',
      steps: {
        upload_game: true,
        annotate_brilliant: true,
        annotate_unfortunate: false,
        create_annotated_video: false,
        log_in: true
      },
      completed: false,
      reward_claimed: false
    },
    ...
  ]
}

POST /api/quests/{quest_id}/claim-reward → { credits_granted: 10, new_balance: 20 }
POST /api/achievements/{key} → { key: 'opened_framing_editor', achieved_at: '...' }
```

**Backend derivation logic (quests.py):**
```python
def check_quest_progress(user_id, profile_id, db):
    """Check all quest steps by querying existing data."""
    steps = {}

    # Derived checks (query per-user SQLite)
    steps['upload_game'] = db.execute("SELECT 1 FROM games LIMIT 1").fetchone() is not None
    steps['annotate_brilliant'] = db.execute("SELECT 1 FROM raw_clips WHERE rating = 5 LIMIT 1").fetchone() is not None
    steps['annotate_unfortunate'] = db.execute("SELECT 1 FROM raw_clips WHERE rating IN (1, 2) LIMIT 1").fetchone() is not None
    steps['create_annotated_video'] = db.execute("SELECT 1 FROM export_jobs WHERE type = 'annotate' AND status = 'complete' LIMIT 1").fetchone() is not None
    steps['export_framing'] = db.execute("SELECT 1 FROM export_jobs WHERE type = 'framing' AND status = 'complete' LIMIT 1").fetchone() is not None
    steps['export_overlay'] = db.execute("SELECT 1 FROM export_jobs WHERE type = 'overlay' AND status = 'complete' LIMIT 1").fetchone() is not None

    # Auth check (from auth.sqlite)
    steps['log_in'] = user_is_authenticated(user_id)

    # Achievement checks
    steps['open_framing'] = db.execute("SELECT 1 FROM achievements WHERE key = 'opened_framing_editor'").fetchone() is not None
    steps['view_gallery_video'] = db.execute("SELECT 1 FROM achievements WHERE key = 'viewed_gallery_video'").fetchone() is not None

    return steps
```

**UI: Slide-out quest panel (same pattern as Gallery):**
```
Header: [...nav...] [🏆 7/9] [📥 Gallery] [👤 Profile]
                        ↓ click
┌─────────────────────────────────┐
│ ← Quests                       │
│─────────────────────────────────│
│ ┌─────────────────────────────┐ │
│ │ Quest 1: Get Started        │ │
│ │ ██████████░░ 4/5 steps      │ │
│ │ 🎁 Reward: 10 credits       │ │
│ │                             │ │
│ │ ✅ Upload Your First Game   │ │
│ │    Drop a game video to...  │ │
│ │                             │ │
│ │ ✅ Mark a Brilliant Play    │ │
│ │    Find your best moment... │ │
│ │                             │ │
│ │ ○ Mark an Unfortunate Play  │ │
│ │    Every player has off...  │ │
│ │                             │ │
│ │ ✅ Create Your Highlight... │ │
│ │    Compile your annotated.. │ │
│ │                             │ │
│ │ ✅ Create Your Account      │ │
│ │    Sign in to save your...  │ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Quest 2: Master the Pipeline│ │
│ │ ██░░░░░░░░░░ 1/4 steps     │ │
│ │ 🎁 Reward: 10 credits      │ │
│ │ ...                         │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**Step completion feedback:**
- When a step completes during normal app usage, pulse the quest icon in the header
- Optional toast: "Quest step completed: [step title]" (auto-dismiss 3s)
- When all steps in a quest complete, show a celebration toast with "Claim 10 credits" button

**Quest icon behavior:**
- Shows total completed steps across all quests (e.g., "7/9")
- Progress ring or fraction badge
- Pulses briefly when a new step completes
- After all quests complete, icon shows checkmark, fades after a session

**Mobile:** Panel slides up as bottom sheet (same behavior as Gallery on mobile)

## Implementation

### Steps
1. [ ] Create quest step definitions config (questDefinitions.js)
2. [ ] Add achievements table to per-user SQLite schema
3. [ ] Create quests.py router with progress derivation logic
4. [ ] Create achievement recording endpoint
5. [ ] Create questStore.js Zustand store
6. [ ] Create QuestPanel.jsx slide-out component
7. [ ] Create QuestIcon.jsx header component with progress badge
8. [ ] Wire achievement triggers (framing screen entry, gallery video play)
9. [ ] Implement quest completion detection + credit reward claim
10. [ ] Add step completion pulse/toast feedback
11. [ ] Mobile responsive layout for quest panel
12. [ ] Backend tests: progress derivation, achievement recording, reward claiming
13. [ ] Frontend tests: panel display, step completion UI, reward flow

## Acceptance Criteria

- [ ] Both quests visible in slide-out panel from header icon
- [ ] Progress badge shows completed/total steps
- [ ] Steps show completed (checkmark) or incomplete state with title + description
- [ ] Derived steps auto-complete when data exists (games, clips, exports, auth)
- [ ] Achievement-based steps complete when user performs the action
- [ ] Quest completion grants 10 credits (via T530 credit system)
- [ ] Reward can only be claimed once per quest
- [ ] Step completion pulses the header icon
- [ ] Quest panel follows existing slide-out pattern (mutual exclusion with Gallery)
- [ ] Mobile responsive (bottom sheet)
- [ ] Step definitions are data-driven (config array, not hardcoded UI)
