# T16180: AI marking for uploaded games

## In plain words

After the upload checkbox exists, a parent who did not tick it, or whose games (full match videos) were uploaded before the feature shipped, has no way to get their plays marked by the AI. We will offer the same thing from the game itself: an entry in the game tile's menu, a card next to Mark play on the game's page, and a line in the empty play list. Each opens one sheet with the pitch, the exact price for that game and the parent's balance, and starts the analysis on confirm. Parents with a backlog of unmarked games are the people most likely to want this, and the owner asked for it. Done when a parent can start and pay for an analysis on any stored game from a phone or desktop, and a game that already has one never offers to sell it again.

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend entry points and one sheet; reuses T16160's endpoints and T16170's progress)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 5 of 7.

## Problem

193 users have put footage in and 109 marked a play. Every game uploaded without the box ticked is a game whose owner still faces the full scrub, and the upload dialog is closed to them.

## Solution

Build section 4, "Starting on a game already uploaded", of [UX-FEEDBACK.md](UX-FEEDBACK.md), with section 2 for a short balance.

1. **Entry points.** Game tile menu ("Mark plays with AI"), an action card beside Mark play on the Annotate page, and a prompt in the empty play list. All open the same sheet.
2. **The sheet.** Pitch, honesty line, Gemini disclosure, price for this game's minutes, balance and balance after, Confirm. If the sport is not set it asks first, with the chooser from T16130. A short balance offers the covering pack and resumes after payment.
3. **States.** Already analysed for this parent: the entry points become "See AI plays" or lead to the team colour step. Running: they show progress. Stored video expired: the sheet explains that the video must be stored to be analysed and offers the existing extend-storage action. Not available (switch off, cap reached, sport not supported, too long): a plain reason.
4. **After confirm.** The same progress, toast and email as T16170.
5. **Measure.** `ai_start_sheet_opened` with the entry point in context.

## Why this and not something else

A separate "AI" page listing all games was ruled out: the parent is already looking at the game they want marked. Running the analysis automatically on old games and charging on import was ruled out because cost must be agreed before any model call.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/analysis/StartAnalysisSheet.jsx` (new; the pitch and cost blocks are shared with `GameDetailsModal` from T16170, extract on this second use only if a third appears, see the refactoring rule on abstraction)
- `src/frontend/src/components/GameTile.jsx`, `ProjectManager.jsx` (menu entry next to "Add video")
- `src/frontend/src/modes/annotate/AnnotateModeView.jsx` (ActionCard grid near the Mark play card), `ClipsSidePanel.jsx` (empty list)
- `src/frontend/src/stores/analysisStore.js`, `hooks/useGameAnalysis.js` (from T16170)
- `src/frontend/src/components/instructions/displayNames.js`, `resolveGuide.js`

### Technical Notes
- Quote and buy are T16160's `GET /api/games/{id}/analysis-quote` and `POST /api/games/{id}/analysis`; no backend work is expected beyond the storage-expired reason if the quote does not already carry it.
- The fresh-game "simplified" layout (T11860) hides extra controls; the new action card must be visible there, since a fresh game is exactly where it matters.
- A game shared in from another parent can be analysed like any other; the stored result is keyed on the video, so it is often already there.
- Confirm is the gesture that buys. Nothing is bought on sheet open.

### Related Tasks
- Depends on: T16130, T16160, T16170.

## Acceptance Criteria

- [ ] A stored game with no analysis offers "Mark plays with AI" from the tile menu, the Annotate action card and the empty play list, at 390 px and on desktop.
- [ ] The sheet shows the same price the server charges for that game.
- [ ] Confirm starts the analysis and shows the same progress states as an upload-time purchase.
- [ ] A game whose analysis is ready or running never shows a buy action.
- [ ] A game whose stored video expired explains why and offers to extend storage.
- [ ] With no sport set, the sheet asks for the sport before showing a price.
- [ ] A short balance leads to buying credits and returns to the sheet with the purchase completed on confirm.
