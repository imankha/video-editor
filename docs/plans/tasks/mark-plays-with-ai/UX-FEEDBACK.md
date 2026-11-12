# Mark plays with AI: user feedback spec

Status: DRAFT, waiting for owner approval. Nothing here is built yet.

This file defines everything the parent sees and can do around the new paid option: the offer, the price, the shortfall, the waiting, the team choice, what lands in the game, and the pass where they say which plays are their athlete's. Each section is written in plain sentences first. Component and file pointers are in a short "For the implementer" list at the end of each section. Every visible string is repeated once in the table in section 8, which is the source to copy from.

Three things hold everywhere in this file:

1. Phone first. Every layout is designed at 390 px wide, then widened for desktop. Every tap target is at least 44 px tall.
2. Words follow the copy glossary: the parent's kid is "your athlete" (or the profile name, written `{athlete}` below), other kids are "teammates", a marked moment is a "play", the two groups of plays are "{athlete}'s plays" and "team plays". The task brief said "My player" and "Team line"; the app and the glossary say "My athlete" and "team plays", so this spec uses those (see open question 3).
3. We only show numbers that are real. No smooth fake percentage, no countdown we cannot keep.

Running example used throughout: a 90-minute game, 3 credits of storage, 135 credits of AI analysis.

---

## 1. The offer at upload

### What the parent sees

The upload dialog keeps its order: the one-line explanation, the cost row, the video picker, the optional details. A new card, "Mark plays with AI", sits directly under the video picker, because the price depends on the video and the parent has just dealt with the video.

The card is a single large checkbox row. It is not ticked by default (see open question 1). Unticked, it is compact: three lines and a link. Ticked, it opens to show the full pitch, the honesty line and the disclosure, so nobody pays without having had those two lines on screen.

Phone, unticked, video already picked:

```
+--------------------------------------------+
| [ ] Mark plays with AI                     |
|     Coach-level analysis of the whole game |
|     135 credits for this 90 min game       |
|     See what you get                       |
+--------------------------------------------+
```

Ticked, the card opens in place and shows, in this order: the three benefit lines as a short list, the "Good to know" paragraph, and the Gemini line. The exact words are in the table in section 8.

The "Good to know" paragraph is ordinary grey body text, not a warning box. It is honest without being a scare. The Gemini line is one size smaller and is always visible when the box is ticked.

### How the cost row changes

Unticked, the cost row is exactly what it is today ("Cost: 3 credits", "Balance: 200 credits", and the 30-day note).

Ticked, the row becomes a short itemised list. Each line is a label on the left and credits on the right, and each line stays whole when the screen is narrow:

```
Storage for 30 days             3 credits
AI analysis, 90 min           135 credits
-----------------------------------------
Total                         138 credits
Your balance                  200 credits
Balance after                  62 credits
The AI credits are set aside when the analysis starts and
only taken when it finishes. If it fails, you get them all back.
```

When the balance does not cover the total, the "Balance after" line is replaced by the shortfall line described in section 2.

### States of the card

| State | What the card says | What the parent can do |
|---|---|---|
| No video picked yet | Price line reads "1.5 credits per minute of video. A 90-minute game is 135 credits." If ticked, the itemised row shows "AI analysis: price appears when you pick the video" and no total. | Tick or untick. The Upload button is still waiting for a video, as today. |
| Video picked | Price line reads "135 credits for this 90 min game". Exact, because the length is read from the file. | Tick or untick. The total updates at once. |
| Several videos for one game | Price line reads "135 credits for 90 min across 2 videos". One analysis, one price, lengths added up, rounded up once at the end. | Same. |
| Length cannot be read | Price line reads "We could not read this video's length, so we cannot price the AI analysis. You can start it after the upload." The checkbox is off and cannot be ticked. | Upload without it. Start later from the game (section 4). |
| Sport not chosen on the profile | When the box is ticked, the existing sport field becomes a required step and its label changes to "Which sport is this?". It moves to sit directly under the card. Until a sport is chosen the Upload button reads "Pick a sport to upload". | One tap to choose. Nothing else changes and nothing is lost. |
| Sport is not soccer | The checkbox is off and cannot be ticked. One calm line: "AI play marking is soccer only for now." No pitch, no price. | Upload as normal. |
| Already analysed (cache) | We only learn this once the upload has started reading the file, a few seconds after the parent taps Upload. From then on the game tile and the status card say: "This game has already been analysed, so your plays will be ready right after the upload. Same price: 135 credits." We do not show a waiting animation for work that is not happening. | Carry on. They can still cancel the AI option before the upload finishes, at no charge. |
| Unavailable today (daily limit reached) | Checkbox off. "AI play marking is full for today. Upload now and start it from the game tomorrow." | Upload as normal. |
| Switched off (maintenance) | Checkbox off. "AI play marking is paused right now. Upload now and start it from the game later." | Upload as normal. |

