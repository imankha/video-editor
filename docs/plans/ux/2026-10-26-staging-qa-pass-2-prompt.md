# Staging QA pass 2: verify the QA-pass-1 fixes (kickoff prompt)

Paste everything below the line into a fresh Claude Code session in this repo once the tasks listed in section 4 are on staging (PLAN.md status STAGING). It is self-contained: the earlier conversation is closed.

---

You are running **QA pass 2** on the ReelBallers **staging** app. Pass 1 (2026-10-25/26) found the bugs filed as tasks T13410-T13690. Your job is to **verify each fix on staging, task by task, using the task file's own repro and "Verify the fix" steps**, then do a short regression sweep and report. You drive the browser yourself with the Playwright MCP tools (load them with ToolSearch, e.g. `select:mcp__playwright__browser_navigate,mcp__playwright__browser_run_code_unsafe,...`).

## 1. Where and who

- App: https://reel-ballers-staging.pages.dev (API: https://reel-ballers-api-staging.fly.dev). **Never** use app.reelballers.com (prod). Links to www.reelballers.com (marketing end card) are expected.
- Account: **imankh+stg-qa-20261025@gmail.com**, email-code sign-in only (no Google). Ask me for the 6-digit code with AskUserQuestion right after tapping Send Code; codes expire in minutes. One live session per account: signing in elsewhere signs this one out.
- Stripe is in test mode. If credits run low, buy the smallest pack with 4242 4242 4242 4242, any future date, any CVC/ZIP.
- Report folder: create `C:\Users\imank\Desktop\staging-qa-pass2-<YYYY-MM-DD>\` with `REPORT.md` (update it as you go, not only at the end). Pass 1's report and screenshots are in `C:\Users\imank\Desktop\staging-qa-part2-2026-10-26\` (`REPORT-FINAL.md` is the summary, `REPORT.md` the full log, `BUG-*.png`/`p3-*.png` the evidence). Use them as the "before" reference.

## 2. Account state at the end of pass 1 (expect drift if others used it)

- About **130 credits**. Profiles: **Default** (active) and **QA Second Athlete** (empty except a stub game).
- Default games: `Vs Carlsbad QA` (main game: 2 videos, 89 s + 5 s green clip; 6 plays: QA first play 0:00, Play 5 0:02, Play 2 0:26, Play 3 0:43, Play 4 1:01, Play 6 1:15), `WCFC vs. LA Breakers FC Long Beach` (Veo-made, 1 kept Goal play), `game2-offline-test` (10 s, 2 videos, 1 play), `staging-verification-fixture-5min`, two `Vs Legends FC San Diego`, `at La Breakers FC Nov 1`.
- Finished highlights (5): QA first play, Play 2 (landscape), Play 4, "Maya goal vs Breakers" (spotlight + text "#7 Maya GOAL"), Play 6 (spotlight + text "#28 Sam"). Top Plays share link: https://reel-ballers-staging.pages.dev/shared/collection/8bcb7109-91de-4dda-889f-da26ef8b70b6 . A public link for Play 6 exists (created by the T13670 bug): https://reel-ballers-staging.pages.dev/shared/a5f6a332-6159-4bb1-9b3d-98825d7d972e
- Guidance is **On**.

## 3. Hard-won tool knowledge (saves hours)

- **Screenshots and uploads only work inside the repo.** Playwright MCP may only read/write under `C:\Users\imank\projects\video-editor` (use `.playwright-mcp/`, which is git-ignored). Copy any file you need to upload there first (e.g. Veo zips from `C:\Users\imank\Downloads\`, `Coin.zip`). Copy screenshots to the Desktop report folder with PowerShell afterwards.
- **The server dedupes identical uploads.** Re-uploading a video already in the account routes into the existing game (that is the T13540 bug path). For a fresh game, append bytes to make a unique file: `$b=[IO.File]::ReadAllBytes(src); [IO.File]::WriteAllBytes(dst, $b + [Text.Encoding]::ASCII.GetBytes("unique-N"))`. Base 5 s file: `formal annotations\test.short\game2-test.mp4` (2 credits per game).
- **The coach shade intercepts clicks.** Dismiss with `page.getByTestId('guide-got-it').click().catch(()=>{})` before acting. Read the coach sentence from `document.querySelector('[role=status]').innerText`.
- `browser_run_code_unsafe` is the workhorse: chain several actions per call. No `require` inside it. Native `confirm()` dialogs block it: register `page.once('dialog', d=>d.accept())` first, or handle with `browser_handle_dialog`.
- **Real phone context** (touch, mobile UA) without a new sign-in: `const ctx = await page.context().browser().newContext({storageState: await page.context().storageState(), viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3})`. Use `p.touchscreen.tap(x,y)`; for touch drags use a CDP session and `Input.dispatchTouchEvent` (touchStart, touchMove x N, touchEnd). Find that page later with `page.context().browser().contexts().flatMap(c=>c.pages())`.
- Credit balance truth: `await (await fetch('https://reel-ballers-api-staging.fly.dev/api/credits',{credentials:'include'})).json()`. Highlights: `/api/downloads`. Offline: `page.context().setOffline(true/false)`.
- Check the rendered video by downloading it (Finished viewer > Download) and sampling frames: `ffmpeg -i f.mp4 -t 3 -vf "fps=4,scale=150:-1,tile=6x2" -frames:v 1 out.png`. Downloads end with a ~4.5 s "Made with ReelBallers" end card (expected).
- Overflow check: elements whose `getBoundingClientRect().right > clientWidth`. Overlap check: intersect the Guidance switch (`[data-testid=guidance-toggle]`) box with every visible button box.
- Mark play only appears when the playhead is outside every play and no play is selected (click an empty timeline spot first). At 1440x900 it currently sits below the fold (T13530).
- Never ingest long logs; read console with `browser_console_messages level=error`.

## 4. What to verify (one row per task)

Read each task file (`docs/plans/tasks/T<id>-*.md`) and run **its** "Repro steps" and "Verify the fix" on staging, at the sizes it names. Record pass/fail with evidence (screenshot or measured value) and compare with the pass-1 "before" evidence. Only verify tasks whose PLAN.md status is STAGING (or DONE); list the rest as "not yet on staging".

| Task | One-line check |
|---|---|
| T13510 | **Blocker.** Offline rating change on a play survives reconnect + reload, or shows an error with Retry; banner never claims "saved" falsely |
| T13520 | Spotlight 0.67-2.67 s overlapping text 0-3 s: ring visible for the full range in download and in-app player |
| T13530 | Mark play / Review / Share plays fully visible at 1440x900 and 1024x768 on Vs Carlsbad QA (2 videos, 6 plays) |
| T13540 | Re-uploading a video already in a game: readable message, game loads with all videos and real play times |
| T13550 | No half-screen shade (Frame step 4 at 390; Annotate after Done at 768). Intermittent: repeat 3x |
| T13570 | Six coach-placement checks A-F in the task file |
| T13580 | Phone Frame checks A-G (trim lane visible, landscape overlaps, hint, Escape, loading states) |
| T13590 | Tapping the big button while playing into a play marks a play, never navigates |
| T13600 | Veo "Make a game": cost shown and matches charge, title as promised, chip counts = rows |
| T13610 | Spotlight picker video large at 1440; phone card title / Got it don't wrap |
| T13620 | Shared reel has Download; content-change behavior matches the decision |
| T13630 | Move to Default shows the name; ranking counts correct on both profiles; no wrong-profile 404s |
| T13640 | Experienced account (4+ finished) gets advanced-option guidance; new account still gets basics |
| T13650 | 25 polish items, each its own repro |
| T13660 | Credit chip updates immediately after Add footage |
| T13670 | Viewer Share never creates a public link without a confirm |
| T13680 | Delete highlight shows an in-app dialog with the highlight name |
| T13690 | Game Highlights "Play all" plays (or is disabled with a reason); duration correct |
| T13440 | Finished posters load, no CORS errors in console |
| T13450 | Viewer guide names the share button actually shown |
| T13460 | Guidance switch overlaps nothing on Home (loaded + loading) and Annotate at 390/768 |
| T13470 | Sign-in: code step survives leaving the tab; exactly one verify-otp call (200). Check on your own sign-in |
| T13480 | Annotate play card small at 390 and only shown inside the play |
| T13490 | Finished tab opens at the top |
| T13500 | Account/credits polish items 1-6 |
| T13400 | Veo zip import into an EXISTING game works (no 422) |
| T13410 | Account Settings shows email sign-in, not Google, for this account |
| T13420 | Guidance switch never flashes On after reload when saved Off; no early-tap flip |
| T13430 | Credit history running balances correct while a generation is pending |

Already-passing in pass 1 (spot-check only): duplicate taps on Generate / Mark play / Finish / Share make one of each; offline during generation and during upload recovers; zip refusals; revoke share link (410 page); profile switch keeps data separate; Report a problem; Guidance Off persists.

## 5. Regression sweep (after the task checks)

One full new-parent journey at **390x844 touch** and at **1440x900**: upload a unique 5 s game, mark 2 plays (rate, tag, note), Review plays, make a portrait highlight (drag box, Play, Preview, Generate), add spotlight + text, Finish, share privately to hello@reelballers.com, open the share signed out. Watch for anything new: console errors, 4xx/5xx, wrong credit numbers, guide text that doesn't match the screen, overlaps, sideways scroll.

## 6. Filing and reporting rules

- **Fix verified:** note it in the task file's Progress Log (date, size, evidence). Do not mark DONE: the user owns DONE (board Resolve or /deploy).
- **Fix failed or partial:** add a Progress Log entry with what you saw, reopen the row (status back to TODO with a note in the description), and keep the evidence.
- **New bug:** create a task with the task-management skill (`docs/plans/tasks/T<id>-<slug>.md` + a PLAN.md row in "Release check bugs", bugs first). Every task must have: Source, Problem, numbered **Repro steps** with size/account/game, Expected vs Actual, and a **"Verify the fix (required, before and after)"** section (run repro before the fix and see it fail + a test that fails for that reason; rerun after and see it pass). Check `git fetch` for new IDs first; use the next free gap-based ID.
- Commit straight to **master** (docs only), subject starting with the first task ID (`T13700: ...`), ASCII only, ending with the Co-Authored-By line. Stage explicit files, never `git add -A`. Push and confirm origin matches.
- No em dashes or double hyphens in anything you write. Copy rule: never claim the app frames or tracks automatically (the user frames; the app smooths and sharpens).
- Known-intended, do not report: reload returns Home to the Games tab; sign-in card doesn't say why you were signed out; shared video end card links to www.reelballers.com.

## 7. Final reply

Summary (coverage, credits start/end), a table of every task: verified / failed / not on staging, with one line of evidence each; new bugs filed (IDs); and anything you couldn't reach and why.
