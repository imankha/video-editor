# T16180: AI Coach for uploaded games

## In plain words

AI Coach is offered in a dialog while a game (the full match video) uploads. A parent who said "Not now" there, or whose games were uploaded before the feature shipped, has no other way to get their plays (moments worth keeping) marked by the AI. We will offer the same thing from the game itself: an "AI Coach" card next to Mark play on the game's page, an entry in the game tile's menu, and a line in the empty play list. Each opens the same offer dialog, with the example, the free-share promise, the exact price for that game and the parent's balance, and starts the analysis on confirm. Parents with a backlog of unmarked games are the people most likely to want this, and the owner asked for a button inside the game's page. Done when a parent can start and pay for an analysis on any stored game from a phone or desktop, and a game that already has AI Coach never offers to sell it again.

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend entry points; reuses T16160's endpoints and T16170's dialog and progress)
**Created:** 2026-11-12
**Updated:** 2026-11-14

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 6 of 10. Section 4 of UX-FEEDBACK.md was redrawn on 2026-11-14 to use the offer dialog and waits for the owner's approval.

## Problem

193 users have put footage in and 109 marked a play. Every game without AI Coach is a game whose owner still faces the full scrub, and once the upload is over the offer dialog is gone.

## Solution

Build section 4, "Starting on a game already uploaded", of [UX-FEEDBACK.md](UX-FEEDBACK.md), with section 2 for a short balance.

1. **Entry points.** The owner ruled on 2026-11-14 that AI Coach is not one of the main action cards on the Annotate page: a parent who skipped it at upload has shown it is a lower priority. The UX designer drew, and the owner approved the same day, one quiet line under the four cards, "Let AI Coach mark the plays", and an item in the game tile menu; the empty play list gets no link. Both open the offer dialog from T16170. After the purchase the line is hidden and the status card above the action cards carries the progress, the team choice and "Tag players". The screens are in UX-FEEDBACK.md section 4.
2. **The dialog.** The same one as at upload, with two differences: there is no upload progress line, and it shows a labelled estimate of how long the analysis takes. If the sport is not set it asks first, with the chooser from T16130. A short balance offers the covering pack and returns to the dialog after payment.
3. **States.** Has AI Coach already, bought or received through a share: the entry points lead to the team colour step or the Tag players pass, never to a price. Running: they show progress. Stored video expired: the dialog explains that the video must be stored to be analysed and offers the existing extend-storage action. Not available (switched off, daily limit reached, sport not supported, too long): a plain reason.
4. **After confirm.** The same progress, toast and email as T16170.
5. **Measure.** The same three offer events as T16170, with the entry point in context.

## Why this and not something else

A separate "AI" page listing all games was ruled out: the parent is already looking at the game they want marked. Running the analysis automatically on old games and charging on import was ruled out because cost must be agreed before any model call. A second, smaller sheet for this case was the earlier design; one dialog is less to build and makes the same pitch, including the free share, wherever the parent meets it.

## How we will know it worked

A parent opens a game uploaded last month on a phone, taps the AI Coach line under the action cards, confirms, and sees the same progress as an upload-time purchase.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/analysis/AICoachOfferDialog.jsx` (from T16170; add `context="game"` behaviour: estimate line instead of upload line, storage-expired and already-owned states)
- `src/frontend/src/components/GameTile.jsx`, `ProjectManager.jsx` (menu entry next to "Add video")
- `src/frontend/src/modes/annotate/AnnotateModeView.jsx` (ActionCard grid near the Mark play card), `ClipsSidePanel.jsx` (empty list)
- `src/frontend/src/stores/analysisStore.js`, `hooks/useGameAnalysis.js` (from T16170)
- `src/frontend/src/components/instructions/displayNames.js`, `resolveGuide.js`

### Technical Notes
- Quote and buy are T16160's `GET /api/games/{id}/analysis-quote` and `POST /api/games/{id}/analysis`; no backend work is expected beyond the storage-expired reason if the quote does not already carry it.
- The fresh-game "simplified" layout (T11860) hides extra controls; the AI Coach line must be visible there, since a fresh game is exactly where it matters. The line reuses the "Share with tagged teammates" row pattern under the `ActionCard` grid; the grid itself is not changed.
- A game shared in from another parent who has AI Coach already has it (T16202), so it never shows a price. A game shared in without AI Coach can be analysed like any other; the stored result is keyed on the video, so it is often already there.
- Confirm is the gesture that buys. Nothing is bought on dialog open.
- Accepting here resets the "three Not now in a row" count from T16170.

### Related Tasks
- Depends on: T16130, T16160, T16170. Blocks: T16202.

## Acceptance Criteria

- [ ] A stored game without AI Coach offers it from the line under the Annotate action cards and from the tile menu, at 390 px and on desktop; the four action cards are unchanged.
- [ ] All three open the same dialog as the upload-time offer, without an upload line and with a labelled time estimate.
- [ ] The dialog shows the same price the server charges for that game.
- [ ] Confirm starts the analysis and shows the same progress states as an upload-time purchase.
- [ ] A game whose analysis is ready or running, or that received AI Coach through a share, never shows a buy action.
- [ ] A game whose stored video expired explains why and offers to extend storage.
- [ ] With no sport set, the dialog asks for the sport before showing a price.
- [ ] A short balance leads to buying credits and returns to the dialog with the purchase completed on confirm.
