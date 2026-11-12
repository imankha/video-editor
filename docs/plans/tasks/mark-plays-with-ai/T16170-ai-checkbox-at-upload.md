# T16170: AI checkbox at upload

## In plain words

Today the upload dialog asks for a few details about the game (the full match video), shows a small storage cost in credits, and uploads. After that the parent marks every play (a moment worth keeping) by hand. We will add one checkbox, "Mark plays with AI", sold as a coach's eye on every play. Ticking it shows the exact extra cost for this video before anything is uploaded, and if the parent is short of credits they can buy more on the spot and the upload carries on, or continue without the AI. Once the upload finishes, the game's tile and its page say truthfully what is happening, for example "11 of 18 sections watched", and an email arrives when the plays are ready, so the parent can leave. Done when a parent can tick the box, pay, leave, come back and find the analysis ready, and every state shown matches what the server is doing.

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** L (upload dialog, activation hook, progress surfaces, email; 6+ files across two layers)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 4 of 7.

## Problem

The engine (T16150) and the charge (T16160) exist but a parent cannot reach them. The moment a parent is most willing to pay to skip ninety minutes of scrubbing is the moment they hand over the game, and that is where the offer has to be.

## Solution

Build exactly what [UX-FEEDBACK.md](UX-FEEDBACK.md) defines in sections 1 ("The offer at upload"), 2 ("Not enough credits") and 3 ("Honest progress"). Do not invent copy; lift strings from its section 8 table. In outline:

1. **The offer.** A checkbox, unticked by default, with the pitch, the honesty line (it marks plays for the team; it does not know which player is theirs; it can miss plays) and one line saying the video is sent to Google's Gemini service.
2. **The price.** Before a file is picked, the rate. After, an itemised cost: storage, AI analysis for N minutes, total, balance, balance after. If this video already has a stored analysis, say it will be ready right after upload.
3. **Sport.** If the athlete's profile has no sport, the dialog's sport field becomes required once the box is ticked, using the chooser from T16130. A sport that is not supported yet gets a plain "soccer only for now" and the upload continues without AI.
4. **Short of credits.** Name the shortfall and the smallest pack that covers it; buying resumes the upload with the box still ticked; "Upload without AI" is always offered.
5. **Start.** When the upload is activated with the box ticked, the analysis is bought (T16160) in the same step. If the purchase cannot be made at that moment, the upload still succeeds and the game offers the analysis later (T16180).
6. **Progress.** On the game tile and at the top of the game's Annotate page: the real stage and the real count of sections watched, a labelled time estimate, and "you can leave". Failure says the credits were not taken.
7. **Ready.** A toast if the parent is in the app, and a "Your plays are marked" email that respects the email opt-out. Both lead to the team colour step (T16190).
8. **Measure.** `ai_offer_shown` and `ai_offer_ticked` so the Journey shows how many uploaders see and take the offer.

## Why this and not something else

Offering the analysis only after upload was ruled out by the owner: the cost must be visible, and rise, at upload time. A smooth percentage bar was ruled out because the first stage has no measurable percentage; real counts and labelled estimates are the honest alternative.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameDetailsModal.jsx`, `GameDetailsFields.jsx`, `components/shared/CreditCostRow.jsx`
- `src/frontend/src/components/BuyCreditsModal.jsx` (resume with the option still ticked)
- `src/frontend/src/stores/uploadStore.js`, `services/uploadManager.js` (carry the option to activation)
- `src/frontend/src/stores/analysisStore.js` (new), `hooks/useGameAnalysis.js` (new)
- `src/frontend/src/components/GameTile.jsx`, `UploadingGameTile.jsx`, `shared/SegmentedProgressStrip.jsx`
- `src/frontend/src/modes/annotate/AnnotateModeView.jsx` (status band)
- `src/frontend/src/components/instructions/displayNames.js` (copy), `resolveGuide.js` and `.claude/knowledge/guidance.md` (the zero-plays coach rule must not pulse Mark play while an analysis runs)
- `src/backend/app/routers/games.py` (`activate`: accept the option, call the buy path), `services/email.py` (new email next to `send_game_ready_email`)
- `src/frontend/src/utils/analysisCost.js` (from T16160)

### Technical Notes
- Duration, width and height are probed in the browser at pick time (`useFootageIntake`), so the exact price is known before upload. A file whose duration cannot be probed shows the rate and the price is fixed at activation; the dialog says so.
- Persistence rule: the analysis starts from the Upload gesture (carried to activation). Never from an effect watching upload state.
- The redirect fallback of `BuyCreditsModal` (no Stripe key) only resumes exports today; in that path keep the dialog's state so the option survives, or disable the fallback for this flow.
- Progress comes from T16150's status read; follow the frontend rule on WebSockets over polling as decided in T16150's design.
- The whole feature sits behind the epic's feature flag; with the flag off the dialog is unchanged.
- The game-ready email already goes out after activation; do not send two emails within minutes. If an analysis was bought, the plays-marked email replaces it or the game-ready email gains a line (decide with the copy in UX-FEEDBACK.md section 3).

### Related Tasks
- Depends on: T16130 (sport chooser), T16150 (status), T16160 (quote, buy). Blocks: T16180 (shares the sheet and the progress pieces).

## Acceptance Criteria

- [ ] With a 90-minute file picked, ticking the box changes the cost from storage only to storage plus 135 credits, itemised, with the balance after.
- [ ] With no sport on the profile, ticking the box makes the sport field required; picking soccer lets the upload proceed.
- [ ] A parent short by N credits sees the shortfall and the smallest covering pack, buys it in place, and the upload proceeds with AI still ticked.
- [ ] "Upload without AI" uploads the game and charges storage only.
- [ ] After upload, the tile and the Annotate page show the server's stage and section count; the count never exceeds or precedes the server's.
- [ ] Reloading or returning the next day shows the current state; a ready analysis leads to the team colour step.
- [ ] A failed analysis shows that no credits were taken, and the balance confirms it.
- [ ] Exactly one email is sent when the plays are ready, and none to a user who opted out.
- [ ] A video with a stored analysis says so before upload and is ready within seconds of activation.
- [ ] The box is unticked when the dialog opens.
- [ ] The terms page says that a game sent for AI play marking is analysed by Google's Gemini service.
- [ ] Works at 390 px and on desktop; with the flag off the dialog is unchanged.
