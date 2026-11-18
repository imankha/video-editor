# Full QA pass: every feature on phone, iPad and desktop (kickoff prompt)

Paste everything below the line into a fresh Claude Code session opened in this repo (`c:\Users\imank\projects\video-editor`). It is self-contained.

---

You are running a full quality pass on **ReelBallers**, a web app for sports parents. You will use the app the way a parent does, in a real browser, at phone, iPad and desktop sizes, and exercise every feature. You produce three things:

1. **Bug tasks** written into our plan, each with exact repro steps and the relevant logs.
2. **A confusion review page** for the owner: every piece of UI that would confuse a parent, with a screenshot, why it confuses, and your suggested change, so the owner can agree or disagree before anything is filed.
3. **A coverage report** that says what you tested, at which size, and what you could not reach.

You do not fix anything. You do not change source code. You only test, record and file.

Work through the sections in order. Section 12 is the checklist of what "finished" means; read it now and again before your final reply.

## 1. What the product is, and what you judge it against

A parent has a long video of their kid's game. The app lets them:

1. **Upload the game** (Home, Games tab).
2. **Mark plays**: watch the game and tap "Mark play" at each good moment. Each play can get a star rating, tags, a note and a name. This screen is called Annotate in our docs.
3. **Frame the play**: pick portrait or landscape, drag a box around their athlete so the video zooms in and follows them, optionally trim or slow down, then pay credits to **sharpen** it (an AI upscale that runs on a GPU and takes a few minutes). This step is called Frame in our docs.
4. **Add a spotlight** (optional, free): a circle that follows the athlete, plus optional text such as "#7 Maya". This step is called Spotlight (Overlay in the code).
5. **Finish**: the result is a **highlight**. It lands in the Highlights tab on Home, where it can be watched, downloaded, shared by link, grouped into highlight reels and ranked.

Around that sit the supporting things a parent has to manage: games, plays in progress, finished highlights, profiles (one per athlete), credits and payments, storage time for game videos, and share links.

**The goal you judge everything against:** a parent should be able to mark plays and get a high quality highlight out in the most straightforward way possible, and managing the things that go into it (games, plays, highlights, profiles, credits, storage, links) should be intuitive. Anything that adds a step, hides the next step, uses two words for one thing, or makes the parent wonder "what happens if I press this" works against the goal.

**Words the product uses.** Use these in everything you write, and report it when the app itself breaks them:

| Word | Meaning |
|---|---|
| game | the uploaded full match video |
| play | a moment the parent marked in a game, or a short video they uploaded |
| highlight | a finished short video, after the paid sharpen step |
| highlight reel | several highlights joined; never used for a single one |
| athlete | the parent's kid (never "player"); other kids are teammates |
| spotlight | the following circle |
| box / position | the Frame rectangle, and each placement of it |
| Home tabs | Games, Plays, Highlights |

The word "clip" is retired from anything a parent reads. If you see "clip", "reel" for a single highlight, "player" for the athlete, "annotation", "draft" or "project" in the UI, that is a copy finding.

## 2. Hard rules (read twice)

- **Test on staging only.** Never open `app.reelballers.com` (production). Links to `www.reelballers.com` (the marketing site) are expected in a few places and are fine to see, not to test.
- **Never change source code, never run the backend test suite** (it empties the shared database), never run migrations, never deploy.
- **Never press the final button on anything destructive to the account itself.** For "Delete my account", go as far as the dialog that asks you to type DELETE, screenshot it, and cancel. Deleting test games, plays and highlights that you created during this pass is fine and is part of the test.
- **Never send anything to a real person.** When a share dialog needs an email address, use only `hello@reelballers.com`.
- **Money:** staging uses Stripe test mode. The only card you may use is `4242 4242 4242 4242`, any future date, any CVC and ZIP. Sharpening uses a real GPU, so keep it to at most 8 sharpens in the whole pass, each on a play 10 seconds or shorter.
- **In the admin panel you look, and you touch only what section 7 "Admin panel" names.** Never send an email or bulk email, never create or edit a campaign, never use a bulk action, never clear or delete any user's data, and never grant credits to, or log in as, any account other than `e2e@test.local`.
- **Do not guess.** If you did not see it happen, do not write that it happens. If a finding happened once and you could not make it happen again in three tries, file it as "possible" and say so.
- **Never read a long log into the conversation.** Redirect command output to a file and use the `reduce_log` tool with `tail` and `grep`.
- **Writing style for everything you file:** plain full sentences a parent could read. No em dashes, no double hyphens, no arrows, no code names in the readable part. ASCII only in commit messages.
- If a tool call is denied, do not retry it the same way. Note it in the report and move on.

## 3. Setup

### 3.1 Tools

Load the browser tools with ToolSearch: `select:mcp__playwright__browser_navigate,mcp__playwright__browser_run_code_unsafe,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_snapshot,mcp__playwright__browser_resize,mcp__playwright__browser_console_messages,mcp__playwright__browser_network_requests,mcp__playwright__browser_file_upload,mcp__playwright__browser_handle_dialog,mcp__playwright__browser_click,mcp__playwright__browser_type,mcp__playwright__browser_press_key`. Also load `mcp__logreducer__reduce_log`.

