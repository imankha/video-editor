# Project Plan

> **DONE rows are archived** to [PLAN-archive.md](PLAN-archive.md) (moved 2026-08-03) to keep this file short. When a task hits DONE, move its row there under the same headings.

## Current Focus

### Staging check account (owner request 2026-11-20, BUGS FIRST)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T18010 | [Staging check account has no play Frame can open](tasks/T18010-staging-check-account-has-no-frame-play.md) | 6 | 3 | 2.0 | TODO | [ ] | After each merge, /dotask checks the change on staging signed in as one shared test account, and that account has no play the Frame screen can open: one is already sharpened and two sit on a game whose upload never finished. On 2026-11-20 this failed all nine T17910 checks and filed nine false bugs, while the same checks passed C1 to C9 on another test account. We will give the account plays Frame can open and stop one run from using them up for the next. Done when the T17910 checks pass on staging as that account twice in a row. |
| T18020 | [Deploy archive step removes the headers of sections that still have work](tasks/T18020-deploy-archive-removes-headers-of-live-sections.md) | 6 | 2 | 3.0 | TODO | [ ] | After the 2026-11-20 deploy, 10 sections that still had tasks lost their table headers, so the board could not read them and the AI Coach milestone vanished from it. No task was lost and the headers were restored by hand. Nothing checks the archive step, so it can happen again. Done when a check fails on a plan with that mistake and the deploy runs it before committing. |
| T18030 | [Privacy policy and terms cover AI analysis and internal testing](tasks/T18030-privacy-terms-ai-analysis-and-internal-testing.md) | 7 | 2 | 3.5 | STAGING | [ ] | The privacy and terms pages said a parent's video is used only as they direct and listed Google for sign-in only. They now cover AI analysis of a game the parent chooses and internal testing with an opt-out, and still say no training, no selling. The attorney approved the wording and it merged on 2026-11-20 (PR #852). It goes live with the next production deploy of the app; telling existing users and the in-app opt-out are T18040. |
| T18040 | [Tell existing users the privacy policy changed, and let them opt out in the app](tasks/T18040-policy-change-notice-and-testing-opt-out.md) | 6 | 4 | 1.5 | STAGING | [x] | The new privacy policy promises an in-app notice of the change and offers an opt-out from internal testing, but there is no notice and the opt-out is an email address. Every signed-in user sees a one-time notice, a setting under Your privacy rights turns the testing use off, and the test tools refuse any account that opted out or has not seen the notice. Done when an existing user sees the notice once and can opt out in the app. |

### Milestone: AI Coach (owner request 2026-11-12, runs before the Referral programme)

**Why this section exists.** A parent who uploads a whole game must scrub up to ninety minutes to mark plays, and only 19 of 100 game uploaders go on to pay for a highlight, against 45 of 100 who arrive with clips already cut. On 2026-11-12 the owner finished a prototype that sends a game to a video model in five-minute pieces and gets back plays with tags, ratings and coaching notes for about $2.84 a game, and asked for it to be sold as a paid option before the referral programme starts. Epic: [mark-plays-with-ai/EPIC.md](tasks/mark-plays-with-ai/EPIC.md), with every screen state and string in [UX-FEEDBACK.md](tasks/mark-plays-with-ai/UX-FEEDBACK.md). Row order is the sequence. The owner approved the designs and ruled on the open decisions on 2026-11-12 (recorded in the epic). On 2026-11-14 the owner named it AI Coach and added four things: every change to what we ask the model is tried in the prototype and shown to them first; the five-minute pieces overlap by 30 seconds and are joined so no play is cut off; the result records which way each team attacked, as a check on which team is which; and one payment covers the team, with the offer moved out of the upload dialog into its own dialog. The owner ruled on the redrawn offer, starting-from-a-game and sharing screens the same day (decisions 35 to 44 in the epic), and approved the last screens after a second look. The owner turned on billing for the Google key on 2026-11-14.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[AI Coach](tasks/mark-plays-with-ai/EPIC.md)** | 9 | 8 | 1.1 | TODO |  | A paid option that has a video model watch the whole game and mark the plays for the parent's team, with tags, a rating and a coaching note on each. A dialog offers it while the game uploads, with the price in credits, and the parent is told honestly how far along the work is. One payment covers the team: families the game is shared with get AI Coach on it free, which is how we expect it to spread. A game is never analysed twice, and what we ask the model is tried in the prototype and shown to the owner before it is built. |
| T16130 | ↳ [Sport chooser where tags go](tasks/mark-plays-with-ai/T16130-sport-chooser-where-tags-go.md) | 6 | 2 | 3.0 | WIP | [ ] | Today a parent with no sport set sees an amber warning where a play's tags should be, and in the sideways full-screen view a line of text pointing at a control that is not on that screen. The owner hit this on 2026-11-12 and asked for a way to choose a sport there, as if nothing were wrong. We will show a calm sport chooser everywhere tags would appear; one tap picks the sport and the tags appear in place with the play untouched. The AI analysis needs the sport too and reuses the same chooser. Done when a parent with no sport can pick one and tag a play from every version of the play form without seeing a warning. |
| T16145 | ↳ [Prototype the prompt and the joining](tasks/mark-plays-with-ai/T16145-prototype-prompt-and-joining.md) | 9 | 4 | 2.3 | WIP | [ ] | The analysis exists as a prototype that watches one five-minute piece of a game at a time. Seven planned changes to what we ask the model have never been run, a play that crosses the line between two pieces gets cut in half, and pieces sometimes disagree about which team is which. We will make every change in the prototype first: pieces that overlap by 30 seconds, joining code that keeps the complete version of a play and never lists a moment twice, and each team's attack direction as a second check on which team is which. The owner reads the output files and iterates, because a stored analysis is never redone. Done when the owner has approved one version of the prompt, the format and the joining from its output files. |
| T16146 | ↳ [Prototype: find the ball and the players, crop to the play, then ask](tasks/mark-plays-with-ai/T16146-prototype-crop-from-ball-and-players.md) | 9 | 5 | 1.8 | TODO | [ ] | AI Coach is on hold behind one question: can it find a child's highlights? On the full camera picture every model failed, but cropped to the play by hand and enlarged, Gemini saw both of the owner's five-star dribbles with the right team. This prototype brings back the earlier player and ball detection work, builds the crop from the ball and the players around it, and scores the result on seven hand-marked slices. Done when the owner has the numbers and rules go or no-go for the epic. |
| T16150 | ↳ [Game analysis engine](tasks/mark-plays-with-ai/T16150-game-analysis-engine.md) | 9 | 7 | 1.3 | TODO | [x] | Today the analysis exists only as a script on the owner's machine. This builds the server job, using the prompt, format and joining the owner approved in the prototype: it sends a stored game to the model in five-minute pieces that overlap by 30 seconds, all at once, checks every piece was fully watched and that the pieces agree on which team is which, joins the answers and keeps the result against the video itself, so the same game is never analysed twice. It records real progress, such as 11 of 18 sections watched, for the screens to show. Done when a 90-minute game on staging produces a complete stored analysis with no play cut at a join, a repeat request makes no model calls, and a job interrupted by a restart finishes. |
| T16160 | ↳ [AI analysis price and charge](tasks/mark-plays-with-ai/T16160-ai-analysis-price-and-charge.md) | 8 | 4 | 2.0 | WIP | [x] | Credits pay for storage by file size and for highlights by the second; an analysis costs us about $2.95 for a 90-minute game and needs its own price. We will charge 1.5 credits for each minute of video, 135 for a 90-minute game, which is a little above cost on the cheapest pack and well above on the others. Credits are set aside at the start, taken only when the result is ready and given back if it fails; a parent who uploads an already analysed game on their own pays the same and gets it at once. Done when the price shown equals the amount charged, a failure leaves the balance unchanged, and the admin sees credits earned against model cost. |
| T16170 | ↳ [AI Coach offer after upload](tasks/mark-plays-with-ai/T16170-ai-coach-offer-after-upload.md) | 9 | 5 | 1.8 | TODO | [ ] | Today the upload dialog shows a small storage cost and uploads; the parent then marks every play by hand. We will leave the upload dialog as it is and, once the upload is running, open a separate dialog that offers AI Coach with rotating examples of real AI plays, the exact price for this game and the promise that one payment covers the whole team. A checkbox in the upload dialog had no room to advertise the feature and tied buying to uploading. A parent short of credits can buy more in the dialog, and the upload is never held up. Afterwards the game says truthfully what is happening and an email arrives when the plays are ready. Done when a parent can accept, pay, leave, come back and find it ready, and every state shown matches the server. |
| T16180 | ↳ [AI Coach for uploaded games](tasks/mark-plays-with-ai/T16180-ai-coach-for-uploaded-games.md) | 7 | 3 | 2.3 | TODO | [ ] | A parent who said not now at upload, or uploaded before the feature shipped, has no way to get plays marked by the AI. We will offer it from the game itself: a quiet line under the main action cards on the game's page and an item in the game tile's menu, both opening the same dialog as at upload with the exact price and the balance. It is deliberately not a main action card: a parent who skipped it at upload has shown it is a lower priority. Parents with a backlog of unmarked games are the likeliest buyers. Done when an analysis can be started and paid for on any stored game from phone or desktop, and a game that already has AI Coach never offers to sell it again. |
| T16190 | ↳ [Team colour and play import](tasks/mark-plays-with-ai/T16190-team-colour-and-play-import.md) | 9 | 6 | 1.5 | TODO | [x] | A finished analysis holds every play for both teams, named only by kit colour, and nothing is in the parent's game yet. We will ask which colour their team wears, showing which way each team attacked in the first half as a second way to tell them apart, and bring in only the plays the model rated as strong for that team, a few dozen for a full game, in the Team lane with tags, a note and a star rating filled in. A play is always brought in and rated Brilliant when one of their players clearly shows something a college coach scouts, or does something impressive enough for social media, and its note says which. Bringing in everything would bury the parent in routine passes. The model sometimes gives a play to the wrong team, and the stored result describes every play from both sides, so each AI play also has a "Wrong team" button that flips just that play to the other team's side of it (new tags, rating and note) and counts the miss. Done when a parent picks a colour and sees those plays, can switch team without paying again, can flip one play the model gave to the wrong team, and can remove the AI plays they have not touched. |
| T16200 | ↳ [Tag players in AI plays](tasks/mark-plays-with-ai/T16200-tag-players-in-ai-plays.md) | 8 | 5 | 1.6 | TODO | [ ] | After the import the plays say what the right winger or player 10 did but not who that is, because the model can almost never read a jersey number from the sideline. Only the parent knows. We will give them a fast tagging screen: one play at a time, the clip looping, each mentioned player as a chip. One tap on a chip either moves the play to My athlete, using the switch the app already has, or tags a teammate by name and email exactly as the app does today, which shares the game and its Team plays with that family. Done when a parent can work through 40 plays on a phone in a few minutes, their child's plays are under My athlete, and teammates tagged from a chip receive the game as they do today. |
| T16202 | ↳ [Share AI Coach for free](tasks/mark-plays-with-ai/T16202-share-ai-coach-free.md) | 9 | 5 | 1.8 | TODO | [x] | Under the plan so far, a family that receives a shared game gets plain plays: no way to see which player the AI meant or to find their own child without paying. We will make one payment cover the team: when a parent who has AI Coach on a game shares it, the receiving family gets the sharer's team plays as today with the full AI Coach on them, free, and can share it on; families the game was shared with before the purchase get it too, and the app says so wherever the feature is sold and wherever a game is shared. A receiver costs us nothing, because the analysis already exists, and each one is a family that has used the product on a game they care about. A parent who uploads the same video on their own still pays. Done when a second account that receives a shared game finds its own athlete's plays without paying, and the owner can see receivers per paid analysis and how many later bought. |
| T16206 | ↳ [Skip dead time when watching an AI Coach game](tasks/mark-plays-with-ai/T16206-skip-dead-time-in-playback.md) | 7 | 4 | 1.8 | TODO | [ ] | A quarter to a half of a youth game is dead time (measured on one ten-minute clip): the ball being fetched, a corner being set up. The AI Coach analysis already writes each dead stretch down, and nothing uses them. A parent watching a game with AI Coach can turn on "Skip dead time" and playback jumps over each stretch, the way watching only the plays already does. Done when such a game plays with the dead stretches skipped and a game without AI Coach is unchanged. |
| T16205 | ↳ [Highlight facts in one read](tasks/mark-plays-with-ai/T16205-highlight-facts-in-one-read.md) | 7 | 3 | 2.3 | TODO | [ ] | What we know about a highlight (a finished short clip) is scattered: its note and star rating sit on the play it came from, the AI's description sits with that play, and its comparison-game standing sits on the highlight. The AI reel builder planned after the reel builder reads text only and needs all of it at once. This builds one server read that returns every fact for every highlight an athlete has, and proves that a play marked by the AI still carries what it demonstrates once it has become a highlight. Doing it inside this epic finds any gap before games have been analysed and stored. Done when one call returns the full set for a test athlete and reads no video. |