The Upload button reads "Upload game" when the box is unticked and "Upload and mark plays with AI" when it is ticked, so the last thing the parent taps says what they are buying.

### For the implementer

- New card in `components/GameDetailsModal.jsx`, placed after `GameFootagePicker`, inside the scroll body. The submit button stays in the pinned footer.
- Extend `components/shared/CreditCostRow.jsx` with an itemised mode (list of label and credits lines, a total, balance, balance after). Keep each line `whitespace-nowrap` in a wrapping pair, as today.
- Duration comes from `utils/videoMetadata.js` (`extractVideoMetadata`), already called on submit. Call it on pick so the price is exact before submit. Price rule lives in one helper next to `utils/storageCost.js`; the backend stays the authority.
- Sport: reuse the existing sport `select` block and `SPORT_PICK` strings; soccer check against `SUPPORTED_SPORTS` ids in `modes/annotate/constants/tagRegistry.js`.
- Availability (daily limit, switch) and the rate come from one config call when the dialog opens.
- Cache hit is known after hashing in the upload manager. If hashing can be moved before submit later, show the same sentence inside the card.

---

## 2. Not enough credits

### In the upload dialog

Nothing pops up when the parent ticks the box. The shortfall is shown in place, in the cost row, as soon as it is true, so they see it before they tap Upload.

A new account has 88 credits. With the box ticked on our example game the list ends like this:

```
Total                         138 credits
Your balance                   88 credits   (red)
You need 50 more credits.
The 150 credit pack ($6.99) covers it.
```

The footer then holds two buttons instead of one:

- Main button: "Buy 150 credits for $6.99". This opens the existing in-page payment sheet with that pack already chosen. The parent can still pick a bigger pack there.
- Second button, same width, quieter: "Upload without AI". This unticks the box and uploads straight away. The parent can still start the analysis later from the game.

We always name the smallest pack that covers the gap: 150 credits for $6.99 up to 150 missing, 340 for $12.99 up to 340 missing, 1000 for $29.99 above that. If no single pack covers the gap (a very long, multi-video game), the line reads "You need {n} more credits." and the button reads "Buy credits".

### After paying

When the payment succeeds the payment sheet closes, a green toast says "Credits added. Uploading your game with AI play marking.", and the upload starts by itself with the box still ticked. The parent does not have to tap Upload again.

### If the payment fails or is abandoned

- A card that is declined shows the payment provider's own message inside the payment sheet, and the parent can try another card there.
- If they close the payment sheet, they are back in the upload dialog exactly as they left it: same video, same details, box still ticked, both buttons still there. A grey line above the buttons says "Payment did not go through. Nothing was charged. Try again, or upload without AI."
- Nothing is uploaded and nothing is charged until they choose one of the two buttons.

### In the start-later sheet (section 4)

Same pattern, one difference: there is no upload to fall back to. The two buttons are "Buy 150 credits for $6.99" and "Not now". After paying, the toast says "Credits added. Starting AI play marking." and the analysis starts by itself.

### One late case

Credits are set aside when the analysis starts, which is after the upload. If the parent spent credits on something else during the upload and no longer has enough, the analysis does not start and nothing fails silently. The game tile and the status card say "AI play marking is waiting: you need {n} more credits." with the same two choices ("Buy {pack} credits for {price}", "Skip AI for this game").

### For the implementer