`browser_run_code_unsafe` is the workhorse: it runs Playwright code against the page, so chain several actions per call. It has no `require`.

### 3.2 Where the app is

- App: `https://staging.reelballers.com`. If that does not load, use `https://reel-ballers-staging.pages.dev`. Write down which one you used.
- API: `https://api-staging.reelballers.com/api`. Confirm it by looking at the app's own network requests after the page loads, and use whatever host the app is calling.
- Staging sleeps when idle. The first load can take up to two and a half minutes and the first sign-in can return a 500. Wait and retry up to three times before calling it a problem.

### 3.3 Signing in

You test as three different people, each with their own account:

| Flow | Who it stands for | Account | How to sign in |
|---|---|---|---|
| **New parent** | someone who has never seen the app | a brand new `imankh+qa-<today's date>@gmail.com` | email code, relayed by the owner (below) |
| **Advanced parent** | a returning parent with many games, plays and highlights | `e2e@test.local` | the sign-in script below |
| **Admin** | the owner looking at the business | `imankh@gmail.com` | the sign-in script below, with that email |

There is no password anywhere in this app. Parents sign in with Google or with a 6 digit code sent by email. You cannot use Google, and you cannot set the sign-in cookie by hand (it is hidden from page scripts). Staging has a test-only door instead: the script below asks the server to sign you in as a named existing account. It only works for accounts that already exist, which is why the new parent needs the email code.

**The sign-in script.** Open the app first, so you are on the app's own address, run this in the page, then reload. A 200 means signed in; after the reload you should see Home, not the sign-in screen.

```js
await page.evaluate(async () => {
  const r = await fetch('https://api-staging.reelballers.com/api/auth/dev-login', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    body: JSON.stringify({ email: 'e2e@test.local' })
  });
  return r.status;
});
```

Rules for the script:

- Run it against the API host the app actually uses (section 3.2), or the cookie lands on the wrong site and the app still shows signed out.
- A 403 means the `X-Test-Mode` header is missing. A 404 means the email has no account on staging. A 500 on the first try after staging has been idle is common: wait 20 seconds and retry, up to three times.
- To switch accounts, use the app's own "Sign out" first (profile menu), then run the script with the other email. To check who you are, open Account settings and read the email shown.
- One account can only be signed in on one browser at a time. Signing in somewhere else signs the first one out. The touch contexts in section 4 copy your sign-in, so they count as the same browser.

**New parent account.** At the very start, use AskUserQuestion to tell the owner: "For the new parent flow I will sign up on staging as `imankh+qa-<today's date>@gmail.com`. I will tap Send code now. Please give me the 6 digit code from that email." Then on the sign-in screen type that address into the email form, tap "Send code", and enter the code the owner gives you. Codes expire in minutes, so ask only when you are ready to type it. Signing up is itself part of the test: record every screen between the sign-in screen and Home. If the owner does not answer or the code fails twice, run the new parent flow on `e2e@test.local` with Guidance on, and record in the report that the true first-time experience was not covered.

A new account starts with few or no credits. When the new parent runs out, that is part of the test: follow what the app offers and buy the smallest pack with the test card.

**Advanced parent account.** `e2e@test.local` already holds many games (some are failed uploads from earlier tests), plays, highlights and credits. That clutter is not a bug, and it is what makes this account useful. Before the advanced flow, check that it has at least 4 finished highlights, 2 profiles and 30 credits. Make what is missing (buy credits with the test card, or grant them from the admin panel once you are in it).

**Admin account.** `imankh@gmail.com` is the owner's real staging account and it is an admin. Signing in as it signs the owner out of staging in their own browser, so do the admin flow last, in one sitting, and sign out when done. Do not create, edit or delete any game, play, highlight or profile on this account. You are there for the admin panel only.

### 3.4 Folders

Create these (the `qa/` folder is git-ignored, so nothing here is committed):

```
qa/qa-pass-<YYYY-MM-DD>/
  REPORT.md        running log, updated after every screen, not only at the end
  COVERAGE.md      the matrix from section 5
  bugs/            screenshots and log excerpts, named B01-..., B02-...
  ux/              screenshots for confusion findings, named U01-..., U02-...
  ux-review.html   the owner's review page (section 10)
```

Playwright can only read and write files inside the repo. Save screenshots to `.playwright-mcp/` (also git-ignored) and copy them into the folders above with PowerShell. Copy any file you need to upload into `.playwright-mcp/` first.

**Write to REPORT.md as you go.** This pass is long and your memory of early screens will be summarized away. Anything not written down is lost.

### 3.5 Test videos

In `formal annotations/test.short/`: `game2-test.mp4` (about 5 seconds), `wcfc-carlsbad-trimmed.mp4` (a real soccer game, short) and `staging-verification-fixture-5min.mp4` (5 minutes). Use the real soccer one for the journeys so there are athletes to frame and spotlight.

