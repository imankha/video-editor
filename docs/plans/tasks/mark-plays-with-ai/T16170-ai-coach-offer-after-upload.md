# T16170: AI Coach offer after upload

## In plain words

Today the upload dialog asks for a few details about the game (the full match video), shows a small storage cost in credits, and uploads. After that the parent marks every play (a moment worth keeping) by hand. We will leave the upload dialog exactly as it is. As soon as the upload is running, a separate dialog offers AI Coach: a video model watches the whole game and marks the team's plays, each with tags, a rating and a coaching note. The dialog shows examples of real AI plays from other games, the exact price for this game, and the promise that one payment covers the whole team, because a game with AI Coach can be shared with other families for free. The parent is waiting for the upload anyway, so this is a moment with their attention, and saying no or running short of credits can never hold up or lose the upload. Afterwards the game says truthfully what is happening, for example "11 of 18 sections watched", and an email arrives when the plays are ready. Done when a parent can start an upload, accept the offer, pay, leave, come back and find the analysis ready, and every state shown matches what the server is doing.

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** L (offer dialog, upload hand-off, progress surfaces, email; 6+ files across two layers)
**Created:** 2026-11-12
**Updated:** 2026-11-14

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 5 of 10. The owner ruled on the offer dialog on 2026-11-14 (UX-FEEDBACK.md section 9, rulings 12 to 16) and approved the short-of-credits flow (section 2) and progress (section 3). The redrawn dialog is approved, with the free-share panel as a gold ribbon (ruling 22).

## Problem

The engine (T16150) and the charge (T16160) exist but a parent cannot reach them. The moment a parent is most willing to pay to skip ninety minutes of scrubbing is the moment they hand over the game. A checkbox inside the upload dialog would sit among form fields with three lines of text, and a feature that is meant to spread from family to family needs room to show what it does and to say that it can be shared for free.

## Solution

Build what [UX-FEEDBACK.md](UX-FEEDBACK.md) defines in sections 1 ("The AI Coach offer"), 2 ("Not enough credits") and 3 ("Honest progress"). Do not invent copy; lift strings from its section 8 table. In outline:

1. **When it opens.** The parent taps Upload in the unchanged upload dialog. The upload starts, and the offer opens over the Games tab with the upload carrying on behind it. It opens once per upload. It does not open when AI Coach cannot be bought for this game (sport not supported, paused, full for today, length unreadable); those games offer it later from the game itself (T16180).
2. **What it shows.** The name and the one-line promise; a carousel of example plays from real analysed games of the same sport, each a picture with its tags, rating and coaching note, labelled as examples and changing every 5 seconds; three benefit lines; the free-share promise in its own gold-ribbon panel with the label "FREE FOR YOUR TEAM"; the price for this game, the balance and the balance after; and the upload's real progress in one small line. The owner removed three pieces of small print from the dialog on 2026-11-14: the "Good to know" paragraph, the line about Google's Gemini service, and the note about credits being set aside. What they described still happens, and the terms page says where the video is analysed.
3. **Two answers.** "Add AI Coach: 135 credits" or "Not now". The dialog closes only by one of these or its close button. "Not now" says where the offer lives afterwards.
4. **Sport.** If the athlete's profile has no sport, the dialog asks for it with the chooser from T16130 before showing a price.
5. **Short of credits.** The dialog names the shortfall and the smallest pack that covers it. Buying that pack from the dialog also adds AI Coach, with no second tap (owner, 2026-11-14). There is nothing to fall back to and nothing to lose: the upload is already running.
6. **Start.** Accepting is the gesture that buys. The choice travels with the upload, and when the upload is activated the analysis is bought (T16160) in the same step. Credits are set aside only then. The parent can cancel free of charge until the upload finishes.
7. **Already analysed.** The app learns a few seconds into the upload whether this exact video has a stored analysis. If it has, the dialog says the plays will be ready right after the upload, for the same price.
8. **Not nagging.** A parent who answers "Not now" three uploads in a row stops getting the dialog automatically. The offer stays on every game without AI Coach (T16180), and accepting it there turns the dialog back on.
9. **Progress.** On the game tile and at the top of the game's Annotate page: the real stage and the real count of sections watched, a labelled time estimate, and "you can leave". Failure says the credits were not taken.
10. **Ready.** A toast if the parent is in the app, and an email that respects the email opt-out. Both lead to the team colour step (T16190), and the email carries the free-share line.
11. **Measure.** How many uploaders were shown the offer, accepted it, said not now, or closed it, so the Journey shows the offer's take-up.

## Why this and not something else

A checkbox in the upload dialog was the first design. It was replaced (owner, 2026-11-14) because the offer is also the feature's advertisement, including the free share, and a checkbox row has no room for either. It also tied buying to uploading: a parent short of credits had to choose between paying and uploading without it, and the upload dialog needed an itemised bill and a required sport step. With the offer after the upload has started, none of that is needed.

Offering it only later, from the game, was ruled out: the parent's attention is highest while they wait for the upload.

A smooth percentage bar was ruled out because the first stage has no measurable percentage; real counts and labelled estimates are the honest alternative.

## How we will know it worked