### In progress (a task's row moves here when work on it starts)

Rows here are WIP or waiting on the owner; a merged row stays until it is DONE and archived.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Bugs found by /dotask verify

Filed by /dotask verify and the staging check. Bugs outrank every feature (owner rule 2026-11-13), so this section sits at the top, right under the work in flight.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Signed-in loading is slow on production (owner report 2026-11-13, BUGS FIRST)

The owner sat on the loading screen on production on 2026-11-13. Measured the same day: the server checks every signed-in request against the accounts database, the check takes 0.2 to 0.6 seconds, and requests queue behind each other, so 12 at once wait 6.3 seconds each. Listed in the order to do them.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Code health: bugs (code review 2026-11-13, BUGS FIRST)

On 2026-11-13 every row of the old Chores, Later and July audit sections was checked against today's code. These are the ones that are wrong behaviour now, listed in the order to do them. Several wait for the multi-clip removal in flight (T11250, T11260, T11270) because they edit the same files; each row says so.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Code health: deletions and refactors (code review 2026-11-13, runs after the bugs above)

From the same review. Deletions come first, because less false code makes every later task and every AI agent more accurate. Each row removes dead code or a second copy of something; nothing a parent sees changes unless the row says so. Listed in the order to do them. Rules: [Refactoring Rules](../../CLAUDE.md#refactoring-rules).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Full QA continuation 2026-11-18: reproduced bugs (owner-requested, BUGS FIRST)

**Why this section exists.** The owner requested continuation of every-feature QA and immediate filing. Current staging is ce8988c54 (#8063). Evidence is under `qa/qa-pass-2026-11-18/` locally. Existing bugs keep their ids.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Full QA pass 2026-11-17: bugs and possible bugs (owner-requested, BUGS FIRST)

**Why this section exists.** Owner asked on 2026-11-17 for a full QA pass of every feature at phone, iPad and desktop sizes. The new parent journey reached a downloaded highlight and share link, with checkout tested at phone and desktop viewports. Screenshots: `qa/qa-pass-2026-11-17/` (local, gitignored). Rows marked possible need a repro first.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Staging QA 2026-11-16: bugs and possible bugs (owner-requested, BUGS FIRST)

**Why this section exists.** Owner asked on 2026-11-16 for a full Playwright QA pass on staging and to file everything found. The pass walked upload, Annotate, Frame with a real sharpen, Spotlight with a real render, share link (signed out, phone size, link preview), download, Home tabs, credits and account menus, on desktop and a phone-sized screen, as the staging test account. Everything not listed here worked. Rows marked possible need a repro first.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Staging QA 2026-11-09: bugs and possible bugs (owner-requested, BUGS FIRST)

**Why this section exists.** Owner asked on 2026-11-09 to file every bug and possible bug from the staging QA pass (new-user flow on desktop, iPhone and iPad, plus the version check of everything in STAGING) at the top of the task list. Screenshots: `qa/staging-qa-2026-11-09/` (local, gitignored). Rows marked possible need a repro first.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### 6. Highlight reels and the recruiting kit (stage: come back; 18 users have 2 or more highlights, 17 of 402 returned after a week; portrait 14 users against landscape 5 since 10-18)

String highlights into reels for college recruiting. The reel is the only in-product reason to return next weekend, and the reel's title card is the cover, the recruiting card and the first second of the reel, because frame 0 is what every platform shows. Ship the smallest version first and let real reels decide the rest. Ratio warning: most highlights are portrait, coaches watch 16:9; T14770's "Where will you share it?" step should route recruiting intent to landscape before the builder sees a portrait-only set. The single-clip cleanup and the analytics reroute are the technical prerequisites. The reel builder itself is the Highlight reel builder milestone in Current Focus: [highlight-reel-builder/EPIC.md](tasks/highlight-reel-builder/EPIC.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Payment return and campaign attribution lost on arrival (priority, owner-requested 2026-11-05, BUGS FIRST)

**Why this section exists.** Found in the T14970 review and confirmed live on staging: URL canonicalization at module load removes the query string before App reads it. A user returning from Stripe gets no confirmation, credit refresh or auto-export, and `utm_*`, `ref` and click ids never reach sign-up. Every attribution number and the Spend readiness attribution gate depend on this.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Production incident 2026-11-04: upload success rate 43.8% (BUGS FIRST)

Analytics alert 2026-11-04. Root cause from the prod log and `upload_failures`: one user re-picked the same zip of clips while a batch was running; two or three flows then shared each file's upload session and recorded each other as failures (27 clip finalizes filed as `game_upload_failed`). Every file had landed. Not a deploy regression (same signature 2026-10-27).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Copy audit (user-approved 2026-11-03, BUGS FIRST)

Follow-ups to the admin Journey map from the prod screenshots of 2026-11-03: fix the missing event behind "Pressed Export 0" (bug first), make stage counts never go up, add full screen, and make a drop-off count list those users in the Users table. Sized for a junior dev; order below. Moved to the top 2026-11-03 (funnel order: the map must stop lying before anything below it is measured). Shares files with the Copy audit milestone, now below: T14710 shares `routers/export/framing.py` with T14540 and the paid Sharpen my highlight button with T14620, and T14720 renames the stage labels to the copy glossary (keys stay frozen). T14720 replaces the original design's skip ribbons with implied reach (user ruling 2026-11-03).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Mobile fullscreen Annotate covers the video (user feedback 2026-11-08, BUGS FIRST)

A parent on an iPhone cannot see the play while trimming or fast-forwarding in fullscreen. Reproduced: in portrait, Edit play covers 92% of the video picture; in landscape it covers 76% and the controls cover 88%. The owner picked UX options B + D now and C as the follow-up (2026-11-08).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Acquisition test prep (owner-approved 2026-11-04, runs after the bugs above)

**Why this section exists.** The 2026-11-04 top-down analysis ([topdown-vs-bottomup-2026-11-04.md](bi/topdown-vs-bottomup-2026-11-04.md), revenue outlook in [revenue-outlook-2026-11-04.md](bi/revenue-outlook-2026-11-04.md)) found the gap between the market (4.7M to 8.4M US competitive-tier athletes) and the funnel ($348 a year today) is reach, not price or demand, and that the referral K factor, the cost per sign-up by platform and geography, and the US vs non-US mix are the model inputs no existing data can produce. A multi-arm acquisition test (Meta, Reddit Ads, share loop, coach codes, organic Reddit, SEO; budget tier is the owner's open decision, $2,500 recommended) needs three measurement pieces first, approved 2026-11-04 from a list of six: the sharer's code on the end card (K becomes measurable from existing tables), a channel read-out keyed on raw attribution (the daily row every arm is read from), and country at sign-up (the organic comparator for the geo arms). Deliberately not filed: code entry at sign-up and partner codes, footage source at upload, a flag-gated referral reward (pricing-adjacent), and any Meta CAPI or Reddit Pixel (against the in-house analytics rule). Audit of what already exists is in section 10 of the top-down doc. Order: T15070 (half a week, unlocks K) -> T15120 -> T15100.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Journey map follow-ups (user request 2026-11-03, runs after Copy audit)

**Why this section exists.** On 2026-11-03 the owner asked for the TODO list to be re-sorted by predicted impact on the funnel, highest fall-off first. Sources: the prod Journey map (14 d conversion window, 14 d inactivity, all platforms; counts are users at their furthest stage) and a fresh `empty`-preset walk-through on master at desktop 1280x800 and phone 390x844 with a real Modal export (every ladder event was recorded). **Order rule for everything under Current Focus:** sections are grouped by the stage they move, largest absolute loss first; inside a stage, bugs then Pri; measurement fixes that make the map lie go first of all (T14710). Sections moved up from lower in the file carry a dated note; two moves reverse earlier owner sequencing (Video Pre-Shrink was deferred until after Tutorial Redesign on 2026-09-17; Movement Tracking and Player Moments were sequenced after For Alpha polish) and are the owner's call to keep.

**Where parents drop (prod, 2026-11-03), what the walk-through found there, and the tasks that move each number.** The ranking table is not a task table; the board rows for the new tasks follow it.

| # | Stage (reached, lost: gone / stuck / in window) | What the walk-through found | Tasks, in order |
|------|------|------|------|
| 1 | **Add footage** 277 reached, **100 lost** (100 gone, 0 stuck, 21 in window), 36% of everyone who opened the upload screen | The modal has no answer when the game video is not on this device; "Skip ahead on Clips" is grey body text on Home; the loss is one number that mixes never-picked-a-file with upload-died. | T14800 (split the stage), T14810 (no-file path), T9000 (size x speed failure matrix, Video Pre-Shrink), T10350, T14530/T14540 (upload error text) |
| 2 | **Footage landed** 183 reached, **47 lost** (46 gone, 1 stuck, 6 in window) | Uploaded a whole game, never marked a play: the next step is scrubbing 90 minutes. The upload-complete email (T7670) exists; the time sink does not change. | Veo Highlights Import (T13200-T13240), Player Moments (T14295-T14340), Lifecycle Email Drip (T7230-T7270: every lost user here is "gone", only mail reaches them), T3290 |
| 3 | **Clipped** 143 reached, **45 lost** (44 gone, 1 stuck, 9 in window) | Marked and rated a play, never opened Frame. The walk-through guessed 90% here; prod says 62%. Two Make highlight cards plus Share plays compete on the same screen; "Frame" names a tool, not the parent's goal. | T14770 (one Make highlight button, Edit play first), T14780 (step names say the goal), Copy Vocabulary T14600/T14610/T14620, T14560 |
| 4 | **Moved framing window** 77 reached, **42 lost** (41 gone, 1 stuck, 11 in window), and **Pressed Export 0** | **Inflated by instrumentation:** the live Frame export (`POST /api/export/render`) records no `export_started`, `export_completed` or `framing_exported` (verified 2026-11-03: zero `record_milestone` calls in `routers/export/framing.py` and `multi_clip.py`; only the Spotlight export and the legacy job worker record them), so a parent who sharpened a highlight and skipped Spotlight is counted as lost here. Real friction found: Generate stays locked until the box is dragged AND Play is pressed; the first progress estimate says "under a minute" for a 131 s export. | T14710 (bug, first), T14830 (unlock on drag; decision), T14760, T14860, Free Second Highlight (T11610 measures credits spent before the first export) |
| 5 | **Started** 332 reached, **33 lost** (33 gone, 3 in window) | Opened the app, never opened the upload screen. Likely share-link viewers who signed up to watch, and parents whose expectation was set by the landing overclaims. | T14520, T14810 (Home secondary button), T7410 (origin split for the top of funnel), drip day-1 |
| 6 | **Signed up** 376, **20 lost** (20 gone, 3 in window) | Signed up, no session. A sign-in code email whose heading is white on no background is invisible in light-mode clients. | T14510 (bug), T7410 |
| 7 | **Finished highlight** 19 reached, **8 lost** (7 gone, 1 stuck, 1 in window) | One tap from done, 42% leave. Reproduced: after Get share link, the closing Guidance card shades the screen and Download is outside every cutout, so it is dead until the card is dismissed. On phones Share sends the file, never a link. | T14840 (bug), T11510, T11530 |
| 8 | **Opened Frame** 89, 7 lost; **Opened Spotlight** 3 lost | Small losses, but at 1280x800 the Frame preview is 75x135 px and the Spotlight video runs under the action bar; the Frame coach can open at step 2 and stall. | T14760 (bug), T14850 |
| - | **Exported 20 -> Finished 19**, 1 lost | Healthy. | none |

New tasks (board rows), stage order. The nine rows from T14800 down were dropped by the 2026-11-03 re-sort (d36ef1ce2) and restored by T14920 on 2026-11-05 with their statuses checked against git (no branch and no implementation commit for any of them, so all stay TODO):

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Spend readiness and Next Step panel (user request 2026-11-03, runs after Journey map follow-ups)

**Why this section exists.** The 2026-11-03 ad-spend model ([ua-roi-model-2026-11-03.md](ua-roi-model-2026-11-03.md), built on a read-only prod aggregate pull of the same day) found paid acquisition loses money in every product state: contribution per sign-up is $0.15 measured, $0.32 after the fix list, $1.56 optimistic, against $9 to $58 per paid sign-up on Meta or TikTok. No single funnel input flips that; only CAC near zero (referral, club partnerships) can. The spend decision therefore hangs on ten measurable gates (visit-to-sign-up, sign-up-to-export, upload failure, finished-to-took-away, money-ladder denominator, payers per 100, revenue per payer, second-season repeat, K-factor, attribution coverage), each with a target. The owner asked for those values and the Journey transitions coloured green / yellow / red, and for one "Next Step" panel that says what to do next, which tasks move it, and whether paid spend is allowed (NO / TEST ONLY / SCALE). Depends on T14710 and T14720 for honest numbers and on T7410 for the visit gate (grey until then). T14910 shares the constants and RAG-chip pattern with T7460 (the design gate decides whether T7460's six criteria fold into the same panel). Order: T14900 (frontend only) -> T14910 (endpoint + panel) -> T14920 (reads both). Sport dimension (owner rulings 2026-11-03: users can have several sports, no DB change, no read-time cost): T14930 arrival sport (parallel with T14900) -> T14940 event tag -> T14950 rollup view (after T7400). T14960 (Visited head node) waits for T7410. Attribution hop (owner question 2026-11-03): the landing already relays `utm_*`, `ref` and the external referrer host onto its app links (T3455, T7910) but only from the first page a visitor sees; T15000 makes it survive internal navigation (per-tab first touch, lands before T14930 so the arrival sport is the first sport page) and T15010 adds the converting landing page as one `user_segments` column. Owner rulings 2026-11-07 (decision page): T15200 may be built before the funnel gates read green; no date is ever a blocker; T7400 splits so its store module (T15280) ships now and T7410 -> T14960 follow; T15230 ranks leaks by loss rate x users entering the step; account deletion keeps analytics with a hashed email (T15290).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Recruiting reel research (owner request 2026-11-13, runs before AI Coach)

**Why this section exists.** On 2026-11-13 the owner asked for an AI reel builder, to come after the reel builder, that understands what college coaches want to see, and for research into successful reels. The research has to come first, ahead of AI Coach, because that work stores each game's analysis once and must already record what every play demonstrates. It is one task with no code, and it belongs to the AI reel builder epic: [ai-reel-builder/EPIC.md](tasks/ai-reel-builder/EPIC.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Automatic finish (owner request 2026-11-14, runs before AI Coach)

**Why this section exists.** A highlight is a finished short clip, and Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today a sharpened highlight waits on a "Your highlight is ready" panel and only reaches the Highlights tab, where it can be downloaded and shared, when the parent taps Finish. On 2026-11-14 the owner asked what parents who exported but never finished had done, and how many redo a highlight from that panel. A read of every production account found 33 parents who paid to sharpen a highlight and have nothing in Highlights, against 17 who finished at least one; 13% of highlights were redone, nearly all within minutes, and nobody parked one to reconsider later ([finish-step-evidence-2026-11-14.md](bi/finish-step-evidence-2026-11-14.md)). The owner asked for the recommendations as an epic ahead of AI Coach. Epic: [automatic-finish/EPIC.md](tasks/automatic-finish/EPIC.md). Row order is the sequence. The second task needs an architecture review and the third a design review before they are built.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Referral programme, 50% of revenue for two months, no codes (owner request 2026-11-05; BLOCKED until every funnel gate that has a reading is green; gates grey by design never block and no date is a blocker, owner 2026-11-07)

**Why this section exists.** The owner's 2026-11-05 request: mass-email a bank of users (and, in time, thousands of clubs) a share link and a dashboard link; referrers earn 50% of the revenue from the users they onboard for two months; no codes; keep it simple; paid-ads tracking stays separate (T15200). The ROI model makes this the one channel that is GO by construction (cost is a fraction of revenue); its risk is K, not unit economics. Epic: [referral-programme/EPIC.md](tasks/referral-programme/EPIC.md). No prep before the funnel is fixed (owner rule 2026-11-05).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Referral programme](tasks/referral-programme/EPIC.md)** | 8 | 5 | 1.6 | BLOCKED |  | Five tasks in dependency order; the share link is the existing invite link (`/?ref=<invite_code>`, resolved at sign-up into `referrals`), accrual is computed from the `payments` ledger, payouts are an append-only table written by one admin gesture. |
| T15210 | ↳ [Referral earnings read model + payouts ledger](tasks/referral-programme/T15210-referral-earnings-and-payouts-ledger.md) | 8 | 5 | 1.6 | BLOCKED | [x] | Epic 1/5, L-tier, Migration agent. `referral_earnings.py`: 50% of net purchase revenue within 60 d of the referred sign-up, refunds netted, self-referral and test accounts excluded, pending vs owed vs paid; `referral_payouts` append-only table (T8630 trigger pattern); `GET /api/referrals/earnings` and `GET /api/admin/referrals/owed`. |
| T15160 | ↳ [Referrer page: your link, your referrals, what you are owed](tasks/referral-programme/T15160-referrer-page.md) | 7 | 3 | 2.3 | BLOCKED | [ ] | Epic 2/5, M-tier, frontend. `/referrals`: share link with Copy and native share, joined / earned / paid / owed, a dated list without names, link to the terms. Read only; mobile first; the email lands here. |
| T15170 | ↳ [Outreach list and mass send, sized for thousands of clubs](tasks/referral-programme/T15170-outreach-list-and-mass-send.md) | 8 | 6 | 1.3 | BLOCKED | [x] | Epic 3/5, L-tier, Migration agent. Contacts table (users and non-user club contacts, CSV import with dedupe), claim-your-link flow that is a sign-up, batch send runner with a durable cursor, provider rate limits, unsubscribe and bounce handling, per-contact status in the admin, owner test send first. |
| T15180 | ↳ [Admin payouts: owed per referrer, mark paid, Stripe Connect decision](tasks/referral-programme/T15180-admin-payouts.md) | 7 | 4 | 1.8 | BLOCKED | [ ] | Epic 4/5, M-tier plus a design-gated spike. Owed list with CSV export, mark-paid gesture (manual, PayPal, Stripe transfer, credits via `credit_ledger.grant` with an idempotency key); the spike reads two months of owed totals and recommends manual, credits or Stripe Connect Express above a threshold. |
| T15190 | ↳ [Programme terms and abuse rules](tasks/referral-programme/T15190-programme-terms-and-abuse-rules.md) | 6 | 3 | 2.0 | BLOCKED | [ ] | Epic 5/5, M-tier. Landing terms page; rules as named constants with a failing test each (own purchases, refunds and disputes, 60 d window, minimum payout); same-IP sign-up flags in the owed list, informational only. |

### Milestone: Highlight reel builder (owner request 2026-11-12; runs after the Referral programme; the dependency on Click-once Spotlight was dropped by the owner on 2026-11-18)

**Why this section exists.** A highlight is one finished short clip and a reel is several of them joined into one video. Today a parent can share a highlight but cannot join several, and the reel is the only reason the app gives a parent to come back next weekend: 18 parents have two or more highlights and only 17 of 402 returned after a week. On 2026-11-12 the owner asked for a builder where the parent picks finished highlights, orders them, defines the transition between them and adds cards that stay up for a set length. Epic: [highlight-reel-builder/EPIC.md](tasks/highlight-reel-builder/EPIC.md); the choices, with drawings, a recommendation and the reasons for and against each, are on the decision page https://claude.ai/artifact/Ug2wkCAVfxhUCfBgKQWq2H . Row order is the sequence. The first task was designed and ruled on 2026-10-20 and can ship alone; it needs the two clean-up tasks that remove old several-clip code (T11250, T11260) to land first. The owner answered the eight choices on 2026-11-13: seven as recommended or simpler (one transition for the whole reel, with a slider for its length), plus music under a reel if an open music bank with terms that cover us can be found (T16310).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Highlight reel builder](tasks/highlight-reel-builder/EPIC.md)** | 8 | 8 | 1.0 | TODO |  | A parent picks finished highlights (short clips of their athlete), puts them in order, chooses how each one moves into the next, and adds cards (still screens with words) that each stay up for a set length. The plain version ships first: pick, order, one title card, straight cuts, export. A wider transition choice that plays in the preview, cards with their own lengths, and optional music follow. The export is free, because every highlight in a reel was already paid for. |
| T11300 | ↳ [Highlight reel, first version](tasks/T11300-reels-v2-post-publish-stitcher.md) | 8 | 8 | 1.0 | TODO | [x] | Parents want one assembled reel for college recruiting, and a reel that grows across the season is the only in-product reason to come back next weekend: 18 parents already have two or more highlights, and only 17 of 402 returned after a week. The first version is deliberately small: pick finished highlights, put them in order, add one title card, join them with hard cuts, and export. A wider transition choice that plays in the preview (T16290) and cards with their own lengths (T16300) follow in the same epic. One warning: most highlights are portrait and coaches watch widescreen, so the Where will you share it question (T14770) should steer recruiting parents to landscape before they build a reel. |
| T16280 | ↳ [Reel render engine](tasks/highlight-reel-builder/T16280-reel-render-engine.md) | 8 | 6 | 1.3 | TODO | [ ] | Today the app joins highlights (finished short clips) for a download by gluing the files end to end, which takes seconds but can only cut from one to the next. A fade or a crossfade needs the picture around each join re-made, and a card (a still screen with words) needs turning into video of an exact length. This builds the server job that does both, with one transition and one length for the whole reel, and measures what nobody knows yet: how long a parent waits and what it costs us when a reel has fades in it. Done when a ten-highlight reel with a crossfade at every join and three cards comes out on staging with every length right, and a reel with only cuts is still as fast as today. |
| T16290 | ↳ [Reel transition and preview](tasks/highlight-reel-builder/T16290-reel-transition-and-preview.md) | 7 | 4 | 1.8 | TODO | [ ] | In the first version the parent chooses a straight cut or a fade to black for the whole reel, the fade has one fixed length, and it only shows after export. The owner ruled on 2026-11-13 that one transition for the whole reel is enough. With this change that one choice gains crossfade as a third kind and a slider for its length, and the preview plays the transition, so the parent sees the reel as it will be before exporting. Done when a parent on a phone picks crossfade, drags the length to about one second, watches it in the preview, and the exported reel plays the same at every join. |
| T16300 | ↳ [Cards with set lengths](tasks/highlight-reel-builder/T16300-cards-with-set-lengths.md) | 7 | 5 | 1.4 | TODO | [ ] | In the first version a card (a still screen with words) always stays up for two and a half seconds, which is too long for a one-word heading and too short for contact details a coach has to read. With this change the parent can add a title card, a section card or an end card anywhere in the reel. Each has its own length, suggested from the number of words on it and changed with plus and minus buttons in half-second steps. Done when a parent on a phone adds a section card of one and a half seconds and an end card of five seconds, and both last exactly that long in the exported reel. |
| T16310 | ↳ [Music for reels](tasks/highlight-reel-builder/T16310-music-for-reels.md) | 5 | 6 | 0.8 | TODO | [ ] | A reel keeps the sound of each highlight and has one mute switch. The owner also wants a parent to be able to lay a music track under a reel, if we can find an open music bank with a good sports or high-energy category. The catch is the licence: most free libraries let a person use a track in their own video but do not let an app hand the tracks out to its users. This task first finds a bank whose written terms cover our use and has at least twenty fitting tracks, and only then builds a short picker. Done when the owner has approved a bank and a parent can pick a track, hear it in the preview and export a reel with it; or, if no bank qualifies, when that is written down and the task is closed. |
| T15880 | ↳ [Reel title card and cover](tasks/T15880-reel-title-card-is-the-cover-recruiting-kit.md) | 8 | 4 | 2.0 | TODO | [ ] | The reel's title card, with the athlete's name, number, position, graduation year and club, is held as the first frames, so it is the picture every platform shows, the card a coach needs, and the first second of the reel. Competitors charge ten to fifteen dollars a month for this. A share link for the reel shows the parent how many times it was viewed. |

### Milestone: AI reel builder (owner request 2026-11-13, runs after the Highlight reel builder, so it follows it to after the Referral programme)

**Why this section exists.** Once the reel builder exists a parent still has to choose which highlights (finished short clips) go into a reel, in what order and under which headings, and most parents do not know what a college coach wants. On 2026-11-13 the owner asked for a builder that does know: a language model that reads the note on each highlight, what it demonstrates and its comparison-game standing, and never watches video. Its sections come from what the athlete has good highlights of, not from a template for their position, and the first version makes recruiting reels only. Epic: [ai-reel-builder/EPIC.md](tasks/ai-reel-builder/EPIC.md). The research ran before AI Coach and the data work was done inside it; the two rows below are outlines whose detail is written after the reel builder ships.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[AI reel builder](tasks/ai-reel-builder/EPIC.md)** | 7 | 5 | 1.4 | TODO |  | One tap suggests a recruiting reel: which highlights (finished short clips) to use, their order, the section cards and a title, and the parent edits and finishes as usual. A language model reads text only, the notes and ratings we already hold, guided by an expert built from our research into what college coaches want. Parents get the judgement they lack, at about a cent a reel. |
| T16330 | ↳ [Reel expert prompt](tasks/ai-reel-builder/T16330-reel-expert-prompt.md) | 7 | 3 | 2.3 | TODO | [ ] | The knowledge of what a coach wants exists only as a research document. This turns it into the instructions the reel model runs with: one general part for every sport, and a short part for each sport stored with that sport and added for its athletes. The instructions tell the model to build sections from what this athlete has good highlights of, not from a position template. Done when the owner has approved the text and a trial gives sensible, different sections for two athletes in different positions. |
| T15890 | ↳ [Suggested reel](tasks/T15890-llm-reel-assembly.md) | 7 | 4 | 1.8 | TODO | [ ] | A parent building a reel must still decide the picks, the order and the headings. The Reels tab gains one button, Suggest a reel: the model reads the facts on each of the athlete's highlights and the builder opens already filled in, with one line of reasoning beside each pick. It reads no video, so a suggestion costs about a cent, and nothing is exported until the parent presses Finish. Done when a parent with five or more highlights gets a suggestion in under twenty seconds and the suggestions share at least 70% of their picks with ten reels the owner built by hand. |

### Milestone: Resume where you left off + impersonation lands on the user's page (user request 2026-11-03)

**Why this section exists.** Owner request 2026-11-03: a user who leaves and comes back should land on the same page, and an admin impersonating them should see that page as exactly as possible, to debug drop-offs. Today the URL names only the mode (`/annotate`, `/focus`, `/overlay`, `/home/*`), the open game or play lives in memory plus per-tab sessionStorage breadcrumbs, and a cold hit on an editor route bounces home by design (T5677). So three pieces in dependency order: T14970 gives every editor page a canonical URL and cold-load hydration (frontend only); T14980 adds the resume point, one Postgres row per user (`user_resume_points`, by design not `user.sqlite`, whose every write is an R2 sync) written on navigation gestures and on the exit gesture, returned on `/me`, restored only on a plain `/` arrival, validated against the target, visible and dismissible; T14990 makes impersonation land on that point and shows it in the user detail panel (screen, step, game and play, playhead, open dialog, platform, build, age). The 2026-07-04 rule that view state is never persisted still holds: the point stores the object and position of the work, never filters, sort or panels. Impersonated sessions never move the user's point. Order checked against in-flight work 2026-11-05: T14970 starts now and shares no file with it; T14980 also waits for T15150 to land; T14990 also waits for T14910 and T14920 to land.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

## Roadmap (re-ranked 2026-11-09 on production evidence)

**Why this order.** Every section names the funnel stage it moves and the number it is judged by, from the prod read in [bi/funnel-evidence-2026-11-09.md](bi/funnel-evidence-2026-11-09.md): 402 real sign-ups, 193 got footage in, 109 marked a play, 56 paid for a highlight, 11 took it away, 18 made a second highlight, 17 came back after a week, 6 ever shared a link, 6 paid money. Day-one Spotlight users are the only group that returns and pays; credits are not what stops the second highlight; game uploaders convert at 19% against 45% for clip users; big files almost never land. Bugs still run first (the Current Focus sections above). Section order is the sequence; inside a section, row order is the sequence. Rows retired on 2026-11-09 are listed in [PLAN-removed-2026-11-09.md](PLAN-removed-2026-11-09.md).

### 1. Get the highlight out (stage: paid highlight to took it away, 56 to 11; October cohort 30 to 3)

The largest fixable leak in the make-the-highlight band. The bug rows that cause it already sit in Current Focus and run first: T14840 (Download dead under the Guidance card), T15480 (Finish lands on an empty screen), T15520 (16 s download with no feedback), T15500 (Share button stays disabled), T15760 (finished player keeps the URL at /home), with T14710 recording the export so the stage is measured. This section holds the one feature row that completes it. Gate: took-away out of paid highlights on the admin Journey, against the 2026-11-03 baseline.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T16420 | [Share the video file from a published highlight](tasks/T16420-share-video-from-published-highlight.md) | 7 | 3 | 2.3 | TODO | [ ] | Owner ruling 2026-11-13. A published highlight's Share buttons open the private-by-default Share dialog (T13120), which shares a link only; posting the video to Reels or TikTok takes Download and a manual upload. Add Share video to that dialog on phones that can share files, without touching the private default. Done when Share video hands the file to the phone's share sheet and the share-or-download rate out of paid highlights moves. |

### 3. Suggested plays by AI (stage: footage landed to first play; game uploaders reach a paid highlight at 19%, clip users at 45%)

This work is the AI Coach milestone in Current Focus: [mark-plays-with-ai/EPIC.md](tasks/mark-plays-with-ai/EPIC.md).

### 4. Big-file upload and video conversion, bounded (stage: picked a file to footage landed, 48 lost; about 25 on files over 2 GB, 40 silent abandons of unknown size; plus iPhone video that some browsers play as sound only)

Upload is the top of the funnel. Prod says the loss is real but a tenth of file-pickers, so the shrinking work is one spike with a number. First make the 40 silent abandons visible (T15770, T14800, Current Focus) and give the 10 GB refusal a path (T15780). Then the cheap fixes that need no shrinking, then the spike. Gate: game upload succeeded out of picked a file, and network/timeout failures per 100 attempts.

**Renamed and split into epics 2026-11-18 (owner).** The milestone now also owns converting video, since the shrink work and the playable-copy work both transcode. Three epics: Upload reliability (no transcoding), Pre-shrink (shrink in the browser before upload), and Playable copies of iPhone video (convert on Modal after upload). Playable copies starts with four prototypes that measure cost and wait and verify every fact its design assumes; no build task starts until the owner approves the design update, and the owner rejected the design's 12-minute wait, so the wait is cut before anything ships. The low-risk parts (messaging and recording each video's format, T17500 and T17510) run now as bug fixes.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Upload reliability](tasks/upload-reliability/EPIC.md)** | 8 | 6 | 1.3 |  |  | Keep a big upload going through network drops and let a parent start on a play before the whole file has arrived. No transcoding. |
| T15840 | ↳ [Upload survives a network drop](tasks/T15840-game-upload-survives-network-drop.md) | 7 | 4 | 1.8 | TODO | [ ] | Today, when a parent's connection drops for a few seconds during a game upload, the whole upload fails and they see an error. Fifteen parents lost uploads this way, almost all on files of two to ten gigabytes that died after four to seven minutes. The server already remembers which parts arrived, but the app only uses that memory if the parent comes back and picks the same file again. We will have the app pause when the network goes away, wait up to about ten minutes, and continue from where it was once the connection returns, with nothing for the parent to do. Done when a simulated thirty-second outage mid-upload finishes on its own and the network and timeout failures per hundred attempts fall. |
| T8865 | ↳ [Highlights before upload finishes](tasks/pre-shrink-integration/T8865-highlights-before-upload-completes.md) | 8 | 7 | 1.1 | TODO | [x] | Today a parent can mark plays while their game is still uploading, but cannot turn any play into a highlight until the whole file has arrived, which on a big game over a slow connection can be hours. We will let a play open for cropping and Spotlight as soon as the footage it covers has arrived, or by sending just that snippet ahead of the rest. It runs on its own because it removes the wait for every large file whether or not we ever shrink video. Done when a play from a still-uploading game can be made into a highlight. |
|  | **[Pre-shrink](tasks/pre-shrink-research/EPIC.md)** | 7 | 5 | 1.4 |  |  | Shrink a large video in the browser before upload: the one-week spike decides go or no-go, then integration (its own sub-epic below). |
| T15850 | ↳ [Pre-shrink spike](tasks/T15850-pre-shrink-spike-go-no-go.md) | 7 | 3 | 2.3 | TODO | [ ] | Today very large game files almost never land: of 246 successful uploads, 202 were under one gigabyte and two were over six, and the five parents who tried files over ten gigabytes were refused. A standalone tool that shrinks video in the browser before uploading exists but has never been measured on a real file over a real connection. One week: shrink three real files on two laptops over two connection speeds, compare total time against uploading the original, and judge the athlete's sharpness at 1080p. Go if shrink plus upload is at least 30% faster on a slow connection and you accept the quality; then the three integration tasks below proceed. No-go closes the milestone with the numbers. |
| T8840 | ↳ [Standalone shrink tool](tasks/universal-upload/T8840-shrink-pipeline-core.md) | 7 | 7 | 1.0 | WAITING ON USER (deferred) | [x] | The standalone shrink tool is what the spike above measures. It waits on your real-folder run, which the spike (T15850) owns. |
|  | **[Pre-Shrink Integration](tasks/pre-shrink-integration/EPIC.md)** | 7 | 5 | 1.4 |  |  | If the spike says go, these three tasks bring the shrink tool into the app as a plain 1080p shrink offered before large uploads, with no automatic cropping. |
| T8845 | ↳ [Port shrink tool into the app](tasks/pre-shrink-integration/T8845-port-shrink-tool-into-app.md) | 7 | 4 | 1.8 | BLOCKED | [ ] | Move the proven shrink code into the app behind a small internal interface, with no change in what it does. Blocked until the spike says go. |
| T8850 | ↳ [Shrink offer and quality picker](tasks/pre-shrink-integration/T8850-shrink-ui-crop-step.md) | 7 | 5 | 1.4 | BLOCKED | [ ] | Show the offer to shrink before a large upload, let the parent pick a quality, and show the size saved, without adding steps to normal small uploads. Blocked until the spike says go. |
| T8860 | ↳ [Shrink during upload](tasks/pre-shrink-integration/T8860-shrink-upload-integration.md) | 7 | 5 | 1.4 | BLOCKED | [ ] | Run the shrink during upload, one segment at a time, with honest progress, and fall back to uploading the original on any failure with no double charge. Blocked until the spike says go. |
| T9050 | ↳ [When-to-shrink rule](tasks/pre-shrink-research/T9050-cost-model-when-not-to-shrink.md) | 8 | 5 | 1.6 | ICE | [ ] | A smarter rule for when shrinking is worth it, using the parent's measured connection speed instead of two fixed thresholds. On ice until the spike says go. |
|  | **[Playable copies of iPhone video](tasks/playable-copy/EPIC.md)** | 8 | 7 | 1.1 |  |  | iPhone HEVC video plays as sound only in Chrome and Edge on many Windows laptops and in Firefox. Make an H.264 copy on Modal after upload (design [T17390](tasks/T17390-play-iphone-hevc-video.md), Q1-Q4 and Q6-Q9 approved, Q5 rejected: cut the wait before shipping). Prototypes first; build tasks blocked until the owner approves the updated design. |
| T17520 | ↳ [Prototype: measure copy cost and time](tasks/playable-copy/T17520-prototype-copy-cost-and-time.md) | 7 | 3 | 2.3 | TODO | [ ] | Make copies of real iPhone files (1080p and 4K, 30 and 60 fps, HDR) with a throwaway Modal function and record time, billed cost, size and disk. Confirm Modal's ffmpeg handles iPhone 10-bit HDR and the current CPU price. |
| T17530 | ↳ [Prototype: prove the copy lines up with the original](tasks/playable-copy/T17530-prototype-copy-fidelity.md) | 7 | 3 | 2.3 | TODO | [ ] | Show that a copy keeps the same size, frame count, timing and rotation as the original, so marked plays and crop boxes land in the same place. |
| T17540 | ↳ [Prototype: cut the wait for a playable copy](tasks/playable-copy/T17540-prototype-cut-copy-wait.md) | 8 | 5 | 1.6 | TODO | [ ] | The owner rejected a 12-minute-per-hour wait. Measure parallel segment encoding, GPU encoding, converting while the upload arrives, and a live ready update; recommend one with a target wait for owner approval. |
| T17550 | ↳ [Prototype: check browser decoders and colors](tasks/playable-copy/T17550-prototype-browser-and-color-facts.md) | 6 | 3 | 2.0 | TODO | [ ] | Which browsers really cannot show iPhone video, whether the test browser reproduces it, whether HDR exports already look right, and whether a 4K copy plays smoothly on a modest laptop. |
| T17560 | ↳ [Playable copy foundation](tasks/playable-copy/T17560-playable-copy-foundation.md) | 6 | 4 | 1.5 | BLOCKED | [x] | Encoder settings and the Postgres table for the copy's status. Blocked on the prototypes and the owner's approval of the updated design. |
| T17570 | ↳ [Make the playable copy](tasks/playable-copy/T17570-make-the-playable-copy.md) | 7 | 5 | 1.4 | BLOCKED | [ ] | The Modal job, automatic after an iPhone upload and from a button for older games, using the fastest approach the prototypes settled. Needs a Modal deploy. |
| T17580 | ↳ [Serve the playable copy](tasks/playable-copy/T17580-serve-the-playable-copy.md) | 7 | 3 | 2.3 | BLOCKED | [ ] | Every browser plays the copy once ready; exports keep the original. Must not deploy until the Postgres migration has run in that environment. |
| T17590 | ↳ [Playable copy screens](tasks/playable-copy/T17590-playable-copy-screens.md) | 7 | 4 | 1.8 | BLOCKED | [ ] | The upload is no longer refused, and each copy state shows its message and button, with the approved wait. |
| T17600 | ↳ [Playable saved clips of iPhone games](tasks/playable-copy/T17600-playable-saved-clip-extracts.md) | 5 | 3 | 1.7 | BLOCKED | [ ] | Saved clips of an expired iPhone game are still HEVC; make them playable too. |
| T17610 | ↳ [Playable HEVC clips uploaded directly](tasks/playable-copy/T17610-playable-hevc-clip-uploads.md) | 5 | 3 | 1.7 | BLOCKED | [ ] | Plays uploaded directly as iPhone clips get a playable copy too. |

### 4a. Sharper output, bounded (moved 2026-11-18 by the owner from section 11 to run after Big-file upload and before Click-once Spotlight; the paid step; no evidence that quality blocks conversion, 4 refund users ever)

Owner rule 2026-11-09: invest only if the models moved. They did: FlashVSR+ (Oct 2026, Apache-2.0, about $0.03 per 10 s clip on H100, explicit text-legibility gains) and ReCaVSR (Sep 2026, 21 fps at 1080p on an A100, about $0.01) land in the same cost bracket as the current compact GAN; SeedVR2 is unchanged and 10x slower. No published evidence covers 30 to 80 px athletes, and hallucinated jersey numbers disqualify a recruiting reel, so the testbed carries a jersey-number OCR gate. The encode fix (T4710) is a one-day chore and can run any time.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Upscale Quality](tasks/upscale-quality/EPIC.md)** | 9 | 7 | 1.3 |  |  | Sharpening is the paid step. We only invest in better models if the field moved, and it did this autumn; the test bench keeps the decision honest. |
| T4710 | ↳ [Final encode fix](tasks/upscale-quality/T4710-encode-denoise-quick-wins.md) | 6 | 2 | 3.0 | TODO | [ ] | Two cheap fixes, any time: the final export is encoded at a lower quality than the intermediate steps, throwing away detail the GPU just produced, and the colour tags are missing on one path. One day of work. |
| T4700 | ↳ [Upscale test bench](tasks/upscale-quality/T4700-sr-quality-testbed.md) | 8 | 5 | 1.6 | TODO | [ ] | A repeatable test bench: a fixed set of real clips, each candidate model run over them, and a side-by-side report you can judge in ten minutes. Aimed at the two new models, FlashVSR+ and ReCaVSR, with a hard check that jersey numbers and faces are not invented, since an invented number ruins a recruiting reel. |
| T4730 | ↳ [Video upscaler trial](tasks/upscale-quality/T4730-temporal-vsr-prototype.md) | 9 | 6 | 1.5 | TODO | [ ] | Try the two new video upscalers on the test bench and decide go or no-go against the quality and cost bar. Evaluation only. |
| T4740 | ↳ [Route small crops to the new upscaler](tasks/upscale-quality/T4740-production-integration-routing.md) | 8 | 5 | 1.6 | BLOCKED | [ ] | If a model wins, send only the small far-away crops to it and keep the cheap path for everything else, behind a flag, staging first. Blocked until a winner exists. |


### 4b. Click-once Spotlight (owner request 2026-11-12; moved 2026-11-18 by the owner from Current Focus to run after Big-file upload and Sharper output; now also holds the former section 2 "Spotlight first, then the next play" and section 0 "Player-following history note")

**Why this section exists.** Spotlight is the step that draws a circle that follows the parent's athlete through a highlight, and parents who finish it are the ones who come back: 5 of 22 who exported a spotlight returned and all 5 payers were among them, against 2 of 30 who did not. Today nothing follows anyone; the parent taps their athlete on four frames and the circle glides between the taps. On 2026-11-12 a prototype outside the app ran ten trackers on 54 of the owner's real highlights from one tap each, the owner chose the model called SAM 2.1 base+, and asked for it to be built before AI Coach. Epic: [click-once-spotlight/EPIC.md](tasks/click-once-spotlight/EPIC.md); measurements: [research/click-once-following-2026-11.md](research/click-once-following-2026-11.md). Row order is the sequence. The first task measures the wait and the cost on the app's own graphics cards before any screen is built, and the two screen tasks need a design review. A new spotlight stays two seconds long (owner, 2026-11-12); following continues when the parent stretches it.

**Absorbed 2026-11-18.** From the former section 0 (what follows the athlete today):

Half a day of reading before any tracking is built: find out what was tried, why nothing follows the athlete today, and which cases defeated earlier attempts, then gate T15860.

From the former section 2 (Spotlight first, then the next play; stage: first session to return; 5 of 22 Spotlight exporters returned and all 5 payers were among them, against 2 of 30 and none):

A good first session only brings parents back when it includes Spotlight, so Spotlight becomes a step rather than an offer, and the Finished screen offers the next play in the same sitting (19 of 21 second highlights were same-day). Mobile Spotlight layout bugs T15470 and T15740 (Current Focus) are prerequisites. Gate: Spotlight-complete out of paid highlights, and took-away out of paid.

Order: the history note (T15900) first, then Spotlight as a step and the Finished screen hub (T15800, T15810), then the Click-once Spotlight epic.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T15800 | [Spotlight becomes a step](tasks/T15800-spotlight-is-a-step-not-an-offer.md) | 9 | 4 | 2.2 | TODO | [ ] | Today, after a parent pays to sharpen a highlight, the app shows a preview and offers Spotlight, the step that draws a circle that follows their athlete. Many never see the offer: of 26 parents who paid on their first day and skipped Spotlight, only 12 were offered it, 3 opened it, and none came back after a week or bought credits. The 13 who finished Spotlight gave us every repeat buyer. We will make Spotlight the next step after sharpening, with the athlete already found and the circle placed, and keep Finish without spotlight as a smaller choice. The bet is that the spotlighted highlight is the product parents value, and the numbers say so. Done when every paid highlight reaches the Spotlight screen and the Journey shows how many finish it. |
| T15810 | [Finished screen hub](tasks/T15810-finished-screen-hub-next-play.md) | 8 | 4 | 2.0 | TODO | [ ] | Today, when a parent finishes a highlight, the screen is empty, the clip is hard to find, Download sits under a help card, and nothing suggests what to do next. Second highlights, when they happen, come about fifteen minutes after the first, and parents who stop at one still hold most of their free credits, so the moment to offer the next play is here, not a day later. We will make the Finished screen a hub: Download, Share, Add to reel once reels exist, and Make the next play, a list of this game's other marked plays that open the cropping step directly. Done when the Finished screen shows those actions on phone and desktop and the download-or-share rate out of paid highlights rises. |
|  | **[Click-once Spotlight](tasks/click-once-spotlight/EPIC.md)** | 9 | 7 | 1.3 | TODO |  | One tap on the athlete in Spotlight, the step that draws a circle that follows them, replaces today's four taps, and the circle follows frame by frame instead of gliding between taps. A prototype on 54 of the owner's real highlights kept the circle on the right player for four seconds on 46 of the 47 clips that could be scored cleanly. Where the follower is unsure the app marks the spot and asks for one more tap; if it fails the parent gets today's four taps and loses nothing. |
| T16220 | ↳ [Following engine](tasks/click-once-spotlight/T16220-following-engine.md) | 9 | 6 | 1.5 | TODO | [ ] | Today the model that follows an athlete from one tap exists only as a script on the owner's laptop, where it kept the circle on the right player for four seconds on 46 of 47 real highlights (finished short clips). This builds the server job: given a highlight, the frame the parent tapped and the box they tapped, it returns the athlete's box on every frame and marks any stretch where it is unsure. It also measures what the laptop could not: the tap on a real detected box, the wait and cost on the rented graphics cards the app uses, and small athletes in wide-angle footage. Done when the job on staging matches the laptop result on the same 54 clips and we know the wait and the cost of a two-second and a four-second spotlight. |
| T16230 | ↳ [Followed path as spotlight points](tasks/click-once-spotlight/T16230-followed-path-as-spotlight-points.md) | 8 | 5 | 1.6 | TODO | [ ] | Today a spotlight (the circle that follows the athlete through a highlight) is stored as a few points, one for each tap the parent made, and the circle glides between them. The following engine returns something different: a box on every single frame, thirty a second, which jitters slightly and cannot be dragged by hand. This turns that path into the same kind of points the app already stores: smoothed, thinned to a handful where the athlete's movement bends, and sized to the athlete. The parent can then drag any point as they do today, and export needs no change. Done when a followed path, saved and exported, keeps the circle on the athlete as closely as the raw path did, using no more than about ten points for four seconds. |
| T16240 | ↳ [One tap in Spotlight](tasks/click-once-spotlight/T16240-one-tap-in-spotlight.md) | 9 | 6 | 1.5 | TODO | [ ] | Today, in Spotlight (the step that draws a circle that follows the athlete), the parent is walked through four frames and taps their athlete on each one. On a phone that is four precise taps on small boxes, and the circle still only glides between them. With this change the parent taps their athlete once, on the first frame. The screen says truthfully that it is following the athlete and how far it has got, then plays the spotlight back with the circle on them. The other three frames no longer ask for anything. If following is unavailable or fails, the screen carries on with today's four taps and one plain line saying why. Done when a parent on a phone gets a followed spotlight from one tap, and a forced failure lands them in the four-tap flow without an error screen. |
| T16250 | ↳ [Doubtful spots and one-tap fix](tasks/click-once-spotlight/T16250-doubtful-spots-and-one-tap-fix.md) | 8 | 6 | 1.3 | TODO | [ ] | Following an athlete from one tap works on most highlights but not all. In the prototype it went wrong on 3 of 54 clips, and every time for the same reason: a player of similar build crossed or ran beside the athlete and the circle moved to them. The follower does not know it has done this; the circle looks just as confident on the wrong child. This task makes the app notice the risky moments and say so. Where the follower is unsure, the timeline shows a mark and the guide says "Check this spot". The parent looks, and if the circle is on the wrong player they tap the right one there; following restarts from that tap and the earlier part is kept. Done when the three known failures are each flagged, and one tap at the flagged spot fixes each. |
| T16260 | ↳ [Following for longer spotlights](tasks/click-once-spotlight/T16260-following-for-longer-spotlights.md) | 7 | 5 | 1.4 | TODO | [ ] | A spotlight (the circle that follows the athlete through a highlight) is two seconds long unless the parent stretches it, because every extra stretch used to mean more taps. Once one tap follows the athlete, length is nearly free, and a goal or a long dribble deserves more than two seconds. Today, stretching a spotlight or adding a second one leaves the new part with no following at all. With this change, when the parent stretches a followed spotlight the following continues to the new end, and a new spotlight added later in the highlight asks for one tap and follows from there. The prototype held the athlete for five seconds; beyond that is untested, so this task measures how far following can be trusted and stops there. Done when stretching a followed spotlight to six seconds keeps the circle on the athlete with no new tap on the test clips. |
| T16270 | ↳ [Following read-out and switches](tasks/click-once-spotlight/T16270-following-read-out-and-switches.md) | 7 | 3 | 2.3 | TODO | [ ] | Once Spotlight (the step that draws a circle that follows the athlete) follows from one tap, we need to know whether it is working for real parents and to be able to stop it quickly if it is not. Today the app records that a spotlight was exported but nothing about how it was made. This adds four simple counts the owner can read: how many spotlights used following, how many needed a correction, how many fell back to four taps, and what the following cost us. It also adds a switch that turns following off for everyone at once and a daily spending limit; with either in force, parents simply get today's four taps. Done when the owner can read those counts for a day of staging use and flipping the switch returns Spotlight to four taps within a minute. |

### 5. Click-once following for Frame (stage: opened Frame to paid, and Spotlight completion; 69 users placed 1,287 framing points by hand)

Spotlight following is now its own milestone in Current Focus: [click-once-spotlight/EPIC.md](tasks/click-once-spotlight/EPIC.md). What stays here is Frame, the step where the parent crops around their athlete and pays to sharpen the result. Following there runs on the raw game video, where athletes are far smaller than in a finished highlight, and nobody has measured it; the prototype of 2026-11-12 covered Spotlight only.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T15860 | [Following in Frame: proof](tasks/T15860-click-once-following-prototype.md) | 8 | 4 | 2.0 | TODO | [ ] | Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today they drag the crop box point by point; 69 parents placed about 19 points each. A prototype on 2026-11-12 showed that one tap can follow an athlete through a finished highlight, but Frame works on the raw game video, where the athlete is far smaller and the play runs 10 to 30 seconds, and nobody has measured following there. We will run the same model on twenty raw plays, including wide-angle Veo and DJI footage, against the parents' own crop paths, and count how often a parent would have to tap again. Go if 15 of 20 plays need at most one extra tap and the box stays on the athlete. |
| T15870 | [Click-once following in Frame](tasks/T15870-click-once-following-in-frame-and-spotlight.md) | 9 | 7 | 1.3 | BLOCKED | [ ] | Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today they drag the crop box point by point through the play, which is the slowest step on a phone. If the proof on raw game video passes (T15860), a parent taps their athlete once and the crop box follows them through the play; the usual edits still work as corrections. Where the follower loses the athlete, the timeline shows a mark and asks for one more tap. A failure never spends credits and leaves the parent in today's manual flow. Blocked until the proof says go, and it needs a design review first. |

### 7. Next-game emails (stage: come back; 385 of 402 never returned after a week, every lost user is "gone" and only mail reaches them)

Three emails keyed to the weekend cadence of youth sports: your highlight is ready, download it; it is the weekend, upload this game; your reel has N highlights, add one. Behaviour triggers matter; AI-written copy barely does.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Lifecycle Email Drip](tasks/lifecycle-drip/EPIC.md)** | 8 | 6 | 1.3 |  |  | Every parent we lose is gone from the app, so only email reaches them: 385 of 402 never came back after a week. Three emails keyed to the weekend game cadence: your highlight is ready, download it; it is the weekend, upload this game; your reel has N highlights, add one. |
| T7230 | ↳ [Email drip storage](tasks/lifecycle-drip/T7230-drip-schema-templates.md) | 7 | 2 | 3.5 | TODO | [ ] | The storage for the email system: a record of what was sent, the templates, and who unsubscribed, kept outside the main database. |
| T7240 | ↳ [Email drip stage picker](tasks/lifecycle-drip/T7240-stage-resolver-selection-engine.md) | 7 | 3 | 2.3 | TODO | [ ] | The logic that looks at what a parent has done and picks which email they should get, written so it can be tested without sending anything. |
| T7250 | ↳ [Email unsubscribe and footer](tasks/lifecycle-drip/T7250-unsubscribe-compliance.md) | 7 | 3 | 2.3 | TODO | [ ] | The one-click unsubscribe link and the legally required footer on every marketing email. |
| T7260 | ↳ [Email drip scheduler](tasks/lifecycle-drip/T7260-drip-scheduler-send-pipeline.md) | 8 | 5 | 1.6 | TODO | [ ] | The scheduled job that finds parents due an email and sends it at most once, with an admin dry run to inspect the plan before anything goes live. |

### 8. The landing page sells the reel (stage: visit to sign-up; 30 to 42 organic sign-ups a week, attribution unknown until T7410 / T15000 land)

Reach is the gap per the ROI model, but nothing above converts well enough yet to pour reach into, so this runs after the reel exists to sell. Before-and-after examples are part of T7110. Comparison pages (T7120) wait in Later.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[SEO Content & Landing Value Props](tasks/seo-content/EPIC.md)** | 7 | 4 | 1.8 |  |  | The landing site tells one story: editing is a grind and we remove it. Once reels exist it should sell the reel, the recruiting card and the season that builds itself. |
| T7110 | ↳ [Homepage sells the reel](tasks/seo-content/T7110-landing-value-props.md) | 7 | 3 | 2.3 | TODO | [ ] | Rewrite the homepage to sell the reel and the recruiting card alongside sharpening, with real before-and-after examples. Runs after the reel exists so there is something true to show. |

### 9. Retention measurement (the number this roadmap is judged by)

There is no retention chart. T7430 is the cohort triangle; T7420 is the shrunk activation report. The other analytics rows wait in Later until attribution carries data.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Investor-Grade Analytics](tasks/investor-analytics/EPIC.md)** | 8 | 5 | 1.6 |  |  | The admin numbers behind this roadmap. Two pieces are on staging already; the retention chart is the one we still lack. |
| T16350 | [Sport as a dashboard dimension, replacing the By Sport table](tasks/T16350-sport-dimension-in-admin.md) | 5 | 4 | 1.3 | TODO | [ ] | Owner request 2026-11-13. The admin dashboard slices by Campaigns, Cohorts and Builds, while sport sits apart in a By Sport table of raw action counts that filters nothing. Add Sport as a fourth Dimension pill with the same columns and row filtering, and remove the By Sport table. Needs a short design first: a user's sport lives per game, not in the tables the dimensions read. |
| T16360 | [The other admin views follow the Dimension pill](tasks/T16360-admin-views-follow-the-dimension.md) | 5 | 4 | 1.3 | TODO | [ ] | Owner request 2026-11-13. The Dimension pills (Campaigns, Cohorts, Builds) only change the top table; the views below have fixed groupings. Activation moved into T7420 (g-t16070-3). Make the pill set the grouping of Journey, Platform Breakdown, Pack Mix and Upload Failures where it makes sense. Runs after g-t16070-3 lands. |