The server recognizes a file it has seen before and routes it into the existing game. To get a fresh game, make a unique copy:

```powershell
$b=[IO.File]::ReadAllBytes("formal annotations\test.short\wcfc-carlsbad-trimmed.mp4")
[IO.File]::WriteAllBytes(".playwright-mcp\qa-game-1.mp4", $b + [Text.Encoding]::ASCII.GetBytes("qa-unique-1"))
```

Uploading the same file twice on purpose is also a test (section 7, Games).

### 3.6 Things that will trip you up

- **The coach.** With the "Guidance" switch on, the app shows one coaching sentence per screen and a dark shade that swallows clicks elsewhere. Dismiss it with `await page.getByTestId('guide-got-it').click().catch(()=>{})`. Read the current sentence with `document.querySelector('[role=status]')?.innerText`. The switch is `[data-testid=guidance-toggle]`.
- **Native confirm dialogs** block `browser_run_code_unsafe`. Register `page.once('dialog', d => d.accept())` before the click, or use `browser_handle_dialog`.
- **"Mark play" only shows** when the playhead is outside every existing play and no play is selected. Click an empty spot on the timeline first.
- **Tile actions** on the Plays tab show on hover with a mouse and on long-press with touch.
- **A real phone or tablet** is more than a narrow window: the app changes layout when the pointer is touch. Use a touch context (section 4), not only `browser_resize`.
- **Sharpening takes about 3 to 4 minutes.** While it runs, test something else in a second page of the same context, then come back.

## 4. Screen sizes

Test three device classes. Each has a main size, where you run everything, and extra sizes, where you only re-check layout (section 8) on every screen.

| Class | Main size | Extra layout-only sizes | Input |
|---|---|---|---|
| Phone | 390 x 844 portrait | 360 x 640 portrait, 844 x 390 landscape | touch |
| iPad | 768 x 1024 portrait | 1024 x 768 landscape | touch |
| Desktop | 1440 x 900 | 1280 x 800, 1366 x 768, 1920 x 1080 | mouse and keyboard |

Notes that matter:

- The app treats **anything up to 1023 pixels wide, and any touch device, as "mobile"**. So an iPad in either orientation gets the mobile layout. Check that the mobile layout actually makes sense on an iPad's much larger screen (wasted space, tiny video, stretched buttons).
- A **phone turned sideways** (landscape, height under 500) switches Frame and Mark Plays into a special full-screen "cockpit" layout with controls on side rails. Test both cockpits at 844 x 390.
- For desktop use `browser_resize`. For phone and iPad, open a touch context that reuses your sign-in:

```js
const browser = page.context().browser();
const ctx = await browser.newContext({
  storageState: await page.context().storageState(),
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 3
});
const p = await ctx.newPage();
await p.goto('https://staging.reelballers.com/');
```

For iPad use `viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2`. Tap with `p.touchscreen.tap(x, y)`. For a touch drag, use a CDP session and `Input.dispatchTouchEvent` (touchStart, several touchMove, touchEnd). Find the page again later with `browser.contexts().flatMap(c => c.pages())`. To rotate, call `p.setViewportSize({ width: 844, height: 390 })`.

## 5. Coverage matrix

Before testing, create `COVERAGE.md` with one row per item in section 7 and three columns: Phone, iPad, Desktop. Add a fourth column, Flow, saying which of the three flows (section 6) covered the row. Fill each cell with `ok`, `bug B07`, `confusing U03`, or `not reached: <reason>`. An empty cell at the end means the pass is not finished. This file is how you, and the owner, know every feature was tried at every size.

## 6. Order of work

1. **Setup** (section 3). Record the build: the app logs `[Build] <hash>` in the console at start.

2. **New parent flow** (new account, Guidance on, which is how a new parent meets the app). Behave like someone who has never seen the app: do not use anything you know from this prompt to find your way. Go only where the screen and the coach lead you, and write down every moment you had to fall back on this prompt to continue. Those moments are confusion findings.
   - **Phone 390 x 844 touch first**, because most parents arrive on a phone. Sign up, then go from nothing to a shared highlight: upload a game, mark three plays (rate, tag, name, note), make a portrait highlight (drag the box at three different moments, Preview, Sharpen my highlight, including running out of credits and buying some), add a spotlight and text, finish, find it in Highlights, download it, create a share link, open the link signed out.
   - At every step read the coach sentence and check that it describes what is actually on screen, that the control it names is visible and tappable, and that it goes away once followed.
   - Count the taps and the minutes from "landed on Home" to "highlight shared" and record both. List every question the app asked that the parent had to answer before getting a highlight.
   - **Then desktop 1440 x 900**, same account: a second game, a landscape highlight, mouse only.
   - **Then iPad 768 x 1024 touch**, same account: one more highlight from an existing game, without spotlight.
   - Record the starting and ending credits of this account.