A parent on a phone starts an upload, accepts the offer, leaves, and returns to plays that are ready. The Journey shows what share of uploaders accepted.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/analysis/AICoachOfferDialog.jsx` (new; one component, also opened by T16180's entry points with `context="game"`)
- `src/frontend/src/components/GameDetailsModal.jsx` (unchanged layout; its submit handler opens the offer once the upload has been handed to the upload manager)
- `src/frontend/src/components/BuyCreditsModal.jsx` (preselected pack, neutral reason panel, return to the offer)
- `src/frontend/src/stores/uploadStore.js`, `services/uploadManager.js` (carry the accepted option to activation; expose the upload percentage and the fingerprint result to the dialog)
- `src/frontend/src/stores/analysisStore.js` (new), `hooks/useGameAnalysis.js` (new)
- `src/frontend/src/components/GameTile.jsx`, `UploadingGameTile.jsx`, `shared/SegmentedProgressStrip.jsx`
- `src/frontend/src/modes/annotate/AnnotateModeView.jsx` (status card)
- `src/frontend/src/components/instructions/displayNames.js` (copy), `resolveGuide.js` and `.claude/knowledge/guidance.md` (the zero-plays coach rule must not pulse Mark play while an analysis runs; no coach pulse competes with the open offer)
- `src/backend/app/routers/games.py` (`activate`: accept the option, call the buy path), `services/email.py` (new email next to `send_game_ready_email`)
- `src/frontend/src/utils/analysisCost.js` (from T16160)

### Technical Notes
- Duration is probed in the browser at pick time (`useFootageIntake`), so the exact price is known when the dialog opens. If it cannot be probed the dialog does not open.
- Persistence rule: the analysis starts from the "Add AI Coach" tap, carried to activation. Never from an effect watching upload state. If the upload has already been activated when the parent accepts, the same tap calls the buy path directly.
- The dialog is portalled to `document.body` and closes only by its buttons or X. It must survive the Games tab re-rendering as the upload tile updates.
- The examples are a bank of fixed assets keyed by sport (for each: a still frame and the time, tags, rating and note of one real AI play), not a live query. Soccer ships with six that the owner chose from the first approved prototype run (T16145); a sport with no bank shows no example. Each is labelled as an example from another game. The carousel advances every 5 seconds, shows dots, changes on swipe or dot tap, and its timer stops on touch, on focus, while the dialog is hidden and under `prefers-reduced-motion`. Preload the next frame so the change never shows an empty box while the upload is using the connection.
- The "three in a row" count and the "shown for this upload" mark are per-account preferences stored by the dismiss and accept gestures; they are not view state, because they must hold across devices.
- The redirect fallback of `BuyCreditsModal` (no Stripe key) only resumes exports today; in that path keep the offer's state so the choice survives, or disable the fallback for this flow.
- Progress comes from T16150's status read; follow the frontend rule on WebSockets over polling as decided in T16150's design.
- The whole feature sits behind the epic's feature flag; with the flag off no dialog opens.
- The game-ready email already goes out after activation; do not send two emails within minutes. If an analysis was bought, the AI Coach email replaces it or the game-ready email gains a line (decide with the copy in UX-FEEDBACK.md section 3).
- Events: `ai_offer_shown`, `ai_offer_accepted`, `ai_offer_dismissed` (context: not now or closed), each with the context `upload`.

### Related Tasks
- Depends on: T16130 (sport chooser), T16145 (the six soccer examples), T16150 (status), T16160 (quote, buy). Blocks: T16180 (shares the dialog and the progress pieces), T16202 (the offer carries the free-share promise).

## Acceptance Criteria

- [ ] The upload dialog looks and behaves exactly as it does today, with the flag on or off.
- [ ] After Upload is tapped on a 90-minute game, the offer opens while the upload runs and shows 135 credits, the balance and the balance after.
- [ ] The offer shows the free-share panel above pinned buttons on a 390 px screen, and contains no "Good to know" paragraph, no Gemini line and no set-aside note.
- [ ] The example changes every 5 seconds through the bank for the game's sport, can be changed by swipe or by its dots, and does not move by itself when the device asks for reduced motion.
- [ ] "Not now" and the close button charge nothing, and the upload finishes normally.
- [ ] With no sport on the profile, the offer asks for the sport first; picking soccer shows the price.
- [ ] A parent short by N credits sees the shortfall and the smallest covering pack and buys it in place; AI Coach is then added without another tap, and the upload was never interrupted.
- [ ] Accepting before the upload finishes sets no credits aside until activation; cancelling before then charges nothing.
- [ ] After upload, the tile and the Annotate page show the server's stage and section count; the count never exceeds or precedes the server's.
- [ ] Reloading or returning the next day shows the current state; a ready analysis leads to the team colour step.
- [ ] A failed analysis shows that no credits were taken, and the balance confirms it.
- [ ] Exactly one email is sent when the plays are ready, and none to a user who opted out.
- [ ] A video with a stored analysis says so in the offer once the upload has identified it, and is ready within seconds of activation.
- [ ] After three "Not now" answers in a row the offer no longer opens by itself, and accepting AI Coach from a game turns it back on.
- [ ] The terms page says that a game sent for AI Coach is analysed by Google's Gemini service.
- [ ] `ai_offer_shown`, `ai_offer_accepted` and `ai_offer_dismissed` appear in the admin Journey inspector.
- [ ] Works at 390 px and on desktop; with the flag off no offer opens.