### 10. Per-player moments (stage: footage landed to first play, after Suggested plays)

The per-player tier from the 2026-10-31 research: tap the child, get scored moments. Runs after AI Coach (T16190) because identity is the hard half and team-level suggestions capture most of the stage. T14300 (ground truth) is two points and can use the same games as T15820, so it runs early.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Player Moments](tasks/player-moments/EPIC.md)** | 9 | 8 | 1.1 |  |  | The step after suggested plays: tap your child and get the moments that involve them. Which small figure is your kid is the hard half, so this waits until team-level suggestions have captured most of the gain. |
| T14300 | ↳ [Player moments ground truth](tasks/player-moments/T14300-ground-truth-games.md) | 7 | 2 | 3.5 | TODO | [ ] | Mark one child's moments by hand on three to five real games and score what Veo's own feature finds on the same games, so every prototype can be judged against a number. Can reuse the games from the suggested-plays proof. |
| T14295 | ↳ [Model candidate registry](tasks/player-moments/T14295-research-refresh-candidate-registry.md) | 8 | 3 | 2.7 | TODO | [ ] | Refresh the list of candidate models and services with current prices before any prototype, so prototypes test today's options, not October's. |
| T14310 | ↳ [Hosted video-search pilot](tasks/player-moments/T14310-twelve-labs-pilot.md) | 8 | 3 | 2.7 | TODO | [ ] | First prototype: a hosted video-search service that takes a tap on the child and returns scored moments. A one-week pilot with a kill rule. |
| T14320 | ↳ [Tracking bake-off](tasks/player-moments/T14320-click-seeded-tracking-bakeoff.md) | 8 | 5 | 1.6 | TODO | [ ] | Second prototype, only if the first fails: our own detector and tracker, seeded by the parent's tap. |
| T14330 | ↳ [Moment scoring prototype](tasks/player-moments/T14330-gemini-flash-criticality-prototype.md) | 8 | 4 | 2.0 | TODO | [ ] | Third prototype: a video model judges whether each moment with the child in frame is a highlight, a learning moment or just interesting. |
| T14340 | ↳ [Player moments feature](tasks/player-moments/T14340-productize-winning-path.md) | 9 | 7 | 1.3 | TODO | [ ] | Turn the winning path into a feature: tap a player in Annotate, get scored suggested plays, under a cost cap per game. |

