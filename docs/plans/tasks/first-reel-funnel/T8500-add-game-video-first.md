# T8500: Add Game: video first, cost up front

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

Cliff 1: 50% of users who reach the upload step never start an upload. The Add Game
modal (`src/frontend/src/components/GameDetailsModal.jsx`, heading "Add New Game" at
line 258) puts FOUR required fields above the video picker: Opponent Team* (line 274),
Game Date*, Game Type* (Home/Away/Tournament), Video Format* (Full Game/Per Half). The
credits line - "`${uploadCost} credit(s) for 30 days of storage`" (line 534) - renders
only AFTER a file is selected, which is the first mention of credits or expiry anywhere
in the product. The header "88" chip (`CreditBalance.jsx`) has no first-run explanation.

The landing page's step 1 is "Upload your game footage" - one action. Prod evidence at
exactly this step: rogerio.klein (desktop, 4 sessions, 31 engaged minutes, zero game
rows), bug #18.

## What to build

All changes inside GameDetailsModal.jsx (plus a small CreditBalance change). No backend
change: `POST /api/games` keeps its current contract; we default fields client-side.

### Step 1 - reorder the modal body

New top-to-bottom order in the create-mode form:
1. Cost line (moved UP, always visible, no file required):
   "2 credits - keeps your video for 30 days - balance {N}"
   (reuse the existing uploadCost + balance values that line 534 renders; show before
   file selection instead of after; keep the exact placement/style tokens of the
   current credits row)
2. The dropzone ("Click or drag to upload video / MP4, MOV, or WebM") - now the first
   interactive element, visually dominant.
3. A collapsed details disclosure: "Game details (optional - you can edit these later)"
   containing Opponent Team, Game Date, Game Type, Video Format, all with defaults
   (see Step 2). Use a native details/summary or the codebase's existing collapse
   pattern (grep for an existing Disclosure/Collapsible in components/shared - reuse,
   don't invent).
4. Submit button (unchanged handler).

### Step 2 - defaults so zero typing is required

- Opponent Team: default `""` -> submit as "Unnamed opponent" if empty, OR relax the
  client-side required check and let the game name fall back to date-only. DECISION
  RULE: read what `POST /api/games` (src/backend/app/routers/games.py, create_game)
  actually requires; if opponent is server-required, send the placeholder client-side.
  The game tile name derives from opponent+date ("Vs Carlsbad SC Aug 30") - a
  placeholder yields "Vs Unnamed opponent Sep 3", acceptable, editable later via
  EditGameModal.jsx (already exists).
- Game Date: default today (the common case is uploading right after the game).
- Game Type: keep existing default (Home preselected today - verify; if not, default
  Home).
- Video Format: keep Full Game as the default. Per the Game Pools directive (T5495
  will DELETE this control, evidence-based), give it NO new prominence: it stays
  inside the collapsed details section, unchanged otherwise.
- The submit button's disabled logic changes from "all four fields + file" to
  "file selected". Field validation only applies to fields the user actually opened.

### Step 3 - credits chip first-run explainer

In `CreditBalance.jsx`: when the account has never uploaded a game (derive: games list
empty - the chip's parent has access to games via props/store; if not, use
credits === starting balance as the proxy and comment it), render a one-time inline
caption or pointer-tooltip: "You start with 88 free credits". Dismiss forever on any
click, stored IN MEMORY ONLY plus derivable state (once a game exists it never shows
again) - NO persisted view state (feedback rule: no-persisted-view-state), NO
localStorage (project rule).

### Step 4 - tests

- `GameDetailsModal.beacon.test.jsx` exists (analytics beacons on open/file-select) -
  keep those beacons firing from the same gestures after the reorder
  (`add_game_opened`, `upload_file_selected` - grep the achievement POSTs).
- New tests: (a) submit enabled with file only, (b) defaults land in the POST body,
  (c) cost line visible before any file is selected, (d) details disclosure closed by
  default in create mode, open in edit mode (EditGameModal unaffected).
- e2e: extend the new-user upload spec - pick file -> submit with zero typing ->
  lands in Annotate uploading (the existing flow from the walkthrough).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameDetailsModal.jsx` (form ~258-560; credits line 534)
- `src/frontend/src/components/CreditBalance.jsx` - explainer
- `src/frontend/src/components/EditGameModal.jsx` - reference only (edit path stays)
- `src/backend/app/routers/games.py` - read-only: confirm required fields
- Tests: `GameDetailsModal.beacon.test.jsx`, `ProjectManager.addGameBeacon.test.jsx`

### Related Tasks
- Subset-of/coordinates-with T5495 (dual-camera epic, sequenced much later): T5495
  makes video optional + deletes Video Format entirely. This task must not add
  prominence to what T5495 deletes; the collapsed-details pattern is compatible.
- T8460 removes the other cliff-1 blocker (update wall). Ship both before re-measuring
  cliff 1.

## Acceptance Criteria

- [ ] A user can start an upload with two gestures: tap dropzone/pick file, tap submit
- [ ] Credits + 30-day expiry visible BEFORE file selection, exact copy above
- [ ] All four metadata fields defaulted + collapsed; editable later via Edit Game
- [ ] Analytics beacons unchanged (opened / file-selected fire as today)
- [ ] Credits chip explainer shows for zero-game accounts only, never persists state
- [ ] Tests above green; e2e zero-typing path passes
- [ ] At 390x844 and 320px: dropzone + submit visible without scrolling (T8550 asserts)