3. **Advanced parent flow** (`e2e@test.local`, Guidance off). This person knows the app and wants speed and control. Desktop 1440 x 900 first, then phone, then iPad. Work through the whole of section 7 except "Admin panel", trying every control listed. In particular, do these things a new parent never reaches:
   - Work with a full account: find one particular game, play and highlight among many; filters and grouping on every tab; rename, link, unlink, move and delete.
   - A game with two videos, lined up with each other. Import plays from `formal annotations/test.short/test.short.tsv`.
   - Trim and slow motion, tilt fix, copy and paste a position, several positions on one play.
   - Change a finished highlight: "Edit zoom" (cancel at the "Sharpen it again?" question once, then go through with it once) and "Redo spotlight". The share link made before must still work afterwards and show the new version.
   - Several highlights from one play. Portrait and landscape versions of the same play.
   - Intro cards, highlight reels, the ranking game, the length slider.
   - Two profiles: data stays separate, and a highlight moves between them.
   - Share management: private and public links, turning a link off, sharing a whole game.
   - Storage: "Extend storage", "Keep only marked plays", "Restore full video", an expired game.
   - Credit history against what was actually spent.
   - Every keyboard shortcut in section 7, on desktop.
   - Saving and connection tests (end of section 7), then rough handling (section 9).

4. **Layout sweep** (section 8) at every size in section 4, on every screen, as the advanced parent.

5. **Admin flow** (`imankh@gmail.com`, last). Section 7 "Admin panel", at desktop first, then iPad and phone for layout only. Sign out when done.

6. File remaining bugs (section 11). Build the confusion review page (section 10). Final reply (section 12).

File bugs in batches as you go (after each numbered step above), not all at the end. In REPORT.md and in every finding, say which of the three flows it came from.

## 7. Feature list: try every one of these

Labels are quoted as the code has them today. If a label on screen differs, use what you see and note the difference only if it breaks the word table in section 1.

### Signed out
- Sign-in screen: Google button present; email code form ("Send code", "Send a new code", "Use a different email"); wrong code shows a clear error and clears the boxes.
- `/privacy` and `/terms` open without signing in.
- An unknown address such as `/focus/p/abc` lands on Home with a message that the game or play is no longer there.

### Home, always visible parts
- Credit chip opens the buy credits window. Profile menu: "Invite a friend", "Account settings", "Sign out". Sport and profile chip. "Guidance" switch. "Install App" or "Add to Home Screen" if shown.
- "Continue Where You Left Off" cards open the right game and the right highlight.
- Storage expiry banner ("Extend storage", Dismiss) if any game is near expiry.
- "Report a problem": floating button on desktop, bottom of Home on phone. Send one report with the text "QA pass test report, please ignore".
- Tabs: Games, Plays, Highlights. Reload on each tab and note where you land.

### Games tab
- "Upload game": the details window (optional fields, sport picker, "Don't have the game video on this device?" help). Cost shown before upload must equal the credits actually taken.
- Upload progress tile: Cancel, then Resume or Retry. Leaving the page mid-upload shows a warning.
- Upload the same file twice: the message must be readable and the existing game must open intact.
- Game tile: tap opens Mark Plays; pencil opens "Edit Game Details"; the menu has "Watch plays", "Add video", "Share game", "Keep only marked plays" and "Restore full video", "Extend storage", "Delete game" (tap again to confirm). Try each on a game you created.
- Failed upload tile: "Retry upload", "Discard".
- "Share game" window: add `hello@reelballers.com`, switch to "Anyone with the link", "Copy link", open the link signed out, then "Turn off link" and confirm the link stops working.
- "Watch plays" window: tabs for team, athlete, all and brilliant plays; "Make highlight"; show and hide the plays list.

### Mark Plays (Annotate)
- Video: play and pause, back and forward 5 seconds, frame step, speed, restart, timeline zoom, full screen and Esc to leave it. Double-tap or double-click the left or right half skips 5 seconds.
- "Mark play". Then in the play editor: drag both trim handles, type trim times, star rating, "Who is this play about?" (my athlete or team), tags, note, teammates, name, "Delete play", "Done".
- Rating a play 5 stars shows "Make this a highlight now?" with "Make highlight" and "Keep marking plays".
- Selecting an existing play: "Edit play", "Make highlight", and the list of highlights already made from it.
- Plays list: filter (all, my athlete, team), show and hide, jump to a play.
- A game with two videos ("Add video"): the Videos bar, previous and next video, and "Line up this video with the game".
- "Watch plays" review mode and its share options.
- Header: Back or Home, the game name breadcrumb, the three step tabs (locked ones must say why), credit chip.
- Desktop keys: Space or K play and pause; J and L back and forward 10 seconds; A marks a play; left and right arrows move 5 seconds on the playhead or step between plays.
- Phone landscape (844 x 390): the full-screen cockpit, marking a play inside it, leaving it.

