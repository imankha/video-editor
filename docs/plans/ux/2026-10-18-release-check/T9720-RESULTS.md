# T9720 results: end-to-end and failure-path release check (staging, 2026-10-18)

Target: https://reel-ballers-staging.pages.dev with API https://reel-ballers-staging.fly.dev/api, the build just released to prod (build `52cd3f3ec` as reported by the Report dialog). Machine shared-cpu-4x/4096. Account `e2e@test.local` (user `eb7320b2-997e-4ae2-b296-b2e2c26c7ffe`, profile `4345b661`), driven with local Playwright 1.57 Chromium at 1440x900 and at 390x844 with touch, Guidance off. Fixture: `wcfc-carlsbad-trimmed.mp4` (plays 2.973-9.000 and 13.000-19.000), cut into byte-different copies with `ffmpeg -c copy` (varA 88 s, varB 87 s, varC 86 s) so each upload is a new game instead of a dedupe hit, plus 5 to 6 s re-encoded clips (clipA, clipB, clipC) for the direct-clip path. Scripts and about 130 screenshots are local only in the session scratchpad `t9720/` (`t9720/shots/*.png`), not committed. Nothing was reset or deleted and no account other than `e2e@test.local` was touched (imankh was used only as the admin session for one credit grant and for reading the bug list).

## 1. Verdicts

| Item | Verdict | One line |
|---|---|---|
| Full parent path, desktop and mobile | PASS | Upload, two plays, framed highlight, spotlight, Finish (private), reopen, public share link, signed-out fetch all worked at 1440 and 390 |
| Direct clip reaches publication without a game | PASS (settles UX-02) | clipA at 1440 and clipB at 390: Upload highlight -> Focus -> generate -> Finish -> public link, games list unchanged |
| Multi-clip reel | PASS | Top Plays collection plays (Play all) and its link opens signed out with every member |
| Failure paths exercised | PASS, with one new HIGH bug found on the way | slow network, interrupted upload, failed render, navigation during preview, duplicate clicks, reload mid-generation all exercised |
| Credits match T9680 and nothing exposed unintentionally | credits PASS; exposure NOT fully settled | credits match every rule below; one phone-share and one live-collection behaviour need an owner decision (section 6) |
| B9 on staging | FAIL as a user path, PASS on delivery | exactly one row with assets on every submit, Retry and Copy error details work, but on desktop (1024 and up) the dialog cannot be clicked at all (new bug R1) |
| UX-16 on staging | FAIL as a user path, same cause as B9 | the recoverable-error design works through keyboard and on phone; a desktop mouse cannot reach Send, Retry or Copy |
| UX-02 | PASS | see path 2 rows |
| Permanent staging-gate lane | YES, as a small on-demand lane D | reasoning in section 7 |

## 2. Path rows (viewport x mode)

Normal = ordinary page. Fullscreen = the in-app fullscreen of the player (Annotate, Focus, collection player); the browser Fullscreen API was never entered (`document.fullscreenElement` stayed null in headless), so "fullscreen" here is the app's own immersive mode.