- `components/GameDetailsModal.jsx` already opens `components/BuyCreditsModal.jsx` and resumes through `handlePaymentSuccess`. Add a preselected-pack prop to `BuyCreditsModal`, and a neutral reason panel: its current `insufficientCredits` panel says "This export requires", which is wrong here.
- Do not use `components/InsufficientCreditsModal.jsx` for this flow. It adds a second dialog on top of a dialog and has no "without AI" exit. The in-place row plus two buttons replaces it.
- Pack list comes from `/api/payments/config` (already cached in `BuyCreditsModal`). Never hard-code prices.
- Fire the existing paywall funnel beacon when the shortfall row first appears with the box ticked.

---

## 3. Honest progress

### Where progress shows

There are two places, and they always say the same thing.

1. The game tile on the Games tab: a small chip in the top-left corner plus one line of text under the game name.
2. A status card in Annotate, directly under the video, above the action cards. It is the full version: a title, a three-step list, the real count, the time estimate, and what the parent can do now.

The status card, while the AI is watching the game:

```
+--------------------------------------------+
| AI is marking plays                        |
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
| A | Uploading, AI next | The browser is uploading. The analysis has not started. No credits are set aside yet. | Existing uploading tile, unchanged, plus a second chip "AI next". | Title "AI play marking starts after the upload". Line "Keep this tab open until the upload finishes. After that you can leave." The three steps are listed, all not started. | Mark plays by hand while waiting. Cancel the AI option ("Cancel AI play marking", no charge). |
| B | Getting the video ready | The video is being sent to the analysis service and prepared. We have no finer measure than "started". Credits are set aside. | Chip "AI: getting ready". Line "Getting the video ready". | Title "AI is marking plays". Step 1 is current, with a spinner and "Started 3 min ago. Usually 5 to 10 minutes for a game this long. This is an estimate." No bar. | Leave. Mark plays by hand. No cancel from here on (see open question 6). |
| C | Watching the game | Sections are being watched in parallel. We know the exact number finished. | Chip "AI: watching". Line "11 of 18 sections watched". A thin strip of 18 cells along the bottom edge of the tile. | Step 2 is current. "11 of 18 sections watched", the 18 boxes, and "Usually 2 to 4 minutes for this step. This is an estimate." | Leave. Mark plays by hand. |
| D | Taking a second look | Some sections stopped early and are being watched again. They were never counted as watched, so the count never goes backwards. | Same as C. | Same as C plus one line: "Taking a second look at 2 sections." Those boxes show a dashed outline. | Same as C. |
| E | Putting the plays together | All sections are watched. Results are being merged. Seconds. | Chip "AI: finishing". Line "18 of 18 sections watched". | Step 3 is current: "Putting the plays together. A few seconds." | Wait or leave. |
| F | Ready, needs team color | The analysis is complete. Credits have been taken. Nothing is in the game yet. | Chip "Pick your team" in cyan. Line "AI plays are ready". | Title "The AI finished watching". Line "It found plays for both teams. Pick your team and we add yours." Button "Pick your team". | Pick the team (section 5). Or leave it for later: it waits, with no time limit while the game is stored. |
| G | Ready from an earlier analysis | This exact video was analysed before. There was no waiting. Credits have been taken. | Same as F. | Title "Ready already". Line "This game was analysed earlier from another upload of the same video, so there was nothing to wait for. Same price: 135 credits." Button "Pick your team". No step list, no spinner. | Same as F. |
| H | Joined an analysis already running | Someone else started an analysis of this same video. This account joined it. Credits are set aside. | Same as B, C, D or E, whichever is true. | Whichever of B to E is true, with one line on top: "This game is already being analysed from another upload of the same video. You joined it, so it will be ready sooner." | Same as B to E. |
| I | Taking longer than usual | The current step has run past the top of its estimate. It is still running. | Chip unchanged. Line "Taking longer than usual". | The estimate line is replaced by "Taking longer than usual. It is still working. There is nothing you need to do." | Leave. |
| J | Trying again | The service was busy and we are retrying by ourselves. | Chip unchanged. Line "Service busy, trying again". | "The analysis service is busy. Trying again (attempt 2 of 3)." The count of finished sections stays as it was. | Leave. |
| K | Failed, credits returned | The analysis did not finish after retries. All set-aside credits are back. Nothing was taken. | Chip "AI did not finish" in rose. Line "135 credits returned". | Title "AI play marking did not finish". One reason line (below). "Your 135 credits are back in your balance. Nothing was charged." Buttons "Try again" and "Dismiss". | Try again (same price, set aside again). Dismiss. Mark plays by hand. |
| L | Waiting for credits | The upload finished but the balance no longer covers the analysis. Nothing is set aside. | Chip "AI waiting". Line "Needs 50 more credits". | Section 2, "One late case". | Buy and start. Skip AI for this game. |
| M | Came back later | The parent left and returned. | The tile shows whichever state above is true right now. | Whichever card above is true right now. If it became ready while they were away, the first screen they land on also shows the "ready" toast once. | As per the true state. |
| N | Plays added | The team was picked and plays were imported. | Chip "Tag players" in cyan until the tag pass has been opened once, then no chip. | The summary card from section 6. | Section 6 and 7. |

Reason lines for state K (exactly one is shown):

- Service busy: "The analysis service was too busy, even after we retried."
- Incomplete: "Some sections of the game could not be watched, so we stopped instead of giving you half a result."
- Not a game or too short: "The AI did not find a game it could mark plays in. This works on full soccer games filmed from the sideline."
- Storage expired during the run: "This game's video is no longer stored, so the AI could not watch it."

If the analysis finishes but finds only a handful of plays, that is not a failure screen. The ready state says the real number ("The AI found 4 plays for both teams.") and section 5 shows the real count per team. Whether we charge for a near-empty result is open question 2.

### Toasts and email

| Moment | Toast (in the app) | Email |
|---|---|---|
| Analysis starts after upload | "Upload finished. The AI is now watching your game. You can leave, we will email you." | None. |
| Ready (states F and G) | "The AI finished watching {game}. Pick your team to add the plays." with a "Pick your team" action. | Subject: "The AI finished watching {game}". Body: "The AI has watched {game} and marked the plays. Open the game and pick your team's jersey color, and we add your team's plays for you to check. The AI marks plays for the whole team and can miss a play or include a weak one. You can edit or remove anything." Button: "Open the game". |
| Failed (state K) | "AI play marking did not finish for {game}. Your {n} credits are back." | Subject: "AI play marking did not finish. Your credits are back". Body: "We could not finish marking plays in {game}. {reason line} Your {n} credits are back in your balance and nothing was charged. You can try again from the game." Button: "Open the game". |

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

### Entry points

1. Game tile menu (the three-dot button). A new item, "Mark plays with AI", sits first in the menu when the game has no analysis. It is not shown for games whose video is no longer stored and cannot be extended.
2. Annotate, next to "Mark play". A new action card titled "Mark plays with AI", with the line "The AI watches the game and marks your team's plays." It sits second, right after "Mark play". "Mark play" stays the one solid cyan card on the screen. On a phone "Mark play" takes the full width on top and the other cards sit two-up beneath it.
3. The empty play list. Where the list says there are no plays yet, a second line offers: "Or let the AI mark your team's plays." as a link that opens the same sheet.

This one card slot follows the game through its life, so the parent always finds the AI in the same place: "Mark plays with AI", then "AI is marking plays" with the real count, then "Pick your team", then "Tag players" with "12 of 46".

### The confirm sheet

All three entry points open one sheet. On a phone it slides up from the bottom and has its own close button. It does not close when the parent taps outside it.

```
+--------------------------------------------+
| Mark plays with AI                      X  |
| Coach-level analysis of the whole game     |
| (the three benefit lines from section 1)   |
| (the "Good to know" paragraph)             |
| (the Gemini line)                          |
| AI analysis, 90 min         135 credits    |
| Your balance                200 credits    |
| Balance after                65 credits    |
| Credits are set aside now and only taken   |
| when the analysis finishes. If it fails,   |
| you get them all back.                     |
| Usually ready in 10 to 15 minutes. This is |
| an estimate. You can leave, we email you.  |
| [ Start: 135 credits ]                     |
| [ Not now ]                                |
+--------------------------------------------+
```

There is no storage line here: storage was paid at upload. The main button always carries the price.

### States of the sheet

| State | What the sheet says | What the parent can do |
|---|---|---|
| Normal | As drawn. | Start, or Not now. |
| Sport not chosen | A step appears above the price: "Which sport is this?" with the sport picker. The Start button is off and reads "Pick a sport to start" until one is chosen. Choosing soccer turns it on in place. | Pick. Nothing else on the sheet moves. |
| Sport is not soccer | The pitch is replaced by one line: "AI play marking is soccer only for now." One button: "OK". | Close. |
| Not enough credits | Section 2, start-later variant. | Buy and start, or Not now. |
| Video no longer stored, can be extended | "This game's video is no longer stored, so the AI has nothing to watch. Extend storage first, then start." Button "Extend storage" (the existing flow), then the sheet reopens. | Extend, or close. |
| Video no longer stored, cannot be extended | "This game's video is no longer stored, so the AI has nothing to watch. Upload the game again to use AI play marking." One button: "OK". | Close. |
| Analysis already running for this game | No sheet. The entry point opens the game and scrolls to the status card. | See progress. |
| Analysis already done, team not picked | No sheet. Opens the team chooser (section 5). | Pick the team. |
| Analysis already done, plays added | A small sheet: "This game is already analysed. You will not be charged again." Buttons: "Tag players", "Switch team", "Add the AI plays again" (only if some were removed). | Any of the three, all free. |
| Already analysed by someone else (cache) | The estimate line is replaced by "This game has already been analysed, so your plays will be ready in seconds. Same price: 135 credits." | Start, or Not now. |
| Unavailable today or paused | The lines from section 1, with one button: "OK". | Close. |

### For the implementer

- Menu item in `components/GameTile.jsx` (same list the mobile sheet and desktop popover share).
- Action card in the grid in `modes/AnnotateModeView.jsx` (the non-edit `ActionCard` grid). Five cards break the current `lg:grid-cols-4`: use five columns at `lg` when the card is present, and on phones make "Mark play" span both columns. Use the secondary `ActionCard` variant; never a second solid cyan card.
- Sheet: new component, built like `VeoImportSheet`. Portal to `document.body`; never `position: fixed` inside the Annotate blur card.
- Sport step uses `components/shared/InlineSportSelect.jsx`; the pick writes the profile sport on that tap.
- "Never charged twice" is enforced by the server per account and game; the sheet only reflects it.

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
| Watch the plays                            |
+--------------------------------------------+
```

