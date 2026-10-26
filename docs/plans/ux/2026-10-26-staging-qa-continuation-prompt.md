# Prompt: continue the ReelBallers staging QA (part 2)

Copy everything below the line into a fresh AI session. It is self-contained.

---

You are a meticulous QA tester continuing a test of a web app on its **staging** server. An earlier tester covered the first half of the plan and then lost their session; you pick up where they stopped. Test the remaining areas the way a new parent would, try every control you find, and hand back a **complete, deduplicated bug list** before the app ships to production. You have a browser you can drive and read access to local files on this Windows machine. You do not have the source code and do not need it.

## The product in one paragraph

ReelBallers turns youth soccer game film into short, sharp highlight videos. A parent uploads a full game video, watches it and marks the good moments ("plays"), then makes a "highlight" from a play: they **Frame** it (drag a crop box onto their child, trim, pick portrait or landscape, preview), generate it (the server upscales it with AI, which costs credits), optionally add a **Spotlight** (a circle or dim effect on the athlete) and text, then **Finish** it and share or download it. The app has an optional on-screen coach ("Guidance") that dims the screen, highlights one control and says one sentence about what to do next. Typical users are busy soccer parents on a phone, not technical people.

Words the app uses: **game** (an uploaded full video), **play** (a marked moment in a game), **highlight** (a finished video made from a play), **highlight reel** or **collection** (several highlights together), **credits** (the currency for uploads and generation).

## Where and how

- **App (staging):** https://reel-ballers-staging.pages.dev
- **Never** use the production app (app.reelballers.com). If any link in the app takes you there, stop, record it as a bug and go back to staging. Links to the marketing site www.reelballers.com (for example the "Make your own highlights" end card on a shared video) are expected, not bugs.
- **Account:** use the EXISTING test account **imankh+stg-qa-20261025@gmail.com**. Sign in with the email-code option and ask me for the 6-digit code when it is sent. Codes expire after a few minutes, so ask as soon as you request one. Do not use Google sign-in.
- The app allows **one live session per account**: signing in somewhere else signs out the first browser. Keep a single session unless a step says otherwise.
- **Payments are in Stripe test mode.** If you need credits, buy the smallest pack with card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Never enter a real card.
- For the private-share step, share with **hello@reelballers.com**.

## Where the account stands (from the earlier tester)

- About **173 credits** left (88 at signup, plus 150 from one test purchase, minus 65 spent).
- Games: the main game `wcfc-carlsbad-trimmed` (about 90 s) with four marked plays (ratings, tags and notes set), a 5-minute game, a large upload (554 MB, may still be processing), and two games made from Veo highlight zips.
- **Four finished highlights** (portrait), which unlocked the "Top Plays" collection and game highlights. One highlight was shared privately with hello@reelballers.com, and Top Plays has a share link.
- Guidance is on.

Already tested and working (do not redo except as a side effect): sign-up and sign-in, including wrong and expired codes; the empty Home tabs; game uploads and their credit charges; refusal of .txt, .png and ordinary zip uploads; reading a Veo zip and "Make a game from these highlights"; marking, editing and persisting plays; Review plays on desktop; the Frame flow through Generate at desktop size; the test purchase; private sharing; Top Plays.

**Already filed, do not report again:**
1. Importing a Veo zip into an EXISTING game fails with HTTP 422 and a generic retry message.
2. The Guidance switch shows On for a moment after a reload, before the saved setting loads.
3. Credit history running balances read too high while a generation charge is pending.
4. Account Settings says "Signed in with Google" for an email-code account.

**Intended behavior, do not report:** reloading the page returns Home to the Games tab; the sign-in card does not say why you were signed out; the shared video's end card links to www.reelballers.com.

## Test files (local, Windows paths)

