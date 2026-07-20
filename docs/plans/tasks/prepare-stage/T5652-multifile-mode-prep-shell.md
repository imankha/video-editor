# T5652: `VideoMode.MULTI_FILE` ("Multiple Files") + client-side Prep workspace shell

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 2/7)

## Epic Context
See [EPIC.md](EPIC.md) + study section 0. This is the user-facing entry point (progressive
disclosure - the 95% clean-Veo users never see Prep).

## Problem
There is no way to bring in many files. Game creation offers only Full Game / Per Half.

## Solution
- Add `VideoMode.MULTI_FILE: 'multi_file'` to `gameConstants.js` + backend `constants.py`; third
  toggle labeled **"Multiple Files"** in `GameDetailsModal.jsx` (beside "Full Game" / "Per Half").
- Selecting it + choosing a folder (or multi-select) opens a **full-screen client-side Prep**
  workspace shell (MVC: Screen -> Container -> View, per frontend CLAUDE.md). Shell only in this
  task: timeline area, file list (rail), preview pane, action bar (Create). The engine (assemble/
  trim/concat/upload) is T5653; preview + markers are T5656.
- Reuse the existing modal's game-details fields (opponent/date/type) and storage-credit display.

## Context
### Relevant Files
- `src/frontend/src/components/GameDetailsModal.jsx` (mode toggle L385-386, file inputs, cost).
- `src/frontend/src/constants/gameConstants.js` (`VideoMode` L13-16), backend `app/constants.py`.
- New: Prep screen/container/view under `src/frontend/src/modes/` or `src/screens/` (follow MVC).

### Related Tasks
- Depends on nothing hard; pairs with T5651. Blocks T5653/T5656 (they fill the shell).

### Technical Notes
- No persisted view state (filters/order are ephemeral until Create). Folder pick uses
  `webkitdirectory` / File System Access API; large-file handles held, not read into memory.

## Acceptance Criteria
- [ ] "Multiple Files" mode selectable; folder pick opens the Prep shell.
- [ ] Full Game / Per Half flows byte-identical to today.
- [ ] Shell renders file rail + timeline + preview + Create bar (no engine yet).