### Later (kept, not scheduled)

Reviewed 2026-11-13: only rows with a payoff that is still real stay here. Nothing here starts before sections 0 to 11 unless the owner moves it.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T17710 | [Sync videos automatically by their sound](tasks/T17710-auto-line-up-by-sound.md) | 7 | 6 | 1.2 | TODO | [ ] | Owner request 2026-11-18. When both videos have sound, the parent's browser matches the waveforms and places the second camera at the best match as its starting position; the parent drags to adjust. Must cope with mics far apart and a conversation next to one mic, and never move a video silently on a weak match. Prototype first. |
| T7120 | [Comparison pages and guides](tasks/seo-content/T7120-seo-content-expansion.md) | 5 | 4 | 1.2 | TODO | [ ] | The marketing site has two comparison pages and one of five planned guides. Parents search for the camera and editing brands they know, and we have no page for Hudl or iMovie. Add those comparison pages (Veo and Trace only if clearly different from the existing works-with pages) and write the four unpublished guides once the owner approves their outlines. Judged by organic visits and visit to sign-up, now measurable, against 30 to 42 organic sign-ups a week. |
| T5950 | [Two-server edit conflict check](tasks/T5950-cross-machine-cas-conflict-verification.md) | 6 | 3 | 2.0 | BLOCKED | [ ] | Production runs one server, so two servers can never save the same parent's data at once. The guards for that case are unit-tested, but the full sequence a parent would see (refused save, conflict notice, Retry, being told their changes were replaced) has never run against a real conflict. Run it the day a second server is added, before real traffic reaches it. Blocked until then; the deploy script refuses any server count other than one. |

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