| Path | Viewport | Mode | Result | Evidence and notes |
|---|---|---|---|---|
| 1 upload game -> two plays -> framed clip -> effects -> private save -> reopen -> publication | 1440x900 | normal | PASS | varA (game 3). Selecting the file starts the upload at once and lands in Annotate (game ready in about 3 s, charged 2). Plays set by typing `0:02.973`-`0:09.000` and `0:13.000`-`0:19.000` into the time fields; they persisted on reload (the field displays `0:02.9`). Focus estimate said `~6 credits`. Preview ran, Generate took about 100 s, spotlight generation was free and fast, "Finish" moved it to Finished (before that the tile read "1 highlight, Private"). Reopen through the Clips tile went to Focus with "Back to preview", the crop key and spotlight were kept (Add spotlight showed the earlier spotlight). Share modal defaults to "Only people I add"; "Anyone with the link" created one public link (`f7eb4f5b-4809-444d-a75a-0cfb05895cf3`), signed-out `GET /shared/{token}` returned 200. Shots `e10-a`, `e18-done`, `e24-b`, `e27-a2`, `e26-a` |
| 1 | 1440x900 | fullscreen | PARTIAL PASS | Annotate fullscreen (shows plays on the timeline, Edit play, exit button), Focus fullscreen (crop box and timeline, Generate and Preview are not offered inside it, exit by button) and the collection player fullscreen all open and close. Escape closed the collection player's fullscreen; Escape on Annotate/Focus fullscreen was not confirmed. Mark play is not offered inside Annotate fullscreen. The whole path was not re-driven inside fullscreen. Shots `fs-desktop-annotate`, `fs2-desktop-focus-fs`, `fs-desktop-collection` |
| 1 | 390x844 touch | normal | PASS | varB (game 5). Multipart upload (9 parts), charged 2. A "What sport is this?" modal appears on the first Mark play (Soccer tapped). Both plays set by typing the same bounds. Mobile Focus offers Generate / Trim / Preview in a bottom bar, estimate `~6 credits`; reload and reopen show "Continue Adding Spotlight to Portrait" which goes straight to Spotlight. Spotlight generate free, Finish worked, `Share` copied a link. Shots `m8-preview`, `m8-ready`, `m10-finished`, `m12-b` |
| 1 | 390x844 | fullscreen | PARTIAL PASS | Annotate, Focus (button "Expand video to fullscreen") and the collection player all open and close. Same caveat as desktop |
| 2 direct clip upload -> framing -> finish -> publication, no game | 1440x900 | normal | PASS | clipA (6.006 s). Clips tab -> Upload highlight -> "Heads up: these highlights start out unlinked from a game" -> Continue -> file chooser. Calls: `prepare-upload`, parts PATCH, `finalize-upload` (kind `clip`), `POST /clips/upload`, then Focus. Charged 1 (no surcharge). Games list before and after: unchanged. Generate 100 s, "Finish without spotlight" published (`POST /downloads/publish/7`), the tile sits under "Mixes & compilations", public link `bcc156f4-055b-4f1c-9b6e-31acad33c126` fetched signed out. Keyboard: Upload highlight reached in 2 Tabs, Upload game in 9, both with a focus ring and visible without hover. Shots `p2d-after-upload`, `p2d-finished`, `e31`. Detour: my first attempt set the file on the hidden GAME input that is mounted on the Clips tab too and so created game 4 (`clipA`, charged 2); that was my script, not a product fault, and the real clip path was then run correctly |
| 2 | 390x844 touch | normal | PASS | clipB (5.004 s) through the same dialog. Charged 1, Focus reached, games list unchanged (still 7 rows, no `clipB`), render, spotlight generate, Finish, share all worked. Shots `g1-focus`, `g2-generating`, `g3-finished` |
| 2 | both | fullscreen | NOT TESTED | direct-clip path was not repeated in fullscreen; Focus fullscreen was covered on a game clip (rows above) |
| 3 multi-clip reel | 1440x900 | normal | PASS | Finished tab -> Top Plays: Play all plays the clips in sequence (fullscreen toggles, Exit fullscreen and Close present). Copy link made a collection share (`180d17ac-c4e5-4337-8eff-a8bfb4903011`, title "Top Plays - Portrait", "This link always shows the current top highlights"); signed-out `GET /shared/collection/{token}` returned 200 with all members (5, later 7). Shots `e28-a`, `e29-play` |
| 3 | 390x844 | normal and fullscreen | PASS (play only) | Play all and collection fullscreen on mobile, Copy link was not repeated on mobile. Shot `fs-mobile-collection` |

## 3. Failure injection rows