### Frame
- "Where will you share it?": Portrait and Landscape. Switching after placing positions asks to confirm; both answers work.
- The box: drag it, resize by a corner, move the playhead and drag again to add a position, "Copy position", "Delete position", "Undo". The "Box is very tight" warning.
- "Preview" and "Back to full video". The preview must match what the box showed.
- "Trim and slow motion": split a section, set a section to 0.5x, trim an end, delete a split.
- Settings: "Fix a tilted camera" (slider and reset), "Dim outside", original audio switch.
- Timeline zoom in, out and reset.
- "Sharpen my highlight": the price shown must equal the credits taken (compare `GET <api>/credits` before and after). If the box was never moved, the "Is your athlete in the box?" question appears. With too few credits, the buy credits window appears.
- While sharpening: progress is visible, leaving the screen and coming back keeps it, and a second tap on the button does not start a second job.
- When it ends: the "ready" panel or the "It's in your Highlights" message, and what each button does ("Add spotlight", "Finish without spotlight", "Edit zoom", "Done for now", "Watch highlight").
- Desktop keys: Space; left and right arrows step one frame; Shift with an arrow jumps 4 seconds; Ctrl+C and Ctrl+V copy and paste a position.
- Phone portrait: the "rotate your device" hint and its Dismiss. Phone landscape: the cockpit rails ("Back", "Settings", "Preview", "Sharpen my highlight", "Add position", "Trim and slow-mo") and its first-time intro card.
- Download the finished highlight and check the picture: `ffmpeg -i f.mp4 -vf "fps=2,scale=200:-1,tile=6x2" -frames:v 1 out.png`, then look at `out.png`. The athlete you boxed must be in frame throughout, the shape must be the one chosen, and the video ends with a short "Made with ReelBallers" card (expected).

### Spotlight
- Athlete outlines appear ("Finding athletes...", "N athletes found"). Tap your athlete through the guided taps. "My athlete isn't outlined" lets you drag a circle by hand.
- Move the circle, turn it on and off, change how long it lasts by dragging its ends on the timeline, delete it (with its confirm).
- Settings: color presets, custom color, "Match color from uniform", "Around athlete" or "Under athlete", outline thickness, fill, "Dim outside".
- "Add text": type "#7 Maya", change font, size, color, position, alignment, shadow; delete the text.
- "Pick cover": a still from the video.
- "Add spotlight to highlight" (free). Then "Finish", "Redo spotlight", "Edit zoom", "Done for now".
- Download and check frames as above: the circle is on the athlete for the whole range you set, and the text shows.
- Leaving with unsaved changes shows a window with "Discard changes", the render button and "Keep editing"; each does what it says.

### Plays tab
- "Upload a play" (a short video), including the notice shown first.
- Filters, "Clear filters", grouping "By status" and "By game".
- Tile actions: "Edit highlight", "Edit spotlight", "Move to Highlights", "Rename", "Download", "Link to game" and "Unlink", Delete (tap again to confirm), "Watch finished highlight".

### Highlights tab and the finished player
- Grouping: by game, by tournament, by month.
- Tile actions: "Share", "Download", "Intro", "Rename highlight", "Edit highlight", "Copy link", "Watch marked plays", "Delete" (with confirm).
- Finished player: play, close, download, swipe or arrow to the next one, "Back to game plays", "Edit highlight", and the redo choices ("Add spotlight" or "Redo spotlight", "Edit zoom" with its "Sharpen it again?" confirm; cancel that confirm).
- Link flow: "Get link", "Create link", "Link ready", "Copy link", and on a phone "Share link" and "Share video".
- Share window: "Only people I add" versus "Anyone with the link", "Add people", "Stop sharing".
- Highlight reels (collections): header actions, the length slider, locked cards and "Why is this locked?".
- Ranking game ("Pick the better highlight"): pick, "Undo last pick", "Done". Needs at least two highlights.
- Intro cards (from the profile window): the consent step, make one, add it to a highlight.

### Shared pages (open each signed out, at phone and desktop size)
- A single highlight link, a highlight reel link, a game link. Check: the video plays, there is a way to download if offered, nothing asks the viewer to sign in just to watch, and a turned-off link shows a clear "no longer available" page.
- Keys on the shared player (desktop): Space, arrows, M, F, Esc.

### Profiles
- Add a second profile (name, color, sport), switch to it, confirm it starts empty and the first profile's games are not in it, switch back and confirm nothing was lost. Edit it. Delete it (read the warning first).
- Move a highlight to another profile.

### Account, credits, storage
- Account settings: email and sign-in method are correct for this account; "Download My Data"; "Delete my account" up to the type DELETE step, then cancel; privacy, terms and contact links; "Sign out" and sign back in.
- Buy credits: pick the smallest pack, pay with the test card, confirm the balance rises by exactly the pack size and the chip updates without a reload. "Credit history" rows and running balance add up.
- "Extend storage" on a game: price shown equals credits taken.

### Saving and connection
- Go offline (`page.context().setOffline(true)`), change a play's rating, go back online, reload. The change must either be there, or the app must have said clearly that it was not saved and offered Retry. It must never look saved and then be gone.
- Go offline during a sharpen and during an upload; go back online; both must recover or say plainly what to do.
- Open the same highlight in Frame in two pages, move the box in one, then in the other. Record what each page shows after a reload.