**Funnel rule (owner, 2026-11-09).** After bugs, sections are ordered by the funnel stage they move, largest measured loss first, and each section names the number it is judged by. Impact is a guess until the stage is read on the admin Journey; a row with no stage it can name is a chore or a removal. Evidence pulls are read-only against prod and recorded under `docs/plans/bi/`. Low-value rows are removed, not parked: their text goes verbatim to a dated `PLAN-removed-*.md`.

### Epic Prioritization

**Epics compete with other epics and standalone tasks at the milestone level.** Each epic gets aggregate Impact/Complexity/Priority scores based on the collective value and effort of its tasks.

- **Milestone level:** Epics and standalone tasks are ordered by Priority (Impact / Complexity). Higher priority = do first.
- **Within-epic level:** Tasks are ordered by **dependency** — foundational layers first, since all tasks in an epic touch similar code. DB/model changes before API, API before UI.
- **Impact over complexity:** When prioritizing within a milestone, favor high-impact work even if it's harder. The priority formula (Impact / Complexity) naturally rewards this.

---

## Completed Tasks

DONE rows live in [PLAN-archive.md](PLAN-archive.md).

## Environment Configuration

### Credentials (Found)

**R2 Storage** (in `.env`):
```
R2_ENABLED=true
R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4
R2_SECRET_ACCESS_KEY=***
R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com
R2_BUCKET=reel-ballers-users
```