- The title is the real number.
- The second line is the real spread of ratings, using the app's rating words.
- "Tag players" is the next step and opens the pass in section 7. It is styled as a tinted cyan secondary button, because "Mark play" remains the single solid cyan action on this screen.
- "Watch the plays" opens the existing play-through of the team plays.
- The "..." menu holds "Switch team" and "Remove AI plays I have not touched".
- The card can be dismissed with its close button. The same actions stay reachable from the "Tag players" action card and the tile menu.

### How an AI play looks

- On the timeline, AI plays sit in the team plays lane in the usual amber. Until the parent touches one, it has a dashed outline instead of a solid one. Shape carries the meaning, not color alone.
- In the play list, the row shows a small grey pill with the letters "AI" before the play name. The pill has the tooltip and screen-reader label "Marked by AI, not checked yet".
- In the play editor, a quiet line under the title reads "Marked by AI. Check the start, end and rating." with a small button "Looks right".
- The play arrives filled in: start and end, the one-sentence summary as its name, tags, rating, and the coaching notes in the notes field. The player chips from section 7 sit under "Who is this play about?".
- The AI mark and the dashed outline go away, for that play, the moment the parent edits anything, taps "Looks right", tags a player on it, or moves it to their athlete's plays. From then on it is simply their play.
- The play list gets one extra filter chip, "AI, not checked ({n})", shown only while there are some.

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