| Injection | Result | What the UI showed and what was checked |
|---|---|---|
| Slow network (CDP 250 to 300 kbps, 800 to 1000 ms latency) | PASS | Home usable after about 21 s; opening game varA showed "Loading v..." then the player was playable at about 35 s, no error state. On the mobile Focus screen the Preview still started within 6 s (video is a local blob). Upload over slow network was NOT exercised (a 46 MB upload would take over 20 minutes at that rate). Shots `sl-home`, `sl-annotate`, `g1-slow-preview` |
| Interrupted upload, multipart game (varC, 46 MB, every R2 PUT aborted) | PASS | After about 12 to 15 s (8 aborted PUTs) the player strip read "Upload stopped. Part 1 network error" with a "Retry upload" button; the game stayed `pending` and no credits were charged (107 before and during). Home shows an "UPLOADING ... 0 / 1 parts, Tap to resume, Resume" row with Cancel and the game is NOT listed in the grid. Going offline for 15 s and back online did not auto-resume: the stopped state stayed until the user pressed Retry. After un-blocking, Retry finished in about 8 s: one `activate`, charged 2, one game (id 6 `ready`, no duplicate). This is a visible, recoverable failure and NOT a silent one. Shots `f1-blocked-10s`, `f1-offline`, `f2-stopped`, `f2-after-retry`, `h1-games-with-pending` |
| Interrupted upload, tiny file (clipC, 435 KB, every R2 request aborted) | PASS | Same "Upload stopped. Part 1 network error / Retry upload" after about 10 s, game `pending`, 0 credits. The 2026-10-18 T12590 note (T13010: "no failed state, game listed, 2 credits") did NOT reproduce here under the same kind of abort; see section 5 |
| Failed render (`page.route` abort of `POST /export/render`, mobile clipB) | PASS | Inline red text "Generation failed due to a network error. Please check your connection and try again." plus a toast "Couldn't generate highlight clipB - Network..." with a Dismiss; the Generate button stayed available; credits 104 before and after (no charge). A true server-side render failure could not be forced from outside, so refund-on-crash (the T9680 gap) is not covered. Shot `g2-render-fail` |
| Navigation during preview load (mobile, Preview tapped then browser Back at once) | PASS | Landed on Home Clips with no error or stuck overlay; the draft was intact and reopened. Shot `g1-after-nav` |
| Duplicate clicks: Generate (3 taps within about 1.5 s) | PASS | exactly one `POST /export/render` (202), one charge of 5 (104 -> 99) |
| Duplicate clicks: Finish (3 taps) | PASS | exactly one `POST /downloads/publish/9` |
| Duplicate clicks: Share (3 taps on phone) | PASS | exactly one `POST /gallery/9/share`, toast "Link copied to clipboard" |
| Duplicate clicks: Send report (2 Enter presses) | PASS | one request, one row (button disables while sending) |
| Mid-flow reload (reload 12 s into a generate, mobile) | PASS | the app returned to Home, credits stayed at 99 (one charge), the render finished on the server, and the clip then opened directly on Spotlight with a "Highlight ready" toast. Closing the browser entirely during a generate (desktop varA Play 1) also let the render finish (Clips showed "Generating Play 1, 11%" on return) |
| Real browser close while "Finish without spotlight" was spinning (desktop) | OBSERVATION | the tile stayed "Private" and unfinished; re-doing Finish worked. Not a defect, the action needs the page open |

## 4. Report a problem on staging (B9, UX-16)

| Check | Desktop 1440 | Mobile 390 |
|---|---|---|
| Open dialog from the floating button or footer link | pass | pass |
| One submission creates exactly one `bug_reports` row | pass, id 16, then id 17 after the retry, ids 18 and 19 on mobile (verified through `GET /admin/bugs`, each row once, reporter `e2e@test.local`, build `52cd3f3ec`) | pass |
| Screenshot and logs attached | pass (`screenshot_r2_key` and `logs_r2_key` present on id 16 and 18) | pass |
| Double submit creates one report | pass (second Enter or tap ignored) | pass |
| Forced failure (`page.route` abort of `/report-problem`) keeps the text | pass, textarea value identical | pass |
| Working Retry | pass: one more failed retry kept the banner, after un-blocking Retry sent it, one row (client report id idempotency held across 3 requests) | pass |
| Copy error details | pass: preview textarea shows report id, status, page, build, browser; the clipboard copy equals the preview apart from Windows CRLF line endings | pass |
| A real mouse click can reach Send report, Retry, Copy, Close | **FAIL (R1)** | pass (tap) |

R1, desktop only: `elementFromPoint` at the centre of "Send report" returns the game card behind the dialog on Home Games, Clips and Finished and an overlay div on Annotate; a real `mouse.click` on the button opened the game behind it (the app navigated to `/annotate`) and sent nothing. The computed `pointer-events` of the dialog root, its parent and the Send button is `none`. Cause (read from the code, not changed): `GlobalReportButton` in `main.jsx` renders `ReportProblemButton` inside `CornerStack`, whose container is `pointer-events-none` (`components/shared/CornerStack.jsx:13`); only the small trigger sets `pointer-events-auto`, the modal rendered inside the same tree inherits `none`. Only keyboard Enter and a touch screen (where the trigger lives in the page, not in the stack) work. All of the rows above on desktop were therefore driven with keyboard Enter or a scripted DOM click. Shots `rp1`, `rp-desktop-form`, `rp-desktop-fail`, `rp-desktop-details`. Test rows left in staging `bug_reports` (all text starts "[T9720 staging test, ignore]"): ids 16, 17, 18, 19.

## 5. Bugs and existing-task check

PLAN.md "Release check bugs" section and `docs/plans/tasks` were searched for each item below.

