# Full QA pass 2026-11-17: remaining test plan

Source instructions: [2026-11-17-full-qa-pass-prompt.md](2026-11-17-full-qa-pass-prompt.md) (section numbers below refer to it).
Working files (local, gitignored): `qa/qa-pass-2026-11-17/` (REPORT.md, COVERAGE.md, bugs/, ux/, ux-review.html).

**How to use this file.** It holds only steps NOT yet done. Each time a batch of bugs is filed (PLAN.md + task files committed), the finished steps are deleted from here in the same commit. To resume after an interruption: read `qa/qa-pass-2026-11-17/REPORT.md` for findings so far, then continue from the first step below.

**Fixed facts.** App `https://staging.reelballers.com`. API `https://api-staging.reelballers.com/api`. Build at start `1e4e0998f (#7952)`. New parent account `imankh+qa-2026-11-17b@gmail.com` (the `imankh+qa-2026-11-17@` one already existed from an earlier run). Advanced `e2e@test.local`. Admin `imankh@gmail.com` (last). Sharpen budget: 8 total, plays of 10 s or less. Sharpens used so far: 3 (all on the new parent account).

**Done so far.** Step 0 (setup, COVERAGE.md) and Step 1 (new parent flow on phone, desktop, iPad; credits 88 to 211; 17.2 min and about 72 taps to a shared link). Batch 1 filed: T17010 to T17060 (ids jumped to T17010 because another session was filing T16910+ at the same time). Evidence files for this run are prefixed `r2-` in `qa/qa-pass-2026-11-17/bugs/` (an earlier run left files there). Confusion candidates so far are listed in REPORT.md under "U-candidate"; they still need U numbers and screenshots in `ux/`.

## Step 2. Advanced parent flow (`e2e@test.local`, Guidance off), desktop 1440x900, then phone, then iPad
- [ ] 2.0 Sign out new account, dev-login e2e. Check: at least 4 highlights, 2 profiles, 30 credits; top up if needed. Record start credits.
- [ ] 2.1 `/admin` as normal account shows "This page is not available"; no Admin row in profile window.
- [ ] 2.2 Signed out checks: `/privacy`, `/terms`, `/focus/p/abc` message.
- [ ] 2.3 Home chrome: credit chip, profile menu (Invite a friend, Account settings, Sign out), sport/profile chip, Guidance switch, install button, Continue Where You Left Off, storage banner, Report a problem (send one "QA pass test report, please ignore"), reload on each tab.
- [ ] 2.4 Games tab: upload details, cancel/resume/retry, leave mid-upload warning, same file twice, game tile actions (Watch plays, Add video, Share game, Keep only marked plays, Restore full video, Extend storage, Delete game), failed tile Retry/Discard, Share game window full cycle incl. turn off link, Watch plays window.
- [ ] 2.5 Mark Plays: all video controls, double-tap skip, play editor fields, trim handles, 5-star prompt, existing play actions, plays list filter, two videos + line up, import `test.short.tsv`, header and locked tabs, desktop keys (Space, K, J, L, A, arrows).
- [ ] 2.6 Frame: portrait/landscape switch confirm, box drag/resize/positions, copy/delete position, Undo, tight box warning, Preview, Trim and slow motion (split, 0.5x, trim end, delete split), tilt fix, Dim outside, audio switch, timeline zoom, Sharpen price vs credits, "Is your athlete in the box?", sharpening progress, ready panel buttons, desktop keys (Space, arrows, Shift+arrow, Ctrl+C/V). Several highlights from one play; portrait and landscape of the same play. Sharpens #4-#5.
- [ ] 2.7 Spotlight: all settings, circle drag/toggle/duration/delete, Add text all options, Pick cover, Redo spotlight, Edit zoom (cancel once, do once; share link still works and shows new version), unsaved-changes window. Download and check frames. Sharpen #6.
- [ ] 2.8 Plays tab: Upload a play, filters, Clear filters, grouping, every tile action.
- [ ] 2.9 Highlights tab: grouping, every tile action, finished player, link flow, share window, highlight reels + length slider + locked cards, ranking game, intro cards.
- [ ] 2.10 Shared pages signed out at phone and desktop: highlight, reel, game; turned-off link page; shared player keys.
- [ ] 2.11 Profiles: add second, separation, edit, move highlight between profiles, delete.
- [ ] 2.12 Account: settings email/method, Download My Data, Delete account up to type-DELETE then cancel, links, sign out and back in. Buy smallest pack, credit history adds up, Extend storage price vs taken.
- [ ] 2.13 Saving and connection: offline rating change, offline during sharpen (#7) and upload, two pages editing Frame.
- [ ] 2.14 Rough handling (section 9) desktop and phone: double taps, reload mid-step, Back/Forward, Esc and outside clicks, long/emoji/`<b>` names, empty tabs, expired game.
- [ ] 2.15 Repeat main checks on phone 390x844 touch (incl. Mark Plays and Frame cockpits at 844x390, rotate hint) and iPad 768x1024 touch.
- [ ] 2.16 File batch 2, update this file.

## Step 3. Layout sweep (section 8) as advanced parent
- [ ] 3.1 Every screen and window at 390x844, 360x640, 844x390, 768x1024, 1024x768, 1440x900, 1280x800, 1366x768, 1920x1080.
- [ ] 3.2 File batch 3, update this file.

## Step 4. Admin flow (`imankh@gmail.com`, last, one sitting)
- [ ] 4.1 Reach via chip > Admin row and via `/admin`; header + staging badge.
- [ ] 4.2 Open every section (Users, Journey, Activation, Retention Chart, Pack Mix, By Sport, Platform Breakdown, R2 Usage, Upload Failures, Revenue Reconciliation); load time, errors.
- [ ] 4.3 Filters and dimensions; number consistency checks; e2e and new account rows match what was done; View journey.
- [ ] 4.4 Grant 5 credits to e2e only; Log in as e2e only (banner, stop link); Manage Campaigns look only.
- [ ] 4.5 Layout at 768x1024 and 390x844. Sign out.
- [ ] 4.6 File batch 4, update this file.

## Step 5. Wrap up
- [ ] 5.1 Cleanup: extra profiles, junk games (keep bug evidence).
- [ ] 5.2 Build `ux-review.html`, publish as Artifact with screenshots.
- [ ] 5.3 COVERAGE.md has no empty cells; REPORT.md complete.
- [ ] 5.4 Final reply (section 12).