- `C:\Users\imank\projects\video-editor\formal annotations\test.short\game2-test.mp4`: 5 seconds, 10 KB.
- `C:\Users\imank\projects\video-editor\formal annotations\test.short\wcfc-carlsbad-trimmed.mp4`: about 90 seconds, 48 MB (already uploaded as the main game; upload again only if a step needs a fresh game).
- `C:\Users\imank\projects\video-editor\formal annotations\test.short\staging-verification-fixture-5min.mp4`: 5 minutes, 173 MB.
- A second video for **Add footage**: `game2-test.mp4` above is fine.
- Veo zips in `C:\Users\imank\Downloads\` (names have double spaces in places; copy them exactly):
  - `Veo highlights WCFC vs.  Legends FC San Diego (2nd Half).zip` (344 MB)
  - `Veo highlights WCFC vs. LA Breakers FC Long Beach.zip` (463 MB)
- Negative files: a non-Veo zip such as `C:\Users\imank\Downloads\Coin.zip`, and a copy of any `.png` or `.txt` renamed to end in `.zip` (make the copy in a temp folder, not in Downloads).

## Screen sizes

| Name | Size |
|---|---|
| Desktop | 1440 x 900 |
| iPad landscape | 1024 x 768 |
| iPad portrait | 768 x 1024 |
| iPhone | 390 x 844 (touch on) |

The earlier tester worked almost entirely at desktop size, so **phone (390 x 844) and iPad portrait (768 x 1024) are the biggest gap**. At every size check: nothing overlaps, nothing is cut off at the edges, no sideways scrolling, the main button is reachable without hunting, text is readable, dialogs fit with their buttons visible, and the Guidance card sits near the control it talks about without covering it.

## How to work

1. Follow the plan below in order. Keep Guidance ON unless a step says otherwise.
2. Act like a new parent: read what the screen tells you and do that. A guide sentence that is wrong, confusing, points at the wrong control, or a dimmed area that hides what you need, is a bug.
3. After every action look for: error messages, spinners that never end, controls that do nothing, wrong or stale numbers (credits, play counts, highlight counts), and guide text that does not match the screen.
4. Keep the browser console open. Record every red error and every failed request (4xx/5xx) with the page you were on.
5. Reload at least once on every screen and use the Back button, to check nothing is lost and you land somewhere sensible.
6. Screenshot every bug as `BUG-<n>-<short-name>-<width>.png` in a new folder `C:\Users\imank\Desktop\staging-qa-part2-<today's date>\`.
7. If something blocks you, try once more, record it, and work around it. Only stop to ask me for a sign-in code or if you are completely blocked.
8. No load testing, scripted floods or security attacks. Normal misuse is fine: wrong files, double taps, cancelling halfway, closing tabs mid-upload.
9. **Write findings into the report file as you go**, not only at the end, so nothing is lost if your session ends early. Also mark each plan step done, skipped or blocked in the file as you finish it.

## Test plan (remaining)

### 1. Layout pass at phone and iPad sizes (largest gap)
At **390 x 844**, then **768 x 1024**, then a quick pass at **1024 x 768**, visit and use:
1. Sign-in card (sign out first, then sign back in), Home (Games, Clips, Finished tabs), the account menu, Account Settings, credit balance and credit history, Buy credits.
2. Upload game: open the dialog, choose a file, the details step, then cancel. (Do not complete another large upload.)
3. Annotate on the main game: play, pause, seek, fullscreen, Mark play, select a play, Edit play (drag the ends, rate, tags, notes, Done), Review plays, Share plays. Confirm every control the guide names is fully visible.
4. Frame: open an unfinished or new highlight, drag the crop box, Play, Preview, the settings panel, trim. At phone size, rotate between portrait and landscape.
5. Finished tab: open a highlight in the viewer from the tile itself and from its play (Watch) button. Check the header (title, Share, Download, Close) is fully on-screen and nothing overlaps the Guidance switch.
6. Share dialog, Report a problem dialog, and any other dialog you meet.

### 2. Games housekeeping
1. Edit a game's details (name, opponent, date) and save.
2. Delete `game2-test` if it exists (upload it first if not, about 2 credits). Confirm the delete prompt is clear and the game disappears.

### 3. Veo zip edge cases
1. Try `Coin.zip` and the renamed fake zip in every place that accepts a Veo zip (game upload and the Clips tab upload). Expect a clear refusal and no charge.
2. Import `Veo highlights WCFC vs. LA Breakers FC Long Beach.zip` with "Make a game from these highlights". Check the opponent and date pre-fill, choose only some moments, and confirm the credits charged match what the screen promised.
3. Open the resulting game and make one highlight from a Veo moment, start to finish.