Done screen: the title "You went through all 46 plays", then three lines with real numbers ("14 are Maya's plays", "20 have teammates tagged", "12 left as team plays"), a main button "Watch Maya's plays" and a quiet "Done".

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

`{n}`, `{m}`, `{min}`, `{price}`, `{pack}`, `{athlete}`, `{name}`, `{game}`, `{color}` are filled in at run time. Plurals go through the shared helper ("1 play", "2 plays", "1 credit", "2 credits", "1 section", "2 sections").

| Key | Text |
|---|---|
| OFFER_TITLE | Mark plays with AI |
| OFFER_TAGLINE | Coach-level analysis of the whole game |
| OFFER_SEE_MORE | See what you get |
| OFFER_BENEFIT_1 | Watches the full game and marks your team's best plays for you. |
| OFFER_BENEFIT_2 | Every play gets tags, a rating and a one-sentence summary. |
| OFFER_BENEFIT_3 | A coaching note for the players involved: what to learn, or which pro it looked like. |
| OFFER_HONESTY | Good to know: it finds plays for the whole team and cannot tell which player is yours, so you pick your athlete's plays afterwards. It can miss a play or include a weak one. You can edit or remove anything. |
| OFFER_DISCLOSURE | Your video is sent to Google's Gemini service to be analysed. |
| OFFER_RATE | 1.5 credits per minute of video. A 90-minute game is 135 credits. |
| OFFER_PRICE | {n} credits for this {min} min game |
| OFFER_PRICE_MULTI | {n} credits for {min} min across {m} videos |
| OFFER_NO_LENGTH | We could not read this video's length, so we cannot price the AI analysis. You can start it after the upload. |
| OFFER_SOCCER_ONLY | AI play marking is soccer only for now. |
| OFFER_FULL_TODAY | AI play marking is full for today. Upload now and start it from the game tomorrow. |
| OFFER_PAUSED | AI play marking is paused right now. Upload now and start it from the game later. |
| OFFER_CACHED | This game has already been analysed, so your plays will be ready right after the upload. Same price: {n} credits. |
| SPORT_QUESTION | Which sport is this? |
| SPORT_REQUIRED_UPLOAD | Pick a sport to upload |
| SPORT_REQUIRED_START | Pick a sport to start |
| COST_STORAGE | Storage for {n} days |
| COST_AI | AI analysis, {min} min |
| COST_AI_PENDING | AI analysis: price appears when you pick the video |
| COST_TOTAL | Total |
| COST_BALANCE | Your balance |
| COST_AFTER | Balance after |
| COST_RESERVE_NOTE_UPLOAD | The AI credits are set aside when the analysis starts and only taken when it finishes. If it fails, you get them all back. |
| COST_RESERVE_NOTE_START | Credits are set aside now and only taken when the analysis finishes. If it fails, you get them all back. |
| UPLOAD_WITH_AI | Upload and mark plays with AI |
| SHORT_NEED | You need {n} more credits. |
| SHORT_PACK | The {pack} credit pack ({price}) covers it. |
| SHORT_BUY | Buy {pack} credits for {price} |
| SHORT_BUY_GENERIC | Buy credits |
| SHORT_WITHOUT_AI | Upload without AI |
| SHORT_NOT_NOW | Not now |
| SHORT_PAID_UPLOAD | Credits added. Uploading your game with AI play marking. |
| SHORT_PAID_START | Credits added. Starting AI play marking. |
| SHORT_PAY_FAILED | Payment did not go through. Nothing was charged. Try again, or upload without AI. |
| SHORT_WAITING | AI play marking is waiting: you need {n} more credits. |
| SHORT_SKIP_AI | Skip AI for this game |
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
| STATUS_TITLE_QUEUED | AI play marking starts after the upload |
| STATUS_QUEUED_BODY | Keep this tab open until the upload finishes. After that you can leave. |
| STATUS_CANCEL | Cancel AI play marking |
| STATUS_TITLE_RUNNING | AI is marking plays |
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
| STATUS_TITLE_FAILED | AI play marking did not finish |
| STATUS_FAILED_CREDITS | Your {n} credits are back in your balance. Nothing was charged. |
| FAIL_BUSY | The analysis service was too busy, even after we retried. |
| FAIL_INCOMPLETE | Some sections of the game could not be watched, so we stopped instead of giving you half a result. |
| FAIL_NOT_GAME | The AI did not find a game it could mark plays in. This works on full soccer games filmed from the sideline. |
| FAIL_EXPIRED | This game's video is no longer stored, so the AI could not watch it. |
| FAIL_TRY_AGAIN | Try again |
| FAIL_DISMISS | Dismiss |
| TOAST_STARTED | Upload finished. The AI is now watching your game. You can leave, we will email you. |
| TOAST_READY | The AI finished watching {game}. Pick your team to add the plays. |
| TOAST_FAILED | AI play marking did not finish for {game}. Your {n} credits are back. |
| EMAIL_READY_SUBJECT | The AI finished watching {game} |
| EMAIL_READY_BODY | The AI has watched {game} and marked the plays. Open the game and pick your team's jersey color, and we add your team's plays for you to check. The AI marks plays for the whole team and can miss a play or include a weak one. You can edit or remove anything. |
| EMAIL_FAILED_SUBJECT | AI play marking did not finish. Your credits are back |
| EMAIL_FAILED_BODY | We could not finish marking plays in {game}. {reason} Your {n} credits are back in your balance and nothing was charged. You can try again from the game. |
| EMAIL_BUTTON | Open the game |
| START_CARD_BODY | The AI watches the game and marks your team's plays. |
| START_EMPTY_LIST | Or let the AI mark your team's plays. |
| START_BUTTON | Start: {n} credits |
| START_ESTIMATE | Usually ready in {n} to {m} minutes. This is an estimate. You can leave, we email you. |
| START_CACHED | This game has already been analysed, so your plays will be ready in seconds. Same price: {n} credits. |
| START_EXPIRED_EXTEND | This game's video is no longer stored, so the AI has nothing to watch. Extend storage first, then start. |
| START_EXTEND_BUTTON | Extend storage |
| START_EXPIRED_GONE | This game's video is no longer stored, so the AI has nothing to watch. Upload the game again to use AI play marking. |
| START_ALREADY | This game is already analysed. You will not be charged again. |
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