**Modal GPU** (in `~/.modal.toml`):
```
token_id=ak-Gr72Vz5gr7MYVpcUowSeDB
token_secret=***
```

### Fly.io Secrets (for T100)

```bash
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4 \
  R2_SECRET_ACCESS_KEY=<from .env> \
  R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com \
  R2_BUCKET=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=ak-Gr72Vz5gr7MYVpcUowSeDB \
  MODAL_TOKEN_SECRET=<from ~/.modal.toml> \
  ENV=staging
```

---

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10-T79` - Feature tasks (complete)
- `T80-T99` - Pre-deployment blockers + bug fix sprint
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features + polish
- `T400-T430` - User Auth epic (T400=Google, T401=OTP, T405=D1, T420=sessions, T430=settings)
- `T500-T525` - Monetization epic
- `T1700-T1705` - Open Panel Analytics epic
- `T2300-T2380` - Landing Page Redesign epic
- `T2400` - Grace Period for Expired Games
- `T2410-T2430` - Expired Game Experience epic
- `T12910-T12950` - Keep Only Marked Plays epic (T12910 bug prerequisite, T12950 tile brilliant count)
- `T14295-T14340` - Player Moments epic (research refresh / candidate registry, ground truth + Veo bar, hosted video-search pilot, tracking bake-off, video-VLM criticality, productize)
- `T2450-T2470` - Auto-Export Reliability epic
- `T2480` - Modal Spline Interpolation
- `T2670` - Upload Slow Connection Optimization
- `T2680` - Remove Video Link Import (legal)
- `T2750` - Unified Multi-Video Experience
- `T2800-T2860` - Team Sharing Alpha epic
- `T2880-T2885` - Games List Performance epic
- `T2890` - Cache Warming Efficiency (standalone, warming system upgrade)
- `T2900-T2910` - Invite & Referral epic
- `T2915` - Sport Inheritance Through Invite (link snapshot: referrals.inherited_sport v017 + shares.sharer_default_sport v018; NOT a users.default_sport mirror)
- `T2920` - Migration System Infrastructure (standalone)
- `T2930` - Postgres Data Locality Audit (standalone)
- `T3000-T3020` - Analytics 1 epic (CF Web Analytics + Postgres event log + admin migration)
- `T3030` - Cross-Origin Fetch Credentials (bug fix)
- `T3080` - Sync User Activity to SQLite (dual-write activity to per-user SQLite)
- `T3050` - Multi-Video Blank Video (bug fix, no error handling on dual video elements)
- `T3060` - Make It Load Fast (Playwright perf benchmarks against prod)
- `T3260` - Edit Game Metadata Post-Upload
- `T3270` - Clip Boundary Visual Indicator (Annotate mode)
- `T3450-T3490` - Analytics Power-Up epic (normalize schema, action log, fill tracking gaps, admin redesign)
- `T3290` - Tune NUF for Returning Users (differentiate returning vs first-time)
- `T3300` - Build Tutorial Video for Landing Page
- `T3070` - Brand Messaging Audit (emails, preloading, landing page high concept)
- `T3420` - Profile Critical-Path Endpoints (375ms per-request baseline, auth/me 1774ms, bootstrap 741ms)
- `T3430` - Parallelize Game Load (4 sequential requests -> 1 game bootstrap endpoint)
- `T446-T449` - PWA new tasks (Screen Wake Lock, Background Fetch, Share Target, Offline Playback)
- `T3540` - Framing "In Progress" Visual Ambiguity (progress strip half-fill + wording)
- `T3550-T3560` - Analytics: Attribution & Access Visibility epic (games uploaded vs accessible, user attribution graph)
- `T3570` - Track Annotation Playback Frequency (recurring usage event)
- `T3580-T3590` - Lifecycle Onboarding Emails epic (day 7/14/30 engine + content/personalization)
- `T1516` - Suppress Export-Job Analytics During Impersonation (split from T1515; stamp impersonated flag on export job, skip completion milestone)
- `T3595` - Share Viewer Opt-In & Viewer Analytics Bucket (consent-based how-to email for opted-in viewers; viewer leads bucketed separately from users)
- `T3600-T3640, T3670` - Season Highlights & Collections epic, DONE (metadata freeze, collections tab, live shares, ranking, "Top Plays" + dynamic smart collections). T3635 (reel order editor) moved to For Alpha - Polish. T3650/T3660/T3680 dropped (custom mix rename, quest rework, stitch).
- `T6190-T6200` - **Project-open latency (HAR 2026-07-28)** — T6190 removes redundant frontend fetches on reel open; T6200 investigates the backend request serialization the same HAR exposed
- `T7400-T7467` - Investor-Grade Analytics epic (analytics.sqlite rollup + visit beacon + activation/retention/growth reports + clip-library events + success-criteria RAG scorecard + journey-flow graph + deploy-comparison view; in-house only, aggregates only, no new Postgres state)
- `T9210-T9260` - On Fire epic (NBA Jam heat effects for Overlay; Post Launch, after Overlay 3; sprite-based flames on the spotlight ellipse, auto-escalation preset, dense tracking, evidence-gated ball flame)
- `T1536, T1537, T3760, T3770` - **Perf batch (HAR 2026-06-17)** — coordinated rollout across 2 branches / 3 conversations. See [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md). Branch `feature/perf-quests-latency`: **T1536 DONE (deployed 2026-06-18)** as a correctness/DRY cleanup — HAR re-attribution showed `/progress` had no above-baseline server cost; **T1537 was removed on 2026-11-13** (the quest request it optimised is being deleted). Branch `feature/perf-page-load`: T3760 (framing clip cold-load over-fetch, re-opens T2560 clamp on latency grounds) + T3770 (StrictMode duplicate page-load fetch confirm, disjoint files).

- `T15910` - Dead-code ratchet (knip + vulture + committed baseline in the CI tooling job; owner 2026-11-09)
- `T15800-T15900` - **Roadmap re-rank 2026-11-09** (evidence: bi/funnel-evidence-2026-11-09.md): T15900 player-following history note (T15790 was taken by a /dotask-filed bug the same day), T15800 Spotlight as a step, T15810 Finished hub + next play, T15820 suggested-plays proof, T15830 suggested-plays feature, T15840 upload survives a network drop, T15850 pre-shrink spike go/no-go, T15860 click-once following prototype, T15870 click-once following in Frame + Spotlight, T15880 reel title card = cover + recruiting kit, T15890 suggested reel
- `T16220-T16270` - **Click-once Spotlight epic 2026-11-12** (tasks/click-once-spotlight/EPIC.md): T16220 following engine, T16230 followed path as spotlight points, T16240 one tap in Spotlight, T16250 doubtful spots and one-tap fix, T16260 following for longer spotlights, T16270 following read-out and switches
- `T16280-T16310` - **Highlight reel builder epic 2026-11-12** (tasks/highlight-reel-builder/EPIC.md): T16280 reel render engine, T16290 reel transition and preview, T16300 cards with set lengths, T16310 music for reels; T11300 and T15880 are its first and last tasks
- `T16320-T16330, T16205` - **AI reel builder epic 2026-11-13** (tasks/ai-reel-builder/EPIC.md): T16320 recruiting reel research (runs before AI Coach), T16330 reel expert prompt, T15890 suggested reel; T16205 highlight facts in one read is the last task of the AI Coach epic
- `T16145, T16202` - **AI Coach epic additions 2026-11-14** (tasks/mark-plays-with-ai/EPIC.md): T16145 prototype the prompt and the joining (before the engine; T16140 was used and dropped on 2026-11-12), T16202 share AI Coach for free (after tagging)
- `T16510-T16540` - **Automatic finish epic 2026-11-14** (tasks/automatic-finish/EPIC.md): T16510 record the finish, T16520 finish when sharpening ends, T16530 redo from the Finished screen, T16540 finish the stranded highlights

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
