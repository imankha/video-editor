# AI Coach: user feedback spec

Status: sections 3, 5, 6, 7, 8 and 10 were approved by the owner on 2026-11-12, with the rulings in section 9. Sections 1, 2 and 4 were redrawn on 2026-11-14 and section 11 is new; those four wait for the owner's approval. Nothing here is built yet.

This file defines everything the parent sees and can do around the new paid option: the offer, the price, the shortfall, the waiting, the team choice, what lands in the game, the pass where they say which plays are their athlete's, and what another family gets when the game is shared with them. The option is called AI Coach everywhere the parent can see it. Each section is written in plain sentences first. Component and file pointers are in a short "For the implementer" list at the end of each section. Every visible string is repeated once in the table in section 8, which is the source to copy from.

Three things hold everywhere in this file:

1. Phone first. Every layout is designed at 390 px wide, then widened for desktop. Every tap target is at least 44 px tall.
2. Words follow the copy glossary: the parent's kid is "your athlete" (or the profile name, written `{athlete}` below), other kids are "teammates", a marked moment is a "play", the two groups of plays are "{athlete}'s plays" and "team plays". The task brief said "My player" and "Team line"; the app and the glossary say "My athlete" and "team plays", so this spec uses those (see ruling 3 in section 9: lane names stay exactly as the app shows them today).
3. We only show numbers that are real. No smooth fake percentage, no countdown we cannot keep.

Running example used throughout: a 90-minute game, 3 credits of storage, 135 credits of AI analysis.

---

## 1. The AI Coach offer

