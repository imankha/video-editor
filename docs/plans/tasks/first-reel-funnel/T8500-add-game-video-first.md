# T8500: Add Game: video first, cost up front

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

Cliff 1: 50% of users who reach the upload step never start an upload. The Add Game
modal puts FOUR required fields (Opponent Team, Game Date, Game Type, Video Format)
above the video picker, contradicting the landing page's step 1 ("Upload your game
footage"). "2 credits for 30 days of storage" appears only AFTER a file is picked, the
first mention of credits or expiry anywhere in the product. The "88" credits chip on
home has no first-run explanation.

## Solution

- Reorder: the video picker is the first and dominant element. Metadata fields become
  deferrable (collapsed "Add game details" section, editable after upload starts).
  Opponent/date keep sensible defaults so upload can start with zero typing.
- Cost and expiry disclosed BEFORE file selection, next to the picker ("2 credits,
  keeps your video for 30 days, balance 88").
- One-time first-visit explainer on the credits chip ("You start with 88 free credits").
- IMPORTANT coordination: the Game Pools epic's T5495 (Add Game Overhaul) already
  redesigns this modal (video optional at create, folder upload, "Per Half"/Video
  Format control REMOVED with evidence). T5495 is sequenced far later (behind T7140).
  This task takes the cheap subset NOW (reorder + disclosure + defaults) without
  contradicting T5495's decisions: do not add new prominence to the Video Format
  control (T5495 deletes it); keep changes rebase-friendly.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - Add Game modal host
- Add Game form component (locate: grep "Add New Game" / "Opponent Team")
- `src/frontend/src/components/CreditBalance.jsx` - credits chip explainer
- e2e: new-user upload flow spec

### Related Tasks
- Subset-of/coordinates-with T5495 (dual-camera epic); T5495 supersedes this UI later
- T8460 (update wall) removes the other cliff-1 blocker

## Implementation

### Steps
1. [ ] Reorder form: picker first, cost line above it, metadata collapsed with defaults
2. [ ] Credits chip one-time explainer (session-scoped or derived from account age; no new persisted view state)
3. [ ] e2e: file-pick-first path starts an upload with zero typed fields
4. [ ] 390x844 pass: picker + submit visible without scrolling

## Acceptance Criteria

- [ ] A user can start an upload with one tap on the picker and one on submit, no typing
- [ ] Credits + 30-day expiry visible before file selection
- [ ] No new prominence for controls T5495 deletes
- [ ] Verified at 390x844