### Admin panel (admin flow only)

Reach it the way the owner does: the sport and profile chip, then the "Admin" row. Also by typing `/admin`.

**First, as a normal account** (do this while signed in as `e2e@test.local`, before the admin flow): typing `/admin` must show "This page is not available" with no admin filters, numbers or internal text, and the "Admin" row must not appear in the profile window.

**Then as the admin:**

- The header shows "Admin Panel" and a badge naming the environment. It must say staging.
- Open every collapsible section and wait for it to load: Users, Journey, Activation, Retention Chart, Pack Mix, By Sport, Platform Breakdown, R2 Usage, Upload Failures, Revenue Reconciliation. For each: it loads within 20 seconds, shows numbers or a clear "nothing yet", and logs no console error or failing request. A section stuck on "Loading..." is a bug.
- Filters: "Real", Paying, Active (7d), Has Exports, Invited Others, Was Invited, the country picker, "Clear all". Each changes the user list and the counts in a way that makes sense (a filter never makes a count go up).
- Dimension: Campaigns, Cohorts, Builds. Each redraws the tables.
- **Numbers must agree with each other.** No percentage above 100. No stage of the Journey with more people than the stage before it. A count shown in two places is the same in both. Where a table shows tries and successes, successes never exceed tries. Write down any that fail, with the numbers.
- **Numbers must agree with what you did.** Find `e2e@test.local` and the new parent account in the Users table (the "Real" filter hides test accounts, so turn it off). Their games, highlights, credits and purchases should match what you made in the first two flows. "View journey" on the new parent account should show the steps you took, in order.
- "Grant credits": grant 5 credits to `e2e@test.local` only. The balance in the table updates.
- "Log in as this user": use it on `e2e@test.local` only. The impersonation banner appears with both emails, Home shows that account's games, and the stop link returns you to the admin panel as the admin. While impersonating, do not change anything.
- "Manage Campaigns": open it, look, close it. Change nothing.
- Look only, never press: bulk email, bulk actions, and the "Clear clips/projects/exports" actions.
- Layout at 768 x 1024 and 390 x 844: tables and the Journey map can be scrolled and read, and no control is cut off with no way to reach it.

For admin confusion findings, the reader is the owner making business decisions, not a parent. Ask: does each number say what it counts and over what period, can two numbers that look alike be told apart, and is the most important number easy to find.

## 8. Layout sweep: what to check on every screen at every size

Run this script on each screen and each open window or sheet, and also look at a screenshot yourself:

```js
await page.evaluate(() => {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = e => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('data-testid') || e.tagName).trim().slice(0, 40);
  const ctl = [...document.querySelectorAll('button,a,[role=button],input,select,textarea')].filter(vis);
  return {
    sidewaysScroll: document.documentElement.scrollWidth > vw,
    scrolledOnOpen: window.scrollY,
    offRight: ctl.filter(e => e.getBoundingClientRect().right > vw + 1).map(label),
    small: ctl.filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(label),
    clippedText: [...document.querySelectorAll('button,h1,h2,h3,p,span,label')].filter(vis)
      .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(label).slice(0, 20)
  };
});
```

Findings to look for:

- The page scrolls sideways, or a control is partly off the right edge.
- A screen opens already scrolled down, so its header is out of view.
- One element covers another: a bottom action bar over the video or timeline, the Guidance switch over a logo or a close button, a toast over a button. Check by eye and by comparing boxes.
- Text cut off or wrapped mid-word; a label truncated with no way to read the rest.
- On touch sizes, a control smaller than 44 by 44 pixels (the `small` list). Report these as one grouped bug per screen, not one each.
- The main thing on the screen (the video, the primary button) is not visible without scrolling.
- A window or sheet taller than the screen whose bottom buttons cannot be reached.
- On iPad: phone-sized layout stranded in a large empty screen, or a video far smaller than the space allows.
- Wording that names the wrong device: "tap" on desktop, "click" or "hover" on a phone, "rotate your device" on a desktop.

## 9. Rough handling

On desktop and on phone:

- Double-tap every button that starts something (Mark play, Sharpen my highlight, Add spotlight to highlight, Finish, Create link, Delete, pay). Exactly one thing must happen.
- Reload in the middle of every step. You should come back to the same place with nothing lost.
- Browser Back and Forward between Home, Mark Plays, Frame and Spotlight.
- Press Esc with each window open. Clicking outside a window must **not** close it (this is intended).
- Very long names (80 characters) and names with emoji, quotes and `<b>` for a game, a play, a highlight and a profile.
- An empty account view: each Home tab with nothing in it must tell the parent what to do next.
- A game whose video has expired (the main account has some): opening it must explain itself and offer "Extend storage".
- Throughout the whole pass, watch the browser console for errors and the network list for any request that answers 4xx or 5xx. Each distinct one is a finding even if the screen looked fine.