| ID | Finding | Sev | Existing task |
|---|---|---|---|
| R1 | Report a problem dialog is not clickable on desktop (pointer-events none inherited from the corner stack). Steps: sign in on staging at 1440 or any width of 1024 and up, open Home, tap the floating Report a problem square, type a sentence, click Send report. Expected: the report is sent. Actual: the click falls through to the page behind (on Home it opened a game); only keyboard Enter sends. | HIGH (Impact 8, Cmplx 2) | none (T9400 covers the delivery path and passes in jsdom; no test covers hit-testing) |
| R2 | Phone Share creates a public link with one tap and no visibility choice. On a phone, Finished -> Share immediately POSTs `/gallery/{id}/share`, copies the link, toast "Link copied to clipboard"; the resulting share is `is_public: true` and a signed-out fetch returns 200. The desktop modal defaults to "Only people I add". Intent unclear (T7350 native share routing); needs an owner decision. | MED, verify intent | none (T12590 section 10 recorded the no-modal behaviour but not the exposure) |
| R3 | Top Plays link is live, by design and disclosed ("This link always shows the current top highlights"): the shared collection grew from 4 to 7 members as new highlights were finished, so a finished but never individually shared highlight would be visible to anyone holding an old collection link. All test highlights had already been shared when I looked, so this is inferred from the member count, not demonstrated on a private item. | LOW, verify intent | none |
| T13010 | Blocked upload shows no failure: NOT reproduced (section 3). The Upload stopped state, Retry, Resume row and zero charge all behaved. Suggest the T13010 owner re-verify before spending effort; the T12590 attempt aborted at page level with Guidance on and may have hit a different state (a 5 s clip that finished activation before the abort). | n/a | T13010 exists |
| T13030 | "Highlight ready" toast still stays until dismissed and covers "Done for now" on the ready screen at 1440 (seen in `e18-done`); and "View / Dismiss" toast covers the lower generate tile on mobile Spotlight (`m9-overlay`). | known | T13030 exists |
| T13040 | Add footage not exercised. | n/a | T13040 exists |

Smaller observations (no task proposed): on phone the Mark play editor asks "What sport is this?" every time until a sport is chosen; Annotate fullscreen has no Mark play control; the Top Plays header duration shows a smaller value (22 s) after Play all than before (30 s), apparently counting only unwatched highlights; the Guidance chip overlaps the header title area in Annotate on mobile (`m1-annotate`).

Proposed new task text (R1):

> **Report a problem dialog cannot be clicked on desktop.** From a host walk of staging 2026-10-18 (T9720). At widths of 1024 and up the global Report trigger is mounted inside `CornerStack` (`pointer-events-none`), and the dialog it opens inherits `pointer-events: none`, so Send report, Retry, Copy error details and Close cannot be clicked; the click goes to whatever is behind (on Home it opened a game). Keyboard and touch work. Steps: staging, 1440x900, Home, click the corner Report icon, type text, click Send report. Expected: report sent. Actual: nothing is sent and the page behind is clicked. Fix: render the dialog outside the pointer-events-none stack (portal) or set `pointer-events-auto` on the dialog root; add a Playwright hit-test e2e (`elementFromPoint` on Send report) because the jsdom tests cannot see this. Severity High: it disables the primary feedback channel on desktop and leaves B9 and UX-16 unsettled.

## 6. Credits table

Starting balance 52 (left by the earlier walk). Granted 80 through `POST /api/admin/users/eb7320b2-.../grant-credits` (balance 132, `applied: true`). Final balance 99; 33 credits spent.

| Step | Action | Balance after | Delta | T9680 rule check |
|---|---|---|---|---|
| start | | 52 | | |
| grant | admin grant, 80 | 132 | +80 | |
| 1 | Upload game varA (47 MB) | 130 | -2 | game upload `max(1, ...)+1` = 2: matches |
| 2 | Focus render varA Play 1, 2.973-9.000 s (6.027 s) | 124 | -6 | round-half-up (T9750): 6, not 7 (old ceil): matches; Focus estimate said `~6 credits` |
| 3 | spotlight generate, Finish, share, collection link | 124 | 0 | overlay, publish, share free: matches |
| 4 | Upload game "clipA" by mistake (wrong input, 0.9 MB) | 122 | -2 | game upload surcharge: matches |
| 5 | Upload highlight clipA (clip path) | 121 | -1 | clip upload has no +1 surcharge: matches |
| 6 | Focus render clipA 6.006 s | 115 | -6 | half-up: 6 (ceil would be 7): matches |
| 7 | Upload game varB (multipart) | 113 | -2 | matches |
| 8 | Focus render varB Play 2, 6.000 s | 107 | -6 | matches |
| 9 | Interrupted upload varC (blocked, no activate) | 107 | 0 | failed upload charges nothing: matches |
| 10 | Retry varC after unblocking | 105 | -2 | one charge for the retried upload: matches |
| 11 | Interrupted clipC upload (blocked) | 105 | 0 | matches |
| 12 | Upload highlight clipB (mobile) | 104 | -1 | matches |
| 13 | Failed render (route abort) | 104 | 0 | failed render not charged: matches |
| 14 | Generate clipB, 3 taps, 5.004 s | 99 | -5 | one charge, half-up 5: matches |
| 15 | Reload mid-generate, spotlight, Finish, share | 99 | 0 | no second charge on reload: matches |