(Redrawn 2026-11-14. Waits for the owner's approval; see section 9, rulings 9 to 11.)

### What the parent sees

The upload dialog does not change at all: same order, same cost row, same Upload button. AI Coach is not mentioned in it.

When the parent taps Upload, the upload starts and the upload dialog closes as it does today. The offer then opens over the Games tab, with the upload carrying on behind it. The parent is waiting anyway, and nothing they do in the offer can stop or lose the upload.

On a phone the offer is a full-height sheet with its buttons pinned at the bottom; on desktop it is a centred dialog. It closes only by "Add AI Coach", "Not now" or its close button, never by a tap outside it.

Phone, 90-minute game, 200 credits, 3 credits of storage already agreed in the upload dialog:

```
+--------------------------------------------+
| AI Coach                                X  |
| Coach-level analysis of the whole game     |
|                                            |
| +----------------------------------------+ |
| | [ frame from the example play ]        | |
| | 34:12   Goal, Dribble       Brilliant  | |
| | Coach's note: Took on the full back at | |
| | speed and finished low.                | |
| | Example from another game              | |
| +----------------------------------------+ |
|                                            |
| - Watches the full game and marks your     |
|   team's best plays for you.               |
| - Every play gets tags, a rating and a     |
|   one-sentence summary.                    |
| - A coaching note for the players          |
|   involved: what to learn, or which pro    |
|   it looked like.                          |
|                                            |
| +----------------------------------------+ |
| | Pay once. Share it with your whole     | |
| | team for free.                         | |
| | Every family you share this game with  | |
| | gets AI Coach on it too, at no cost    | |
| | to them.                               | |
| +----------------------------------------+ |
|                                            |
| Good to know: it finds plays for the whole |
| team and cannot tell which player is       |
| yours, ... (full text in section 8)        |
| Your video is sent to Google's Gemini      |
| service to be analysed.                    |
+--------------------------------------------+
| AI Coach, 90 min              135 credits  |
| Storage, already agreed         3 credits  |
| Your balance                  200 credits  |
| Balance after both             62 credits  |
| Credits are set aside when the analysis    |
| starts and only taken when it finishes.    |
| If it fails, you get them all back.        |
| Uploading your game: 12%                   |
| [ Add AI Coach: 135 credits ]              |
| [ Not now ]                                |
| You can add it later from the game.        |
+--------------------------------------------+
```

- **The example** is one real play from a game the owner chose: a still frame, the time, the tags, the rating and the coaching note, exactly as an AI play looks in the app. It is labelled "Example from another game" so nobody takes it for a result from their own video.
- **The free-share box** is the only tinted panel in the dialog. It is the reason to buy for a team and the reason the feature spreads, so it gets its own box and a heading. It is cyan-tinted, not amber: it is a benefit, not a warning.
- **"Good to know"** is ordinary grey body text. The Gemini line is one size smaller. Both are always visible before the buttons can be reached on a phone, because the top part scrolls and the bottom part is pinned.
- **The upload line** shows the browser upload's real percentage, the one number the app already measures. It reads "Upload finished" once that is true.
- **The main button always carries the price.**

### What each answer does

- **Add AI Coach.** The dialog closes. A toast confirms: "AI Coach added. It starts when the upload finishes." The game tile gains the "AI next" chip (section 3, state A). No credits are set aside yet; that happens when the analysis starts, after the upload. The parent can cancel free of charge until then.
- **Not now**, or the close button. The dialog closes and nothing else happens. The offer stays on the game (section 4).
- If the upload has already finished when the parent taps "Add AI Coach", the analysis starts at once and the toast is the usual "The AI is now watching your game."

### When the offer opens, and when it does not

It opens once for each upload, after Upload is tapped. It never opens by itself at any other time.

A parent who answers "Not now" (or closes it) on three uploads in a row stops getting it automatically. The offer is still on every game. Buying AI Coach once, from anywhere, turns the automatic offer back on.

| Situation | What happens |
|---|---|
| Normal | The offer opens as drawn, with the exact price: the length is read from the file when it is picked. |
| Several videos for one game | One offer, one price, lengths added up and rounded up once. The price row reads "AI Coach, 90 min across 2 videos". |
| Sport not chosen on the profile | The offer opens. Above the price sits one step: "Which sport is this?" with the sport chooser. The main button is off and reads "Pick a sport to continue" until one is chosen. Choosing soccer shows the price in place. |
| Sport is not soccer | The offer does not open. |
| Length cannot be read from the file | The offer does not open. Once the upload has finished the server knows the length, and the game offers AI Coach (section 4). |
| Unavailable today (daily limit reached) or switched off | The offer does not open. The game's own entry points say why (section 4). |
| Already analysed (cache) | We learn this a few seconds into the upload. If the offer is open, the estimate is replaced in place by: "This game has already been analysed, so your plays will be ready right after the upload. Same price: 135 credits." |
| The parent used AI Coach on a game someone shared with them | One line under the tagline: "You used AI Coach on a game {name} shared." (section 11). |
| Not enough credits | Section 2. |

### For the implementer

- New component `components/analysis/AICoachOfferDialog.jsx`, built like `VeoImportSheet`: portalled to `document.body`, close by X or its buttons only. The same component serves section 4 with `context="game"`.
- `components/GameDetailsModal.jsx` keeps its layout. Its submit handler opens the offer after the upload has been handed to the upload manager. `components/shared/CreditCostRow.jsx` is not changed.
- Duration comes from `utils/videoMetadata.js` (`extractVideoMetadata`) at pick time. Price rule lives in one helper next to `utils/storageCost.js`; the backend stays the authority.
- The upload percentage and the fingerprint result come from the upload manager; the dialog subscribes, it does not poll.
- Sport: `components/shared/InlineSportSelect.jsx` and the chooser from section 10; soccer check against `SUPPORTED_SPORTS` ids in `modes/annotate/constants/tagRegistry.js`.
- Availability (daily limit, switch) and the rate come from one config call made when Upload is tapped, so the decision to open is made before the dialog renders.
- The example is a fixed asset shipped with the app; its text lives with the other strings.
- The "Not now three times in a row" count is an account preference written by the dismiss and accept gestures.
- Free-share box tokens: the tinted cyan secondary panel from the style guide. The main button is the dialog's one solid cyan action.

---

## 2. Not enough credits

(Redrawn 2026-11-14 with section 1. Waits for the owner's approval.)

### In the offer

Nothing pops up. The shortfall is shown in place, in the price rows, as soon as the offer opens, so the parent sees it before tapping anything.

A new account has 88 credits. On our example game the rows end like this:

```
AI Coach, 90 min              135 credits
Storage, already agreed         3 credits
Your balance                   88 credits   (red)
You need 50 more credits.
The 150 credit pack ($6.99) covers it.
```

The buttons become:

- Main button: "Buy 150 credits for $6.99". This opens the existing in-page payment sheet with that pack already chosen. The parent can still pick a bigger pack there.
- Second button: "Not now". It closes the offer. The upload was never waiting on this, so there is no "upload without AI" choice to make.

We always name the smallest pack that covers the gap: 150 credits for $6.99 up to 150 missing, 340 for $12.99 up to 340 missing, 1000 for $29.99 above that. If no single pack covers the gap (a very long, multi-video game), the line reads "You need {n} more credits." and the button reads "Buy credits".

### After paying

When the payment succeeds the payment sheet and the offer both close, and a green toast says "Credits added. AI Coach starts when the upload finishes." (or "Credits added. Starting AI Coach." when the upload has already finished, or when the offer was opened from a game). The parent does not have to tap "Add AI Coach" again: buying the pack from this button was the choice.

### If the payment fails or is abandoned

- A card that is declined shows the payment provider's own message inside the payment sheet, and the parent can try another card there.
- If they close the payment sheet, they are back in the offer exactly as they left it, both buttons still there. A grey line above the buttons says "Payment did not go through. Nothing was charged."
- The upload carries on throughout.

### One late case

Credits are set aside when the analysis starts, which is after the upload. If the parent spent credits on something else during the upload and no longer has enough, the analysis does not start and nothing fails silently. The game tile and the status card say "AI Coach is waiting: you need {n} more credits." with two choices ("Buy {pack} credits for {price}", "Skip AI Coach for this game").

### For the implementer

- The offer opens `components/BuyCreditsModal.jsx` and resumes through its success callback. Add a preselected-pack prop to `BuyCreditsModal`, and a neutral reason panel: its current `insufficientCredits` panel says "This export requires", which is wrong here.
- Do not use `components/InsufficientCreditsModal.jsx` for this flow. The in-place rows plus two buttons replace it.
- Pack list comes from `/api/payments/config` (already cached in `BuyCreditsModal`). Never hard-code prices.
- Fire the existing paywall funnel beacon when the shortfall rows first appear.

---

## 3. Honest progress

### Where progress shows

There are two places, and they always say the same thing.

1. The game tile on the Games tab: a small chip in the top-left corner plus one line of text under the game name.
2. A status card in Annotate, directly under the video, above the action cards. It is the full version: a title, a three-step list, the real count, the time estimate, and what the parent can do now.

The status card, while the AI is watching the game:

```
+--------------------------------------------+
| AI Coach is working                        |
|                                            |
| (done) 1. Getting the video ready          |
| (now)  2. Watching the game                |
|           11 of 18 sections watched        |
|           [#][#][ ][#][#][#][ ][#][#]      |
|           [#][ ][#][#][ ][#][ ][ ][#]      |
|        3. Putting the plays together       |
|                                            |
| Usually 2 to 4 minutes for this step.      |
| This is an estimate.                       |
| You can leave. We will email you when the  |
| plays are ready.                           |
+--------------------------------------------+
```

The 18 boxes are the 18 five-minute sections of the game, in game order. A box fills when that section is really finished. Sections are watched at the same time, so boxes fill out of order. That is what is happening, so that is what we show.

### State table

| # | State | What is true | Game tile | Status card in Annotate | What the parent can do |
|---|---|---|---|---|---|
| A | Uploading, AI next | The browser is uploading. The analysis has not started. No credits are set aside yet. | Existing uploading tile, unchanged, plus a second chip "AI next". | Title "AI Coach starts after the upload". Line "Keep this tab open until the upload finishes. After that you can leave." The three steps are listed, all not started. | Mark plays by hand while waiting. Cancel the AI option ("Cancel AI Coach", no charge). |
| B | Getting the video ready | The video is being sent to the analysis service and prepared. We have no finer measure than "started". Credits are set aside. | Chip "AI: getting ready". Line "Getting the video ready". | Title "AI Coach is working". Step 1 is current, with a spinner and "Started 3 min ago. Usually 5 to 10 minutes for a game this long. This is an estimate." No bar. | Leave. Mark plays by hand. No cancel from here on (see section 9). |
| C | Watching the game | Sections are being watched in parallel. We know the exact number finished. | Chip "AI: watching". Line "11 of 18 sections watched". A thin strip of 18 cells along the bottom edge of the tile. | Step 2 is current. "11 of 18 sections watched", the 18 boxes, and "Usually 2 to 4 minutes for this step. This is an estimate." | Leave. Mark plays by hand. |
| D | Taking a second look | Some sections stopped early and are being watched again. They were never counted as watched, so the count never goes backwards. | Same as C. | Same as C plus one line: "Taking a second look at 2 sections." Those boxes show a dashed outline. | Same as C. |
| E | Putting the plays together | All sections are watched. Results are being merged. Seconds. | Chip "AI: finishing". Line "18 of 18 sections watched". | Step 3 is current: "Putting the plays together. A few seconds." | Wait or leave. |
| F | Ready, needs team color | The analysis is complete. Credits have been taken. Nothing is in the game yet. | Chip "Pick your team" in cyan. Line "AI plays are ready". | Title "The AI finished watching". Line "It found plays for both teams. Pick your team and we add yours." Button "Pick your team". | Pick the team (section 5). Or leave it for later: it waits, with no time limit while the game is stored. |
| G | Ready from an earlier analysis | This exact video was analysed before. There was no waiting. Credits have been taken. | Same as F. | Title "Ready already". Line "This game was analysed earlier from another upload of the same video, so there was nothing to wait for. Same price: 135 credits." Button "Pick your team". No step list, no spinner. | Same as F. |
| H | Joined an analysis already running | Someone else started an analysis of this same video. This account joined it. Credits are set aside. | Same as B, C, D or E, whichever is true. | Whichever of B to E is true, with one line on top: "This game is already being analysed from another upload of the same video. You joined it, so it will be ready sooner." | Same as B to E. |
| I | Taking longer than usual | The current step has run past the top of its estimate. It is still running. | Chip unchanged. Line "Taking longer than usual". | The estimate line is replaced by "Taking longer than usual. It is still working. There is nothing you need to do." | Leave. |
| J | Trying again | The service was busy and we are retrying by ourselves. | Chip unchanged. Line "Service busy, trying again". | "The analysis service is busy. Trying again (attempt 2 of 3)." The count of finished sections stays as it was. | Leave. |
| K | Failed, credits returned | The analysis did not finish after retries. All set-aside credits are back. Nothing was taken. | Chip "AI did not finish" in rose. Line "135 credits returned". | Title "AI Coach did not finish". One reason line (below). "Your 135 credits are back in your balance. Nothing was charged." Buttons "Try again" and "Dismiss". | Try again (same price, set aside again). Dismiss. Mark plays by hand. |
| L | Waiting for credits | The upload finished but the balance no longer covers the analysis. Nothing is set aside. | Chip "AI waiting". Line "Needs 50 more credits". | Section 2, "One late case". | Buy and start. Skip AI Coach for this game. |
| M | Came back later | The parent left and returned. | The tile shows whichever state above is true right now. | Whichever card above is true right now. If it became ready while they were away, the first screen they land on also shows the "ready" toast once. | As per the true state. |
| N | Plays added | The team was picked and plays were imported. | Chip "Tag players" in cyan until the tag pass has been opened once, then no chip. | The summary card from section 6. | Section 6 and 7. |

Reason lines for state K (exactly one is shown):

- Service busy: "The analysis service was too busy, even after we retried."
- Incomplete: "Some sections of the game could not be watched, so we stopped instead of giving you half a result."
- Not a game or too short: "The AI did not find a game it could mark plays in. This works on full soccer games filmed from the sideline."
- Storage expired during the run: "This game's video is no longer stored, so the AI could not watch it."

If the analysis finishes but finds only a handful of plays, that is not a failure screen. The ready state says the real number ("The AI found 4 plays for both teams.") and section 5 shows the real count per team. A finished analysis is charged whatever the count (section 9, ruling 2).

### Toasts and email

| Moment | Toast (in the app) | Email |
|---|---|---|
| Analysis starts after upload | "Upload finished. The AI is now watching your game. You can leave, we will email you." | None. |
| Ready (states F and G) | "The AI finished watching {game}. Pick your team to add the plays." with a "Pick your team" action. | Subject: "The AI finished watching {game}". Body: "The AI has watched {game} and marked the plays. Open the game and pick your team's jersey color, and we add your team's plays for you to check. The AI marks plays for the whole team and can miss a play or include a weak one. You can edit or remove anything." Button: "Open the game". |
| Failed (state K) | "AI Coach did not finish for {game}. Your {n} credits are back." | Subject: "AI Coach did not finish. Your credits are back". Body: "We could not finish marking plays in {game}. {reason line} Your {n} credits are back in your balance and nothing was charged. You can try again from the game." Button: "Open the game". |

No "ready" email is sent when the result was ready within one minute of the upload finishing and the parent is still in the app (the cache case). The toast is enough.

### Rules for time and progress

1. Never show a percentage for the analysis. The only percentage on screen is the browser upload, which is a real measure and already exists.
2. Only two kinds of numbers appear: real counts ("11 of 18 sections watched", "attempt 2 of 3") and real elapsed time ("Started 3 min ago").
3. Every estimate is a range, is worded "Usually", and carries "This is an estimate." in the status card. Ranges come from the server and scale with the game's length. The tile never shows an estimate; it has no room to label it honestly.
4. No countdown ("4 minutes left"). We do not know that.
5. A count never goes down. A section counts as watched only when it is completely finished.
6. No bar, ring or animation that moves by itself. A spinner is allowed on the current step because it claims only "running". The 18 boxes change only when the server says a section finished.
7. When nothing is being done (cache), nothing spins.
8. When the run is past its estimate, say so (state I) instead of leaving a stale "Usually" line up.
9. Every state names what the parent can do right now, and after the upload always includes "You can leave".

### For the implementer

- Tile: `components/UploadingGameTile.jsx` for state A, `components/GameTile.jsx` for the rest. Chips go in the existing top-left chip slot; if an expiry chip is also due, stack the AI chip under it. The 18-cell strip reuses `components/shared/SegmentedProgressStrip.jsx` (slim variant) fed with real section states. If the tile skin for uploading changes, both tile files change together (see the note in `UploadingGameTile.jsx`).
- Status card: new component rendered by `modes/AnnotateModeView.jsx` under the player, in the slot `VeoAlignCard` uses. Panel tokens: `bg-gray-800 border border-gray-700 rounded-lg p-4`. No amber, no fuchsia: this is status, not a warning.
- Live updates over a WebSocket, not polling (frontend rule). Server sends: stage, sections done, sections total, sections being re-watched, attempt number, stage start time, estimate range in minutes.
- `components/UploadProgressIndicator.jsx` is unchanged; it covers the browser upload only.
- Toasts through `components/shared/Toast.jsx` with a `dedupKey` per game and state.

---

## 4. Starting on a game already uploaded

(Redrawn 2026-11-14 to use the offer dialog from section 1. Waits for the owner's approval.)

### Entry points

1. Annotate, next to "Mark play". A new action card titled "AI Coach", with the line "The AI watches the game and marks your team's plays." It sits second, right after "Mark play". "Mark play" stays the one solid cyan card on the screen. On a phone "Mark play" takes the full width on top and the other cards sit two-up beneath it. This is the button for a parent who said "Not now" at upload.
2. Game tile menu (the three-dot button). A new item, "AI Coach", sits first in the menu when the game does not have it. It is not shown for games whose video is no longer stored and cannot be extended.
3. The empty play list. Where the list says there are no plays yet, a second line offers: "Or let AI Coach mark your team's plays." as a link.

This one card slot follows the game through its life, so the parent always finds AI Coach in the same place: "AI Coach", then "AI Coach is working" with the real count, then "Pick your team", then "Tag players" with "12 of 46".

### The dialog

All three entry points open the offer dialog from section 1: the same example, the same benefit lines, the same free-share box, the same honesty and Gemini lines. Two things differ in the pinned bottom part:

```
| AI Coach, 90 min              135 credits  |
| Your balance                  200 credits  |
| Balance after                  65 credits  |
| Credits are set aside now and only taken   |
| when the analysis finishes. If it fails,   |
| you get them all back.                     |
| Usually ready in 10 to 15 minutes. This is |
| an estimate. You can leave, we email you.  |
| [ Start AI Coach: 135 credits ]            |
| [ Not now ]                                |
```

There is no storage row and no upload line: storage was paid at upload. In their place is the labelled time estimate.

### States of the dialog

| State | What the dialog says | What the parent can do |
|---|---|---|
| Normal | As drawn. | Start, or Not now. |
| Sport not chosen | A step appears above the price: "Which sport is this?" with the sport chooser. The Start button is off and reads "Pick a sport to continue" until one is chosen. Choosing soccer turns it on in place. | Pick. Nothing else in the dialog moves. |
| Sport is not soccer | The pitch is replaced by one line: "AI Coach is soccer only for now." One button: "OK". | Close. |
| Not enough credits | Section 2. | Buy and start, or Not now. |
| Video no longer stored, can be extended | "This game's video is no longer stored, so the AI has nothing to watch. Extend storage first, then start." Button "Extend storage" (the existing flow), then the dialog reopens. | Extend, or close. |
| Video no longer stored, cannot be extended | "This game's video is no longer stored, so the AI has nothing to watch. Upload the game again to use AI Coach." One button: "OK". | Close. |
| Analysis already running for this game | No dialog. The entry point opens the game and scrolls to the status card. | See progress. |
| Has AI Coach, team not picked | No dialog. Opens the team chooser (section 5). | Pick the team. |
| Has AI Coach, plays added | A small sheet: "This game already has AI Coach. You will not be charged again." Buttons: "Tag players", "Share with your team, free", "Switch team", "Add the AI plays again" (only if some were removed). | Any of them, all free. |
| Has AI Coach through a share | Same as the two rows above; the small sheet's first line reads "AI Coach on this game was shared by {name}. It is free for you." | Same. |
| Already analysed by someone else (cache) | The estimate line is replaced by "This game has already been analysed, so your plays will be ready in seconds. Same price: 135 credits." | Start, or Not now. |
| Unavailable today or paused | The pitch is replaced by "AI Coach is full for today. Start it from here tomorrow." or "AI Coach is paused right now. Start it from here later.", with one button: "OK". | Close. |

### For the implementer

- Action card in the grid in `modes/AnnotateModeView.jsx` (the non-edit `ActionCard` grid). Five cards break the current `lg:grid-cols-4`: use five columns at `lg` when the card is present, and on phones make "Mark play" span both columns. Use the secondary `ActionCard` variant; never a second solid cyan card. The card must be visible in the fresh-game simplified layout.
- Menu item in `components/GameTile.jsx` (same list the mobile sheet and desktop popover share).
- Dialog: `components/analysis/AICoachOfferDialog.jsx` from section 1 with `context="game"`. Portal to `document.body`; never `position: fixed` inside the Annotate blur card.
- Sport step uses `components/shared/InlineSportSelect.jsx`; the pick writes the profile sport on that tap.
- "Never charged twice" and "has it through a share" are decided by the server per account and game; the dialog only reflects the quote.

---

## 5. Pick your team colour

(The heading keeps the owner's spelling. Visible copy uses "color", like the rest of the app.)

### The chooser

The analysis names the two teams by jersey color. Before anything is added to the game, the parent picks theirs. On a phone this is a full-screen step; on desktop it is a centred dialog. It opens from the "Pick your team" button on the status card, the tile, or the toast. It never opens by itself.

```
+--------------------------------------------+
| Which team is yours?                    X  |
| The AI tells the teams apart by jersey     |
| color.                                     |
|                                            |
| +----------------------------------------+ |
| | [ frame from the game showing white ]  | |
| | (O) White                    46 plays  | |
| +----------------------------------------+ |
| +----------------------------------------+ |
| | [ frame from the game showing navy ]   | |
| | (O) Navy                     39 plays  | |
| +----------------------------------------+ |
|                                            |
| We add the plays the AI is most sure are   |
| your team's. You can switch teams later    |
| for free.                                  |
|                                            |
| [ Add 46 plays ]                           |
| Neither looks right                        |
+--------------------------------------------+
```

- Each choice is one large card, at least 96 px tall, the whole card tappable. It shows a frame from the game where that team is clearly visible, a round color swatch, the color name in words, and the real number of plays that will be added for that team.
- The swatch always has a thin light ring, so white shows on a light frame and navy shows on the dark background. The color name is always written out, so the choice never depends on seeing color.
- Tapping a card selects it (blue selected border and a filled radio dot). Nothing is added yet. The button at the bottom then reads "Add 46 plays". Two taps on purpose: a mis-tap here would fill the game with the other team's plays.
- If no frame is available for a team, the card shows only the large swatch and name.
- Under the color name, one grey line says which way that team attacked in the first half, as the camera saw it: "Attacked toward the left in the first half". It is shown only when the analysis knows it. Two kits can look alike on video, and the direction is a second way for the parent to tell which team is theirs.
- The play counts are exact, not "about": the analysis is finished, so we know them.
- "Neither looks right" opens two lines of help in place: "The AI names teams by the jersey color it sees. Pick the closer one. If the plays turn out to be the other team's, switch for free from the game." It does not block.

After "Add 46 plays" the chooser closes and the parent lands in Annotate with the summary card (section 6).

### Wrong choice

"Switch team" is always available on the summary card menu and the game tile menu. It opens the same chooser with the current team marked "Your team now". The button reads "Switch to Navy", and a line above it says exactly what will happen:

"The 41 White plays you have not touched are removed. The 5 you edited, tagged or moved stay. 39 Navy plays are added. No charge."

Switching is free as many times as they like. It never touches plays the parent marked by hand.

### For the implementer

- New component; layout tokens from the pack buttons in `components/BuyCreditsModal.jsx` (large full-width choice cards). Selected state uses the blue selection accent from the style guide, not cyan.
- Frames: one still per team from the analysis result. Lazy image, grey skeleton while loading, swatch-only fallback on error.
- Import rule: plays with relevance 4 or 5 for the chosen team. The count on each card is that same query.
- "Touched" means the parent edited any field, confirmed the play, tagged a player, or moved it to their athlete's plays.
- Import and switch are each one named gesture with one server call.

---

## 6. What arrives in Annotate

### The summary card

Right after import, the status card becomes a summary card, in the same place:

```
+--------------------------------------------+
| 46 plays added to team plays          ...  |
| 9 Brilliant  21 Good  11 Interesting       |
| 5 Needs work                               |
|                                            |
| These are plays the AI marked for White.   |
| It does not know which player is yours.    |
|                                            |
| [ Tag players ]                            |
| [ Share with your team, free ]             |
| Watch the plays                            |
+--------------------------------------------+
```

- The title is the real number.
- The second line is the real spread of ratings, using the app's rating words.
- "Tag players" is the next step and opens the pass in section 7. It is styled as a tinted cyan secondary button, because "Mark play" remains the single solid cyan action on this screen.
- "Share with your team, free" opens the existing game share. Every family that receives the game gets AI Coach on it at no cost (section 11).
- "Watch the plays" opens the existing play-through of the team plays.
- The "..." menu holds "Switch team" and "Remove AI plays I have not touched".
- The card can be dismissed with its close button. The same actions stay reachable from the "Tag players" action card and the tile menu.

### How an AI play looks

- On the timeline, AI plays sit in the team plays lane in the usual amber. Until the parent touches one, it has a dashed outline instead of a solid one. Shape carries the meaning, not color alone.
- In the play list, the row shows a small grey pill with the letters "AI" before the play name. The pill has the tooltip and screen-reader label "Marked by AI, not checked yet".
- In the play editor, a quiet line under the title reads "Marked by AI. Check the start, end and rating." with two small buttons: "Looks right" and "Wrong team" (see "Wrong team on one play" below).
- The play arrives filled in: start and end, the one-sentence summary as its name, tags, rating, and the coaching notes in the notes field. The player chips from section 7 sit under "Who is this play about?".
- The AI mark and the dashed outline go away, for that play, the moment the parent edits anything, taps "Looks right", tags a player on it, or moves it to their athlete's plays. From then on it is simply their play.
- Sometimes the analysis itself doubted which team was which during a stretch of the game. Plays from that stretch carry one more grey line in the editor: "The AI was unsure which team was which here. Check the team." The "Wrong team" button beside it is the fix.
- The play list gets one extra filter chip, "AI, not checked ({n})", shown only while there are some.

### Wrong team on one play

The AI sometimes has the teams the wrong way round on a play: it describes one team's actions under the other team's color. "Switch team" is the wrong tool for that, because the rest of the plays are right. The AI writes about both teams on every play, so the fix is to show this one play from the other side. A play that is good for one team is bad for the other, so a flip usually turns a highlight into a lesson, or a lesson into a highlight.

- "Wrong team" sits beside "Looks right" on the AI line in the play editor, in the same quiet style. It is not red: it is a correction, not a warning.
- One tap flips the play in place. Start, end and name stay. Tags, rating, notes and the player chips under "Who is this play about?" are replaced by what the AI wrote about the other team. The editor stays on the play.
- A toast says "Flipped. This play now shows your team's side." with a "Flip back" action. The AI line then reads "Flipped by you. The AI had the teams the wrong way round on this play." and the button beside "Looks right" reads "Flip back". Flipping back is always available, not only for ten seconds.
- A flipped play keeps its AI mark and dashed outline until the parent edits it or taps "Looks right", because the new tags and rating have not been checked either.
- The name was written once for both teams and may still mention the wrong color. Under the name, a grey line: "The name may still mention the wrong team. Tap it to edit." It goes away when the name is edited or the play is confirmed.
- If the AI wrote nothing about the other team on this play, the flip still happens and the play is left with its start, end and name. A grey line says: "The AI wrote nothing about the other team on this play. Add your own tags, or flip back."
- If the parent has already changed the tags, rating or notes, the button asks once before flipping: "Flipping replaces the tags, rating and notes you changed on this play." Buttons: "Flip" and "Keep mine". Otherwise there is no confirm step.
- The button outlives the AI mark. Once a play has been edited or confirmed, the AI line and "Looks right" go, and "Wrong team" (or "Flip back") stays as a single quiet button in the same place, so a play can still be flipped after the parent has worked on it.
- The flip sticks. "Add the AI plays again" and "Switch team" leave a flipped play flipped.
- In the Tag players pass (section 7) the same button is offered on each play. The chips change in place to the other team's players and the pass stays on that play.

### Undo

"Remove AI plays I have not touched" asks once, with real numbers:

"Remove 41 AI plays you have not touched? The 5 you edited, tagged or moved stay. You can add the AI plays back for free."

Buttons: "Remove 41 plays" (red) and "Keep them". After removal a toast says "41 AI plays removed." with an "Undo" action for ten seconds. Later, "Add the AI plays again" (tile menu and the sheet in section 4) brings them back at no charge.

### For the implementer

- Lane and list: `modes/annotate` region rendering and `components/ClipListItem.jsx`. The AI mark is a field on the play, cleared by the same surgical call that carries the parent's edit.
- Pill tokens: `px-1.5 py-0.5 rounded-full border text-[11px] font-semibold text-gray-300 border-gray-500`, with `title` and `aria-label`.
- Layer control stays `modes/annotate/components/LayerSegmentedControl.jsx`. Ratings from `components/shared/clipConstants.js` (`RATING_ADJECTIVES`); "Needs work" in the summary merges ratings 1 and 2.
- Filter chip joins the existing borderless filter row. Filter state is view-only and never stored.
- Destructive confirm uses the existing two-step pattern; removal is one server call scoped to untouched AI plays.
- "Wrong team" is one gesture and one server call that rebuilds the play from the other team's section and records the flip on the parent's game (T16190). It sends the event `ai_play_team_flipped`. The play keeps its id, so the editor stays on it and re-renders in place.

---

## 7. Tag players

### The player chips

Each AI play carries the players the AI described for the parent's team. Each one is a chip: the position, a jersey number if the AI could read one (rare), and what that player did.

Example: "Right winger #7" on the first line, "Dribble, Chance Creation" beneath it, and "Who is it?" on the right until someone is named.

Tapping a chip opens a small sheet with thumb-sized choices:

```
+--------------------------------------------+
| Right winger #7: who is this?           X  |
|                                            |
| [ This is Maya ]                           |
|   Moves this play to Maya's plays          |
|                                            |
| A teammate:                                |
| [ Ava ]  [ Zoe ]  [ Priya ]                |
| [ Type a name            ]                 |
|                                            |
| [ Not sure ]                               |
|                                            |
| Coach's note: Took on the full back at     |
| speed and cut the ball back early.         |
| Decision 4 of 5, execution 5 of 5.         |
+--------------------------------------------+
```

- "This is Maya" uses the athlete profile's name. It moves the play to Maya's plays. The chip turns cyan and reads "Maya".
- Teammate names already used in this game are offered first as one-tap buttons. A new name is typed once and is then offered on later plays. The chip turns amber and reads the name.
- "Not sure" closes the sheet and changes nothing.
- The coaching note for that player sits at the bottom of the sheet, so naming and reading happen together.

Remembering positions. After the parent says "Right winger is Maya" once, later plays in this game that mention a right winger show a suggestion on the chip, never a silent answer:

The chip then shows two small buttons on its right: "Maya?" and "No".

"Maya?" is one tap to confirm. "No" clears the suggestion for this play only. We never fill it in by ourselves, because kids change positions during a game. The memory lasts for this game only. The same works for teammates ("Ava?").

The existing rule about teammates. Today, a play that belongs to the athlete carries no teammate names: moving a play to "My athlete" clears them. This design works with that rule instead of around it:

- "This is Maya" is always the first choice, so most parents answer it before naming anyone else.
- If teammates were already named on this play, the button's second line reads "Moves this play to Maya's plays and removes the teammate names on it."
- Afterwards the other chips on that play go quiet and read-only, with one grey line: "Teammate names are kept on team plays only." An "Undo" link sits next to it and puts the play and the names back.

### The Tag players pass

A fast, one-play-at-a-time pass. It opens from the summary card, the "Tag players" action card and the tile menu. On a phone it takes the whole screen.

Phone (390 px):

```
+--------------------------------------------+
| X   Tag players            12 of 46        |
| [ All 46 ] [ Might be Maya 14 ] [ To do 30]|
+--------------------------------------------+
|                                            |
|          the play, looping, 16:9           |
|                                            |
+--------------------------------------------+
| 34:12   Goal, Dribble          Brilliant   |
| Winger cuts inside and finishes low.       |
+--------------------------------------------+
| Who was in this play?                      |
| +----------------------------------------+ |
| | Right winger  #7                       | |
| | Dribble, Goal        [ Maya? ] [ No ]  | |
| +----------------------------------------+ |
| +----------------------------------------+ |
| | Striker                                | |
| | Assist                     Who is it?  | |
| +----------------------------------------+ |
| Maya was not in this play                  |
+--------------------------------------------+
| [  Back  ]                    [  Next  ]   |
+--------------------------------------------+
```

- The play loops by itself, muted, from its start to its end. Tapping the video pauses and resumes. If the device asks for reduced motion, it does not start by itself; a play button is shown.
- "12 of 46" is the parent's real place in the list. There is no bar pretending to measure anything else.
- "Back" and "Next" are pinned to the bottom, each at least 56 px tall and half the width. "Next" is the skip: moving on without tagging is always allowed and is never treated as an answer. Swiping left or right on the video does the same.
- Moving on is always the parent's tap. The pass never jumps forward by itself after a tag.
- "Maya was not in this play" is a quiet link. It keeps the play in team plays and marks it as checked.
- Filters appear as chips under the title. "Might be Maya" appears only after at least one position or number has been tagged as Maya. It lists the not-yet-tagged plays that mention one of those positions or that number. Its count is real. "To do" lists plays with nobody tagged and not checked.
- Closing with X keeps everything already tagged; every tag was saved when it was tapped. Opening the pass again starts at the first play in "To do".

Desktop (1280 px):

```
+----------------------------------------------------------------------------------+
| Tag players     12 of 46      [ All 46 ] [ Might be Maya 14 ] [ To do 30 ]    X  |
+---------------------------------------------------+------------------------------+
|                                                   | 34:12  Goal, Dribble         |
|                                                   | Brilliant                    |
|                                                   | Winger cuts inside and       |
|             the play, looping                     | finishes low.                |
|                                                   |                              |
|                                                   | Who was in this play?        |
|                                                   | [ Right winger #7  Maya? No ]|
|                                                   | [ Striker       Who is it?  ]|
|                                                   | Maya was not in this play    |
+---------------------------------------------------+------------------------------+
| [ Back ]   Left and Right arrow keys move. M = this is Maya. Space = pause.  [ Next ] |
+----------------------------------------------------------------------------------+
```

On desktop the chip's choices open as a small popover next to the chip instead of a bottom sheet.

### Empty and done states

| State | What the parent sees | What they can do |
|---|---|---|
| A play with no player described | "The AI did not name a player for this play." and two buttons: "This is Maya's play" and "Add a teammate". | Either, or Next. |
| "Might be Maya" has nothing left | "No more plays that might be Maya's. Some of Maya's plays may be described differently by the AI." Button "See plays to do". | Switch filter. |
| No AI plays in this game | The pass is not offered at all. | Nothing to do. |
| Last play reached | Done screen, below. | Finish, or go back. |

Done screen: the title "You went through all 46 plays", then three lines with real numbers ("14 are Maya's plays", "20 have teammates tagged", "12 left as team plays"), a main button "Watch Maya's plays", a second button "Share with your team, free" with the line "Other families can find their own athlete's plays the same way." (section 11), and a quiet "Done".

The three numbers are real and add up to the total. If the parent skipped some, the first line reads "You reached the end. 9 plays still have nobody tagged." with a button "Go through those".

### For the implementer

- New full-screen view, built like `AddDetailsPopup` (`fixed inset-0`, portalled to `document.body`, close by X only).
- Teammate names: reuse the data and suggestion source of `components/shared/TeammateTagInput.jsx`; the sheet shows the top suggestions as buttons and the same input for a new name.
- "This is {athlete}" sends the same surgical call the layer control sends today (my athlete on, teammates cleared, one gesture). Undo sends the reverse with the previous names.
- Position memory is per game, stored with the game as "position or number, name", written only by the confirm tap. It only ever produces suggestions.
- Filter choice, current index and pause state are view-only state. Nothing about them is stored.
- Keyboard: Left, Right, M, Space, Escape closes. All chips and buttons reachable by Tab with visible focus.

---

## 8. Copy rules

### Words to use and to avoid

| Say | Never say | Why |
|---|---|---|
| "plays the AI marked", "your team's plays" | "all your plays", "every highlight", "every play" | It can miss plays. |
| "It cannot tell which player is yours" | "finds your child", "your athlete's plays, found" | It does not know the child. |
| "marks", "suggests", "found" | "knows", "detects every", "guarantees" | Same reason. |
| "Coach-level analysis" as the one-line promise, then concrete things: tags, rating, a note | "professional scouting", "like a real coach watched", "expert verified" | The promise is the depth of the notes, not a person. |
| "Usually 5 to 10 minutes. This is an estimate." | "5 minutes left", "almost done", any percentage | We do not know. |
| "set aside", "only taken when it finishes", "returned" | "held", "pending charge", "refund" | Credits, not money; plain words. |
| "already analysed" | "instant AI", any waiting animation | Do not pretend to work. |
| "play", "team plays", "{athlete}'s plays", "teammate" | "clip", "layer", "Team line", "player" for the parent's kid | Copy glossary. |
| "Your video is sent to Google's Gemini service to be analysed." | Hiding the provider, or legal wording | One plain line, always visible when buying. |
| "did not finish", "could not" | "error", "failed job", codes | Calm, and says what happened to their credits. |

Tone for "coach-level analysis": a good youth coach on the sideline. Specific, warm, short. A mistake is a lesson ("Look up before the pass next time"), a great play gets a comparison to a well-known player. Never harsh, never gushing. The app's own voice around it stays factual: numbers, what happened, what to do next. No exclamation marks in status or money copy.

Every failure message has three parts in this order: what happened, what happened to the credits, what the parent can do.

### Every string in this spec

`{n}`, `{m}`, `{min}`, `{price}`, `{pack}`, `{athlete}`, `{name}`, `{game}`, `{color}`, `{sharer}`, `{side}`, `{period}` are filled in at run time. `{period}` comes from the sport's own strings ("first half" for soccer), so the sentence itself stays sport-neutral. Plurals go through the shared helper ("1 play", "2 plays", "1 credit", "2 credits", "1 section", "2 sections").

| Key | Text |
|---|---|
| OFFER_TITLE | AI Coach |
| OFFER_TAGLINE | Coach-level analysis of the whole game |
| OFFER_BENEFIT_1 | Watches the full game and marks your team's best plays for you. |
| OFFER_BENEFIT_2 | Every play gets tags, a rating and a one-sentence summary. |
| OFFER_BENEFIT_3 | A coaching note for the players involved: what to learn, or which pro it looked like. |
| OFFER_HONESTY | Good to know: it finds plays for the whole team and cannot tell which player is yours, so you pick your athlete's plays afterwards. It can miss a play or include a weak one. You can edit or remove anything. |
| OFFER_DISCLOSURE | Your video is sent to Google's Gemini service to be analysed. |
| OFFER_SOCCER_ONLY | AI Coach is soccer only for now. |
| OFFER_FULL_TODAY | AI Coach is full for today. Start it from here tomorrow. |
| OFFER_PAUSED | AI Coach is paused right now. Start it from here later. |
| OFFER_CACHED | This game has already been analysed, so your plays will be ready right after the upload. Same price: {n} credits. |
| SPORT_QUESTION | Which sport is this? |
| SPORT_REQUIRED_START | Pick a sport to continue |
| COST_AI | AI Coach, {min} min |
| COST_BALANCE | Your balance |
| COST_AFTER | Balance after |
| COST_RESERVE_NOTE_UPLOAD | Credits are set aside when the analysis starts and only taken when it finishes. If it fails, you get them all back. |
| COST_RESERVE_NOTE_START | Credits are set aside now and only taken when the analysis finishes. If it fails, you get them all back. |
| SHORT_NEED | You need {n} more credits. |
| SHORT_PACK | The {pack} credit pack ({price}) covers it. |
| SHORT_BUY | Buy {pack} credits for {price} |
| SHORT_BUY_GENERIC | Buy credits |
| SHORT_NOT_NOW | Not now |
| SHORT_PAID_UPLOAD | Credits added. AI Coach starts when the upload finishes. |
| SHORT_PAID_START | Credits added. Starting AI Coach. |
| SHORT_PAY_FAILED | Payment did not go through. Nothing was charged. |
| SHORT_WAITING | AI Coach is waiting: you need {n} more credits. |
| SHORT_SKIP_AI | Skip AI Coach for this game |
| CHIP_AI_NEXT | AI next |
| CHIP_GETTING_READY | AI: getting ready |
| CHIP_WATCHING | AI: watching |
| CHIP_FINISHING | AI: finishing |
| CHIP_PICK_TEAM | Pick your team |
| CHIP_FAILED | AI did not finish |
| CHIP_WAITING | AI waiting |
| CHIP_TAG | Tag players |
| TILE_GETTING_READY | Getting the video ready |
| TILE_SECTIONS | {n} of {m} sections watched |
| TILE_READY | AI plays are ready |
| TILE_SLOW | Taking longer than usual |
| TILE_RETRY | Service busy, trying again |
| TILE_RETURNED | {n} credits returned |
| TILE_NEEDS | Needs {n} more credits |
| STATUS_TITLE_QUEUED | AI Coach starts after the upload |
| STATUS_QUEUED_BODY | Keep this tab open until the upload finishes. After that you can leave. |
| STATUS_CANCEL | Cancel AI Coach |
| STATUS_TITLE_RUNNING | AI Coach is working |
| STATUS_STEP_1 | Getting the video ready |
| STATUS_STEP_2 | Watching the game |
| STATUS_STEP_3 | Putting the plays together |
| STATUS_STARTED | Started {n} min ago. |
| STATUS_EST_PREPARE | Usually {n} to {m} minutes for a game this long. This is an estimate. |
| STATUS_EST_WATCH | Usually {n} to {m} minutes for this step. This is an estimate. |
| STATUS_SECTIONS | {n} of {m} sections watched |
| STATUS_REWATCH | Taking a second look at {n} sections. |
| STATUS_MERGE | Putting the plays together. A few seconds. |
| STATUS_LEAVE | You can leave. We will email you when the plays are ready. |
| STATUS_JOINED | This game is already being analysed from another upload of the same video. You joined it, so it will be ready sooner. |
| STATUS_SLOW | Taking longer than usual. It is still working. There is nothing you need to do. |
| STATUS_RETRY | The analysis service is busy. Trying again (attempt {n} of {m}). |
| STATUS_TITLE_READY | The AI finished watching |
| STATUS_READY_BODY | It found plays for both teams. Pick your team and we add yours. |
| STATUS_READY_FEW | The AI found {n} plays for both teams. |
| STATUS_TITLE_CACHED | Ready already |
| STATUS_CACHED_BODY | This game was analysed earlier from another upload of the same video, so there was nothing to wait for. Same price: {n} credits. |
| STATUS_TITLE_FAILED | AI Coach did not finish |
| STATUS_FAILED_CREDITS | Your {n} credits are back in your balance. Nothing was charged. |
| FAIL_BUSY | The analysis service was too busy, even after we retried. |
| FAIL_INCOMPLETE | Some sections of the game could not be watched, so we stopped instead of giving you half a result. |
| FAIL_NOT_GAME | The AI did not find a game it could mark plays in. This works on full soccer games filmed from the sideline. |
| FAIL_EXPIRED | This game's video is no longer stored, so the AI could not watch it. |
| FAIL_TRY_AGAIN | Try again |
| FAIL_DISMISS | Dismiss |
| TOAST_STARTED | Upload finished. The AI is now watching your game. You can leave, we will email you. |
| TOAST_READY | The AI finished watching {game}. Pick your team to add the plays. |
| TOAST_FAILED | AI Coach did not finish for {game}. Your {n} credits are back. |
| EMAIL_READY_SUBJECT | The AI finished watching {game} |
| EMAIL_READY_BODY | The AI has watched {game} and marked the plays. Open the game and pick your team's jersey color, and we add your team's plays for you to check. The AI marks plays for the whole team and can miss a play or include a weak one. You can edit or remove anything. |
| EMAIL_FAILED_SUBJECT | AI Coach did not finish. Your credits are back |
| EMAIL_FAILED_BODY | We could not finish marking plays in {game}. {reason} Your {n} credits are back in your balance and nothing was charged. You can try again from the game. |
| EMAIL_BUTTON | Open the game |
| START_CARD_BODY | The AI watches the game and marks your team's plays. |
| START_EMPTY_LIST | Or let AI Coach mark your team's plays. |
| START_BUTTON | Start AI Coach: {n} credits |
| START_ESTIMATE | Usually ready in {n} to {m} minutes. This is an estimate. You can leave, we email you. |
| START_CACHED | This game has already been analysed, so your plays will be ready in seconds. Same price: {n} credits. |
| START_EXPIRED_EXTEND | This game's video is no longer stored, so the AI has nothing to watch. Extend storage first, then start. |
| START_EXTEND_BUTTON | Extend storage |
| START_EXPIRED_GONE | This game's video is no longer stored, so the AI has nothing to watch. Upload the game again to use AI Coach. |
| START_ALREADY | This game already has AI Coach. You will not be charged again. |
| START_ADD_AGAIN | Add the AI plays again |
| OK | OK |
| TEAM_TITLE | Which team is yours? |
| TEAM_SUB | The AI tells the teams apart by jersey color. |
| TEAM_COUNT | {n} plays |
| TEAM_NOTE | We add the plays the AI is most sure are your team's. You can switch teams later for free. |
| TEAM_ADD | Add {n} plays |
| TEAM_NEITHER | Neither looks right |
| TEAM_NEITHER_HELP | The AI names teams by the jersey color it sees. Pick the closer one. If the plays turn out to be the other team's, switch for free from the game. |
| TEAM_CURRENT | Your team now |
| TEAM_SWITCH | Switch team |
| TEAM_SWITCH_TO | Switch to {color} |
| TEAM_SWITCH_EXPLAIN | The {n} {oldColor} plays you have not touched are removed. The {m} you edited, tagged or moved stay. {added} {newColor} plays are added. No charge. |
| SUMMARY_TITLE | {n} plays added to team plays |
| SUMMARY_NEEDS_WORK | {n} Needs work |
| SUMMARY_BODY | These are plays the AI marked for {color}. It does not know which player is yours. |
| SUMMARY_TAG | Tag players |
| SUMMARY_WATCH | Watch the plays |
| AI_PILL | AI |
| AI_PILL_LABEL | Marked by AI, not checked yet |
| AI_EDITOR_LINE | Marked by AI. Check the start, end and rating. |
| AI_CONFIRM | Looks right |
| AI_FILTER | AI, not checked ({n}) |
| AI_WRONG_TEAM | Wrong team |
| AI_WRONG_TEAM_LABEL | The AI mixed the teams up on this play. Show it from your team's side. |
| AI_WRONG_TEAM_TOAST | Flipped. This play now shows your team's side. |
| AI_WRONG_TEAM_UNDO | Flip back |
| AI_FLIPPED_LINE | Flipped by you. The AI had the teams the wrong way round on this play. |
| AI_FLIPPED_NAME_HINT | The name may still mention the wrong team. Tap it to edit. |
| AI_FLIPPED_EMPTY | The AI wrote nothing about the other team on this play. Add your own tags, or flip back. |
| AI_FLIP_CONFIRM_EDITED | Flipping replaces the tags, rating and notes you changed on this play. |
| UNDO_MENU | Remove AI plays I have not touched |
| UNDO_CONFIRM | Remove {n} AI plays you have not touched? The {m} you edited, tagged or moved stay. You can add the AI plays back for free. |
| UNDO_YES | Remove {n} plays |
| UNDO_NO | Keep them |
| UNDO_TOAST | {n} AI plays removed. |
| UNDO_ACTION | Undo |
| TAG_TITLE | Tag players |
| TAG_PROGRESS | {n} of {m} |
| TAG_FILTER_ALL | All {n} |
| TAG_FILTER_MAYBE | Might be {athlete} {n} |
| TAG_FILTER_TODO | To do {n} |
| TAG_QUESTION | Who was in this play? |
| TAG_CHIP_ASK | Who is it? |
| TAG_SHEET_TITLE | {name}: who is this? |
| TAG_THIS_IS | This is {athlete} |
| TAG_THIS_IS_SUB | Moves this play to {athlete}'s plays |
| TAG_THIS_IS_SUB_CLEARS | Moves this play to {athlete}'s plays and removes the teammate names on it. |
| TAG_TEAMMATE_HEAD | A teammate: |
| TAG_TYPE_NAME | Type a name |
| TAG_NOT_SURE | Not sure |
| TAG_NOTE_HEAD | Coach's note: |
| TAG_SCORES | Decision {n} of 5, execution {m} of 5. |
| TAG_SUGGEST | {name}? |
| TAG_SUGGEST_NO | No |
| TAG_TEAM_ONLY | Teammate names are kept on team plays only. |
| TAG_NOT_IN | {athlete} was not in this play |
| TAG_BACK | Back |
| TAG_NEXT | Next |
| TAG_KEYS | Left and Right arrow keys move. M = this is {athlete}. Space = pause. |
| TAG_NO_MENTION | The AI did not name a player for this play. |
| TAG_WHOLE_PLAY | This is {athlete}'s play |
| TAG_ADD_TEAMMATE | Add a teammate |
| TAG_MAYBE_EMPTY | No more plays that might be {athlete}'s. Some of {athlete}'s plays may be described differently by the AI. |
| TAG_SEE_TODO | See plays to do |
| TAG_DONE_TITLE | You went through all {n} plays |
| TAG_DONE_MINE | {n} are {athlete}'s plays |
| TAG_DONE_TEAMMATES | {n} have teammates tagged |
| TAG_DONE_TEAM | {n} left as team plays |
| TAG_DONE_PARTIAL | You reached the end. {n} plays still have nobody tagged. |
| TAG_DONE_AGAIN | Go through those |
| TAG_DONE_WATCH | Watch {athlete}'s plays |
| TAG_DONE | Done |
| SPORT_TAGS_QUESTION | Which sport? Tags are different for each one. |
| SPORT_TAGS_OTHER | Another sport |
| SPORT_TAGS_CHIP | Pick sport |
| SPORT_TAGS_SHEET_TITLE | Which sport is this? |
| SPORT_TAGS_SET | {sport} tags. |
| SPORT_TAGS_CHANGE | Change |
| OFFER_EXAMPLE_LABEL | Example from another game |
| OFFER_SHARE_TITLE | Pay once. Share it with your whole team for free. |
| OFFER_SHARE_BODY | Every family you share this game with gets AI Coach on it too, at no cost to them. |
| OFFER_UPLOADING | Uploading your game: {n}% |
| OFFER_UPLOAD_DONE | Upload finished |
| OFFER_ADD | Add AI Coach: {n} credits |
| OFFER_LATER_HINT | You can add it later from the game. |
| OFFER_ADDED_TOAST | AI Coach added. It starts when the upload finishes. |
| OFFER_USED_SHARED | You used AI Coach on a game {name} shared. |
| COST_AI_MULTI | AI Coach, {min} min across {m} videos |
| COST_STORAGE_AGREED | Storage, already agreed |
| COST_AFTER_BOTH | Balance after both |
| START_SHARED_ALREADY | AI Coach on this game was shared by {name}. It is free for you. |
| TEAM_DIRECTION | Attacked toward the {side} in the {period} |
| AI_TEAM_UNSURE | The AI was unsure which team was which here. Check the team. |
| SHARE_BUTTON | Share with your team, free |
| SHARE_SUMMARY_LINE | Every family you share this game with gets AI Coach on it, at no cost to them. |
| SHARE_DONE_LINE | Other families can find their own athlete's plays the same way. |
| SHARE_TEAMMATE_LINE | {name}'s family gets this game with AI Coach, free. |
| SHARE_DIALOG_LINE | This game has AI Coach. Everyone you share it with gets it free. |
| SHARE_EMAIL_READY_LINE | Pay once, share free: every family you share this game with gets AI Coach on it too. |
| SHARE_EMAIL_SUBJECT | {sharer} shared {game} with AI Coach |
| SHARE_EMAIL_BODY | {sharer} shared {game} with you. It comes with AI Coach: the AI has watched the whole game and marked the team's plays, with tags, a rating and a coaching note on each. {sharer} already paid for it, so it is free for you. |
| SHARE_EMAIL_TAGGED | {sharer} tagged {athlete} in {n} plays. |
| SHARE_EMAIL_BUTTON | Find {athlete}'s plays |
| SHARE_CARD_TITLE | AI Coach, shared by {sharer} |
| SHARE_CARD_FREE | Free for you. {sharer} paid once for the team. |
| SHARE_CARD_COUNT | {n} plays for {color} are in team plays. |
| SHARE_CARD_TAGGED | {sharer} tagged {athlete} in {n} of them. |
| SHARE_CARD_FIND | Find {athlete}'s plays |
| SHARE_CHIP | AI Coach: shared |
| SHARE_SUGGEST | {sharer} says this is {athlete} |
| SHARE_RUNNING_LINE | {sharer} shared this game with AI Coach. Free for you. |
| SHARE_OWN_GAMES | Want this on your own games? AI Coach is 1.5 credits per minute of video. |

Implementer note: the strings go in `src/frontend/src/config/displayNames.js` as one new group. Copy never uses "her" or "his" for the athlete; it repeats the name.

---

## 9. Owner rulings (2026-11-12)

All screens in this file were approved by the owner on 2026-11-12. Where a ruling below differs from text earlier in the file, the ruling wins and the implementer follows it.

1. AI Coach is never added without the parent's own tap. Nothing in the offer is selected in advance.
2. An analysis that finishes is always charged, even when it finds few plays. The ready state still says the real number found. There is no automatic return of credits for a small result; credits come back only when the analysis does not finish.
3. Lane names do not change. Use the labels the app shows today ("My athlete" and "Team", and the existing headings for each list of plays). This feature adds no new name for a lane.
4. Moving a play between My athlete and Team, and editing a play, work exactly as they do today. "This is {athlete}" on a chip is the existing switch and nothing more: the play keeps the tags, rating and note it arrived with, and the parent edits them if they want to. The existing rule that the athlete's own plays carry no teammate names stays.
5. Position memory is a suggestion for this game only, and the parent can always change the answer.
6. Free cancel until the upload finishes; no cancel after the analysis starts.
7. Tagging a teammate from a chip is the app's existing teammate tagging: the parent enters the player's name and email address, and that family gets the game and the plays in the Team lane, as today. That flow is not changed. This feature only makes it one tap away from each chip ("Right winger", "Player 10"): the chip opens the existing name entry with names already used in this game offered first, and the existing step that collects the email address and shares.
8. (2026-11-13) The AI sometimes mixes the teams up, so every AI play carries a "Wrong team" button that flips that one play to the other team's side of it and records the miss. The owner ruled out removing the play: that is no more help than deleting it. See "Wrong team on one play" in section 6. This was added after the screens were approved and has no approved mock-up; it follows the "Looks right" button's style.

9. (2026-11-14) The option is called AI Coach on every screen. "Coach-level analysis of the whole game" stays as its one-line promise.
10. (2026-11-14) AI Coach is offered in its own dialog once the upload is running, and the upload dialog does not change. The same dialog opens from the game. Sections 1, 2 and 4 are drawn to this ruling and wait for the owner's approval.
11. (2026-11-14) One payment covers the team. A family that receives a shared game from someone who has AI Coach on it gets the full AI Coach on that game for free, and can share it on. A parent who uploads the same video on their own, without a share, pays the normal price. Section 11 is drawn to this ruling and waits for the owner's approval.
12. (2026-11-14) Choices made while drawing sections 1, 2, 4 and 11 that the owner has not ruled on: the offer stops opening by itself after three "Not now" answers in a row; the offer shows one example play labelled as coming from another game; no email is sent to sell AI Coach to a family that received it free; a receiver's AI plays are a fresh set from the stored analysis, not a copy of the sharer's edited plays.

---

## 10. Choosing a sport where tags go

### The problem today

When the athlete profile has no sport, the place where tags would be shows a boxed notice with a heading ("Pick your sport to tag this play"), a helper sentence and a dropdown. It reads as "something is wrong", and it sits where the parent expected tags. In the landscape full-screen editor it is worse: plain text reading "Set your sport (top bar) for tags", pointing at a control that is not on that screen and cannot be tapped. The owner's words: "I didn't like that the tags view locks me out if I haven't picked a sport instead of giving me UI to choose a sport and acting like nothing is wrong."

(A note for accuracy: in the code the full notice was already changed from amber to grey, but it kept its box, its icon and its notice wording, so it still reads as a warning. If the owner still sees amber on a device, that is a stale build and worth checking separately.)

### The replacement

In every place tags would appear, the "Tags" label stays exactly where it is, and under it, in the same space and the same chip style as the tags themselves, is a row of sport chips. No box, no icon, no heading, no colour other than the normal grey chips. It looks like the first step of tagging, because it is.

```
Tags
Which sport? Tags are different for each one.
[ Soccer ] [ Basketball ] [ Flag Football ] [ Another sport ]
```

- One tap on a sport chip chooses it. The sport chips are replaced, in place, by that sport's tags. The play being made or edited is untouched: same start and end, same name, same rating, same notes, and the form does not close, scroll or reload.
- "Another sport" opens the device's own picker with the full list.
- For the rest of that form, a small grey line sits above the tags: "Soccer tags. Change". "Change" brings the sport chips back, so a mis-tap costs one tap to fix. After the form closes the line is gone; the sport can be changed from the profile as today.
- The three chips shown are soccer first, then the next two most chosen sports among our users. The order is fixed, not personalised.
- The wording never says "missing", "required", "set up", or "to see tags". Tags stay optional; a play can be saved without choosing a sport, exactly as today.

### Compact variant, landscape full screen

The landscape scrub bar has room for one small item where the tags button would be. It shows a chip the same size and style as its neighbours:

```
[ Pick sport ]
```

Tapping it opens a sheet above the full-screen editor. The video stays visible behind it and the play in progress is untouched.

The sheet is titled "Which sport is this?" and shows every sport as a large button, three to a row.

One tap chooses the sport and closes the sheet. The "Pick sport" chip becomes the normal tags control for that sport, and the tag choices open straight away, since choosing tags is what the parent was trying to do. The sheet closes with its X or the Escape key and changes nothing if closed.

### Where this applies

| Place | Today | After |
|---|---|---|
| Play form on desktop (details panel) | Boxed notice with dropdown | Sport chips under "Tags" |
| Play form on phone, portrait (details pop-up) | Boxed notice with dropdown | Sport chips under "Tags" |
| Full-screen editor, landscape scrub bar | Dead text pointing at the top bar | "Pick sport" chip that opens the sheet |
| Suggested plays list (imported plays) | Boxed notice with dropdown | Sport chips under "Tags" |
| Upload dialog | Optional sport field | Unchanged |
| AI Coach offer (sections 1 and 4) | New | Asks for the sport with the same chips when the profile has none |
| Tag players pass (section 7) | New | Never needed: the sport is always known before an analysis can start |

### For the implementer

- Replace both variants of `components/shared/NoSportTagWarning.jsx` (consider renaming it, since it is no longer a warning; a rename is its own mechanical commit). Call sites: `modes/annotate/components/DetailsFields.jsx`, `modes/annotate/components/ClipDetailsEditor.jsx`, and the compact use in `modes/annotate/components/AnnotateFullscreenOverlay.jsx`.
- Chips use the tag selector's own chip classes, with `coarse-pointer:min-h-[44px]`. "Another sport" wraps `components/shared/InlineSportSelect.jsx` (native picker).
- The pick calls the existing `onSetSport` handler, which writes the profile sport on that tap. The form must re-render in place with no remount, as the current full variant already does.
- The landscape sheet is portalled to `document.body` above the overlay's layer (`constants/zLayers`), and never uses `position: fixed` inside the blur card. Close by X or Escape only.
- "Change" and the "Soccer tags." line are form-local view state; nothing about them is stored.
- Existing strings `SPORT_PICK.CHIP` ("Pick sport") and `SPORT_PICK.CHIP_ARIA` are reused; `SPORT_PICK.HELPER` and the "Pick your sport to tag this play" heading are retired.
- This section does not depend on the AI epic and can ship first.

---

## 11. Sharing AI Coach

(New 2026-11-14. Not yet approved by the owner; no mock-up has been reviewed. Built by T16202.)

### The rule the parent is told

One payment covers the team. When a parent who has AI Coach on a game shares that game, the family that receives it gets AI Coach on it too, free, and can share it on. The words are always the same: "Pay once. Share it with your whole team for free."

Sharing itself is the app's existing game share and the existing teammate step (name and email address). Nothing about how a game is shared changes. What changes is what arrives, and what the screens say.

### Where the sharer sees it

| Place | What it says | What it does |
|---|---|---|
| The offer (sections 1 and 4) | The free-share box. | Nothing to tap; it is part of the pitch. |
| Summary card after the plays are added (section 6) | A second button under "Tag players": "Share with your team, free". One grey line: "Every family you share this game with gets AI Coach on it, at no cost to them." | Opens the existing game share. |
| Last screen of the Tag players pass (section 7) | Under the three numbers: "Other families can find their own athlete's plays the same way." Button "Share with your team, free". | Opens the existing game share. |
| The teammate step, when a teammate is tagged from a chip (section 7) | One added line above the email field: "{name}'s family gets this game with AI Coach, free." | Nothing new; the step shares as it does today. |
| The existing share dialog, on a game with AI Coach | One added line at the top: "This game has AI Coach. Everyone you share it with gets it free." | Nothing new. |
| The "AI Coach finished" email (section 3) | A last line: "Pay once, share free: every family you share this game with gets AI Coach on it too." | None. |

The share button on the summary card is a tinted secondary button, like "Tag players". "Mark play" remains the one solid cyan action on the screen.

### What the receiving family sees

The share email:

- Subject: "{sharer} shared {game} with AI Coach"
- Body: "{sharer} shared {game} with you. It comes with AI Coach: the AI has watched the whole game and marked the team's plays, with tags, a rating and a coaching note on each. {sharer} already paid for it, so it is free for you." When the sharer tagged their child, one more sentence: "{sharer} tagged {athlete} in {n} plays."
- Button: "Find {athlete}'s plays", or "Open the game" when the receiver has no athlete profile yet.

A receiver without an account creates one to open the game, as with any share today.

On the game, in the slot the other AI Coach cards use:

```
+--------------------------------------------+
| AI Coach, shared by Sam               ...  |
| Free for you. Sam paid once for the team.  |
|                                            |
| 46 plays for White are in team plays.      |
| Sam tagged Ava in 6 of them.               |
|                                            |
| [ Find Ava's plays ]                       |
| Watch the plays                            |
+--------------------------------------------+
```

- The numbers are real. The second line of the count appears only when the sharer tagged the receiver's child.
- "Find {athlete}'s plays" opens the Tag players pass (section 7). The plays the sharer tagged open first, each with a suggestion chip: "Sam says this is Ava", with the two small buttons "Ava" and "No". Nothing is assigned until the receiver taps.
- The "..." menu holds "Switch team" (for a parent of the other team), "Share with your team, free" and "Remove AI plays I have not touched".
- The game tile shows the chip "AI Coach: shared" in cyan until the pass has been opened once.
- The receiver's AI plays look and behave like any AI play (section 6): the "AI" pill, "Looks right", "Wrong team".

### The receiver's own next game

- On the done screen of the receiver's first Tag players pass, under the share button, one quiet line: "Want this on your own games? AI Coach is 1.5 credits per minute of video." It is a line, not a dialog.
- The next time the receiver uploads a game, the offer (section 1) carries the line "You used AI Coach on a game {name} shared." under the tagline.
- No email is sent to sell AI Coach to a receiver.

### States

| State | What the receiver sees | What they can do |
|---|---|---|
| Shared while the analysis is still running | The usual progress card (section 3) with one line on top: "{sharer} shared this game with AI Coach. Free for you." | Leave; the ready toast and email follow as usual. |
| Shared, team not yet picked by the sharer | "Pick your team" as in section 5, free. | Pick. |
| Receiver already bought AI Coach on this same game | Nothing changes for them. No card, no second set of plays. | Carry on. |
| Receiver is a parent of the other team | The card as drawn, with the sharer's team. "Switch team" is in the menu and in the "Neither looks right" help of the chooser. | Switch, free. |
| The game was shared before the sharer had AI Coach | The receiver's game offers AI Coach at the normal price. If the sharer shares it again after buying, the receiver gets it free. | Ask the sharer, or buy. |

### For the implementer

- The card is the summary card component from section 6 with a shared-by variant; do not build a second card.
- Strings are in section 8 under the `SHARE_` keys. `{sharer}` is the sharing account's display name as the existing share email shows it.
- "Sam says this is Ava" reuses the suggestion chip from "Remembering positions" in section 7; the source of the suggestion differs, the chip does not.
- Events and the server side are in T16202.