## 10. Confusion findings and the owner's review page

A confusion finding is not something broken. It is something that works but would make a parent hesitate, guess, or take a wrong turn. The owner decides these, so **do not file them as tasks**. Collect them and present them.

### How to spot confusion (ask these on every screen)

1. **Next step.** Without the coach, is it obvious what to do next? Is there exactly one primary button, and is it the thing most parents want?
2. **Names.** Is the same thing called by one name everywhere? Does the button say what the parent gets ("Make highlight"), not how it works? Does a label match the screen it opens?
3. **Where things go.** After an action, can the parent tell where the result went (which tab, which tile)? After Finish, is it clear the highlight is in Highlights?
4. **Cost and consequence.** Before anything that spends credits, takes minutes, deletes, or makes something public, does the parent know that in advance? Is the price next to the button?
5. **State.** Can the parent tell a play in progress from a finished highlight, a sharpened one from an unsharpened one, a shared one from a private one, an expired game from a live one?
6. **Waiting.** During uploads, sharpening and loading, does the screen say what is happening, roughly how long, and whether they may leave?
7. **Too many choices.** Is there a window with three or more buttons of equal weight, or two ways to do the same thing with different names?
8. **Icons without words.** Would a parent know what each icon-only button does before pressing it?
9. **Dead ends.** Is there a screen with no visible way forward or back? A disabled button that does not say why?
10. **The coach.** Does the coaching sentence match what is on screen, name a control that is visible, and disappear when it has been followed?
11. **Managing things.** Can the parent find, rename, delete and move a game, a play and a highlight from where they would expect? Is it clear what deleting a game does to its plays and highlights?
12. **Step count.** Could this be done in fewer taps? Is a question asked that the app could answer itself?

For each finding, save one screenshot at the size where it is clearest. Before saving, draw attention to the spot: add a red outline to the element (`el.style.outline = '4px solid red'`), take the screenshot, then remove the outline. Save as `ux/U01-<short-name>.png`.

Record for each:

- **Where:** screen, device class and size, and the steps to get there.
- **What a parent sees.**
- **Why it confuses**, in one or two sentences, naming which of the twelve questions it fails.
- **Suggested change**, concrete enough to picture: the new wording, the button to remove, the order to change. Give one suggestion, and a second only if it is a real alternative.
- **How much it matters:** High (blocks or misleads on the main path to a highlight), Medium (slows or worries the parent), Low (polish).

### The review page

Build `qa/qa-pass-<date>/ux-review.html`, one self-contained page:

- A short summary at the top: how many findings, the three that matter most, and the tap and minute counts from the new parent flow.
- Each card is labelled with the flow it came from (new parent, advanced parent, admin), and the page can be filtered by flow.
- Findings ordered High, Medium, Low. Each is a card: the screenshot (click to enlarge), where, what the parent sees, why it confuses, the suggested change.
- On each card, three choices the owner can click (Agree, Disagree, Different idea) and a note box.
- A "Copy my answers" button at the bottom that puts all choices and notes on the clipboard as plain text, keyed by U number, so the owner can paste them back.
- Screenshots referenced as relative files in `ux/`. Works in light and dark, readable on a phone.

If the Artifact tool is available, load the `artifact-design` skill and publish the page with the screenshots as supporting files, and give the owner the link. If not, give the full path of the local file. Either way, **stop there for confusion findings**: the owner answers first.

## 11. Filing bugs into the plan

### What counts as a bug
Something broken, wrong, lost, overlapping, unreachable, charged wrongly, or erroring in the console or network. A fact, not an opinion. If you are unsure whether it is a bug or a confusion finding, put it in the review page.

### Before filing each one
1. **Reproduce it** from a fresh page load. Three tries. If it does not repeat, it is "possible".
2. **Look for an existing task.** Search `docs/plans/PLAN.md` and `docs/plans/tasks/` for the screen and symptom words. Many layout bugs from 2026-11-16 are already filed (for example T16630 to T16690).
   - If a task exists with status TODO or WIP: do not file. Mention it in the report.
   - If a task exists with status STAGING (its fix should already be on staging) and you still see the bug: do not file a new one. Add a dated entry under a `## Progress Log` heading in that task file saying what you saw, at what size, on which build, with the evidence file name. List it in the report under "fixes that did not hold".
3. **Collect the logs** (next part).

### Logs to attach
- **Console:** `browser_console_messages` at level error, only the lines from the moment of the bug.
- **Network:** for each failing request: method, address, status, the response body (first 500 characters), and the `X-Request-ID` request header if present.
- **Server:** if the `fly` command is signed in, run `fly logs -a reel-ballers-api-staging --no-tail > .playwright-mcp/fly.log 2>&1`, then `reduce_log` on that file with `grep` set to the request id or the failing path, and `tail: 2000`. If `fly` is not signed in, write "server logs not available: fly not signed in" and move on.
- Save the excerpt as `bugs/B07-logs.txt` and paste at most 30 lines into the task file. Remove cookies, tokens and email addresses other than the test account.