The rare mid-pipeline crash refund gap noted in T9680 cannot be forced from outside and was not tested.

Exposure checks done: signed out, `GET /downloads`, `/downloads/{id}/file`, `/downloads/{id}/poster.jpg`, `/games`, `/credits`, `/gallery/{id}/shares` all returned 401; an unknown share token returned 404; only tokens I created through the UI (public links and the collection link) were readable, and those returned the expected video or collection. I did not create an "Only people I add" share because adding an email address may send real mail from staging.

## 7. Permanent staging-gate lane decision

Decision: YES, add a small lane D ("release path", on-demand before a prod deploy, not on every master merge), after R1 is fixed and the fixture accounts (T12900) are re-seeded.

Reasoning:
- Every defect this run found lives in the seams, not in a single feature: R1 (dialog vs corner stack) passes all T9400 jsdom tests and was invisible to the existing 21 gate specs; the interrupted-upload, duplicate-tap and reload-during-generate guards are only provable end to end with real request counting and real credits.
- It fits the lane model. STAGING-GATE already says upload and extract are "covered by one upload in the manual pass"; this makes that one upload automatic and bounded.
- Cost control: use the 5 s clip and a 3 to 5 MB game, not the 46 MB fixture. One run needs about 12 credits (clip upload 1, one 5 s render 5, one game upload 2 plus 2 on retry, spotlight and share free) and about 6 to 8 minutes (the single render is the long step at about 100 s). Give it its own account (CAS rule in STAGING-GATE) and an admin credit top-up in step 0 (a one-line `grant-credits` call).
- Keep out of the lane: the 46 MB upload, fullscreen, slow-network upload (flaky and too slow), and anything that sends mail.
- Assertions to include: one clip upload with the games list unchanged; one render with a single `POST /export/render` after triple-tap and one 5 credit charge; abort of `/export/render` leaves the balance unchanged and shows the failure text; PUT abort shows "Upload stopped" and Retry completes with one charge; Finish and Share triple-tap give one request each; public share fetch signed out returns 200 and private endpoints return 401; Report a problem submit with a real `elementFromPoint` hit-test on Send, one `bug_reports` row (the row must be tolerated or cleaned by an admin step, since reports are Postgres rows).
- Do not make it part of the default three-lane gate; an on-demand fourth lane keeps the 5m48s budget.

## 8. Test-account residue (for whoever resets it next)

`e2e@test.local` now has 7 game rows (varA, varB, varC, clipA (accidental game), game2-test, wcfc-carlsbad-trimmed, and a `pending` clipC with an unfinished-upload row on Home), 7 finished highlights (including the two direct clips clipA and clipB), all with public links, 99 credits, and 4 staging `bug_reports` rows (ids 16 to 19).

## 8. Re-check after T13120 (2026-10-18, phone Share default)

Build: master `7eea54364` (T13110 + T13120), deployed to staging by Deploy Frontend/Backend on that SHA. Account e2e@test.local; clipB (gallery id 9) had its earlier public share revoked first (`DELETE /api/shared/{token}` 200), leaving 0 active shares.

| Check | 390 touch | 1440 |
|---|---|---|
| Share requests sent by tapping/clicking Share | none | none |
| Dialog opens with visibility choice | yes: "Share clipB", Who can watch | yes |
| Default selected | Only people I add | Only people I add |
| Share created by the tap alone | none | none |

Before (this file, finding R2): the phone tap POSTed `/gallery/{id}/share`, the share was `is_public: true`, and a signed-out fetch returned 200. After: no request until the user chooses, default private. The exposure half of criterion 5 is met; credits were already met. Screenshot: t13120-mobile-after-share (local scratchpad).

Side finding: the dialog's Share and Cancel buttons each show a large empty circle above the label (icon not rendering), filed as T13250.