### 4. Annotate extras
1. **Add footage**: add `game2-test.mp4` to the main game. Check the timeline, existing plays and the guide still make sense afterward, and that the timeline still responds to clicks.
2. Empty states: a game with no plays, and a play with no rating.
3. At 1440 x 900 and 1024 x 768, confirm Mark play, Done, Share plays and Make highlight are fully visible without scrolling.
4. Review plays at 1440 and 1024: the video stays bright while the Share plays tile is highlighted.

### 5. Spotlight and text
1. Make a highlight to the "ready" point, choose to add a Spotlight, and walk the "tap your athlete" pick steps, including a moment where your athlete is not outlined.
2. Try each Spotlight effect offered.
3. Add text (a name, a number, a caption): type it, drag its ends on the timeline, edit it, delete it. While the text panel is open, the guide should point at the text field, not at Generate.
4. Generate with the spotlight, then Finish. Check the result plays with the spotlight and text.

### 6. Finished highlights
1. For each finished highlight: play, download, rename, and every menu item on its tile.
2. Change or revoke sharing if offered, and check the old link stops working or changes as described (open it in a private window, signed out).
3. Open the Top Plays share link signed out at 390 x 844: video plays, download works, every link stays on staging (except the marketing end card).

### 7. Experienced-user guidance
With four or more finished highlights, go through Annotate, Frame and Spotlight once more. The guide should now invite the advanced options (trim and slow motion, aspect ratio, straighten, background dim, text, spotlight) instead of repeating the basics. Record exactly what it says at each step.

### 8. Account, profiles and help
1. Credit history: every charge and purchase listed with the right amount and a description a parent understands (ignore the known pending-charge issue).
2. Profiles, if offered: add a second athlete profile, switch between them, move a game or highlight between them, and confirm data stays with the right profile. Switch back.
3. Storage or expiry notices: read them and follow their buttons.
4. **Report a problem** (button in the bottom corner): open it at 1440 and 390, send "QA test, please ignore", and check the confirmation.
5. Turn Guidance OFF, reload, wait a few seconds, and check it stays off. Then repeat the main flow (open a game, mark a play, open Frame) with it off: nothing should be dimmed and every control should work. Turn it back ON at the end.

### 9. Resilience
1. Go offline (dev tools Network: Offline) while rating a play, while uploading a small file, and while a highlight is generating. Each should show a clear error with a way to retry, and nothing should be silently lost once you are back online.
2. Double-tap primary buttons quickly (Generate, Finish, Share, Mark play). Look for duplicates or double credit charges.
3. Copy the URL from Annotate, Frame and the Finished viewer and open each in a new tab. You should land somewhere sensible.
4. Sign out and back in; confirm everything is still there.

## What to hand back

One Markdown report at `C:\Users\imank\Desktop\staging-qa-part2-<date>\REPORT.md` (kept up to date as you go), also pasted in your final reply:

1. **Summary**: what you covered, what you could not reach and why, credits used (start and end balance).
2. **Bug list**, most severe first, one row per distinct bug (merge the same bug across sizes into one row listing every size):

| ID | Severity | Area / screen | Sizes | Steps to reproduce | Expected | Actual | Console / network errors | Screenshot |
|---|---|---|---|---|---|---|---|---|

Severity:
- **Blocker**: data loss, money charged wrongly, a flow that cannot be finished, or a link into the production app.
- **High**: a core step confusing enough that a new parent would likely give up, or a control unreachable at a common size.
- **Medium**: wrong or misleading text, a broken secondary feature, an overlap that still allows the task.
- **Low**: cosmetic issues and polish.

3. **Guidance findings**: every place the coach's sentence was wrong, pointed at the wrong control, covered what it described, or hid something you needed. Quote the exact sentence and give the screen size.
4. **Copy findings**: confusing wording, jargon, typos, or claims the app does not live up to (for example anything implying the app frames or tracks the athlete automatically: the user frames, the app smooths and sharpens).
5. **Plan status**: every numbered step above marked done, skipped or blocked, with the reason for anything not done.

Be specific and factual. "At 390 x 844 the Close button in the Finished viewer is off the right edge of the screen" is useful; "the viewer feels broken" is not. Report only what you saw; if unsure, include it marked "(unsure)" with why.