Implementer note: the strings go in `src/frontend/src/config/displayNames.js` as one new group. Copy never uses "her" or "his" for the athlete; it repeats the name.

---

## 9. Open questions for the owner

1. Should the box start ticked or unticked? Recommendation: unticked. A new account has 88 credits and a full game costs about 138 with the box ticked, so a ticked box would put a payment screen in front of every first upload, which is the step we most need new parents to finish. The card is still the most prominent thing under the video picker.
2. Do we charge when the AI finishes but finds almost nothing? Recommendation: if it finds fewer than 5 plays in total, treat it as "did not find a game", return all credits and say so. Above that, charge and show the real count. This keeps "you only pay for a result" true without inviting abuse.
3. Wording: the brief said "My player" and "Team line"; the app and the copy glossary say "My athlete" and "team plays" (owner decision of 2026-11-03). Recommendation: keep the glossary words, as this spec does.
4. Teammate names are removed when a play becomes the athlete's play (today's rule). In the tag pass this means a goal by Maya cannot also record that Ava assisted. Recommendation: keep the rule for launch, as designed in section 7, and revisit only if parents ask, because changing it touches sharing.
5. Position memory ("right winger = Maya") lasts for one game only. Recommendation: keep it per game. Kids change positions between games, and a wrong suggestion on every play is worse than one extra tap per game. Jersey numbers, when the AI reads one, could later be remembered across games.
6. Can the parent cancel once the analysis has started? Recommendation: no cancel after the upload finishes. The cost to us is spent within minutes, other parents may have joined the same run, and "set aside, then taken only on success" already protects them. Before the upload finishes, cancelling is free.

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
| Upload dialog | Optional sport field | Unchanged, except it becomes a required step when "Mark plays with AI" is ticked (section 1) |
| Tag players pass (section 7) | New | Never needed: the sport is always known before an analysis can start |

### For the implementer

- Replace both variants of `components/shared/NoSportTagWarning.jsx` (consider renaming it, since it is no longer a warning; a rename is its own mechanical commit). Call sites: `modes/annotate/components/DetailsFields.jsx`, `modes/annotate/components/ClipDetailsEditor.jsx`, and the compact use in `modes/annotate/components/AnnotateFullscreenOverlay.jsx`.
- Chips use the tag selector's own chip classes, with `coarse-pointer:min-h-[44px]`. "Another sport" wraps `components/shared/InlineSportSelect.jsx` (native picker).
- The pick calls the existing `onSetSport` handler, which writes the profile sport on that tap. The form must re-render in place with no remount, as the current full variant already does.
- The landscape sheet is portalled to `document.body` above the overlay's layer (`constants/zLayers`), and never uses `position: fixed` inside the blur card. Close by X or Escape only.
- "Change" and the "Soccer tags." line are form-local view state; nothing about them is stored.
- Existing strings `SPORT_PICK.CHIP` ("Pick sport") and `SPORT_PICK.CHIP_ARIA` are reused; `SPORT_PICK.HELPER` and the "Pick your sport to tag this play" heading are retired.
- This section does not depend on the AI epic and can ship first.