### Task ids
Run `git fetch`, then find the highest task number in use across `docs/plans/PLAN.md`, `docs/plans/PLAN-archive.md`, the file names in `docs/plans/tasks/` (including subfolders) and the same on `origin/master`. Your first id is the next multiple of 10 above it, then keep adding 10. Check again before each batch, because other sessions file tasks too.

### The task file
`docs/plans/tasks/T<id>-<short-slug>.md`:

```markdown
# T<id>: <two to six words naming the problem>

**Status:** TODO
**Impact:** <1-10>
**Complexity:** <1-10>
**Created:** <YYYY-MM-DD>
**Updated:** <YYYY-MM-DD>

## In plain words

<Three to five sentences a parent could read. What the parent does and sees today. What goes wrong and how often (always, or seen once). What should happen. No code names.>

## How we got here

Found by the full QA pass on <date> on staging (build <hash>), as <account>, at <device and size>.

## Repro steps

1. <Sign in as ..., at size ...>
2. <Each tap or key, with the exact label>
3. ...

**Expected:** <one sentence>
**Actual:** <one sentence>
**Repeats:** always | N of 3 tries | seen once (possible)
**Also checked at:** <other sizes and whether it happens there>

## Evidence

- Screenshot: `qa/qa-pass-<date>/bugs/B07-<name>.png` (local, not in git)
- Console: <lines>
- Network: <method, address, status, request id, body excerpt>
- Server log: <lines, or why not available>

## Solution

<One plain sentence on what "fixed" looks like. Do not design the fix.>

## Relevant Files

<Only if you actually found the file by searching for the on-screen label in src/frontend/src. Otherwise write "not investigated".>

## Acceptance Criteria

- [ ] C1: <the repro steps above now give the expected result, at the size named>
- [ ] C2: <the same at the other device classes where it applied>
```

**Scores.** Impact: 9 to 10 data lost, wrong charge, or the main path to a highlight is blocked; 7 to 8 a main-path step is broken but has a workaround; 5 to 6 a side feature is broken, or a main-path screen is badly laid out; 3 to 4 cosmetic on a main screen; 1 to 2 cosmetic elsewhere. Complexity: 1 to 2 wording or a style change; 3 to 4 one screen's logic; 5 to 6 several files or the server; 7 and up, unknown cause. Priority is Impact divided by Complexity, one decimal.

Group near-identical findings (the same overlap on three screens, small touch targets on one screen) into one task with a list. Do not group unrelated bugs.

### The PLAN.md rows
In `docs/plans/PLAN.md`, add a new section directly **above** the line `### Staging QA 2026-11-16: bugs and possible bugs (owner-requested, BUGS FIRST)`:

```markdown
### Full QA pass <YYYY-MM-DD>: bugs and possible bugs (owner-requested, BUGS FIRST)

**Why this section exists.** Owner asked on 2026-11-17 for a full QA pass of every feature at phone, iPad and desktop sizes. <One sentence on what was walked.> Screenshots: `qa/qa-pass-<date>/` (local, gitignored). Rows marked possible need a repro first.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T<id> | [<name>](tasks/T<id>-<slug>.md) | 6 | 2 | 3.0 | TODO | [ ] | <The "In plain words" text, three to five sentences, ending with "Done when ...".> |
```

Order rows by priority, highest first. Start the description of an unrepeated one with "Possible, seen once."

### Committing
Docs only. After each batch:

```
git add docs/plans/PLAN.md docs/plans/tasks/T<id>-<slug>.md   (name every file; never "git add -A" or "git add .")
git commit -m "T<first id>: file full QA pass bugs (T<first>-T<last>)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
git push
```

If the push is refused because master moved, run `git pull --rebase` and push again. Never force push, never stash. If anything other than your own files under `docs/plans/` shows as changed in `git status`, leave it alone and do not add it.

## 12. Finished means all of this

- `COVERAGE.md` has no empty cells.
- Every bug is a task file plus a PLAN.md row, committed and pushed, with repro steps and logs, or is noted against an existing task.
- `ux-review.html` exists (and is published if the Artifact tool was available) with a screenshot, a reason and a suggestion for every confusion finding.
- Everything you created on the account that is not needed as evidence is deleted (extra profiles, junk games). Leave the highlights and links that bugs refer to.
- `REPORT.md` is complete.

**Final reply to the owner**, short:

1. Build tested, addresses used, the three accounts used, credits at start and end for each, number of sharpens. For the new parent flow: taps and minutes to a shared highlight, and how many times you needed this prompt to find the way.
2. Bugs filed: a table of id, name, impact, device classes affected. Then "possible" ones. Then "fixes that did not hold" with their existing ids.
3. The link or path to the confusion review page, the count by High, Medium, Low, split by flow (new parent, advanced parent, admin).
4. What you could not test and why.
5. The three findings, of either kind, that most stand between a parent and a finished highlight.

Do not write "everything else worked" unless the coverage matrix shows it.
