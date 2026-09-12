# T9575: Onboarding quest-walkthrough vocabulary sweep

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-11
**Updated:** 2026-09-11

## Source

Filed by **T9570** (cross-surface naming audit, closing the Shared Vocabulary epic). The audit
found the onboarding **quest walkthrough** copy still carries pre-epic vocabulary — a surface no
sibling task swept, because T9560 (the onboarding-vocabulary owner) scoped the quest STEP copy OUT
and named the residuals for the audit to reconcile. See
`docs/plans/tasks/shared-vocabulary/T9570-audit-results.md`.

## Problem

The guided-onboarding narrative in `questDefinitions.jsx` (Quest 1–4 STEP_TITLES /
STEP_DESCRIPTIONS) still describes the flow with the object names the epic renamed, so the tutorial
tells the user to do things by names the actual controls no longer use. It is the last cluster of
pre-epic vocabulary on a live user-facing surface. Because this copy **describes real flow
behavior** (e.g. "Notice **My Athlete** and **Create Reel** are switched on. Then **Save**." names
three controls that N28/N07/N08 renamed), it is a coherent narrative task, not a blind string swap —
which is why the audit filed it instead of editing it inline.

## Observed stragglers (from the T9570 audit)

`src/frontend/src/config/questDefinitions.jsx`:

| Where | Current | Epic target | Group |
|-------|---------|-------------|-------|
| `STEP_TITLES.upload_game` | "Add Your First Game" | Upload game | N01 |
| `STEP_TITLES.add_clip` / desc | "Find an Amazing Play" / "click Add Play" | Mark play | N05 |
| `STEP_TITLES.annotate_brilliant` / desc | "Save Your Reel" / "My Athlete … Create Reel … Save … create a reel" | Save play / My player / Create clip | N08/N28/N07/N09 |
| `STEP_TITLES.choose_color` / desc | "Pick Your Highlight Color" | Spotlight color | N29 |
| `STEP_TITLES.choose_shape` / desc | "Pick Body or Ground" | Around player / Under player | N29 |
| `STEP_TITLES.export_overlay` | "Add the Spotlight" | Export clip with effects | N20 |
| various step titles/desc | single-clip "reel" narrative ("Open Your Reel", "Watch Your Reel") | clip vs reel per object | N09 |

`src/frontend/src/components/QuestPanel.jsx`:

- `:261-262` success toast **"Quest complete!"** / **"Keep going — more quests await!"** — the only
  place the user still meets the word **"quest"** on the SUCCESS path (N39 fixed only the failure
  path). **T9560 residual #1.** Decide: reword (e.g. "Step complete!") or record "quest" as an
  accepted internal noun on this surface. (Also: that string contains an em-dash, which violates the
  project-wide no-em-dash rule — fix regardless.)

Backend (`src/backend/app/services/quest_config.py`):

- `STEP_TITLES["move_to_my_reels"]` hardcodes **"Move to Highlight Reels"** where the frontend
  derives the same words from `SECTION_NAMES.LIBRARY`. They agree today; this is a **FE/BE sync
  point** — a future `LIBRARY` rename would silently drift the backend error copy. **T9560 residual
  #2.** Either derive/share the constant or add a test that asserts the two agree.

## Notes / constraints

- Quest **step ids** and backend `quest_config` step_ids are internal — do NOT rename them (standing
  epic rule). Only the user-facing titles/descriptions change.
- `TUTORIAL_VIDEOS_ENABLED = false` gates the four `watch_*_tutorial` steps out of the checklist;
  their copy is unreached today but should still be swept for when it flips back on.
- The `emptyStates.js` guide copy ("tap Add Play", "Focus pass") is T9390-**binding** approved copy
  ("do not paraphrase") that names the *flow*, not the exact control. If a coordinated pass is
  wanted, re-approve that copy explicitly rather than editing it under this task.
- This is copy that narrates behavior: verify each renamed reference against the live control it
  points at (e.g. the annotate create-clip toggle is now "Create an editable clip", not a "reel").

## Acceptance Criteria

- [ ] The quest walkthrough uses the epic's object model everywhere (play / clip / reel / player)
- [ ] No user-facing quest copy introduces "reel" for a single-clip object or "athlete" for a player
- [ ] The `QuestPanel` success toast no longer says "quest" (or the exception is recorded), and its
      em-dash is removed
- [ ] The FE/BE `move_to_my_reels` title is either shared from one source or guarded by a test
- [ ] Internal step ids unchanged; relevant test set green with output attached
