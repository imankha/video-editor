# Project Plan

> **DONE rows are archived** to [PLAN-archive.md](PLAN-archive.md) (moved 2026-08-03) to keep this file short. When a task hits DONE, move its row there under the same headings.

## Current Focus

### Payment return and campaign attribution lost on arrival (priority, owner-requested 2026-11-05, BUGS FIRST)

**Why this section exists.** Found in the T14970 review and confirmed live on staging: URL canonicalization at module load removes the query string before App reads it. A user returning from Stripe gets no confirmation, credit refresh or auto-export, and `utm_*`, `ref` and click ids never reach sign-up. Every attribution number and the Spend readiness attribution gate depend on this.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T15220 | [Payment return and campaign params are stripped before the app reads them](tasks/T15220-arrival-params-stripped-before-app-reads-them.md) | 9 | 3 | 3.0 | WIP | [ ] | M-tier, frontend only. Keep the params App owns through the `editorStore.js` module-load canonicalization. Measure the prod attribution impact first (read-only aggregate). Blocked by T14970, which rewrites the same block; start the moment it lands. |

### Production incident 2026-11-04: upload success rate 43.8% (BUGS FIRST)

Analytics alert 2026-11-04. Root cause from the prod log and `upload_failures`: one user re-picked the same zip of clips while a batch was running; two or three flows then shared each file's upload session and recorded each other as failures (27 clip finalizes filed as `game_upload_failed`). Every file had landed. Not a deploy regression (same signature 2026-10-27).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T15020 | [Two upload flows for one file collide; success rate read 43.8% from one user](tasks/T15020-concurrent-upload-flows-one-outcome.md) | 9 | 3 | 3.0 | STAGING | [ ] | M-tier, backend + frontend. finalize-upload answers a duplicate flow with the durable outcome (HEAD by client hash/kind) instead of a 404 filed as a game failure; a lost CompleteMultipartUpload race with the object landed is success; PATCH /parts 404 is non-terminal; client re-prepares on part 404 and queues clip batches; empty-state Add Video disables while uploading. Pushed straight to master 2026-11-04 on the owner's call. |
| T15030 | [Resume-state saves serialize every 5 MB part on the per-user write lock](tasks/T15030-upload-parts-save-write-lock-contention.md) | 8 | 4 | 2.0 | STAGING | [ ] | M-tier, design note first. PATCH /parts after every part takes the write lock and triggers an R2 sync; waits of 15-16 s per part during the incident made the user re-pick. Batch the saves, make them light writes, or drop resume state for clips. |
| T15040 | [prepare-upload hands a live session to a second flow for the same file](tasks/T15040-prepare-upload-in-flight-guard.md) | 7 | 3 | 2.3 | STAGING | [ ] | M-tier. Resume branch cannot tell "crashed, resume" from "another flow is uploading this now". Return `in_progress` for a session with recent activity; the client waits instead of uploading the bytes twice. |
| T15050 | [Upload observability: flow id and kind on every event, no empty beacons, log retention, alarm counts users](tasks/T15050-upload-observability-flow-id-retention-alarm.md) | 8 | 3 | 2.7 | STAGING | [ ] | M-tier. flow_id on lifecycle lines, failures and beacons; /parts carries hash + kind; reason-less beacons never terminal; app.log keeps 7 days or a drain; pulse-card alarm reports distinct users and needs failures from 2+ users. |
| T15060 | [user.sqlite PUT to R2 failed with BadDigest during the clip batch](tasks/T15060-user-sqlite-put-baddigest.md) | 7 | 3 | 2.3 | STAGING | [ ] | M-tier, expert root-cause first. The file changed under the upload (writer bypassing the lock or WAL checkpoint); upload from a snapshot under the lock, retry BadDigest once. |
| T15130 | [T15040's 60 s liveness window is shorter than T15030's save interval: a live slow upload looks dead](tasks/T15130-prepare-liveness-window-vs-save-cadence.md) | 8 | 3 | 2.7 | STAGING | [ ] | M-tier, design note first. Resume-state saves are now every 8 parts but the in-flight window is 60 s, so a live slow upload reads as dead and a second flow re-uploads the same parts. Add a heartbeat or bound the save interval by time. |
| T15080 | [Every in_progress poll books an upload-attempted milestone and takes the per-user write lock](tasks/T15080-in-progress-poll-inflates-attempted-and-takes-lock.md) | 6 | 3 | 2.0 | STAGING | [ ] | M-tier. Each 5 s in_progress poll books an attempted milestone and takes the per-user write lock before the live check. Move the live check first or make the poll a GET. |
| T15090 | [T15030 acceptance miss: PATCH /parts still holds the per-user lock across a full profile.sqlite R2 sync](tasks/T15090-parts-save-still-holds-write-lock-and-sync.md) | 6 | 4 | 1.5 | STAGING | [ ] | M-tier, expert root-cause first. T15030 criterion (no /parts lock wait above 2 s) was missed at merge: 3.6 s and 5.2 s seen. /parts still holds the lock across a full profile.sqlite sync. Take the light-write option or waive with numbers. |
| T15140 | [Upload follow-up review minors: stale comment, wait-loop cancel, legacy beacon test, alarm edge cases](tasks/T15140-upload-followup-review-minors.md) | 4 | 4 | 1.0 | STAGING | [ ] | M-tier bundle. Stale ListParts comment, wait-loop cancel/timeout, legacy beacon test, alarm edge cases, snapshot size threshold, T5340 user_version assertion. |
| T15150 | [Finalize and activate hold the per-user write lock across a durable R2 sync, so uploads finishing together queue](tasks/T15150-durable-sync-held-under-write-lock.md) | 5 | 6 | 0.8 | STAGING | [ ] | L-tier, expert first. Two finishes at once: finalize 6.7 s, activate 8.9 s, lock waits 2.2-2.5 s. Measure on staging before sizing. Depends on T15090. |

### Copy audit (user-approved 2026-11-03, BUGS FIRST)

Follow-ups to the admin Journey map from the prod screenshots of 2026-11-03: fix the missing event behind "Pressed Export 0" (bug first), make stage counts never go up, add full screen, and make a drop-off count list those users in the Users table. Sized for a junior dev; order below. Moved to the top 2026-11-03 (funnel order: the map must stop lying before anything below it is measured). Shares files with the Copy audit milestone, now below: T14710 shares `routers/export/framing.py` with T14540 and the paid Sharpen my highlight button with T14620, and T14720 renames the stage labels to the copy glossary (keys stay frozen). T14720 replaces the original design's skip ribbons with implied reach (user ruling 2026-11-03).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T14510 | [Sign-in code email heading may be invisible](tasks/T14510-otp-email-heading-invisible.md) | 8 | 2 | 4.0 | STAGING | [ ] | S/M-tier, backend. OTP heading is `#ffffff` with no background set (`email.py:515`); verify in a light-mode client, then fix. |
| T14520 | [Auto-tracking and AI-focus overclaims](tasks/T14520-tracking-and-ai-focus-overclaims.md) | 7 | 2 | 3.5 | STAGING | [ ] | M-tier, landing + frontend. "Really tracked well" testimonial, "AI focus smooths, spotlights" hero, "Player tracking disabled". |
| T14560 | [Contradictory copy](tasks/T14560-contradictory-copy.md) | 6 | 3 | 2.0 | STAGING | [ ] | M-tier. "use Add Game instead" (button is Upload game), "Tap Finish to get your link", "Share plays" shares the whole game, 3 vs 4 steps, "1 credits". Tagline line needs the user's OK. |
| T14550 | [Harsh rating words in play names and captions](tasks/T14550-harsh-rating-words.md) | 6 | 4 | 1.5 | STAGING | [ ] | M-tier, backend + frontend. "Decision miss Dribble" names reach share pages; D6: "Needs work: decision/skill", never in names; 5 stars = "Brilliant". Migration only if names are persisted (ask first). |
| T14530 | [Developer error text shown to parents (frontend)](tasks/T14530-dev-error-text-frontend.md) | 7 | 5 | 1.4 | STAGING | [ ] | M-tier, frontend. "backend server is running on port 8000", "Computing hash... 40%", status codes, raw err.message, "Uncommitted ... (GPU processing)" dialog. |
| T14540 | [Server error text shown to parents (backend)](tasks/T14540-server-error-text-backend.md) | 6 | 5 | 1.2 | STAGING | [ ] | M-tier, backend. Displayed `detail` strings name R2, BLAKE3, moov, Modal, "pending migration", "Project not found"; progress says Export/Generation/Refresh. Coordinate with T4620. |
| T14570 | [Native alert and confirm dialogs](tasks/T14570-native-alert-confirm-dialogs.md) | 4 | 4 | 1.0 | STAGING | [ ] | M-tier, frontend. Four native `alert()`/`confirm()` call sites, one says "click OK", two interpolate raw errors. |
|  | **[Copy Vocabulary](tasks/copy-vocabulary/EPIC.md)** | 8 | 7 | 1.1 |  |  | One word per concept across every surface; glossary, verbs and style rules in EPIC.md. Ordered by area, each one reviewable change. |
| T14600 | ↳ [Glossary reference + Home and tabs](tasks/copy-vocabulary/T14600-glossary-home-and-tabs.md) | 8 | 4 | 2.0 | STAGING | [ ] | Creates `.claude/references/copy-glossary.md`; tabs Games / Plays / Highlights; Plays tab heading, upload button, guide; tile menus (Edit highlight, Move to Highlights). |
| T14610 | ↳ [Mark plays copy](tasks/copy-vocabulary/T14610-mark-plays-copy.md) | 7 | 5 | 1.4 | STAGING | [ ] | play everywhere (no moment/clip/annotation/highlight), recap modal, layers, details, extra-video copy. |
| T14620 | ↳ [Frame and the paid step copy](tasks/copy-vocabulary/T14620-frame-and-paid-step-copy.md) | 7 | 5 | 1.4 | STAGING | [ ] | "Frame play" opens Frame; "Make highlight" is the paid step; box/position; drop Focus/keyframe/segment/Export. |
| T14630 | ↳ [Spotlight copy](tasks/copy-vocabulary/T14630-spotlight-copy.md) | 6 | 4 | 1.5 | STAGING | [ ] | The circle is always "spotlight"; "Re-run Focus" warning; text and cover jargon. |
| T14640 | ↳ [Sharing, credits, profiles and guidance copy](tasks/copy-vocabulary/T14640-sharing-credits-profiles-copy.md) | 6 | 5 | 1.2 | STAGING | [ ] | Turn off link, people, one dead-link message, credit history labels, athlete, intro card, Guidance, ranking, auth casing. |
| T14650 | ↳ [Landing site vocabulary](tasks/copy-vocabulary/T14650-landing-vocabulary.md) | 7 | 5 | 1.4 | STAGING | [ ] | One step sequence matching the app, play/highlight, D5 "highlight reel" only in titles/FAQ, athlete, no "--", US spelling. Coordinate with T7110/T11650. |
| T14660 | ↳ [Emails, share pages and server-made names](tasks/copy-vocabulary/T14660-emails-share-pages-names.md) | 6 | 4 | 1.5 | STAGING | [ ] | One noun per share email, sentence-case CTAs, one share-page template, no "Clip {id}"/"Mixes"/"annotations". Migration only if default names are persisted (ask first). |
| T14670 | ↳ [Guard test for banned copy](tasks/copy-vocabulary/T14670-banned-copy-guard-test.md) | 5 | 3 | 1.7 | STAGING | [ ] | Vitest scan of displayNames + JSX text fails on retired words, em dashes, status codes; allowlist with reasons. |

### Acquisition test prep (owner-approved 2026-11-04, runs after the bugs above)

**Why this section exists.** The 2026-11-04 top-down analysis ([topdown-vs-bottomup-2026-11-04.md](bi/topdown-vs-bottomup-2026-11-04.md), revenue outlook in [revenue-outlook-2026-11-04.md](bi/revenue-outlook-2026-11-04.md)) found the gap between the market (4.7M to 8.4M US competitive-tier athletes) and the funnel ($348 a year today) is reach, not price or demand, and that the referral K factor, the cost per sign-up by platform and geography, and the US vs non-US mix are the model inputs no existing data can produce. A multi-arm acquisition test (Meta, Reddit Ads, share loop, coach codes, organic Reddit, SEO; budget tier is the owner's open decision, $2,500 recommended) needs three measurement pieces first, approved 2026-11-04 from a list of six: the sharer's code on the end card (K becomes measurable from existing tables), a channel read-out keyed on raw attribution (the daily row every arm is read from), and country at sign-up (the organic comparator for the geo arms). Deliberately not filed: code entry at sign-up and partner codes, footage source at upload, a flag-gated referral reward (pricing-adjacent), and any Meta CAPI or Reddit Pixel (against the in-house analytics rule). Audit of what already exists is in section 10 of the top-down doc. Order: T15070 (half a week, unlocks K) -> T15120 -> T15100.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T15070 | [Sharer's code on the end card and share-page calls to action](tasks/T15070-sharer-code-on-end-card-and-share-ctas.md) | 8 | 2 | 4.0 | STAGING | [ ] | M-tier, frontend share surfaces + public share payload + two attribution fixes. The "Made with ReelBallers" end card links back with a static UTM and no sharer; add `sharer_invite_code` (deterministic, persisted) to the share payload, carry `ref=<code>` on every end-card and share-page CTA, record channel `endcard`, and fill a NULL `referrer_id` when a share is claimed after sign-up. No reward. K reads at 90 and 285 post-launch sign-ups. |
| T15120 | [Channel read-out by raw attribution](tasks/T15120-channel-readout-by-raw-attribution.md) | 8 | 4 | 2.0 | STAGING | [ ] | M-tier, admin read + table, no schema change. `GET /analytics/channels?by=origin|utm_source|utm_campaign|utm_content|click_source|referral_channel` through `_segment_group_rows`; five new columns on every dimension table (upload attempted beside succeeded, first highlight within 14 days on aged sign-ups with the aged count, paywall shown, buy modal opened, payers beside revenue); NULL shown as "unknown"; dimension picker + CSV in `ChannelsTable`. |
| T15100 | [Country on the sign-up row](tasks/T15100-country-on-signup-row.md) | 7 | 3 | 2.3 | STAGING | [x] | M-tier, Migration agent (next free postgres version, one nullable `user_segments.country`, probe-before-write like `signup_build`). Cloudflare Pages Function `/api/geo` returns `request.cf.country`; `captureCampaignParams` stores it first-touch; both auth paths send it; server keeps `^[A-Z]{2}$` only. Admin `by=country` on Channels and the Journey inspector, Users filter, T14910 payload. No IP storage, no geo dependency. |

### Journey map follow-ups (user request 2026-11-03, runs after Copy audit)

**Why this section exists.** On 2026-11-03 the owner asked for the TODO list to be re-sorted by predicted impact on the funnel, highest fall-off first. Sources: the prod Journey map (14 d conversion window, 14 d inactivity, all platforms; counts are users at their furthest stage) and a fresh `empty`-preset walk-through on master at desktop 1280x800 and phone 390x844 with a real Modal export (every ladder event was recorded). **Order rule for everything under Current Focus:** sections are grouped by the stage they move, largest absolute loss first; inside a stage, bugs then Pri; measurement fixes that make the map lie go first of all (T14710). Sections moved up from lower in the file carry a dated note; two moves reverse earlier owner sequencing (Video Pre-Shrink was deferred until after Tutorial Redesign on 2026-09-17; Movement Tracking and Player Moments were sequenced after For Alpha polish) and are the owner's call to keep.

**Where parents drop (prod, 2026-11-03), what the walk-through found there, and the tasks that move each number.** The ranking table is not a task table; the board rows for the new tasks follow it.

| # | Stage (reached, lost: gone / stuck / in window) | What the walk-through found | Tasks, in order |
|------|------|------|------|
| 1 | **Add footage** 277 reached, **100 lost** (100 gone, 0 stuck, 21 in window), 36% of everyone who opened the upload screen | The modal has no answer when the game video is not on this device; "Skip ahead on Clips" is grey body text on Home; the loss is one number that mixes never-picked-a-file with upload-died. | T14800 (split the stage), T14810 (no-file path), T9000 (size x speed failure matrix, Video Pre-Shrink), T10350, T14530/T14540 (upload error text), T447/T448 (PWA background upload, share target) |
| 2 | **Footage landed** 183 reached, **47 lost** (46 gone, 1 stuck, 6 in window) | Uploaded a whole game, never marked a play: the next step is scrubbing 90 minutes. The upload-complete email (T7670) exists; the time sink does not change. | Veo Highlights Import (T13200-T13240), Movement Tracking (T7060-T5490), Player Moments (T14295-T14340), Lifecycle Email Drip (T7230-T7270: every lost user here is "gone", only mail reaches them), T3290 |
| 3 | **Clipped** 143 reached, **45 lost** (44 gone, 1 stuck, 9 in window) | Marked and rated a play, never opened Frame. The walk-through guessed 90% here; prod says 62%. Two Make highlight cards plus Share plays compete on the same screen; "Frame" names a tool, not the parent's goal. | T14770 (one Make highlight button, Edit play first), T14780 (step names say the goal), Copy Vocabulary T14600/T14610/T14620, T14560 |
| 4 | **Moved framing window** 77 reached, **42 lost** (41 gone, 1 stuck, 11 in window), and **Pressed Export 0** | **Inflated by instrumentation:** the live Frame export (`POST /api/export/render`) records no `export_started`, `export_completed` or `framing_exported` (verified 2026-11-03: zero `record_milestone` calls in `routers/export/framing.py` and `multi_clip.py`; only the Spotlight export and the legacy job worker record them), so a parent who sharpened a highlight and skipped Spotlight is counted as lost here. Real friction found: Generate stays locked until the box is dragged AND Play is pressed; the first progress estimate says "under a minute" for a 131 s export. | T14710 (bug, first), T14830 (unlock on drag; decision), T14760, T14860, Free Second Highlight (T11610 measures credits spent before the first export) |
| 5 | **Started** 332 reached, **33 lost** (33 gone, 3 in window) | Opened the app, never opened the upload screen. Likely share-link viewers who signed up to watch, and parents whose expectation was set by the landing overclaims. | T14520, T14810 (Home secondary button), T7410 (origin split for the top of funnel), drip day-1 |
| 6 | **Signed up** 376, **20 lost** (20 gone, 3 in window) | Signed up, no session. A sign-in code email whose heading is white on no background is invisible in light-mode clients. | T14510 (bug), T7410 |
| 7 | **Finished highlight** 19 reached, **8 lost** (7 gone, 1 stuck, 1 in window) | One tap from done, 42% leave. Reproduced: after Get share link, the closing Guidance card shades the screen and Download is outside every cutout, so it is dead until the card is dismissed. On phones Share sends the file, never a link. | T14840 (bug), T11510, T11530 |
| 8 | **Opened Frame** 89, 7 lost; **Opened Spotlight** 3 lost | Small losses, but at 1280x800 the Frame preview is 75x135 px and the Spotlight video runs under the action bar; the Frame coach can open at step 2 and stall. | T14760 (bug), T14850 |
| - | **Exported 20 -> Finished 19**, 1 lost | Healthy. | none |

New tasks (board rows), stage order. The nine rows from T14800 down were dropped by the 2026-11-03 re-sort (d36ef1ce2) and restored by T14920 on 2026-11-05 with their statuses checked against git (no branch and no implementation commit for any of them, so all stay TODO):

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T14710 | [Make highlight press records no analytics event ("Pressed Export 0")](tasks/T14710-frame-export-records-no-journey-events.md) | 7 | 3 | 2.3 | STAGING | [ ] | `export_started` is only written by the legacy `POST /api/exports`; Frame's Make highlight uses `POST /api/export/render`, which records nothing (and probably no `export_completed`/`framing_exported` either, so "Exported" is overlay-only today). Record them in `render_project`; update `EVENT_INSTRUMENTED_AT`. |
| T14720 | [Journey stage counts never go up, stages use glossary words](tasks/T14720-journey-counts-strictly-decreasing.md) | 6 | 4 | 1.5 | STAGING | [ ] | Reaching a stage implies every earlier stage: `fold_journey`/`classify_user` count a user at 0..furthest; neighbour edges only, skip ribbons removed; inspector agrees; money strip too. Relabel 7 stages (First play, Pressed Make highlight, Highlight made, ...), keys unchanged. |
| T14730 | [Full-screen button for the Journey map](tasks/T14730-journey-map-fullscreen.md) | 4 | 2 | 2.0 | STAGING | [ ] | Fullscreen API on the Journey container, Esc/Exit button, map scales to screen width. Frontend only. |
| T14740 | [Click a drop-off count to list those users in Users](tasks/T14740-journey-dropoff-click-filters-users.md) | 6 | 5 | 1.2 | STAGING | [ ] | Drop labels and "N lost" filter the Users table via new `journey_stage`/`journey_outcome` params on `GET /api/admin/users`, reusing `fetch_step_users` + `classify_user`; removable chip built from the endpoint's stage label. After T14720. |
| T14800 | [Journey: split Add footage into Opened upload / Picked a file / Upload started](tasks/T14800-journey-add-footage-split-picked-file-upload-started.md) | 7 | 3 | 2.3 | WIP | [ ] | M-tier, backend + admin frontend. Two non-major ladder stages from existing `upload_file_selected` (2026-08-28) and `game_created` events, so the largest loss separates never-picked from upload-died. No new beacon. With or after T14720. |
| T14810 | [Upload modal: a path for parents who have no game file on this device](tasks/T14810-upload-modal-no-file-path.md) | 8 | 3 | 2.7 | WIP | [ ] | M-tier, frontend + landing help page. Disclosure block in the modal (Veo / Trace / Hudl download steps, a real "I already have highlight clips" button, "on another device"); Home's grey "Skip ahead on Clips" becomes a secondary button. ui-designer mock first. |
| T14770 | [One Make highlight button, Edit play first, shape picked in Frame, list of highlights made](tasks/T14770-single-highlight-entry-and-made-list.md) | 7 | 6 | 1.2 | WIP | [ ] | M-tier, frontend. Design approved 2026-11-03 ([decision page](https://claude.ai/artifact/MggCeaBwWEqdgnAdkUjYhT)): Edit play first, one Make highlight button, Frame asks "Where will you share it?" (Option C), count chips + rows that open each highlight, 5-star card opens Frame. Absorbs T14750. After T14760. |
| T14780 | [Step names say the parent's goal](tasks/T14780-step-names-say-the-parents-goal.md) | 6 | 3 | 2.0 | WIP | [ ] | M-tier, copy. Header steps Frame / Spotlight are tool words; propose goal-first names on a decision page, user picks, apply across app, glossary, landing. |
| T14830 | [Frame: Generate unlocks on the first box drag; Play becomes advice (decision)](tasks/T14830-frame-generate-unlocks-on-drag.md) | 7 | 2 | 3.5 | WIP | [ ] | S/M-tier, frontend. `stepsComplete = dragDone && hasPlayed`; the Play half was added 2026-10-06 without a ruling (audit F1 kept only the drag gate). Options A (unlock on drag, recommended) / B (locked card explains itself) / C (keep) on a decision page. Measure after T14710. |
| T14860 | [Export progress: no "Less than a minute remaining" before frames are flowing](tasks/T14860-export-progress-no-under-a-minute-overclaim.md) | 4 | 2 | 2.0 | WIP | [ ] | S/M-tier, frontend (+ Modal progress rate). Measured 131 s for an 8 s clip against an opening "under a minute"; estimate from this job's frame rate plus rolling tails, none before the first frame. |
| T14840 | [Finished: Download is dead under the last Guidance card](tasks/T14840-finished-download-blocked-by-guidance-shade.md) | 6 | 2 | 3.0 | WIP | [ ] | S/M-tier, frontend, bug. The closing "Keep going" card shades the screen with no cutout for Download; make informational cards unshaded (or always-clear the primary actions) + a test that every primary action stays tappable under a shaded card. |
| T14760 | [Frame guidance starts at step 2 and stalls after Got it](tasks/T14760-frame-guidance-starts-step-2-and-stalls.md) | 7 | 4 | 1.8 | WIP | [ ] | M-tier, frontend, bug. Likely a pre-placed box makes `dragDone` true, so Frame opens at step 2 of 5; Got it on a step not yet done leaves the shade up with no card. Fix both; copy uses box/position/athlete. |
| T14850 | [Frame and Spotlight on short desktop viewports](tasks/T14850-frame-spotlight-short-desktop-viewport.md) | 5 | 4 | 1.3 | WIP | [ ] | M-tier, frontend. At 1280x800 the Frame player is 280x155 (preview 75x135) and the Spotlight video overflows under the sticky action bar; extend T12630's height cap to the preview state and Spotlight, floor the player at 320 px. Phone unchanged. |

### Milestone: Spend readiness and Next Step panel (user request 2026-11-03, runs after Journey map follow-ups)

**Why this section exists.** The 2026-11-03 ad-spend model ([ua-roi-model-2026-11-03.md](ua-roi-model-2026-11-03.md), built on a read-only prod aggregate pull of the same day) found paid acquisition loses money in every product state: contribution per sign-up is $0.15 measured, $0.32 after the fix list, $1.56 optimistic, against $9 to $58 per paid sign-up on Meta or TikTok. No single funnel input flips that; only CAC near zero (referral, club partnerships) can. The spend decision therefore hangs on ten measurable gates (visit-to-sign-up, sign-up-to-export, upload failure, finished-to-took-away, money-ladder denominator, payers per 100, revenue per payer, second-season repeat, K-factor, attribution coverage), each with a target. The owner asked for those values and the Journey transitions coloured green / yellow / red, and for one "Next Step" panel that says what to do next, which tasks move it, and whether paid spend is allowed (NO / TEST ONLY / SCALE). Depends on T14710 and T14720 for honest numbers and on T7410 for the visit gate (grey until then). T14910 shares the constants and RAG-chip pattern with T7460 (the design gate decides whether T7460's six criteria fold into the same panel). Order: T14900 (frontend only) -> T14910 (endpoint + panel) -> T14920 (reads both). Sport dimension (owner rulings 2026-11-03: users can have several sports, no DB change, no read-time cost): T14930 arrival sport (parallel with T14900) -> T14940 event tag -> T14950 rollup view (after T7400). T14960 (Visited head node) waits for T7410. Attribution hop (owner question 2026-11-03): the landing already relays `utm_*`, `ref` and the external referrer host onto its app links (T3455, T7910) but only from the first page a visitor sees; T15000 makes it survive internal navigation (per-tab first touch, lands before T14930 so the arrival sport is the first sport page) and T15010 adds the converting landing page as one `user_segments` column.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T14900 | [Journey transitions coloured against the roadmap targets](tasks/T14900-journey-transitions-rag-targets.md) | 7 | 3 | 2.3 | STAGING | [ ] | M-tier, frontend only. `journeyTargets.js` holds the after-fixes targets and the 2026-11-03 baselines per frozen stage key; green at target, yellow above baseline, red below baseline, grey under 20 reached; edge labels, inspector chip, legend, end-to-end chip. Partial-instrumentation edges badged, not coloured. |
| T14910 | [Spend-readiness gates: funnel gates + per-channel ladder (GO / TEST / NO per channel)](tasks/T14910-spend-readiness-gates.md) | 8 | 5 | 1.6 | STAGING | [ ] | L-tier, backend + frontend, read only. Revised 2026-11-04 before build: `GET /api/admin/analytics/spend-readiness` composes existing tables into eleven funnel gates (gate 11 = payer rate of the coach/club-attributed cohort, the kickback kill rule; K recalibrated to 0.05 / 0.02) plus a channel ladder that colours each channel (coach codes in credits $0.72, coach with cards $1.29, Reddit cheapest $1.67, Reddit/Meta $6, Meta $12, club fee) by the computed break-even CAC, benchmark costs replaced by measured ones at 43+ attributed sign-ups; verdict line names every channel's state. Spend entry per campaign on the v038 registry in scope unless T15120 adds it. Small N grey, no season logic. |
| T14920 | [Next Step panel: biggest leak, the tasks that move it, spend verdict, roadmap](tasks/T14920-next-step-panel.md) | 8 | 5 | 1.6 | STAGING | [ ] | L-tier, design gate on the roadmap source (recommended: build-time `scripts/export_roadmap.py` parsing PLAN.md plus a stage map into `roadmap.json`, never a second status store). Picks the largest red/yellow loss, lists its tasks with status chips and the highlighted Next, shows T14910's verdict and reddest gate, roadmap collapsed. After T14900 and T14910. |
| T15230 | [Judge partial Journey steps over the sign-ups that can be measured](tasks/T15230-judge-partial-steps-over-measurable-cohort.md) | 7 | 4 | 1.8 | TODO | [ ] | M-tier, backend + frontend, read only. One old sign-up marks a whole step partial, so the real leak can stay unnamed. Judge each step over sign-ups since its later instrumentation date; design first on conservation and comparing leaks across cohorts. Owner request 2026-11-06, follow-up to T14900 and T14920. |
| T15270 | [Spend gate 1 unblock text names a task id](tasks/T15270-gate-unblock-text-names-task-id.md) | 2 | 1 | 2.0 | WIP | [ ] | S-tier, backend text. The design says these rows carry no task ids; drop T7410 from gate 1's `unblock.text`. |
| T14930 | [Arrival sport on sign-ups: landing sport pages tag utm_content, admin filters by it](tasks/T14930-sport-filter-admin-analytics.md) | 7 | 2 | 3.5 | TODO | [ ] | M-tier, landing + admin read. Sport dimension piece 1 of 3 (owner 2026-11-03: users have several sports, no DB change, no read-time cost). `[sport].astro` links carry `utm_content=<sport>` unless an ad set one; lands in the existing `user_segments.utm_content`; `sport` param on journey, step, users and the T14910 payload labelled "arrival sport"; direct arrivals are "unknown". No migration. |
| T14940 | [Sport in the milestone context of profile-scoped events](tasks/T14940-sport-in-milestone-context.md) | 5 | 3 | 1.7 | TODO | [ ] | M-tier, backend. Piece 2 of 3. Each profile-scoped `record_milestone` call adds `sport` to its context (already free-form JSON in the per-user `user_action_log`); a two-sport parent's hockey and soccer exports are told apart at write time; instrumented-at date recorded. Postgres untouched. After T14710. |
| T14950 | [Sport key in the analytics.sqlite rollup + "By sport" admin table (Total exports by sport)](tasks/T14950-sport-rollup-and-by-sport-view.md) | 6 | 4 | 1.5 | BLOCKED | [ ] | M-tier. Piece 3 of 3. T7400's in-process sweep rolls the T14940 tag into `rollup_action_by_sport(month, sport, action, events, distinct_users)`; one-query "By sport" table (uploads, plays, exports, finished, shares, purchases, users) with `no_sport` and `unrecorded` rows and the overlap note. Blocked by T7400, after T14940. |
| T14960 | [Visited head node on the Journey map (aggregate, from the visit beacon)](tasks/T14960-journey-visited-head-node.md) | 7 | 3 | 2.3 | BLOCKED | [ ] | M-tier. Answers "does T7410 add a visited stage": yes, as an aggregate head node left of Signed up, since the beacon is anonymous counts, never a per-user stage. Visits in the window and the visit -> sign-up ratio with both counts, badged aggregate, outside the conservation check, "not instrumented" before the beacon's first day; T14910 gate 1 reads the same function. Needs T7410's `page_class` to carry `landing:<sport>` for the Sport pill. Blocked by T7410. |
| T15000 | [Landing attribution survives a multi-page visit: first-touch record relayed from every page](tasks/T15000-landing-attribution-first-touch-across-pages.md) | 8 | 2 | 4.0 | WIP | [ ] | M-tier, landing only. Owner question 2026-11-03 "are we handing off attribution to app.reelballers.com": yes (T3455 params, T7910 `lref`) but only from the FIRST landing page; internal navigation drops the query string and `document.referrer` becomes our own host. Fix: per-tab `sessionStorage` first-touch record (whitelisted `ref`/`utm_*`/click ids, `lref`, `lp`) written once and merged into every `data-cta` link on every page; pure module + `node --test` in the CI `landing` job. Should land before T14930 (arrival sport = first sport page of the visit) and T15010. |
| T15010 | [Landing page that converted: `landing_path` stored at sign-up and readable in admin](tasks/T15010-landing-page-path-at-signup.md) | 7 | 4 | 1.8 | BLOCKED | [x] | L-tier (one nullable column), landing + frontend + backend, Migration agent. First landing pathname relayed as `lp`, whitelisted by `captureCampaignParams`, sent by both auth paths, validated server-side, written once to `user_segments.landing_path` (next free postgres version + `_SCHEMA_DDL`; tolerate the column being absent before the admin migration runs, as `signup_build` does). Admin `by=landing_path` dimension grouped by page class with an explicit "unknown". Covers camera, comparison, guide and audience pages that T14930's sport fill does not. Blocked by T15000. |
| T15200 | [Paid-ads tracking: registry spend entry, live-campaign block, kept separate from the referral programme](tasks/T15200-paid-ads-tracking-separate-from-referrals.md) | 7 | 5 | 1.4 | BLOCKED | [x] | L-tier, Migration agent. Carved out of T14910's approved design (2026-11-05) under the owner's steer to keep the current focus on the funnel: nullable `channel`, `spend_cents`, `landing_views`, `platform_conversions` on `campaigns` (one Save gesture via `PATCH /campaigns/{id}`), measured ladder values at 43+ attributed sign-ups, the live-campaign block with the revenue outlook's kill checks, and Paid ads vs Referral programme as separate groups in Channels, the Journey filter and the ladder. Blocked until T14910 reads every funnel gate settled green (owner rule 2026-11-05). |

### Milestone: Referral programme, 50% of revenue for two months, no codes (owner request 2026-11-05; BLOCKED until T14910 reads every funnel gate settled green)

**Why this section exists.** The owner's 2026-11-05 request: mass-email a bank of users (and, in time, thousands of clubs) a share link and a dashboard link; referrers earn 50% of the revenue from the users they onboard for two months; no codes; keep it simple; paid-ads tracking stays separate (T15200). The ROI model makes this the one channel that is GO by construction (cost is a fraction of revenue); its risk is K, not unit economics. Epic: [referral-programme/EPIC.md](tasks/referral-programme/EPIC.md). No prep before the funnel is fixed (owner rule 2026-11-05).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Referral programme](tasks/referral-programme/EPIC.md)** | 8 | 5 | 1.6 | BLOCKED |  | Five tasks in dependency order; the share link is the existing invite link (`/?ref=<invite_code>`, resolved at sign-up into `referrals`), accrual is computed from the `payments` ledger, payouts are an append-only table written by one admin gesture. |
| T15210 | ↳ [Referral earnings read model + payouts ledger](tasks/referral-programme/T15210-referral-earnings-and-payouts-ledger.md) | 8 | 5 | 1.6 | BLOCKED | [x] | Epic 1/5, L-tier, Migration agent. `referral_earnings.py`: 50% of net purchase revenue within 60 d of the referred sign-up, refunds netted, self-referral and test accounts excluded, pending vs owed vs paid; `referral_payouts` append-only table (T8630 trigger pattern); `GET /api/referrals/earnings` and `GET /api/admin/referrals/owed`. |
| T15160 | ↳ [Referrer page: your link, your referrals, what you are owed](tasks/referral-programme/T15160-referrer-page.md) | 7 | 3 | 2.3 | BLOCKED | [ ] | Epic 2/5, M-tier, frontend. `/referrals`: share link with Copy and native share, joined / earned / paid / owed, a dated list without names, link to the terms. Read only; mobile first; the email lands here. |
| T15170 | ↳ [Outreach list and mass send, sized for thousands of clubs](tasks/referral-programme/T15170-outreach-list-and-mass-send.md) | 8 | 6 | 1.3 | BLOCKED | [x] | Epic 3/5, L-tier, Migration agent. Contacts table (users and non-user club contacts, CSV import with dedupe), claim-your-link flow that is a sign-up, batch send runner with a durable cursor, provider rate limits, unsubscribe and bounce handling, per-contact status in the admin, owner test send first. |
| T15180 | ↳ [Admin payouts: owed per referrer, mark paid, Stripe Connect decision](tasks/referral-programme/T15180-admin-payouts.md) | 7 | 4 | 1.8 | BLOCKED | [ ] | Epic 4/5, M-tier plus a design-gated spike. Owed list with CSV export, mark-paid gesture (manual, PayPal, Stripe transfer, credits via `credit_ledger.grant` with an idempotency key); the spike reads two months of owed totals and recommends manual, credits or Stripe Connect Express above a threshold. |
| T15190 | ↳ [Programme terms and abuse rules](tasks/referral-programme/T15190-programme-terms-and-abuse-rules.md) | 6 | 3 | 2.0 | BLOCKED | [ ] | Epic 5/5, M-tier. Landing terms page; rules as named constants with a failing test each (own purchases, refunds and disputes, 60 d window, minimum payout); same-IP sign-up flags in the owed list, informational only. |

### Milestone: Resume where you left off + impersonation lands on the user's page (user request 2026-11-03)

**Why this section exists.** Owner request 2026-11-03: a user who leaves and comes back should land on the same page, and an admin impersonating them should see that page as exactly as possible, to debug drop-offs. Today the URL names only the mode (`/annotate`, `/focus`, `/overlay`, `/home/*`), the open game or play lives in memory plus per-tab sessionStorage breadcrumbs, and a cold hit on an editor route bounces home by design (T5677). So three pieces in dependency order: T14970 gives every editor page a canonical URL and cold-load hydration (frontend only); T14980 adds the resume point, one Postgres row per user (`user_resume_points`, by design not `user.sqlite`, whose every write is an R2 sync) written on navigation gestures and on the exit gesture, returned on `/me`, restored only on a plain `/` arrival, validated against the target, visible and dismissible; T14990 makes impersonation land on that point and shows it in the user detail panel (screen, step, game and play, playhead, open dialog, platform, build, age). The 2026-07-04 rule that view state is never persisted still holds: the point stores the object and position of the work, never filters, sort or panels. Impersonated sessions never move the user's point. Order checked against in-flight work 2026-11-05: T14970 starts now and shares no file with it; T14980 also waits for T15150 to land; T14990 also waits for T14910 and T14920 to land.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T14970 | [Deep-linkable editor URLs: game and play ids in the path, cold load hydrates](tasks/T14970-deep-linkable-editor-urls.md) | 7 | 5 | 1.4 | STAGING | [ ] | L-tier, frontend only, grammar approved 2026-11-05: `/annotate/g/{gameId}[?t=]`, `/focus/p/{projectId}`, `/overlay/p/{projectId}`; home tabs unchanged. Navigation handlers that already push history write the object id; cold load hydrates through the existing pending-game and pending-project paths; unknown or deleted ids land on Home with a visible notice; other-profile ids switch profile first (T5820 pattern). Bare mode paths and `/framing` behave as today. Blocks T14980 and T14990. |
| T14980 | [Resume where you left off: server-held resume point restored on the next visit](tasks/T14980-resume-where-you-left-off.md) | 7 | 5 | 1.4 | TODO | [x] | L-tier, backend + frontend, Migration agent (next free pg version, `user_resume_points`, one row per user, plus `_SCHEMA_DDL`). Point = path, profile, screen, step, playhead, open dialog, home tab, platform, build, left_at; closed vocabularies, no view state. Written by `POST /api/me/resume-point` (in `SKIP_SYNC_PATHS`: no write lock, no R2 sync) from navigation gestures and by `sendBeacon` on the exit gesture; impersonated sessions discarded (record_milestone guard pattern). Returned on `/me`; restored only on a plain `/` arrival under 30 days old; a 404 target lands Home, shows the notice and clears the point; "Picking up where you left off" chip, no "Saved" copy. Blocked by T14970 and T15150 (rewrites the `db_sync.py` lock path this route opts out of). |
| T14990 | [Impersonation opens the user's last page; admin sees where they left off](tasks/T14990-impersonation-lands-on-last-page.md) | 8 | 3 | 2.7 | BLOCKED | [ ] | M-tier, admin read + one flag on the impersonate flow, no schema change. UserDetailPanel "Where they left off" row (titles resolved by the existing read-only profile open); "Impersonate at their last page" action navigates to the point path instead of `/`; banner shows the summary and "Reopen their page"; one-shot `?dialog=` reopens the recorded dialog for the admin only. T14980's guard keeps the user's point unchanged during impersonation (e2e). Blocked by T14980 and by T14910 + T14920 (group g-t14900-3 owns `admin.py` and `adminStore.js`). |
| T15240 | [Email link give-up path moves, misses or mislabels in three edge cases](tasks/T15240-email-link-give-up-path.md) | 4 | 2 | 2.0 | TODO | [ ] | S to M-tier, frontend only. A user who moved tabs inside 5 s is moved to Games; a slow list loses a valid link; an empty profile routes through the editor. Decide on the list's load state, not a timer. |
| T15250 | [T14970 e2e spec can hang on a profile the store never loaded](tasks/T15250-t14970-spec-profile-fixture-race.md) | 3 | 1 | 3.0 | TODO | [ ] | S-tier, test only. A raw POST creates the twin profile, so the switcher can miss it and the test waits out 300 s. Confirm the twin first and fail fast. |
| T15260 | [Small deep link gaps left after T14970](tasks/T15260-deep-link-small-gaps.md) | 3 | 2 | 1.5 | TODO | [ ] | S to M-tier. Locked Spotlight on a play with no working video, URL left behind on a failed load, stale pendingGameId, dead FocusScreen fallback, a stronger clip /file proof. |

### Deploy Candidate (P1, user-ordered 2026-10-13: THE next prod deploy)

**Moved up 2026-11-03 (funnel order, stage 1: Add footage, 100 lost).** T9000 is the read-only failure-matrix analysis that root-causes the upload half of that loss and runs first; the shrink work follows it. This reverses the 2026-09-17 deferral until after Tutorial Redesign (which T12580's guide system has since overtaken); owner to confirm.

Filed 2026-09-08 (user direction) from the state of the Universal Upload shrink track:
the standalone tool T8840 merged (PR #368) but its real-hardware acceptance is still open,
auto-crop is automated but untuned, every speed/quality number comes from one laptop and
one 8K folder, and nobody has the production numbers on which file sizes and connection
speeds actually stop users uploading. The thesis to prove with numbers: total time (shrink
+ upload) must go DOWN while visual quality on the players is NOT sacrificed, across ALL
file types, and the pre-shrink must be net-positive for every video type and size (on a
slow connection it should spend MORE time shrinking, because that still saves total time).
Two epics, strictly sequenced: **Pre-Shrink Research** finishes the research (goal
definition first, then the real-folder run, auto-crop on DJI then other cameras, the
all-types benchmark + production survey, the cost model + size-cap bitrate rule, tweening
auto-crop, and T8836's two undecided cheap wins), then **Pre-Shrink Integration** ports the
proven pipeline into the app - the three integration tasks were MOVED here from Universal
Upload with their IDs and content intact. Picked up AFTER Share-Back Attribution.
**Also after Tutorial Redesign (user direction 2026-09-17): the whole shrink-tool track,
including T8840 itself, is explicitly deferred until Tutorial Redesign ships** - this
milestone was already sequenced after it in row order, and now that's a stated decision, not
just a position. T8836 is DONE (user decided 2026-09-17: T9070 confirmed, T9080 deferred,
relocated here from Universal Upload & Angles alongside T8840).

**Epic 1 - Pre-Shrink Research** (order = dependency + "what defines success first"):

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T13960 | [Branch CI backend job selects tests by recorded coverage (pytest-testmon)](tasks/T13960-ci-backend-pytest-testmon.md) | 7 | 6 | 1.2 | OBSOLETE | [ ] | Master CI publishes a testmon baseline; Branch CI runs only coverage-affected tests; full run on deps, conftest, migrations, schema or data-file changes. Not adopted (user 2026-10-29): per-test testmon misses import-time, cached and process-pool dependencies, and only 20/80 recent backend commits would select; hardening split to T13961/T13962. |

**Epic 2 - Pre-Shrink Integration** (BLOCKED by Epic 1 in full; the three tasks below were moved from Universal Upload on 2026-09-08, IDs and content intact):

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|

### Veo Highlights Import (user request 2026-10-18, feature, runs after the bug sections above) (IN_PROGRESS)

**Moved up 2026-11-03 (funnel order, stages 1-2).** Every lost user at Add footage (100) and Footage landed (46 of 47) is classified *gone*, not stuck: only mail reaches them, which is the Lifecycle Email Drip epic (first rows below). The landing-page rows in this section ride along unchanged.
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
*T5080 (standalone JIT-migration row) was promoted 2026-08-04 into the [JIT Migration epic](tasks/jit-migration/EPIC.md) (T5081-T5089) — rows live in Milestone TOP; the old tasks/T5080-jit-migration.md file no longer exists.*

### Staging QA Walkthrough (user-ordered 2026-10-08, TOP PRIORITY)

**Moved up 2026-11-03 (funnel order, stage 2: Footage landed, 47 lost).** Parents with a Veo highlights zip never have to scrub a 90-minute game to mark the first play.

**User request 2026-10-18:** support uploading the "Veo highlights" zip a parent downloads from Veo. Surveyed 7 real zips (329 clips, `NN HHMMSS_-_Tag.mp4`, zero parse misses): the stamp is the clip's start in the Veo recording, frame-matched on 4 games; halves come as separate zips on their own timelines. **Path A** (full game uploaded): the zip becomes suggested plays in Annotate, promoted to plays by a gesture; nothing is uploaded. **Path B** (zip only): a pick list feeds the existing T8370 batch clip upload. User-upload only, no request to Veo (T2680 boundary). **Decisions V1-V6 DECIDED 2026-10-18 (every recommendation accepted)** plus a user amendment: making a play and rating it is ONE tap in the suggestions list on the same screen (tap a rating = keep), no play editor, no switching. See [EPIC.md](tasks/veo-import/EPIC.md). Order: T13200 -> T13210 -> T13220 (Path A) and T13230 (Path B) -> T13240. Bug T13150 (Release check bugs) gates T13230's link option.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T12420 | [Locked Review plays card needs a visible locked state (decision)](tasks/T12420-locked-review-plays-card-cues.md) | 4 | 2 | 2.0 | OBSOLETE | [ ] | Ruled 2026-10-11: keep as is (lock icon and tap message already explain it). |

### Parent Usability Audit (user-ordered 2026-10-04, NEXT)

**Moved up 2026-11-03 (funnel order, stage 2: Footage landed, 47 lost).** The stage's loss is the time sink this epic removes (dead-time skimming, never speeding past a goal). Research-gated; sequenced after Veo import because it is cheaper per user reached.

Annotating a full game is the product's biggest time sink — only ~55-65% of a match is effective playing time; the rest is throw-in walks, resets, subs, and halftime. Paid opt-in at upload runs a Modal job producing a per-game movement profile (per-second activity score + ACTIVE/DEAD/EMPTY states); Annotate renders it as an activity layer (y proportional to movement) and smart playback skims dead time / skips halftime. Science project first: testbed + human-labeled ground truth + KPI gates (headline: >=99.5% play preservation — never speed past a goal) BEFORE anything touches the app. Signals: compressed-domain motion vectors, optical flow with camera-motion compensation, YOLO player tracking (weights already in our Modal image), tiny learned fusion + temporal smoothing. Epic tasks are STRICTLY ordered. Full research basis, library survey, label taxonomy, and decision gates: [tasks/movement-tracking/EPIC.md](tasks/movement-tracking/EPIC.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T11900 | [Re-run the parent journey on staging (milestone close)](tasks/parent-usability-audit/T11900-re-audit-parent-journey.md) | 7 | 2 | 3.5 | OBSOLETE | [ ] | Folded into T12590 on 2026-10-11: nothing was left but a findings table written from another pass's screenshots, and T12590's walk is a superset. Scope moved intact, including the T11890 known gap. |

### Live Queue (2026-10-01)

**Moved up 2026-11-03 (funnel order, stage 2: Footage landed, 47 lost).** Prototype-gated as before; sits after Movement Tracking (same loss, higher complexity and cost per game).

**User request 2026-10-31 (bar and method set 2026-11-01):** send a full game (any sport) to AI, tap the child once, get back ranked time ranges where that child does something notable, each with a score and a label (highlight / learning opportunity / interesting), under $5 per game. **The bar is Veo's AI:** the shipped path must beat Veo Player Spotlight (per-player; team-level zip where the add-on is missing) on precision AND recall against parent-marked ground truth on the same games. **Models are parameters:** research is redone first (T14295) into a dated candidate registry (`scripts/prototypes/player_moments/candidates.json`); each prototype fills a slot (hosted video search, person detector, tracker, video VLM) from the registry and is rerun on a refreshed registry if it is older than 60 days. Research 2026-10-31 ([player-moments-research-2026-10-31.md](research/player-moments-research-2026-10-31.md)): no model or service sells this for arbitrary footage; camera vendors lock it to their cameras; nobody returns a calibrated probability. **Every risk is listed in [EPIC.md](tasks/player-moments/EPIC.md) (R0 to R15), each retired by a named task; EPIC.md holds the KPI definitions and the PASS / NEAR / FAIL decision tree.** Ladder: T14295 -> T14300 -> T14310 (hosted slot; PASS = T14320 / T14330 OBSOLETE) -> T14320 (tracker slot through exits and re-entries) -> T14330 (video-VLM slot on the child's windows: "is this interesting, which ranges", "is this a highlight", "is this a learning opportunity") -> T14340.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Modal Export Safety & Capacity](tasks/modal-export-safety/EPIC.md)** | 7 | 5 | 1.4 | STAGING | [ ] | Filed from Bug 58p: a 16:9 full-frame 14-clip export hit Modal's 3600s timeout 4 times with no feedback. Core safety pair shipped; GPU-parallelism and GAN-skip-gate children deferred as backlog. |
| T11340 | ↳ [Parallelize multi-clip export across GPUs](tasks/modal-export-safety/T11340-modal-multiclip-parallel-chunking.md) | 7 | 8 | 0.9 | ICE | [ ] | Raises the real export-time ceiling. L-tier/design-gated; deferred as backlog 2026-09-26 (revised design recorded for when this is picked back up). |
| T11350 | ↳ [Enable GAN-skip gate for near-1:1 crops](tasks/modal-export-safety/T11350-modal-gan-skip-gate-enable.md) | 6 | 5 | 1.2 | ICE | [ ] | Skips a full 4x GAN enhance a near-1:1 crop doesn't need. Deferred as backlog 2026-09-26 pending the calibration run `modal-gpu.md` calls for. |

---

### Social Cover Image (user-ordered 2026-10-01, HIGH PRIORITY)

Full copy audit of the app, landing site, emails, share pages and server text on 2026-11-03 (~520 findings, [decision page](https://claude.ai/artifact/6mAdkCVzAktgZ1zWhPWq4j), reports in [copy-vocabulary/audit/](tasks/copy-vocabulary/audit/)). The user approved the glossary on 2026-11-03: game / **play** / **highlight** / highlight reel, tabs **Games / Plays / Highlights**, **Make highlight** starts a highlight and the paid step inside Frame is **Sharpen my highlight** (revised 2026-11-03), and **athlete** (not player) for the parent's kid. Bug rows run first and do not depend on the glossary. The epic then sweeps one area per task in order, ending with a guard test. Supersedes the clip half of the 2026-09-10 [Shared Vocabulary](tasks/shared-vocabulary/EPIC.md) object model.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Social Cover Image](tasks/social-cover-image/EPIC.md)** | 8 | 5 | 1.6 |  |  | Make the user's chosen cover show up wherever a platform allows it, give a one-tap path where only the person posting can set it, and say so honestly where nothing can. Vocabulary: the finished product is a highlight (highlight clip or highlight reel); copy never calls a single highlight a "reel". |
| T11510 | ↳ [Separate "Share video" and "Share link" on mobile](tasks/social-cover-image/T11510-split-share-video-vs-share-link.md) | 8 | 3 | 2.7 | TODO | [ ] | M-tier, frontend + one read-only backend field. Split `webShare` into file vs link intents; fix the mislabeled draft "Share link..." button; one Share chooser (new `ActionSheet`, no backdrop close) on published-highlight player/tile/kebab. User decisions 2026-10-01: published highlights mint links with no review (T10180 R5); unpublished highlights can't share the video file, so the post-export toast drops its mobile Share; desktop Copy link needs no confirm. UI decisions recorded in the task file. |
| T11530 | ↳ [Save cover image + honest platform guidance](tasks/social-cover-image/T11530-save-cover-image-and-platform-guidance.md) | 7 | 3 | 2.3 | TODO | [ ] | M-tier, depends on T11510. One-tap save of the full-size cover JPEG for Instagram "Add from camera roll" / Facebook custom thumbnail; Cover image panel + post-share hint state where the cover applies. |
| T11540 | ↳ [Experiment: does frame 0 set the default cover on upload?](tasks/social-cover-image/T11540-frame0-cover-upload-experiment.md) | 6 | 2 | 3.0 | TODO | [ ] | User-run. AI builds 5 variant MP4s (as-is, no covr, cover held 1f/3f/0.5s); user uploads to IG/TikTok/FB/X/WhatsApp/iMessage/Snapchat/Shorts and records default covers. Gates T11550. |
| T11550 | ↳ [Lead the delivered file with the chosen cover (conditional)](tasks/social-cover-image/T11550-lead-file-with-cover-frame.md) | 7 | 6 | 1.2 | TODO | [ ] | L-tier, BLOCKED on T11540 results + explicit user approval (visible change to the delivered video). Prepend the cover still in the serve-time compose pass. OBSOLETE if T11540 shows no win. |

### Free Second Highlight (user-ordered 2026-10-02)

User feedback from phone screenshots on 2026-11-03. Runs right after the Copy audit milestone and uses its glossary ([copy-vocabulary/EPIC.md](tasks/copy-vocabulary/EPIC.md)): play, highlight, athlete, box, position, Make highlight is the entry button (user 2026-11-03: name the parent's goal, never "Frame play"). Bug first. All touch `GUIDE.*` sentences that T14610/T14620 rewrite, so they come after those. T14750 folded into T14770 (2026-11-03).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Free Second Highlight](tasks/free-second-highlight/EPIC.md)** | 8 | 5 | 1.6 |  |  | Publish -> congrats + "your next highlight is free for 24h (up to 40 s)" -> reminder email at 5h left. Signup 88 -> 48, so the max free value is unchanged. |
| T11610 | ↳ [Baseline: second-export rate + credits spent before first export](tasks/free-second-highlight/T11610-baseline-second-export-metrics.md) | 5 | 2 | 2.5 | TODO | [ ] | S/M-tier, read-only Postgres script run on prod. Records the 24h/7d second-export baseline and p90 credits spent before the first export. Gate for T11650: p90 must be 48 or less, or the user must accept otherwise. |
| T11620 | ↳ [Backend: free highlight pass](tasks/free-second-highlight/T11620-free-pass-backend.md) | 8 | 5 | 1.6 | TODO | [x] | L-tier. Postgres v036 `free_highlight_passes` (PK user_id = one pass ever). Granted in `publish_to_my_reels`; redeemed in one transaction at both export reserve sites (grant LEAST(cost,40) under a new `free_highlight_pass` ledger source); `free_pass` on `GET /api/credits`. |
| T11630 | ↳ [Frontend: pass sheet, "Free" export price, Home banner](tasks/free-second-highlight/T11630-free-pass-frontend.md) | 8 | 4 | 2.0 | TODO | [ ] | M-tier. Sheet driven by the publish response (gesture, memory-only); export price "Free" / "N credits (40 free)" with a net-cost insufficient check; Home countdown banner + chip tag; credit history label. |
| T11640 | ↳ [Reminder email: Resend scheduled send + cancel](tasks/free-second-highlight/T11640-free-pass-reminder-email.md) | 6 | 4 | 1.5 | TODO | [ ] | M-tier. Step 0: verify Resend `scheduled_at` + cancel. Schedule at grant +19h, cancel on redeem, honor opt-out; minimal HMAC unsubscribe through the restore-if-newer seam. No scheduler of our own. |
| T11650 | ↳ [Signup 88 -> 48 + landing page copy](tasks/free-second-highlight/T11650-signup-split-and-landing-copy.md) | 6 | 2 | 3.0 | TODO | [ ] | M-tier, ships LAST. `WELCOME_CREDITS` 80 -> 40 (the remainder calc leaves existing accounts untouched); landing `freeCredits` 48 + free-next-highlight caption; `/deploy-landing` right after the prod deploy. |

### Highlight-First + Single-Clip Editor + Quest Removal (user request 2026-09-24, ships in the Deploy Candidate)

**Placed 2026-11-03 (funnel order, stage 4: Moved framing window -> Exported, 42 lost before T14710 corrects the count).** T11610's baseline (credits spent before the first export) is the cheapest read on whether cost stops first exports.

**Filed 2026-10-02.** The goal is more users making a second highlight. When a user publishes,
congratulate them and give them a free pass: their next highlight is free (up to 40 s) if they make
it within 24 hours, and a Resend email goes out with 5 hours left. Signup drops from 88 to 48 so
the total free value stays 88.

User decisions:
- Proposal C (next one free) over two-step credits or a reserved bonus.
- Ruling G1 of the quest-removal epic is superseded.
- Every account gets exactly one pass (fewest code branches; the extra cost for existing users is
  accepted).
- The landing page is updated.

Row order is the sequence. **T11650 merges LAST** so nobody gets 48 credits without the pass.
Mockups and the original spec: [canvas](https://claude.ai/artifact/6DVHn3V3Y16rzEGJBPKg9x).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Single-Clip Editor: remove Reels and multi-clip editing](tasks/single-clip-editor/EPIC.md)** | 8 | 7 | 1.1 | TODO |  | Dependency order below. No schema migration unless R3 picks the split option. |
| T11250 | ↳ [Remove multi-clip backend: clip-management endpoints + export N>1 branches](tasks/single-clip-editor/T11250-remove-multiclip-backend-export.md) | 6 | 6 | 1.0 | TODO | [ ] | Single-clip export already runs through `_export_clips`; delete the N>1 branches, keep the module. Modal untouched (R10). |
| T11260 | ↳ [Remove multi-clip highlight carry, clip boundaries, Spotlight gates](tasks/single-clip-editor/T11260-remove-multiclip-highlight-carry.md) | 5 | 4 | 1.3 | TODO | [ ] | After T11220: carry code is what keeps legacy multi-clip highlights alive. |
| T11270 | ↳ [Collapse clip selection to "the clip" (mechanical)](tasks/single-clip-editor/T11270-collapse-clip-selection.md) | 3 | 3 | 1.0 | TODO | [ ] | Move-only commit. |
|  | **[Remove the Quest System](tasks/quest-removal/EPIC.md)** | 6 | 5 | 1.2 | TODO |  | Owner ruling 2026-09-24: no more quests; keep only what a future opt-in Guided mode needs (all derivable from games/clips/exports/published/shares). Quests still pay 80 of the 88 welcome credits, so T11170 moves that grant first with the ledger strings frozen. Open G1-G6. |
| T11175 | ↳ [Reroute funnel analytics off the quest achievements endpoint](tasks/quest-removal/T11175-funnel-analytics-reroute.md) | 5 | 3 | 1.7 | TODO | [ ] | The achievements POST is also the admin-funnel bridge; move ~15 event families to funnel events with per-session dedup. |
| T11180 | ↳ [Delete the quest system, frontend](tasks/quest-removal/T11180-delete-quests-frontend.md) | 4 | 3 | 1.3 | TODO | [ ] | Pure deletion (~2,000 LOC); quest UI is already gone. Re-key TutorialVideoModal by topic. |
| T11185 | ↳ [Delete the quest system, backend (+ optional table drops)](tasks/quest-removal/T11185-delete-quests-backend.md) | 4 | 4 | 1.0 | TODO | [ ] | Pure deletion (~2,200 LOC), never deployed before T11180. v005/v006 read `completed_quests`: guard before any table drop. |

### Deploy Candidate, original 2026-09-17 (SUPERSEDED 2026-10-13 by the P1 section at the top; T7620/T7630/T7640 stay here for re-scope)

**Placed 2026-11-03 (funnel order, stage 7: Finished highlight -> Took it away, 8 of 19 lost).** T11510 is the share-side half of that loss; T14840 (above) is the download-side half.

**Filed 2026-10-01 from a user report:** Instagram ignored the cover image the user picked, both
via the PWA Share button and via download + manual upload. Expert root cause (verified against
code): on mobile every Share sends the raw MP4 file, never a link (`useWebShare.js:118-126`), so
Share and Download hand Instagram the same bytes and our `og:image` never runs; the cover is
already embedded as `covr` (T6360) but platforms ignore it and default to frame 0. The draft's
"Share link..." button actually sends the file. Levers are exactly three: `og:image` for links, a
user-supplied cover in the platform's own picker, and frame 0 of the file. Row order is the
sequence; T11540 is user-run on real phones and can start any time. Full findings and the
per-platform map: [EPIC.md](tasks/social-cover-image/EPIC.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T7620 | [Architect design: guided-tour engine + steps](tasks/tutorial-redesign/T7620-guided-tour-design.md) | 8 | 4 | 2.0 | DECIDED | [ ] | Epic 1/3, design gate (user approval). Engine (shade portal, data-tutorial-target registry, re-anchoring, step advance via existing gesture handlers, interrupt/resume, escape hatches), full step table incl. mobile anchoring, state model (toggle + step bookmark, existing-accounts default = explicit user decision), quest reconciliation, failure-mid-tour behavior. |
| T7630 | [Implement engine + essential-path steps](tasks/tutorial-redesign/T7630-guided-tour-implementation.md) | 9 | 6 | 1.5 | TODO | [ ] | **RE-SCOPE after the P1 Deploy Candidate (2026-10-13): overlaps the T12580 shade and Got it guide system; likely shrinks or goes obsolete.** Epic 2/3, **RE-SCOPED 2026-09-17 to the essential-path CORE** (engine, ladder L1-L5, forks F1/F3/F5/F8, Help chip + panel with toggle / ladder / Watch the walkthrough / Report a problem, stall pulse, consequence captions, default ON until first export, quest PANEL deletion, copy re-derived from `displayNames.js`); the post-publish advanced tier, F6/F7, legacy cleanup and the admin readout moved to T10330 (next iteration). **In the Deploy Candidate milestone (2026-09-17), sequenced LAST: do not start until every other milestone task is implemented and the UI approved by the user. The four directive deltas are RULED (EPIC.md 2026-09-17 section): fully guided when on with Help-close as the only exit; default ON until the first export; consequence captions on fork options; videos return via the Help panel so `TutorialVideoModal` stays.** **Prerequisite chain fully cleared 2026-09-17 (re-verified against PLAN-archive.md): R3,R4 -> T8360 -> T8370 -> T8380 are ALL DONE (deployed 2026-09-13 prod), T7620 design DECIDED/approved — nothing left blocking this task from starting.** T7620 design APPROVED 2026-09-02 (GUIDANCE_MAP spine, 69 rules incl. post-publish advanced tier + fork F8). **STALE VOCABULARY WARNING (found 2026-09-17): this row's own target-attribute guidance below is now WRONG — do not trust it, re-derive from `displayNames.js`/`MODE_NAMES` at implementation time instead.** It says "Focus (not Framing)"; T9860 (merged, STAGING) later renamed the DISPLAY name "AI Focus" -> **Framing** (2026-09-13 user decision, PLAN.md Current Focus) while internal file/component names stay `Focus*` (T7700/T9320 precedent: never rename internals for UI consistency) — so the guided tour's user-facing copy must say "Framing", not "Focus", even though `data-tutorial-target` attributes may still live on `Focus*`-named components. Original (now-superseded) guidance for reference only: "Clip Out Play" (not Create Reel, T8760), "Build New Reel" (not Create Highlight Reel, not New Highlight Reel — renamed again by T8780), Published/In Progress Reels tabs (not My Reels/Highlights); REUSE T8390's existing `data-tutorial-target="focus-publish"` — these narrower nouns should ALSO be re-verified against `displayNames.js` before use, not assumed current. Engine + target attributes + toggle/bookmark persistence (gesture-written only); e2e drives the full guided path; a failing guided step surfaces the real error, never traps. |
| T7640 | [Screen-size matrix + quest reconciliation + rollout](tasks/tutorial-redesign/T7640-screen-size-matrix-rollout.md) | 7 | 4 | 1.8 | TODO | [ ] | **RE-SCOPE after the P1 Deploy Candidate (2026-10-13): overlaps the T12580 shade and Got it guide system; likely shrinks or goes obsolete.** Epic 3/3 (front-loaded with T7630 into the Deploy Candidate, 2026-09-17), blocked by T7630 **AND by T8370+T8380 (user directive 2026-09-02: clip upload + the Clips-screen Add Video entry ship before the tutorial launches - the guided path's pre-cut branch needs them live)**. Step-by-width screenshot matrix (320/375/428/768/1280+, keyboard open/closed, safe areas), real-device iPhone pass on the two mobile-cliff steps, quest reconciliation (**NOTE: T8690 SHIPPED — the quest_1-4 watch-video steps are ALREADY hidden behind `TUTORIAL_VIDEOS_ENABLED=false`; reconcile the remaining steps vs the guided tour, don't re-retire videos**), default-on rollout, user walkthrough on staging as final gate. |

### Milestone: Release check bugs (filed 2026-10-18, BUGS FIRST)

Bugs found by the post-release check (T12780, T12590 re-walk, T9720, T9730) on 2026-10-18. User rule: bugs are fixed before any feature work, so this section runs ahead of everything below it. Ordered by infrastructure depth (data and credits first, UI next, test tooling last), then Impact/Complexity.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Next Up

Branch CI picks jobs by layer but runs each job's FULL suite, and editing `scripts/ci_policy.py` fans out to every job. User wants Branch CI to run only tests reachable from the change. Master CI stays the full post-merge sweep. Order: T13970 (smallest), T13950, T13960 (not adopted; follow-ups T13961, T13962).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Fast App Update (speed up new version load)](tasks/fast-app-update/EPIC.md)** | 7 | 5 | 1.4 | TODO |  | HIGH PRIORITY (user-ordered 2026-09-09), filed from the same walkthrough as T9320/T9330/T9350: "update version takes so long", then "create an epic/tasks to speed up new version load". Goal: cut the wall-clock from "a new build is live" to "the user is running it" from minutes to seconds, WITHOUT reintroducing a blocking interstitial (T8460 deleted it deliberately) and without reloading anyone mid-work (T9310 Gap A). Three legs, one child each: time to notice (a waiting bundle never self-activates - `registerType:'prompt'` + a no-op `onNeedRefresh` make `checkServerVersion` the sole activator, and it is throttled to 5 min; T9310's Part 1 verdict recorded that for an idle tab making no API calls the window is "effectively unbounded" and called that acceptable in steady state - this epic reopens that judgement because the user has now asked for fast), time to fetch (the SW precaches the whole new build before it can go `waiting`; nobody has measured how much a one-line deploy actually re-downloads, and the fact that installs routinely blow past the 10s `SW_INSTALL_TIMEOUT_MS` is evidence this leg is not small - it is also the only leg that scales with the user's connection, i.e. sideline cellular), and time to activate (quiescence wait + `flush-verify` + `skipWaiting`->`controllerchange`->full reload, with a 3.5s Safari escalation that may be the NORMAL path rather than the exception). T9340 gates the other three. Already done and not to be redone: T9310 shipped Gaps A/B/C and explicitly deferred D. |
| T9380 | ↳ [Shrink time-to-activate](tasks/fast-app-update/T9380-shrink-time-to-activate.md) | 5 | 4 | 1.3 | ICE | [ ] | Epic 4/4, blocked on T9340. Three questions, in order: (1) is the 3.5s `SW_ACTIVATE_TIMEOUT_MS` Safari escalation the NORMAL path or the exception - if normal, detect the condition and go straight to the manual bust-and-reload instead of waiting for an event that will not come; (2) what does the quiescence wait actually cost - seconds is worth paying to not reload someone mid-gesture, minutes means the condition is satisfied by the wrong events and needs narrowing (never removing); (3) does the reload have to be a full cold boot at all - the ambitious end, likely rejected, and route/scroll restoration is a perceived-latency win rather than a real one, to be judged as such. Do NOT "clean up" `updateGateStore`'s dynamic imports of exportStore/uploadStore - static caused a production-only Rollup TDZ crash. Real Safari device testing required if the escalation path is touched. M-tier for 1+2; L with an Architect gate for 3. |

### Milestone: Admin campaign management + attribution dimensions (user request 2026-10-29)

User request 2026-10-29 from the prod admin panel: the Campaign table and the Cohort grid sit stacked in one filter panel; they should be three mutually exclusive dimensions (Campaigns, Cohorts, Build versions) with one table shown at a time, plus a "Manage Campaigns" button that lists campaigns and creates one from a name, returning the URL that attributes every signup through it. Attribution itself already works (`?ref=` and `utm_*` relayed by the landing site, T3455/T7910); what is missing is the registry with a short id and a display name, matching that id in whatever field a platform delivers it, the build capture and the UI. One `/dotask` group, order below.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Admin journey drop-off (user request 2026-10-30, approved design)

Replaces the admin Funnel tab with a Journey map: a 14-stage intent ladder in three bands (Get footage in, Make the highlight, Take it away), every user at exactly one furthest stage, each stage's drop split into in window / stuck / gone with explicit window and inactivity controls, a loss ranking strip, and a per-stage inspector (timing, breakdowns, side-action lift, failure reasons, people). Design: [admin-journey-dropoff-design-2026-10-30.md](admin-journey-dropoff-design-2026-10-30.md); mock https://claude.ai/artifact/JJfPADKV5QJQ7XtboxmR4V. Supersedes T7465; shrinks T7420. Runs after the Admin campaign management milestone above (shares the dimension pills and the build filter).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md). Follow-ups moved to "Journey map follow-ups" after the Copy audit milestone.*

### Milestone: 10K users readiness (user request 2026-10-31)

User request 2026-10-31: "we should be ready for 10K users". An audit on 2026-10-31 found what breaks first between today (~100-300 real prod users) and 10K registered (~1,000 daily actives, ~100 concurrent at peak). The deploy data-loss fix [T14150](tasks/T14150-shutdown-sync-only-pending.md) is a prerequisite but lives in Release check bugs (bugs first, moved 2026-10-31). Order follows dependency and infrastructure depth: prerequisites first (a baseline load test, the machine, Modal capacity and threadpool), then the O(users) background walks, then abuse limits and downloads. Audit items already planned elsewhere stay where they are: background sync batching is [T2250](tasks/session-scaling/T2250-write-back-r2-sync.md), and running on more than one machine is the [Session Scaling epic](tasks/session-scaling/EPIC.md) ([T2250](tasks/session-scaling/T2250-write-back-r2-sync.md) / [T40](tasks/session-scaling/T40-single-active-session-handoff.md) / [T2260](tasks/session-scaling/T2260-data-loss-detection-recovery.md)). Partial overlaps: [T13920](tasks/T13920-sweep-hot-loop-r2-list-cost.md), [T13940](tasks/T13940-expired-refs-missing-recap-artifacts.md) and [T2650](tasks/T2650-sweep-to-modal.md) for the sweep (none removes the per-user walk, T14140); [T2570](tasks/r2-cdn/T2570-remove-flyio-video-proxy.md) and the [R2 CDN epic](tasks/r2-cdn/EPIC.md) for downloads (T14170).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### CI & Instruction Tooling (follow-ups from T13710, filed 2026-10-27, down the road)

**Filed 2026-10-13** from the T12590 live staging walk (10 gaps, T12620 to T12710) plus the release gate. Five epics, built in order A to E, each one `/dotask` group. **Blocking rule (user ruling 2026-10-13): Epics A and B block the deploy; C and D ship if ready, otherwise they go in the next build; E gates everything. **Epic F (added 2026-10-14, guide pulse centralization) BLOCKS the deploy (user ruling 2026-10-14: "I want to ship Epic F with this build"); it runs after Epic B, and Epic E starts only after F is on staging.** 2026-10-14: T12590, T9720 and T9730 went back to TODO (A to D are on staging; they run from a host session, not a container). T10320 decided 2A ([decision artifact](https://claude.ai/artifact/SDeWeJ5qnaB3G64jn85iLU)): the in-app video opens from a link in the guide card, added only with the new videos; the old videos are linked nowhere (T12780 removes them from the landing site).** The tutorial engine rows (T7630, T7640) are OUT of this build and get re-scoped against the T12580 guide system afterwards; T10320 (tutorial videos) is the gate before the all-user email. The earlier 2026-09-17 "Deploy Candidate" section below is superseded by this one (its open rows moved here; T7630/T7640/T7620 stay there flagged for re-scope). Decision artifact: https://claude.ai/artifact/3RNsjmukcE75aU2y3xHhYx

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T13720 | [Fix dead knowledge-doc references, ratchet drift baseline to 0](tasks/T13720-fix-dead-knowledge-doc-references.md) | 5 | 4 | 1.25 | TODO | [ ] |  |
| T13730 | [Landing job: gate astro check + SEO verifier](tasks/T13730-landing-check-and-seo-gates.md) | 4 | 2 | 2.0 | TODO | [ ] |  |
| T13740 | [Close cross-tree scan + doc-drift blind spots](tasks/T13740-ci-scan-and-drift-blind-spots.md) | 3 | 4 | 0.75 | TODO | [ ] |  |
| T13750 | [Require ci-ready via GitHub branch protection](tasks/T13750-require-ci-ready-branch-protection.md) | 6 | 1 | 6.0 | TODO | [ ] |  |
| T13760 | [Branch CI frontend job runs only the tests related to the change](tasks/T13760-branch-ci-frontend-runs-related-tests-only.md) | 6 | 4 | 1.5 | TODO | [ ] |  |

#### After the deploy (user-ordered 2026-10-13)

**Send gate:** epics A, B and E done and deployed to prod, tutorial published, socials ready. Then the all-user email, then the new-signup welcome email.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Post deploy (filed 2026-10-24, runs after the Deploy Candidate reaches prod)

Checks that can only be made against prod, after a deploy.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Next Build, external QA 2026-10-16

**Filed 2026-10-16** from an external first-time-parent QA pass on staging ([report and screenshots](ux/2026-10-16-external-qa/QA-REPORT.md), [intake and verification table](tasks/qa-2026-10-16/README.md)). Every row here was verified in code AND is already on prod (`deploy/*/2026-10-05`), so none blocks the Deploy Candidate (user rule 2026-10-16); the one staging-only regression (T12810) sits in the Deploy Candidate above. C01 (landing overclaim) is already fixed and deployed (7f96b5611). Ordered by user impact, easier first on equal impact.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Keep Only Marked Plays (filed 2026-10-18, feature, runs after the bug sections above)

**User request 2026-10-18:** a per-game "Keep only marked plays" gesture that leaves only the plays viewable (highlights still possible), reversible until the source video expires; plus the brilliant count on game tiles. Scoped against the existing expiry path: keep-only = run the sweep's `auto_export_game` now + a `games.plays_only_at` flag that routes the tile to Watch plays and silences every expiry nag; restore = clear the flag while the ref is live. Decisions D1-D7 all DECIDED 2026-10-18 per the recommendations (Watch plays on tap, no storage/credit change, sharing unchanged, preserve immediately, restore deletes the recap and resets export status, no Extend for expired plays-only games, athlete-only brilliant count). Order: T12910 (bug, above) -> T12920 -> T12930 -> T12940; T12950 is independent and can go first.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Annotate marking speed (user feedback 2026-11-01, feature, runs after the bug sections above)

**User feedback 2026-11-01** from a parent marking plays at 2x: a forward skip and YouTube-style double-tap skip so they can jump past dead time without dragging the scrubber and missing a play. The Annotate bar's only forward button is a one-frame step; forward-by-seconds exists only as an undocumented Right Arrow (playhead layer only). User decision: match YouTube as closely as possible.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Final Polish

**Filed 2026-10-08 from a first-time-user Playwright walkthrough of staging** (blank account to finished highlight). Four epics: bugs, confusing moments and jargon, styling and CTA consistency, guide correction. Root causes verified on master `c6e6708fa` by Opus expert agents; all 8 bugs were still present. **All 18 decisions ruled 2026-10-08** (every recommendation approved except Q15 = C and Q16 = A); decision report with mockups: https://claude.ai/artifact/E5KKydoV5gngJ9nXa14ftm. Tasks are written for the ruled options. Milestone overview, vocabulary, sequencing and decision register: [README.md](tasks/staging-qa-2026-10-08/README.md). Findings and screenshots: [docs/plans/ux/2026-10-08-staging-qa-walkthrough/](ux/2026-10-08-staging-qa-walkthrough/findings.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T6530 | [UX pass: how should the intro card feature actually be surfaced?](tasks/player-intro/T6530-intro-card-discoverability-ux.md) | 7 | 4 | 1.8 | DECIDED | [x] | **Moved here from Milestone A 2026-09-01 (user order).** Research + written proposal (22 live screenshots) delivered 2026-08-08, reviewed and decided by the user the same day. Split into 4 implementation tasks: T6660 (naming, final pick "Athlete Intro Card"), T6670 (card selector inline create flow), T6680 (default card before user creates one, design-gated), T6690 (non-active-profile dead end fix). Full decision record in the task file. No code from this task itself - see the 4 children. |
| T8950 | [Audit the credit pricing model for high-resolution/high-fps source files](tasks/T8950-pricing-model-high-resolution-audit.md) | 6 | 3 | 2.0 | TODO | [ ] | Filed 2026-09-05 from live-testing feedback, related to the Universal Upload epic but not one of its ordered tasks. Cost is already purely byte-size-based (no formula bug), but the epic's own DJI evidence (50 GB/game, 8K/60fps) prices out to ~18 credits at current constants vs ~2 credits today for a typical 3GB upload - open questions are calibration + surrounding UX (credit-purchase copy for double-digit charges, whether `MARGIN`/`R2_RATE_PER_GB_MONTH` still make sense), NOT the real-time shrink-step cost preview (already speced in T8850, explicitly out of scope here to avoid duplication). |

### Video Pre-Shrink

**Filed 2026-10-04 from an external parent usability test of staging** at desktop, tablet and
iPhone sizes. The tester finished the whole journey, but only after learning hidden rules: the crop
box must be *dragged* before Generate unlocks, a play must be rated 5 stars to become a highlight,
and the clip is labeled "In Spotlight" after Spotlight was skipped. On iPhone the editor scrolls
sideways and hides the game name. Every finding was mapped to code by code-expert agents and
designed by four ui-designer agents. Milestone overview, standing rules and the **decision
register (15 decisions, ruled 2026-10-04: 14 as recommended, U2 replaced by an investigation)**: [README.md](tasks/parent-usability-audit/README.md).
Audit and screenshots: [docs/plans/ux/2026-10-04-parent-usability-audit/](ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md).
Decision report with mockups: https://claude.ai/artifact/Kt8eRfZB27Tj2DJGQ5zgn9. Tasks are written for the
ruled option. **Epic D reverses Highlight-First ruling H3 (2026-09-24) and round 2 ruling 6, by user decision 2026-10-04.** Epic order is the recommended
sequence; up to four epics can run in parallel (shared-file order is in the README).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Pre-Shrink Research](tasks/pre-shrink-research/EPIC.md)** | 8 | 6 | 1.3 |  |  | Finish the pre-shrink research so integration is a port of a PROVEN pipeline. Instrument = `scripts/shrink-tool/` (never imported by app code; `pipeline/` stays DOM-free for T8845). No new telemetry: production questions are answered from `user_actions` (T7510 reasons, T8838 census rows) and per-profile `games`/`pending_uploads`. Inputs already settled (T8830/T8832/T8834/T8836/T8838, design R11 + §4.2, T5650 §9) are tabled in EPIC.md - do not re-derive. |
| T8840 | ↳ [Standalone browser shrink tool (fully working, zero app integration)](tasks/universal-upload/T8840-shrink-pipeline-core.md) | 7 | 7 | 1.0 | WAITING ON USER (deferred) | [x] | **Relocated here 2026-09-17 from Universal Upload & Angles** - the whole shrink-tool track is deferred until after Tutorial Redesign. Merged PR #368, commit 0343215e - unit/smoke-tested (34/34 + 32/32 real-browser checks) and 3-lens reviewed in-container; standalone tool has no app deploy, so the user's own real-hardware test IS the test phase (50GB DJI folder + second machine, recipe in `scripts/shrink-tool/README.md`). Not formally an Epic-1 child (T9010 below is), placed here because T9010 directly depends on it. Acceptance = the user runs the written test recipe on the real 50 GB folder AND a second machine and says it works. 11 binding caveats in the file. |
| T9000 | ↳ [Upload-failure analysis: which file-size x connection-speed combinations stop users uploading (sets the milestone goal)](tasks/pre-shrink-research/T9000-upload-failure-size-speed-analysis.md) | 8 | 3 | 2.7 | TODO | [ ] | FIRST on purpose: defines success for the whole milestone. Read-only mining of prod: `game_created` (attempts) vs `game_upload_succeeded` vs `game_upload_failed:{reason}` by size bucket x inferred-bandwidth bucket x platform (bandwidth is not recorded server-side - parts go straight to R2 - so infer from prepare->finalize elapsed and from `pending_uploads` part progress). Deliverable: the matrix + ONE goal line ("a X GB game must upload on Y Mbps in Z hours, output under C GB") written into EPIC.md. Names any non-inferable dimension's would-be beacon; builds none. |
| T9010 | ↳ [Run T8840's test recipe on the real 50 GB DJI folder and a second machine (T8840's open acceptance)](tasks/pre-shrink-research/T9010-verify-shrink-tool-real-folder-run.md) | 8 | 3 | 2.7 | TODO | [ ] | T8840's acceptance was never a test suite: the user runs `scripts/shrink-tool/README.md`'s recipe (steps 1-7) on the real folder + one other machine. Four `*.shrunk.mp4` outputs already exist under `formal annotations/u14 adonis/DJII Compressed/` but the README results table is empty - record it. Checks design R1 (mdat >4 GB at Sharp on the 24-min segment), R3/R11 (color + compression A/B), R10 (LRF vs MP4 framing). Defects are filed, not fixed here. Produces the real Sharp timing + output sizes T9040 needs. T8840's status stays the user's call. |
| T9020 | ↳ [Tune auto-crop on the real DJI folder (parameter sweep + ball-in-frame check)](tasks/pre-shrink-research/T9020-tune-auto-crop-dji.md) | 7 | 4 | 1.8 | TODO | [ ] | `pipeline/autoCrop.js` (grid 24x14, threshold 15% of max cell variance, 3% padding, 8 samples at 160x90 over the middle 80%) has only been validated on synthetic blobs. Build ground truth from YOLO on the `.LRF` proxies (T5650 §9 detected the ball in every tested frame; ultralytics is in the backend venv), sweep grid/threshold/padding/sample count/resolution, score by 100% ball-in-rect + players-in-rect + kept-area. Commit new defaults + tests + a `qa/autocrop-sweep.mjs` harness (T9060 reuses it). Pipeline stays DOM-free. |
| T9030 | ↳ [Trial auto-crop on other camera sources (Trace, Veo, iPhone, existing fixtures)](tasks/pre-shrink-research/T9030-auto-crop-other-camera-sources.md) | 6 | 4 | 1.5 | TODO | [ ] | Auto-crop has only seen a fixed tripod DJI lens. Run T9020's harness on the Legends/Trace exports (tracked camera pans: expect near-full-frame, verify it is not a confident nonsense rect), the phone clip (10 s, handheld), `test.short/`, and a Veo export if the user can supply one. Per-source verdict (usable / correct no-op / harmful + mitigation) in the README + EPIC.md; a >90%-area -> `null` guard if the data supports it. No per-source branches on one anecdote. |
| T9040 | ↳ [Benchmark shrink-time + upload-time vs visual quality across ALL file types (with a production file-type survey)](tasks/pre-shrink-research/T9040-benchmark-time-vs-quality-all-file-types.md) | 9 | 6 | 1.5 | TODO | [ ] | The core thesis, with numbers. (1) Production survey from per-profile `games` rows (size/duration/dims/fps -> bitrate buckets) joined with the T8838 census (`capability_impression:shrink_*`) - extends T9000's read-only script, adds no telemetry. (2) Matrix: source type x preset (Sharp/Small) x machine -> shrink wall-clock (encode-bound: output pixels / probe `pixelsPerSecond`), output bytes, upload time per T9000 bandwidth bucket, total vs upload-original, break-even bandwidth per source, player-REGION SSIM/VMAF + stills for the user's blind A/B (whole-frame PSNR rewards blur). Legends (4.67 Mbps) included as the negative case. Written to `docs/plans/research/pre-shrink-benchmark.md`. |
| T9050 | ↳ [Cost model: when NOT to shrink, and the size-cap-driven bitrate rule](tasks/pre-shrink-research/T9050-cost-model-when-not-to-shrink.md) | 8 | 5 | 1.6 | TODO | [ ] | Replaces the two-constant gate (`shouldOfferShrink`: >= 3 GB AND >= 10 Mbps) with a pure, unit-tested `pipeline/decision.js` `decideShrink(...) -> {mode: client |
| T9060 | ↳ [Tweening auto-crop: a keyframed crop path that follows the play](tasks/pre-shrink-research/T9060-tweening-auto-crop-follow-the-play.md) | 7 | 7 | 1.0 | TODO | [ ] | One static rect per segment must stay nearly full-field-wide to keep every play, and the resolution cap is width-driven (design R11). Evolve to a crop PATH: constant size (encoder dims are fixed per segment - a pan, not a zoom), keyframed centres from the variance heuristic per time window, smoothed (1-euro/EMA, velocity + acceleration bounds, never jitters, never lags the ball out of frame - widen instead). `cropScale.createCropScaler.transform` evaluates the path per `frame.timestamp`; manifest round-trip + resume; plain rects still valid. New `pipeline/cropPath.js` + `autoCrop.suggestCropPath`, all DOM-free so T8845 ports them. Verdict in EPIC.md: worth carrying or not. |
| T9070 | ↳ [Extract the `stss` keyframe index client-side (T8836 row 2)](tasks/pre-shrink-research/T9070-stss-keyframe-index-client-side.md) | 4 | 2 | 2.0 | TODO | [ ] | **CONFIRMED 2026-09-17** (was provisional). T8836 measured it free: the same ftyp+moov parse `probeShrinkCapability` already does (16-124 ms incl. both 17 GB files) yields keyframe times (0006: 274/8196 samples; Legends: 2650/79489). Add `keyframeTimesSec` to the shared `src/frontend/src/utils/shrinkCapability.js` result (explicit `null` for all-sync tracks); the tool's `probeContainer` consumes the same function. In-memory only, no persistence, no beacon. Feeds T8850's filmstrip seeks and a future mid-segment resume. |
| T9080 | ↳ [Poster + preview frames from the `.LRF` proxy at upload time (T8836 row 3)](tasks/pre-shrink-research/T9080-lrf-proxy-poster-frames.md) | 4 | 3 | 1.3 | TODO | [ ] | **DEFERRED 2026-09-17, not vetoed** (was provisional) - user: kick to a later milestone dealing with uploads; already lives here. T8836 measured 224 ms/frame (70 load + 94 seek + 60 draw/JPEG) for a ~210 KB 1280x720 JPEG from the frame-synced `.LRF` proxy, vs `poster.py`'s ~5 remote seeks per game. At the upload gesture, when the intake paired a proxy (EPIC decision 2 keeps them client-side), send one validated JPEG with finalize and skip the server seeks; proxy-less uploads stay byte-identical (server path is the only fallback). No schema change. Needs T9010's R10 verdict (proxy framing matches the MP4). |

### Video Pre-Shrink

**Filed across several recent commits as prose paragraphs instead of table rows, so the task
board's parser (which only reads `| ID |` tables) skipped this whole section.** Moved into a table
here 2026-10-01 so "top of board" matches actual priority. These aren't a single dependency-ordered
epic — it's the live backlog of bugs/features filed outside the active milestones below. Full
context for each still lives in its own task file (linked); descriptions here are one-line
summaries per the task-management convention.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Pre-Shrink Integration](tasks/pre-shrink-integration/EPIC.md)** | 7 | 5 | 1.4 |  |  | Port the PROVEN pipeline into the app: worker + client API, offer card + crop step, upload-queue integration with the binding fallback. Hard chain T8845 -> T8850 -> T8860. Design decisions (Universal Upload EPIC.md decisions 2/4/5/6, artifact screens E + F) still govern; research outputs (T9050 decision rule, T9060 crop path, T9070/T9080) are named inputs. |
| T8845 | ↳ [Port the approved standalone shrink tool into the app (worker + client API)](tasks/pre-shrink-integration/T8845-port-shrink-tool-into-app.md) | 7 | 4 | 1.8 | TODO | [ ] | Filed 2026-09-07; moved 2026-09-08. Starts ONLY after the Pre-Shrink Research epic is complete (T9010 = the user's T8840 sign-off, the gate it always had). Mechanical: `git mv` the pipeline modules (as they stand after research - incl. `decision.js`/`cropPath.js` if adopted) into `src/frontend/src/services/shrink/`, wrap in `shrinkWorker.js` + `shrinkClient.js`, `capability.js` turns the tool's "too slow" verdict into the Modal fallback, add mp4box/mp4-muxer to the app. Behaviour proven identical via the tool's own smoke fixture. Blocks T8850/T8860. |
| T8850 | ↳ [Shrink UI: offer card + crop step + presets](tasks/pre-shrink-integration/T8850-shrink-ui-crop-step.md) | 7 | 5 | 1.4 | TODO | [ ] | Moved 2026-09-08. **Gated on T8845.** Offer card only when the gate says so (T9050's `decideShrink` if landed, else total > 3 GB AND source bitrate > ~10 Mbps, EPIC decision 4 as amended 2026-09-07) AND capability true (never gates Add Game); full-modal crop step over a preview frame (DJI .LRF proxies power previews for free), per-segment filmstrip with per-segment automated crops as the default rect (decision 5 as amended 2026-09-08; a moving rect if T9060 was adopted), two presets Sharp/Small with live size/time/credit estimates. Artifact screens E + F are the spec, incl. the "you can still zoom in later" reassurance copy. |
| T8860 | ↳ [Shrink upload integration + fallback](tasks/pre-shrink-integration/T8860-shrink-upload-integration.md) | 7 | 5 | 1.4 | TODO | [ ] | Moved 2026-09-08. **Gated on T8845 + T8850.** Two-slot pipeline (segment i shrinks while i-1 uploads), phase-aware progress, credits from ACTUAL uploaded bytes, shrunk file flows through the untouched normal upload path (hash/probe/activate), binding fallback: any shrink error -> toast + upload originals, already-shrunk segments stay shrunk, loud logging; Modal fallback bounded by T9050's cost rule (it uploads the original first, so it never saves upload time). Manual e2e on the real 50 GB DJI folder recorded. |
| T8865 | ↳ [Make highlights from plays before the whole game video has uploaded](tasks/pre-shrink-integration/T8865-highlights-before-upload-completes.md) | 8 | 7 | 1.1 | TODO | [x] | Filed 2026-10-18 (user direction). **Gated on T8860.** Relaxes the upload lock shipped 2026-10-17 (58b109087: 409 `source_uploading`, `useIsGameUploading` locks slots/choice card/Frame+Spotlight): a play unlocks for Framing/Spotlight once ITS footage is available, not the whole game. Mechanism (user, 2026-10-18): use the play's footage when its file is already a complete R2 object (multi-file games, T8860 segments); otherwise the client remuxes just that play's snippet (no re-encode) and uploads it ahead of the game. The snippet becomes the clip's per-clip extract (`resolve_clip_source` step 2, plus a new `extract_start_time` origin column), so the game video wins again automatically once it lands. Per-clip 409 gate, backend-derived lock (closes guidance.md invariant 8's direct-link residual), snippets never charged. Design approval still required. |
| T11300 | [Reels v2: stitch published highlights into a college highlight reel](tasks/T11300-reels-v2-post-publish-stitcher.md) | 8 | 8 | 1.0 | TODO | [x] | **Thawed 2026-10-20 (user direction): sequenced AFTER the Video Pre-Shrink milestone**, not inside it. L-tier, Architect gate first. Twelve design decisions RULED 2026-10-20 (wireframes https://claude.ai/artifact/GvP9djXxXSRmU5WVb3yN35, UI spec `tasks/T11300-ui-proposal.md`): fourth Reels tab at `/home/highlight-reels`; checkbox picker over FINISHED highlights (filters are a view, payload = ordered ids); Best first default, Custom on drag; **transition default = hard cut, Fade available as a reel-level setting (user override of the fade-default recommendation)**; title card + between-clip text frames behind a toggle; free with a soft 5:00 advisory; members keyed to the highlight's project id with a Changed state + Re-export gesture; draft row created at the Arrange gesture, surgical writes, no save copy; mono-ratio via a ratio pill; result lives on the Reels tab; grip-handle drag + kebab moves on phone; preview = existing composite player, fades export-only. Depends on T11250 + T11260 (single-clip-editor epic) landing first. Needs a `reels` profile_db table (Migration agent). |

**NEXT DEPLOY = [Milestone: Deploy Candidate](#milestone-deploy-candidate-user-ordered-2026-09-17-the-next-deploy) (user-ordered 2026-09-17).** Filed from the user's own staging
run: three crash paths to re-verify (T10230), two clip-upload bugs (T10250/T10260), upload-failure
observability (T10270, the "do we have enough logging" answer is no), pricing single-source
(T10210, merged; the 12.99/22.99/32.99 reprice T10220 is deferred until AFTER the build), the landing overclaim (T10170), the home-tab / Annotate-editor /
Overlay-panel UI finalization (T10280/T10290/T10310), uploaded-clip game linking (T10300), the
Tutorial Redesign core (T7620/T7630/T7640 as epic children in the milestone, LAST: after every other task is implemented and the UI approved; the advanced tier is T10330 in "Guided Mode: next iteration"),
the video reshoot (T10320, in-app + site, after guided mode), and T9720/T9730 as the gate. Bugs before features; that section's row
order is the sequence. **2026-09-19 addition: the [Play Editor Autosave + mobile trim layout](#milestone-play-editor-autosave--mobile-trim-layout-user-ordered-2026-09-19) epic (T10600-T10630)** — user-ordered removal of the editor's Update/Save button plus the portrait trim-layout fix; its position relative to the candidate is the user's call.

**Durability Hardening Campaign (2026-07-17): CORE COMPLETE, re-verified 2026-09-17.** The
campaign's original "TOP PRIORITY" set — **T4320** (durable clip gestures, incl. the T5310
`POST /api/profiles` create source-fix), **T4310** (upload-side CAS) and **T4315**
(restore-if-newer), i.e. the entire [durability-sync epic](tasks/durability-sync/EPIC.md), plus
its standalone sibling **T5840** (credits → Postgres) — are **ALL DONE**, deployed 2026-07-18
through 2026-07-28 prod (T4320's own PLAN.md/archive row had gone missing despite being merged and
shipped; recovered 2026-09-17, see PLAN-archive.md). This section had gone unupdated for two
months and was still describing all four as upcoming/sequenced work; it wasn't. Two siblings from
the original campaign are still genuinely open: **T4400** (backend-authoritative export — client
state clobbers surgical edits, DB≠video), now sequenced inside the [Export Write-Path Unification
epic](tasks/export-write-path/EPIC.md) behind T4370→T4380→T4390 (strict order, all four still
TODO, see Milestone B), and **T2260** (data-loss detection/recovery on reconnect,
`tasks/session-scaling/T2260-data-loss-detection-recovery.md`, also still TODO). Point-fixes from
the original 2026-07-24 arshia incident (grantee-DB sync, `TrackedConnection` owner tracking,
move_reels `require_fresh`) shipped alongside the epic itself.

**UI Runway (user-ordered 2026-08-03): CLOSED 2026-08-17.** Every near/mid-term UI-visible task landed, then the tutorials were reshot against settled screens (T5140, deployed 2026-08-17 prod) — see the UI-runway note at the end of Milestone TOP below for what's now unblocked.

**Phase: Feature** — Season Highlights & Collections epic: My Reels becomes the curation home (annotate → publish → rank → share). Spec: [season-highlights-spec.md](season-highlights-spec.md) · Tech notes: [season-highlights-tech-notes.md](season-highlights-tech-notes.md)

**Landing Page:** Already live at `reelballers.com`

### Milestone: Dev Account Picker (user-ordered 2026-10-09, before Social Cover Image)

Every local stack the AI brings up for a human test opens on a sign-in screen that can't work
locally. Replace it, on dev stacks only, with a picker of three per-stack accounts: empty, just an
upload, and full (two profiles, annotations, a clip in Framing, one in Spotlight, one finished).
Every pick creates a new account. Design sketch
and open questions: [T11500](tasks/T11500-dev-account-picker.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Next Work: September 12-13 Evaluation Handoff

**NEXT BATCH (user-ordered 2026-09-13): 20 live tasks in T9770-T9970 + T10010.** Work this batch
before the older pending backlog below. The [integration epic and ID
mapping](tasks/evaluation-2026-09-13/EPIC.md) carries all 27 imported tasks and the [full source
plan](tasks/evaluation-2026-09-13/source/plan.md); its **Reconciliation and scope decisions**
section records what was verified against code and the decisions taken 2026-09-13.

**Reconciliation result (2026-09-13).** Both the Sept 9-10 and the Sept 12-13 evaluations tested
**staging**, not prod - the evaluator's 88-credit account is only producible by master-side code
(T8120's `quest_upfront` grant), and prod was pinned at build 4290 / `d9621161`. Findings are
therefore LIVE against master, and four of the evaluator's quoted strings were confirmed still
present in the tree. **4 imported tasks dropped as already-shipped or duplicated** (T9910, T10000,
T10020, T10030), **1 folded** (T9940 into T9860), **2 deferred to their own epic** (T9980, T9990).

**User decisions 2026-09-13:**

- **Deploy first.** Prod was 744 commits / 12 days behind master with 138 tasks sitting at STAGING,
  including 34 from the Sept 9-10 walkthrough. Deployed before starting this batch.
- **Vocabulary: Clip and Reel both stand.** "Highlight" is a MODIFIER, not a third object. This
  REVERSES the intake's proposed Clip -> Highlight rename (source N02/N06) and leaves the 2026-09-10
  object model intact. Standing rule: **short form in controls** (`Clips`, `Reels`), **long form in
  prose** (highlight clip, highlight reel). Never one sibling carrying the modifier while its
  sibling does not - today's `Clips` tab beside the `Highlight Reels` noun is the actual defect.
- **AI Focus becomes Framing**, lifting the 2026-09-10 override. That override's recorded reason was
  that the name should say the reframing is automatic. It is not: framing is manual crop keyframes
  joined by a spline. Mode noun = **Framing**; screen instruction = "Frame your athlete" (a sentence
  cannot be a mode name - it has to work in a tab, a switcher and a status chip).
- **Relocate the AI claim to where the AI actually runs.** "AI" appears in exactly ONE parent-facing
  place today (the mode name), and that is the one step with no AI in it - which is why users report
  the app "has no AI". Real AI: `AIVideoUpscaler` (Real-ESRGAN, every framing export) and YOLO player
  detection on a T4 GPU (Spotlight). Name those steps: "Finding players", "Enhancing video".
  **Name the step, never promise the outcome** - no "Enhanced to HD" or equivalent quality claim
  until T9970 has measured whether it holds.
- **Statuses: T8470's Draft/Shared stands** (2026-09-10 override upheld). Take source N11 as
  PRESENTATION only, not a new state machine: add a plain-language second half to each existing
  state - `Draft / Not exported yet`, `Private / Ready to watch`, `Shared / Anyone with the link`.
  `draftStage.js` remains the single source and T9600 keeps its job.
- **Capture window = 6s before + 2s after** (8s total, replacing today's 9+3=12). The code was never
  broken: `DEFAULT_CLIP_BEFORE=9` + `DEFAULT_CLIP_AFTER=3` straddling the tap produced exactly the
  0:00-0:06 the evaluator reported at a 0:03 tap. Only the word "previous" was false. The post-roll
  is deliberate (parents tap AFTER they see the play), so 2s of it is preserved. Copy becomes
  "Captures 6 seconds before and 2 after".
- **Spotlight stays optional, but encouraged.** Its real reason - 22 kids in the same kit, and this
  is how anyone watching knows which one is yours - is the strongest sentence in the product and is
  currently written as a definition rather than a reason.
- **Every stage states its point in one sentence, and no explanation may use the feature's own name
  as the reason for the feature.** The framing copy failed this test ("so you can focus the clip
  around your player" is circular), and so does every other screen: they teach the mechanics and
  never state the point. T9860 owns the sweep.
- **One UI iteration, not several.** All copy-shaped work folds into T9860 so six tasks do not each
  edit their own corner and reintroduce the exact inconsistency both evaluations found.

**Sequence:** P1 repairs (T9770, T9790, T9800, T9810, T9820, T9840, T9920; T9780 after T9770) ->
T9860 copy and concept sweep -> the P2 UX tier -> T9970 quality benchmark and T10010 telemetry, both
independent and startable any time -> the existing release gate T9720 (which absorbed T10020).
T9980/T9990 follow afterwards in the [Capability Discovery
epic](tasks/evaluation-2026-09-13/EPIC-discovery.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

*T10170 moved to the Deploy Candidate milestone (2026-09-17, user order: kill bugs and finalize the streamlined UI before the next deploy).*

**Dropped from the intake 2026-09-13** (rationale in
[EPIC.md](tasks/evaluation-2026-09-13/EPIC.md); task files retained as provenance):

| Imported | Why it was dropped |
|------|------|
| T9910 | Credit/storage policy is already ANSWERED: T9680's decision record is complete on all six questions and was verified against production 2026-09-12; T9750 fixed the rounding rule; T9760 explains the credit discrepancy. Residual copy work is T9650, already on the board. |
| T10000 | Premise is stale - the Collection Download epic (T4945/T4946/T4947) shipped and is archived, so download capability exists. The evaluator simply could not find it, which is discoverability. Folded into T9880. |
| T10020 | Duplicates T9720, the existing end-to-end and failure-path release check. Merge the new checklist into T9720 rather than running two gates. |
| T10030 | Overlaps T9730 (product review and traceability sign-off). Both need real participants, which are not currently queued. |
| T9940 | Folded into T9860 - it is the same AI/capability copy problem, and splitting it would produce two passes over the same strings. |

### Production Reported Bugs

Bugs reported by users on production. Populated from Postgres `bug_reports` table via task board API. Use "Copy Kickoff Prompt" to investigate.

**Full triage pass 2026-09-14** (first pass since T10090 restored task-board connectivity):
6 real reports (51-53, 55-57) processed into the rows below, plus T10121/T10122 split out of the
bug-52 (T10120) expert investigation and T10130 filed from a user request that same investigation
gated. Bug 54 is a QA test artifact (`[QA TEST - T9400 investigation, safe to ignore]`, reporter
imankh@gmail.com) - no task needed, safe to clear from the board directly. **User directive: bugs
before features** - this batch takes priority over the pending P2 UX tier noted in Current Focus
above; row order below IS the sequence, ranked by infrastructure depth per the task-management
skill's bug-prioritization rule (data durability first, then unreachable-but-intact data, then pure
UI).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

*Bug 46p: the NULL-description half shipped as [T7560](tasks/T7560-bug-report-null-description.md); the UI-confusion half (inert quest step + triple prompt) is [T7840](tasks/T7840-quest-step-actionable-empty-state.md) under Next Up.*

### Milestone TOP: Durable Sync — stop active prod data loss

Row order IS the sequence (2026-08-24): **2026-08-31 P0 insert (bug 47p investigation): T8160 + T8170 jump the queue - prod upload OUTAGE (every fresh upload fails since the ~2026-08-30 deploy; root cause reproduced: T7950's orphan reclaim aborts its own just-created multipart because R2 ListMultipartUploads returns different UploadId strings per call). T8180 (ghost annotate session) follows T8150.** Then **T8110** (inserted at the top 2026-08-31 by user order - admin panel test-account filter + whole-DB column sort), then the Upload Failure Integrity epic, then the drop-off-investigation P1 bugs (T7590/T7580/T7540/T7520 + outreach T7610 + smaller findings), then the activation follow-ups from the CapCut/best-practices review (user: liked, not priorities), then the admin-dashboard audit bugs (T7960/T7970/T7980/T7990/T8000 - user-ordered 2026-08-28, must ship with the current build, placed above JIT Migration). **2026-08-31 insert (user-approved): T8150 (P1 vanishing-game bug) + the First-Clip Funnel epic (T8120-T8140) sit directly after T8110 - the activation-cliff work from the ux-investigator prod investigation ([theory doc](ux/UX-annotate-first-clip-2026-08-31.md)); the Tutorial Redesign epic gained the binding Help-button directive the same day (see its EPIC.md).** Table must stay CONTIGUOUS - a non-table line between rows breaks the task board's parser and hides every row after it.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*Admin Auth Hardening epic (T8300, T8290) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*First-Clip Funnel epic (T8120, T8130, T8140) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7690 (share-back attribution audit) DECIDED 2026-09-03 — audit delivered, all 5 proposals approved, split into the [Share-Back Attribution epic](tasks/share-back-attribution/EPIC.md) (moved to its own milestone after Final Polish, below).*
*Tutorial Redesign (guided essential path: epic + T7620/T7630/T7640) and its four blocking prerequisites (T8390/T8400/T8370/T8380) moved AFTER the "Next Up" section — user order 2026-09-02: finish every Next Up task first. See the "Tutorial Redesign: guided essential path" section below Next Up.*
*JIT Migration epic (T5083, T5085, T5087) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7610 (stuck-user outreach) moved to the Milestone: Final Polish section (2026-09-01, user order); still WAITING ON USER on booking link + send timing.*
*Collection Download epic (T4945/T4946/T4947) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*T7190/T7200/T7210/T7220 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*The Upload Failure Integrity epic (T7480/T7470/T7490/T7500), T7360, T7820, T7510, T7590, T7580, T7540, T7520, T7530, T7550, T7560, T7570, and T7600 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md). T7580's "Create Reel" copy on the Overlay finish button was later reversed by T7700 per user request; the Focus/Export naming from T7580 stands elsewhere. T7600 shipped its idempotency fix; the orphan-audit + rank-pool-question items split off into [T7830](tasks/T7830-sweep-orphan-audit-rankpool-question.md).*

**UI Runway CLOSED 2026-08-17.** All near/mid-term UI-visible work landed first — including [T6630](tasks/player-intro/T6630-overlay-text-add-remove-drag-ux.md) (STAGING, merged 2026-08-08) — and the tutorial reshoot ([T5140](tasks/T5140-reshoot-tutorial-videos.md), archived to [PLAN-archive.md](PLAN-archive.md)) shipped in the 2026-08-17 prod deploy, closing the runway. NOT gated on the reshoot and still open on their own schedules: [T6500](tasks/T6500-overlay-font-catalogue.md) (pushed out 2026-08-09, polish-only), T5750 (evidence-gated), Multi-File Ingest & Prep (deprioritized 2026-07-31), Movement Tracking + Dual-Camera milestones (post-reshoot features — when one lands, the affected quest gets a touch-up reshoot, not a full redo), the UI Pass epic row (all children shipped; row open only for ledger reconciliation). **Exception (user-ordered 2026-08-10):** [T6350](tasks/T6350-move-reels-half-apply-on-sync-failure.md)/[T6345](tasks/T6345-postgres-migration-runner-skips-version-gaps.md)/[T6410](tasks/T6410-migration-swap-discards-unsynced-writes.md) were refactor/durability work with no visible UI change that landed BEFORE the reshoot rather than after — shipped in the 2026-08-13 prod deploy, archived to [PLAN-archive.md](PLAN-archive.md) (Milestone TOP section). [T6441](tasks/tile-video-preview/T6441-hover-preview-in-overlay-drafts.md) also moved ahead of T5140 (bundled into the same pre-reshoot session, small enough to not delay it) and is likewise archived. T6680/T6690/T6700 (all UI-visible) also gated the reshoot and are now archived (2026-08-13 prod deploy); T6710 (design-gated at the time) landed too — the Overlay quest's text-editor rail work (T6480/T6600/T6610/T6630/T6640) was on-screen in the current tutorial and has since landed too (archived, 2026-08-13 prod deploy).

**Now unblocked — the "after the reshoot" group is ready to start:** the **admin-dashboard audit bugs** (T7960/T7970/T7980/T7990/T8000, user-ordered 2026-08-28 — 4 correctness bugs found auditing the admin analytics panel against a screenshot, plus a scaling assessment for thousands of users; must ship with the current build) are FIRST. Then the [JIT Migration epic](tasks/jit-migration/EPIC.md) (T5081-T5089, user-ordered 2026-08-04; **re-affirmed 2026-08-28** — signups growing, the bulk sweep is outgrown; target: JIT live in the next deploy, that deploy's post-migrate is the LAST manual run, then delete the bulk machinery + applied migration files; rows now in the table above) — not a UI-runway member, placed immediately after the admin-audit bugs and ahead of Preview Video Improvements. [Collection Download](tasks/collection-download/EPIC.md) (above) is complete already. Relative order between JIT Migration and Preview Video Improvements not yet specified by the user. **T7140 (renumbered from T7020 2026-08-17, previously "first after the reshoot") was deprioritized out of this group entirely on 2026-09-01 by user order, then moved again on 2026-09-02 (user order) to the For Launch — Infrastructure section, next to T2580 (Faststart Upload Validation).** **The [SEO Content & Landing Value Props epic](tasks/seo-content/EPIC.md) is NOT part of this group** — per the Priority Policy (growth work sits behind infrastructure bugs) it is sequenced after Milestone TOP finishes entirely, not merely after the reshoot; see the SEO & Organic Discovery section below.

|  | **[Preview Video Improvements](tasks/preview-video-improvements/EPIC.md)** | 6 | 5 | 1.2 |  |  | Filed 2026-08-17, taking over the PLAN.md slot T7020 (unrelated task, renumbered to T7140) used to hold. **Merges the former Tile Video Preview epic** (design settled 2026-08-03; T6420/T6441 shipped and archived, T6440 carries forward unchanged below) rather than running two epics for one feature surface — see EPIC.md's merge note. Two user asks (2026-08-17): remove the hover-preview's artificial reveal delay, and give mobile a tap-to-select-plays-preview trigger, **replacing** T6430's never-built in-viewport-scroll-autoplay design (T6430 marked SUPERSEDED in place, not deleted). Not started. |
| T7160 | ↳ [Mobile: tap-to-select plays preview](tasks/preview-video-improvements/T7160-mobile-tap-select-plays-preview.md) | 7 | 5 | 1.4 | TODO | [ ] | Epic child 2/3, depends on T6420 + T7170. Supersedes T6430. First tap on an eligible tile selects it and starts its inline preview (reusing T6420's WARM/REVEAL machinery + single-active registry, triggered by tap instead of hover); second tap opens it. Neither tile type actually has this scheme today (ReelTile: single tap goes straight to full player; DraftTile: long-press reveals actions, modal preview not inline) — this is new design, not a wire-up. L-tier, Architect gate required; task file lists 4 open design questions including a real ReelTile tap-to-play-speed tradeoff to confirm with the user. |
| T6440 | ↳ [Autoplay-previews setting + data-saver](tasks/preview-video-improvements/T6440-autoplay-setting-data-saver.md) | 3 | 2 | 1.5 | TODO | [ ] | Epic child 3/3, depends on T6420 (+T7160 for touch, was T6430). Moved unchanged from the merged Tile Video Preview epic. "Autoplay previews" toggle (default ON) in the existing settings surface, persisted gesture-based - Netflix shipped without this and had to add it under user pressure. Data-saver guardrail for metered connections (sideline cellular is exactly this audience). |

### Upscale Quality

**Filed 2026-09-24 from a user request:** "The point is to get users intuitively making
highlights." Two epics. [Highlight-First Annotate Flow](tasks/highlight-first/EPIC.md): editing a
play requires a star rating, "Brilliant" becomes "Highlight", Done on a Highlight play offers Make
Highlight Now / Keep Annotating, Create clip / Frame CTAs leave Annotate, mode bar becomes Annotate
/ Frame Highlight / Add Spotlight gated on the selected play's clip. [Single-Clip Editor: remove
Reels and multi-clip editing](tasks/single-clip-editor/EPIC.md): Reels tab + Create reel deleted,
Framing/Spotlight become one-clip-only, ~4,000 production LOC removed; Reels returns later as a
post-publish stitcher ([T11300](tasks/T11300-reels-v2-post-publish-stitcher.md), thawed 2026-10-20,
sequenced after the Video Pre-Shrink milestone). **This reverses the 2026-09-13 vocabulary ruling** (Highlight as modifier only; mode noun
Framing) and changes screens the Tutorial Redesign core, T10320 and T9720 anchor to. **All 55
questions answered 2026-09-24** (decision artifact https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB;
rulings copied into each EPIC.md and task file). **Placement (R1, owner): part of the Deploy
Candidate, before the Tutorial Redesign core (T7620/T7630/T7640), T10320 and T9720**, which must
be re-derived against these screens. Table must stay CONTIGUOUS.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Upscale Quality](tasks/upscale-quality/EPIC.md)** | 9 | 7 | 1.3 |  |  | Testbed-proven upscale improvements for far-side action: quick wins → model A/B → temporal VSR → routed integration → (conditional) domain fine-tuning. |
| T4700 | ↳ [SR Quality Testbed](tasks/upscale-quality/T4700-sr-quality-testbed.md) | 8 | 5 | 1.6 | TODO | [ ] | Standalone eval harness at `src/backend/experiments/sr_testbed/`: fixed 10-12 clip set (far/mid/near, day/night, manifest-pinned crop keyframes), `Pipeline` plug-in interface, exact prod-replica + lanczos baselines, synthetic (PSNR/SSIM/LPIPS vs ground truth) + real (MUSIQ/NIQE + flicker ratio) tracks, blind-A/B HTML report with zoomed focus-box stills + jersey/face hallucination checklist, generic Modal GPU runner. Blocks the whole epic. |
| T4710 | ↳ [Encode + Denoise Quick Wins](tasks/upscale-quality/T4710-encode-denoise-quick-wins.md) | 6 | 2 | 3.0 | TODO | [ ] | Three cheap prod losses: final encode is CRF 23/fast while chunks are CRF 18 (last step = lowest quality — GPU detail thrown away at encode); Modal path missing bt709 color tags (local path sets them; some players render washed out); `dni_weight` denoise blend unused (`realesr-general-wdn-x4v3` companion model) while far crops are block-noise the GAN sharpens. Prove in testbed, then flip flags in video_processing.py + bake wdn weight into the image. |
| T4720 | ↳ [GAN Model A/B Evaluation](tasks/upscale-quality/T4720-gan-model-ab-evaluation.md) | 6 | 3 | 2.0 | TODO | [ ] | Measure (not estimate) RealESRGAN_x4plus / SwinIR-L GAN / Real-HAT vs the compact prod model on our clips, via `spandrel` auto-loading (sidesteps the dead arch-file backends in ai_upscaler). Full matrix on Modal T4 + L4 timing; recommendation table with LPIPS/MUSIQ/flicker/blind-win-%/s-per-frame/$-per-clip/VRAM. Eval only; "wait for VSR" is a valid verdict. |
| T4730 | ↳ [Temporal VSR Prototype (FlashVSR / SeedVR2)](tasks/upscale-quality/T4730-temporal-vsr-prototype.md) | 9 | 6 | 1.5 | TODO | [ ] | The ceiling-changer: one-step diffusion VSR fuses sub-pixel detail across frames — the only real fix for 30-80px far-side players. FlashVSR v1.1 primary (~17fps @ 768x1408 on A100, ~10x our current throughput), SeedVR2-3B secondary. Modal L40S, weights on a Volume. Hard gates: >=70% far-side blind wins, ZERO jersey/face hallucinations, <=$0.15 + <=3x wall-clock per 10s clip, license review. Go/no-go for T4740. |
| T4740 | ↳ [Production Integration + Crop-Size Routing](tasks/upscale-quality/T4740-production-integration-routing.md) | 8 | 5 | 1.6 | TODO | [ ] | BLOCKED by T4730 go. New Modal function (same progress-generator contract as process_clips_ai) + routing in modal_client: min-crop < FAR_SIDE_CROP_THRESHOLD (300) AND VSR_ENABLED → heavy pipeline on L40S; near-side stays on cheap T4 path. Loud deliberate fallback to standard pipeline on heavy failure (never a failed paid export); `[UPSCALE_COST]` telemetry; comparison endpoint gets the new option; staging-first. |
| T4750 | ↳ [Domain Fine-Tuning (conditional)](tasks/upscale-quality/T4750-domain-finetune.md) | 7 | 8 | 0.9 | TODO | [ ] | CONDITIONAL — only if T4730/T4740 leave a named gap. HR/LR dataset from OWN-account near-side footage (YOLO-harvested player crops; consent boundary is hard); Veo/Trace-matched synthetic degradation validated by blind-sort vs real far crops; fine-tune the shipped model (Real-ESRGAN recipe or VSR LoRA); same testbed gate — hallucination checklist especially (plausible wrong jersey numbers are worse than blur). |

### Playwright Suite Health

**Filed 2026-09-17 from the user's own staging run** plus a scan of every open row above Revenue
Record Integrity. Goal, in the user's words: "a tight plan to get this build out to users. Previous
versions struggled with ease of use and intuitiveness. This should be the version that lets users
fulfil on the promises they signed up for without getting lost." Rule for membership: **kill bugs
and finalize the streamlined UI**; features that are not part of that story stay out (T10180,
T7160/T6440, Universal Upload leftovers T8838/T8872/T8892 are NOT in, pending the user's word).
Everything already at STAGING ships with this candidate automatically and is not re-listed.

**Row order IS the sequence** (user rulings 2026-09-17 applied): (1) crash + upload bugs, (2) the
pricing single-source refactor (merged) and the landing overclaim, (3) UI finalization, (4) the
Tutorial Redesign core (epic row + its three children; the leftover half is T10330 in the "Guided Mode: next
iteration" section) - **user order: not before every
other task in this milestone is implemented AND the UI approved, because guided mode anchors to the
final screens**, (5) the tutorial videos, shot after guided mode ships so they show the real UI, (6)
the release gate. **The 12.99/22.99/32.99 reprice (T10220) is deliberately AFTER this build** (user
ruling 2026-09-17; reading B, credits get cheaper) - see the "After the Deploy Candidate" table right
below. Nothing here is code work for the AI until the user assigns it: this milestone was prepared as
a consolidated plan (user instruction 2026-09-17). **Prod read-only check 2026-09-17** (backing
T10270): `daily_counters` since the 2026-09-13 deploy shows 13 game uploads succeeded / 0 recorded
failures (2026-09-14: 8, 2026-09-16 and 17: 0), zero `*_upload_failed` rows in `user_actions`, and
no bug reports after #57 (2026-09-13, already triaged) - but the audit in T10270 shows whole failure
classes (clip batch endpoint, pre-prepare client deaths, credits-after-prepare) record nothing, so
"0 recorded" is not "0". T10190 and T8872 were considered and left OUT (user ruling). Table must stay
CONTIGUOUS.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T10640 | [Fix stale "Export" locator in T4880 mobile reachability spec](tasks/T10640-fix-t4880-export-locator.md) | 3 | 1 | 3.0 | TODO | [ ] | Discovered 2026-09-19 verifying T10630: the Framing CTA's name changed to "Generate Framing" (N19) but the spec still looks for "Export", so it stalls to its full 3-minute timeout instead of failing fast. Not a CI blocker (spec isn't in branch-ci.yml) but wastes local verification time on every Focus/Overlay task. One-line locator fix. |

#### After the Deploy Candidate (user-ordered 2026-09-17)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone: Play Editor Autosave + mobile trim layout (user-ordered 2026-09-19)

**Filed 2026-09-19 from the mobile trim audit** (decision artifact https://claude.ai/artifact/2oxojEQTrAhJhfG23UmJus: live 393x852 reproduction of the Edit/Mark Play sheet hiding the video, and the Focus export bar wrapping its captions one word per line, with the ui-designer's option ledger). User ruling: "get rid of the update button" — the play editor stops being a submit-form; every control persists on its own gesture (the SURGICAL pattern CLAUDE.md endorses and `ClipDetailsEditor` already uses; reactive `useEffect` persistence stays banned). First task is the Architect design gate, the rest are UX. **Strict order T10600 -> T10610 -> T10620** (shared files: `AnnotateFullscreenOverlay.jsx`, `AnnotateModeView.jsx`, `AnnotateContainer.jsx`); T10630 is file-disjoint and may run in parallel. Placement relative to the Deploy Candidate is the user's call — it is UI finalization of the Annotate editor, the same story as T10290/T10310 above. Table must stay CONTIGUOUS.

*Play Editor Autosave + mobile trim layout epic (T10600, T10610, T10620, T10630) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Focus Result Loop (user-ordered 2026-09-19)

**Filed 2026-09-19 from the user's own session.** Two halves of one complaint about what happens
AFTER a framing render: the app forgets the video it just made you, and the one action that says
"no spotlight" walks you through the Spotlight editor anyway. Both are Focus-side only, frontend
only, no schema. **Strict order T10650 -> T10660** (shared file `src/frontend/src/screens/FocusScreen.jsx`,
so they cannot run in parallel). T10650 carries the user's two design rulings (D1/D2 in the task
file); T10660 carries the verified root cause and supersedes T9740's readiness-poll mechanism.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Clip Ready Screen (user-ordered 2026-09-19)

**Filed 2026-09-19 from the user's own post-export screenshot** (epic: [tasks/clip-ready-screen/EPIC.md](tasks/clip-ready-screen/EPIC.md);
decision artifact https://claude.ai/artifact/9w4SKRvSbdNzMLpwFxNWKF, approved same day, variant V2 +
video-controls option 3; full spec with per-state Tailwind strings in `tasks/clip-ready-screen/design-proposal.md`).
Three complaints: no play/pause or fullscreen on the finished video; the "saved to your drafts" line +
"Save draft" link + its caption are redundant and confusing; the three real choices "don't look fun".
Follow-up ruling: the published-reel player gets the same controls. Frontend only, no schema. **The two
tasks are file-disjoint and may run in parallel**; neither touches `FocusScreen.jsx`/`OverlayScreen.jsx`,
so both are clear of T10650/T10660. Design gate already satisfied (user approval), Reviewer required on both.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Rating Unset State (user-ordered 2026-09-19)

**Filed 2026-09-19 from a screenshot-driven question about the Annotate rated badge.** T10610
(merged same day) made the rated badge unconditionally green, since create-at-tap now seeds every
play with a real default rating (`NEW_PLAY_DEFAULT_RATING = 4`). User saw this, was told it
reverses a decision made hours earlier, and ruled explicitly for a true null rating over a
session-only "touched" flag: a play can have NO rating on record until the user picks one, which
needs a schema change (`raw_clips.rating` currently `NOT NULL`). Design approved 2026-09-19 (recommended
option taken on every open question except the TSV round-trip fix, deferred). **Strict order
T10700 -> T10710** (T10710 stops the frontend from seeding a default rating, which 500s every
Mark-play tap until T10700's migration is live on staging).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Mobile Annotate timeline zoom (user-ordered 2026-09-20)

**Filed 2026-09-20 from a staging phone screenshot.** The Annotate plays track renders a full game across ~280 px on a phone, so plays collapse into an unreadable green smear. `TimelineBase` already has zoom, scroll sync and a touch `MobileScrollbar`; Annotate just pins `timelineScale={1}`. Mockup artifact: https://claude.ai/artifact/JorjZij5XGKnYQMr6myHri. File-disjoint from T10760/T10770. T10800 (player letterbox) was found on the T10780 phone test and is file-disjoint from it.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone: Focus on a landscape phone (user-ordered 2026-09-21)

**Filed 2026-09-21 from the user's own staging screenshot** (epic: [tasks/focus-landscape/EPIC.md](tasks/focus-landscape/EPIC.md); design approved same day, [design doc](tasks/focus-landscape/T10840-design.md); mockup artifact https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx, 6 artboards incl. an interactive cockpit). A phone held sideways gets `sm:` tablet CSS driven by JS that says phone: the crop box is scrolled off the top, a 224 px clip rail shows one row and a disabled `Transition:` control, the action band takes 27% of the viewport for a credit-rounding sentence, and ~900 px of content stacks into a **812 x 334** viewport (measured: 77 px of height and 79 px of width go to system chrome before our first pixel). `useIsLandscape()` has existed since Annotate and Focus never read it. Fix is a distinct cockpit layout entered automatically on rotation, plus a hint on each side of the flip. Frontend only, no schema. **Strict order T10830 -> T10840 -> T10850** (all three touch `modes/FocusModeView.jsx`). 16 settled decisions D1-D16 in the design doc; D1/D2/D3/D6/D7/D10-D14 summarized in EPIC.md.

*Focus on a landscape phone epic (T10830, T10840, T10850) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Hotfix (user-reported live 2026-09-19 / 2026-09-20)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Admin panel correctness (user-reported live 2026-09-22)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

## Single-Server Priority (2026-07-18; durability re-escalated 2026-07-24)

The stack is currently ONE server. **Correction (2026-07-24): the durability epic is NOT safely
deferred to multi-server.** It was parked on the belief that its failure needs two live machines,
but arshia lost a 400-credit grant AND 5 published reels on the *single-server* stack — via deploy
machine-replacement (a local-only write dies when the machine is swapped) and R2-error stale
force-push (a writer builds on a stale local copy and overwrites newer cloud state). So the
*silent-data-loss* half of the old epic is now the **TOP** milestone below (the deeper
two-machines-both-live race in T4310 is still partly multi-server, but its single-server face is
real and included). The lower-priority format/concurrency tasks split out to the
[Write Correctness epic](tasks/write-correctness/EPIC.md).

### Milestone A: Do Now — user-reported single-server bugs (no blockers)

The class that has twice destroyed real prod data (arshia's profiles 2026-07-17; his credits + 5
reels 2026-07-24). Point-fixes already landed (branch `fix/admin-credit-grant-r2-sync`:
grantee-DB sync, `TrackedConnection` owner tracking, move_reels `require_fresh`, + the 5 reels
recovered); these tasks are the general guarantees behind those point-fixes.

**Moved ahead of the tutorial reshoot (user-ordered 2026-08-10):** [T6350](tasks/T6350-move-reels-half-apply-on-sync-failure.md), [T6345](tasks/T6345-postgres-migration-runner-skips-version-gaps.md), and [T6410](tasks/T6410-migration-swap-discards-unsynced-writes.md) shipped in the 2026-08-13 prod deploy — archived to [PLAN-archive.md](PLAN-archive.md) (Milestone TOP section). None were UI-visible, but the user chose to land them before the reshoot rather than after.

*T6530 (intro card discoverability UX, DECIDED - split into T6660/T6670/T6680/T6690) moved to the Milestone: Final Polish section (2026-09-01, user order).*

*T6780 and T6770 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Milestone 0: Tooling first — make the staging gate trustworthy (DONE)

Do this before the feature bugs: right now "is staging green?" can't be answered by one run, so
every derisk is manual. Fixing it de-risks all the rest.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### SEO & Organic Discovery

Standalone, immediately actionable — no epic prerequisites.

*Cross-Profile Game Attribution epic (bug 37p; sole child T5830) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Investor-Grade Analytics](tasks/investor-analytics/EPIC.md)** | 8 | 5 | 1.6 |  |  | Filed 2026-08-20 from the user's investor-readiness requirements (2.1 instrument the full funnel visit→signup→upload→tag→export→share→repeat; 2.2 activation = first shared reel ≤14d with drop-off localization; 2.3 seasonality-adjusted cohort retention curves that visibly flatten, clip-library as the structural retention asset; 2.4 attributed MoM organic growth). Four binding user directives (2026-08-20): in-house only (no external analytics tools — subscriptions + privacy), keep it light (extend the existing `record_milestone`→`user_actions`/`daily_counters` system), aggregates only (counts + first/latest timestamps, never per-event rows in shared stores), and NO new Postgres data (new state lives in flat `analytics.sqlite`, drip.sqlite precedent). The survey found the system further along than assumed — `user_actions.first_at` already supports activation math and `user_usage_daily` (v022) is already the per-user retention spine — so the epic is mostly REPORTS over existing PG (read-only) plus two light additions: an admin-triggered rollup sweeping per-user `user_action_log` into aggregate cohort×action×week rows, and a first-party cookie-free visit beacon for the invisible top of funnel. Research brief (a16z/Sequoia/Lenny benchmarks, seasonality practice) embedded in EPIC.md. T7420 is pure-read and can start immediately; T7400→T7410 unlock the rest. |
| T7400 | ↳ [analytics.sqlite store + on-demand cohort rollup sweep](tasks/investor-analytics/T7400-analytics-sqlite-rollup.md) | 8 | 5 | 1.6 | TODO | [ ] | Epic 1/6. Flat `analytics.sqlite` (env-prefixed R2 key, single-writer, etag-asserted upload — drip.sqlite precedent; NOT in the 3 migration tracks, no _SCHEMA_DDL change) + admin-triggered sweep reducing each user's existing `user_action_log` to `rollup_action_weekly(cohort_week, action, week_index, distinct_users)` — aggregate rows only, raw events never leave the per-user DBs. Full-rebuild idempotent reruns; failed user DBs counted loudly, never silently skipped. Unlocks action-level cohort retention (T7430) without a PG event table. |
| T7410 | ↳ [First-party visit beacon (landing + app, aggregate-only)](tasks/investor-analytics/T7410-first-party-visit-beacon.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 2/6, depends on T7400's store module. The funnel's first stage (visit→signup) is invisible today: the landing emits nothing and the CF/zaraz sink is inert without its token. Tiny cookie-free beacon on landing + app pre-auth + share pages → unauthenticated buffered `POST /api/t` → `visit_daily(day, source, page_class)` counts in analytics.sqlite. Source buckets mirror `_determine_origin` priority (invite > referral > click-ID social > seo > direct) in ONE shared constant. No cookies/IDs/IP stored — quotable on the kids-privacy page. Supersedes T3000. |
| T7420 | ↳ [Activation & funnel drop-off report](tasks/investor-analytics/T7420-activation-funnel-report.md) | 8 | 2 | 4.0 | TODO | [ ] | SCOPE SHRUNK 2026-10-30 (user-approved): per-cohort activation rate (export_completed <=14d primary, share_completed <=14d value-moment), maturing label, benchmarks beside actuals, CSV. The stall distribution and inter-stage medians moved to T14020's step inspector so one ladder has one implementation. Original: Epic 3/6, ZERO dependencies — pure read of existing PG (`user_actions.first_at` + `user_segments.acquired_at`), can start immediately. Per monthly cohort: activation rate (share_completed ≤14d; secondary export_completed ≤7d), stage conversion + median inter-stage days (upload→tag→export→share), and non-activated users' furthest-stage stall distribution — the "where exactly are the drop-offs" number. Maturing (<14d) cohorts labeled, never blended. Benchmarks printed beside actuals (30% median / 50%+ great). CSV export. |
| T7430 | ↳ [Retention curves & triangle, seasonality-adjusted](tasks/investor-analytics/T7430-retention-cohort-curves.md) | 9 | 4 | 2.3 | TODO | [ ] | Epic 4/6. THE investor chart ("show me your cohort retention"). Weekly triangle + overlaid retention curves from the EXISTING `user_usage_daily` spine — classic AND unbounded/activity-based toggles (unbounded is the headline for a seasonal product), day-30/60/90 columns, WAU + WAU/MAU series (never DAU/MAU). Seasonality derived from data only (owner rule 2026-11-03: never assume seasons, they differ per sport and league): low-volume weeks detected from measured activity per arrival sport and shaded, return-after-gap rate (active again 120+ days later) as the long-horizon headline, no season calendar constants, coverage-start marker (usage data begins at v022's deploy). Action-level toggle (export habit, clip-library usage) reads T7400's rollup. Small-N cells render raw fractions, not misleading %s. |
| T7440 | ↳ [Organic growth & attribution report + investor export](tasks/investor-analytics/T7440-organic-growth-report.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic 5/6. Assembles existing attribution (`user_segments.origin`/utm, `referrals`, share-origin) into the narrative: MoM signups by source bucket (organic/community/referral/social/partnerships/paid + an explicit unattributed bucket — never silently folded into organic), organic-only growth rate, YoY where data allows, referral loop share→view→signup + K-factor estimate with dark-social caveat, visit→signup conversion once T7410 lands, explicit ~$0 paid-spend line. Absolute counts printed next to every %. CSV + print-clean — this report IS the hand-to-investor artifact. |
| T7450 | ↳ [Flow-event coverage: clip-library & repeat-usage signals](tasks/investor-analytics/T7450-compounding-value-event-coverage.md) | 5 | 2 | 2.5 | TODO | [ ] | Epic 6/7, independent + small. Requirement 2.3's structural-retention asset (collections/season library) has no FLOW_EVENTS coverage. Add `collection_viewed` / `ranking_vote_cast` / `collection_shared` (confirm against real endpoints; verify nothing double-counts) through the existing `record_milestone` path — server-side, gesture-traceable, `daily_col: None` so PG daily_counters untouched; rows land only in the existing `user_actions` upsert + per-user `user_action_log`, which T7400's rollup then surfaces in T7430's clip-library retention view. T3570 stays standalone. |
| T7455 | ↳ [Editor-open event coverage: per-open Focus/Overlay/Annotate entries with clip context](tasks/investor-analytics/T7455-editor-open-event-coverage.md) | 6 | 3 | 2.0 | TODO | [ ] | Filed 2026-08-27 from the user's "which users opened a clip in Focus/Overlay" audit. `framing_opened`/`overlay_opened` fire only via the quest achievement bridge: once per page-load session (questStore dedup Set), EMPTY context (quests.py:472 passes `{}`), so per-open counts and "which clip" are unanswerable. Fix: fire `record_milestone` from the real open gesture per open with `{project_id, clip_id}` context, drop the two keys from ACHIEVEMENT_TO_MILESTONE (no double-count; quest steps untouched); add `annotate_opened` (new — nothing fires between upload and clip_created) and add `overlay_opened` to FUNNEL_STEPS + admin FunnelChart (both currently missing it). All `daily_col: None`, existing `user_actions` upsert + `user_action_log` only — zero new PG state. |
| T7465 | ↳ [Journey Flow graph replaces the admin bar funnel](tasks/investor-analytics/T7465-journey-flow-graph.md) | 7 | 4 | 1.8 | SUPERSEDED | [ ] | SUPERSEDED 2026-10-30 (user-approved) by T14010 in the Admin journey drop-off milestone; design in [admin-journey-dropoff-design-2026-10-30.md](admin-journey-dropoff-design-2026-10-30.md). The Sankey direction and the `EVENT_INSTRUMENTED_AT` idea carry over; the fold changes to ladder order with a three-way drop split. Original: Filed 2026-09-02 (user request, direction approved via design mock). Replace the admin FunnelChart (independent ever-did-X counts producing 322%/500% neighbor ratios) with a Sankey-style journey graph: nodes = stages, ribbon width = users whose next first-touch step after A was B, gray peel-offs = journeys ending there; counts conserved by construction. Pure read of existing `user_actions.first_at` + `user_segments.acquired_at` (zero new events, zero PG state, no migration) folded per user with canonical-order tiebreak; new read-only `/api/admin/analytics/journey` (origin/date/exclude-test filters + compact/full node sets) + hand-rolled SVG `JourneyFlowChart.jsx` (no chart lib). Late-instrumented events (T7890 et al) badged `partial` via an `EVENT_INSTRUMENTED_AT` registry, never silently thin. v1 = first journeys (labeled); repeat-transition fidelity deferred to a T7400-rollup aggregate table if ever needed. Coordinates with T7455 (`annotate_opened` becomes a node once it exists). Design in task file + mock artifact. |
| T7460 | ↳ [Success-criteria scorecard (goal vs actual, green/yellow/red)](tasks/investor-analytics/T7460-success-criteria-scorecard.md) | 8 | 4 | 2.0 | TODO | [ ] | Epic 7/7, capstone (goes last — composes the query functions T7420/T7430/T7440/T7400 build). User-defined success criteria (2026-08-20) in their own admin dashboard: 6 cards, each goal + current number + RAG chip. Targets: 1,000 WAU by month 6 (stretch 2,000, 4-wk trailing, WoW ~10% outside detected low-volume weeks); signups +15% MoM >=90% organic; activation 40%+ export<=14d (PRIMARY metric per these criteria — share<=14d stays tracked as the value-moment) + biggest drop-off shrinking MoM; 30%+ of activated active at D30 + 50%+ WoW return outside low-volume weeks; WAU/MAU>=40% outside low-volume weeks + median 2+ exports/mo (via T7400's rollup_engagement_monthly distribution summaries — per-user rows never stored); 25%+ signups via shared links/referrals. Goals = named constants in success_criteria.py (no DB, no editor); data-derived low-volume weeks render grey "paused" never false red (no season calendar); small-N suppresses to "insufficient data". TARGET_DATE default 2027-02-28 (month 6 from filing — user to confirm). |
| T7467 | ↳ [Deploy-comparison view (segment any metric by deploy, before vs after)](tasks/investor-analytics/T7467-deploy-comparison-view.md) | 7 | 5 | 1.4 | TODO | [ ] | Filed 2026-09-02, prompted by a manual investigation (curl /api/version + git show + hand-written Postgres query) needed just to answer "upload success rate since the last deploy." Adds a `deploys` log table (deployed_at, commit_sha, build_number, env) to T7400's analytics.sqlite, appended automatically by `scripts/deploy_production.sh` right after its backend health-check verify; a `since_deploy` param on the existing report endpoints (pulse card's `upload_success_rate` + at least one of T7420/T7430/T7440) resolving to a before/after pair via the deploy log; and an admin-UI deploy picker rendering each as absolute counts + delta%, small-N suppressed per T7460's honesty convention. Day-granularity is the disclosed ceiling — `daily_counters`/`user_actions` have no per-event timestamp centrally, so a deploy's exact instant can't be sliced more finely; stated in the UI, not solved. Zero new Postgres state (deploys table lives in analytics.sqlite alongside T7400's rollups). Depends on T7400; sequenced after T7460 and T7465 since it layers onto the same report endpoints/components those are actively shaping. |
|  | **[SEO Content & Landing Value Props](tasks/seo-content/EPIC.md)** | 7 | 4 | 1.8 |  |  | Filed 2026-08-16. Sequenced after Milestone TOP (the Durable Sync campaign) completes — growth work sits behind open infrastructure bugs per the Priority Policy; not a member of the post-reshoot queue (T7020/JIT Migration/Collection Download) even though it also follows the reshoot chronologically. Sell everything the product does (feature-inventory audit) + give thin content coverage its missing pages. T7110 → T7120 strict order. Owner gates in [seo-owner-checklist.md](../marketing/seo-owner-checklist.md). T6370 stays a standalone sibling (indexing/GSC side). |
| T7110 | ↳ [Landing homepage — sell all four value stories (copy overhaul)](tasks/seo-content/T7110-landing-value-props.md) | 7 | 3 | 2.3 | TODO | [ ] | Epic child 1/2. Filed 2026-08-16 from the marketing proposal built on [feature-inventory.md](../marketing/feature-inventory.md). Homepage sells only "editing grind removed"; the share→claim loop, kids'-privacy stance, season-builds-itself story, and half the broadcast-package stack (slow-mo, intro cards, text overlays) are absent or undersold, and two live claims overrun the inventory ("generate reels from simple queries"; "auto-frames to follow your player"). 8 changes C1–C8 with final copy embedded in the task file: hero subhead, Elevate rewrite, new share-loop + season sections, reusable TrustStrip component, Celebrate tonight-payoff line, accuracy fixes, 3 FAQs + FACTS entries (privacySummary, pricingPerSecond). src/landing only; merge gate = user copy approval (master push auto-deploys the site). |
| T7120 | ↳ [SEO content expansion — comparisons, use-case & privacy pages, guide bodies](tasks/seo-content/T7120-seo-content-expansion.md) | 6 | 5 | 1.2 | TODO | [ ] | Epic child 2/2. Depends on T7110 (TrustStrip, FACTS, link targets). Content-side complement to T6370's indexing diagnosis (thin/duplicative pages): Phase A adds /vs/hudl, /vs/veo, /vs/trace, /vs/imovie with the honest they're-cameras-we're-the-editor framing + works-with cross-links; Phase B adds /share-team-highlights (the loop's citable deep page) and /kids-privacy (the page an AI engine quotes for "is it safe for kids"); Phase C reuses TrustStrip + privacy FAQs across for-parents/recruiting/sport pages (raises per-page unique text — feeds T6370 Part C); Phase D writes bodies for the five guide outlines in data/guides.ts — GATED on owner outline approval per [seo-owner-checklist.md](../marketing/seo-owner-checklist.md); Phase E (optional) VideoObject schema builder. App-subdomain robots/soft-404 work stays in T6370 — not duplicated here. |
| T12600 | [dotask headless auto-continue: NEEDS_USER relay, blocker classification, outcome ledger](tasks/T12600-dotask-headless-auto-continue-ledger.md) | 7 | 5 | 1.4 | TODO | [ ] | Tooling. Removes the manual clear+resend between dotask tasks and measures how often a task needs the user (and why), which decides headless vs supervisor. Tracer run 2026-10-12 (branch feature/dotask-tracer-ext, REPORT.md) ruled out GUI automation: the Claude panel can be prefilled but never submitted; the terminal route works but first-run screens block it invisibly. Headless claude -p answered in 2.4 s on the Max login. Extends HEADLESS_LOOP/task.sh drive: deterministic commit-line trigger, worker-tagged NEEDS_USER questions answered via drive --resume, classified blockers (no auto re-auth), per-dispatch outcome ledger. Likely L, design gate on taxonomy + ledger schema. |
| T10350 | [Upload/app log drain to R2 (D2 follow-up to T10270)](tasks/T10350-upload-log-drain-to-r2.md) | 3 | 4 | 0.8 | TODO | [ ] | T10270 shipped D1 (durable Postgres record) only, per its own design's D1/D2 split. D2 is a raw Fly log drain (Vector -> R2, TTL'd) so `[UPLOAD_FAILURE]`/`[UPLOAD_BEACON]` lines survive past Fly's retention window. Infra work, no app code. Not urgent - D1 already answers the acceptance criteria on its own. |
| T10540 | [Game poster/thumbnail races the first clip save, caches the wrong frame forever](tasks/T10540-game-poster-stale-vs-first-clip-race.md) | 4 | 4 | 1.0 | TODO | [ ] | Found live while testing T10520/T10530 (unrelated): a freshly uploaded game's thumbnail never reflected the play marked+saved during upload — it stayed on a visibly different framing. `Explore`-agent investigation (medium-high confidence, not yet log-confirmed): `poster.py`'s `_choose_game_poster_frame` falls back to a fixed `GAME_POSTER_FALLBACK_OFFSET_SEC=60.0` frame when a game has zero `raw_clips` yet; the activation handler fires `warm_game_source_poster_background` essentially immediately on upload-complete, almost certainly before the user's multi-step mark/rate/save flow lands a clip. `ensure_game_source_poster` cache-checks R2 first with **no re-generation and no invalidation hook anywhere** on `raw_clips` insert/rating (unlike reel drafts' `invalidate_draft_poster`, which has no game-poster analog) — so the fallback frame sticks forever once cached. `list_games`'s `warm_visible_game_sources` reproduces the same race independently on every Games-tab load. Suggested fix direction: invalidate + re-warm the cached poster key at the first-clip-save write path; needs an Architect/expert pass first (touches a shared R2-cached asset with two independent fire-and-forget warmers) — not yet designed or implemented. |
| T10990 | [Big lag on the first Portrait/Landscape switch of a Focus session](tasks/T10990-focus-first-aspect-switch-lag.md) | 4 | 3 | 1.3 | TODO | [ ] | User report 2026-09-21 (prod). Investigated with T10980: the gesture is 3 sequential round trips (~100 ms in dev), nothing first-time-only on the frontend; the only first-write-only server path is the `.sync_pending` retry in `db_sync.py`. Prod log buffer was too short to inspect the report window. Re-test after T10980 (the pre-fix selector made the first click a no-op), then capture request timings on staging. |
*T7290/T7320/T7330/T7340/T7350/T7370/T7380/T7390 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*


### Parent Walkthrough Remediation (2026-09-09 handoff)

**Filed 2026-09-10** from an external first-time-parent walkthrough of **staging** run 2026-09-09/10
(`reel-ballers-staging.pages.dev`, desktop Codex in-app browser), plus Andrew's supplied feedback and
screenshots. Archive:
`C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md` + `01-bugs.html` B1-B11 + `04-ux-change-specifications.html` UX-01..18 +
`03-naming-consistency.html` N01-N47). The run was against **current** staging, so these are live
findings, not stale ones. No source-code or network diagnosis was performed by the reporter: every
item is an observation, and the mechanism is ours to establish.

**Row order is execution order, user-chosen 2026-09-10: bugs, then naming, then UX restructuring.**
T9400 leads because a broken "Report a problem" is the channel every other bug arrives through.

**Four decisions taken at filing (each stated with its conflict, then chosen anyway):**

1. **Adopt the full report naming model** (Shared Vocabulary epic), with two binding overrides: mode
   names stay **AI Focus** / **Spotlight** (T9320, shipped 2026-09-09; N16/N18 overridden), and
   statuses are **not** re-modelled (T8470's Draft/Shared stands; N22 overridden). The model
   deliberately reverses T8130 (Add Play), T8760 (Clip Out Play) and part of T8555 ("In Progress"
   tab prefixes) - recorded as decisions, not drift.
2. **Re-hierarchize the post-Focus action bar** (T9590). This reverses T8390's flat four-action bar
   and the product owner's 2026-09-08 "Publish Now"/"Add Spotlight Now" pairing, and moves T9110's
   Overlay bar with it so the two stay consistent.
3. **Keep Draft/Shared statuses**; T9600 only removes the contradictory extra labels found on one card.
4. **File all seven decision and verification tasks** (T9670-T9730) rather than relying on the tier
   policy and the staging gate.

**Deduped out before filing** (already shipped or in flight; verify on staging before implementing
anything that touches them): the "Step N of M" copy and the AI Focus/Spotlight renames (T9320), the
four home-tab guidance screens (T9390), direct clip upload and its entry point (T8370/T8380),
video-first upload with optional metadata (T8700/T8500), cost disclosure before file selection
(T8500), and the draft-preview modal consolidation (T8535). Several tasks below are expected to
shrink once re-verified; that is a good outcome and should be recorded, not implemented around.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

*T9720 (release gate) and T9730 (traceability sign-off) moved to the Deploy Candidate milestone (2026-09-17) - they close that milestone.*

### First Reel Funnel (walkthrough remediation)

**User-ordered 2026-09-03.** Walkthrough remediation: a fresh account must reach a shared reel
with zero dead ends. Source: the 2026-09-02 first-time-parent staging walkthrough + UX designer
expert review ([artifact](https://claude.ai/code/artifact/79e0afa6-666f-44ea-9e42-7c39939e3e2e)),
decisions in [EPIC.md](tasks/first-reel-funnel/EPIC.md).

*All 15 children are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Clip Upload & Reel Completion (split out of Tutorial Redesign, user order 2026-09-04)

**User question 2026-09-04: why was T8370 filed under "Tutorial Redesign" when it isn't
tutorial-building work?** Correct catch — T8390/T8400/T8370/T8380 were filed FROM the
T7620 guided-tour design round only because the guided tour needs them live to anchor its
steps to; each is independently justified in its own task file as a real product fix
("standalone... a product win on its own" for T8390/T8400; T8370 closes a real observed
failure — pre-cut clips uploaded as nonsense "games", credits burned for nothing). Split
into this standalone epic so it competes and reads on its own merits, sequenced BEFORE
Tutorial Redesign (the dependency always ran this direction — T7630/T7640 were blocked ON
these, never the reverse, so nothing about the work itself changes). Row order = the
existing dependency order from T7620-design.md 18.3: R3, R4 -> T8370 -> T8380.

**Next Up's gate is now moot for this epic.** The old Tutorial-Redesign gate text required
every UI-visible Next Up task to "ship" first — checked 2026-09-04, and T8200/T8210/T8220/
T8230/T8240/T8260/T8270/T8280/T8310/T8320/T8330 are ALL already STAGING (merged, deployed
to staging, awaiting user promotion to DONE). That prerequisite is satisfied; it no longer
blocks anything here or in Tutorial Redesign itself.

**Pre-flight note for T8390/T8400 (added 2026-09-04):** both were filed 2026-09-02, before
T8520/T8530/T8540 shipped (merged 2026-09-04). T8530's shared `usePublishProject` hook +
draft preview player and T8540's Share-primary player action may have already
substantially or fully satisfied "Focus gets a publish exit" and "publish lands on the
reel with share at hand" — re-verify against the CURRENT shipped code before implementing
either (same pattern as the T8490-vs-T8600 pre-flight check earlier this session). A task
that turns out to already be satisfied gets closed with a note recording why, not
implemented redundantly. See the pre-flight note appended to each task file.

**File-ownership note (UPDATED 2026-09-04):** T8380 and T8400 both touch
`ProjectManager.jsx` and the published-reels surface — now **`PublishedReelsPanel.jsx`**
(renamed from DownloadsPanel by **T8555, which SHIPPED**, replacing T8545's three-tab
redesign with the four-tab IA: Games / In Progress Clips / In Progress Reels / Published).
**The landing surface has LANDED — no wait remains** for either task; they build directly
against the shipped four-tab structure. T8390 (Focus publish exit) and T8370 (pre-cut clip
upload) also SHIPPED tonight.

*Both gaps closed — T8390 (Focus publish exit), T8400 (publish lands on the reel), T8370 (pre-cut
clip upload) and T8380 (Clips-screen Add Video entry) are all DONE, rows archived to
[PLAN-archive.md](PLAN-archive.md). This epic never had its own child task files (see task
descriptions for how each satisfies this epic's two stated gaps).*

### Milestone: Universal Upload & Angles (user-ordered 2026-09-05, before Tutorial Redesign)

**Filed 2026-09-05 from the approved concept** (decision artifact with mockups + real-footage
analysis: https://claude.ai/code/artifact/3a4411ea-3034-4235-a6fe-078f73b61e9b). One universal
intake replaces Per Game / Per Half (any files or a whole camera folder, auto-ordered from
embedded recording times with filename fallback), an optional client-side shrink (crop-to-field
+ re-encode via WebCodecs; a 50 GB 8K DJI game becomes a 3-12 GB upload), and overlapping
sideline phone clips become switchable "angles" in Annotate (derived minimal lanes, violet UI,
Fix-timing nudge), plus Add footage from inside Annotate. Settled design decisions live in
[EPIC.md](tasks/universal-upload/EPIC.md); row order is the strict dependency order. T8830 is a
go/no-go spike gating T8840-T8860; a NO-GO sends the shrink tasks back to the user for re-scope.
**Shrink integration moved (2026-09-08):** T8845/T8850/T8860 now live in the
[Video Pre-Shrink milestone](#milestone-video-pre-shrink) (Pre-Shrink Integration epic),
sequenced after a Pre-Shrink Research epic that finishes the open shrink research first.
Tutorial note: T7640's screenshot matrix runs AFTER this milestone lands or the guided tour will
anchor to the deleted Per Game / Per Half toggle - reconcile at T7640 time.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

*T8836 (survey, DONE 2026-09-17 - user confirmed T9070, deferred T9080) — row archived to
[PLAN-archive.md](PLAN-archive.md). T8840 (standalone shrink tool) relocated to the Video
Pre-Shrink milestone below — user direction 2026-09-17: the whole shrink-tool track is deferred
until after Tutorial Redesign, so it now sits with the rest of that work instead of here.*

### Milestone: Publish Load Performance (user-ordered 2026-09-08, before Tutorial Redesign)

**Filed 2026-09-08 from `published.har` analysis** (41 requests, waterfall + findings:
https://claude.ai/code/artifact/25370533-d3ce-4381-8d31-66feedac679c). The Publish screen sits
blank ~4.9s after mount — NOT video weight (zero `.mp4` bytes in the capture). Seven unrelated
endpoints (`admin/me`, `health`, `rank/confidence`×2, `collections/summary`, `intro-cards`,
`bootstrap`) resolve in near-perfect lockstep 3.6s after firing, then four more repeat the
pattern for ~0.9s — the documented **T6200 blocking-event-loop signature** (`app/utils/offload.py`),
not yet root-caused for this specific burst. Two things the user asked about were checked and are
**already correct, no task filed**: `+faststart`/moov-to-front is universal across every encoder
and enforced pre-upload (`storage.py` `FaststartCheck`), and preview video already loads
poster-first + hover-only (`TilePreviewVideo.jsx`, zero video bytes at mount confirms it). Full
findings in [EPIC.md](tasks/publish-load-performance/EPIC.md).

*Publish Load Performance epic (T9120, T9130, T9135, T9140) is complete — rows archived to
[PLAN-archive.md](PLAN-archive.md). T9120's row was found stuck at WAITING ON USER despite every
downstream child already DONE — corrected 2026-09-17.*

### Guided Mode: next iteration (Tutorial Redesign epic, the half that does not ship in the Deploy Candidate)

**Renamed and split 2026-09-17** (user: "re-name the latter and make sure the tasks are built in
concert; whatever supports our next deploy moves to the front-loaded one and whatever is left
remains in the next iteration"). The epic's design (T7620), the essential-path core (T7630,
re-scoped) and the matrix + rollout (T7640) now sit as children of the epic row inside the
[Deploy Candidate milestone](#milestone-deploy-candidate-user-ordered-2026-09-17-the-next-deploy).
This section holds only what the next deploy does not need. History that still applies: the
2026-09-02 "every UI-visible Next Up task ships first" gate is satisfied; T8560 folded into
T7620/T7630; the four blocking prerequisites (T8390/T8400/T8370/T8380) are DONE.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Revenue Record Integrity (sequenced AFTER the Tutorial Redesign group)

**User order 2026-09-03.** Filed the same day from the prod revenue-reconciliation
investigation, then deliberately sequenced behind the tutorial work: the accounting hole is
real but bounded (one $3.99 payment, one deleted account), while the tutorial group is the
growth lever. Nothing here blocks or is blocked by the tutorial tasks, and no task in this
epic has a UI surface that would gate the tutorial group. **T8660 was pulled forward and is
DONE:** the receipt email is now supplied to Stripe. On 2026-09-29 the owner explicitly waived
the remaining real-purchase/inbox/descriptor verification, so live delivery is not claimed as
observed.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](../../../docs/plans/PLAN-archive.md).*

### Milestone B: Single-server data correctness (needs the export harness first)

Real single-server data bugs, but each needs the export golden harness [T4370](tasks/export-write-path/T4370-export-golden-harness.md) or its epic in place first — so **T4370 is the actual unlock** for this milestone:

- [T4390](tasks/export-write-path/T4390-finalize-publish-single-writers.md) (imp 9) — the finalize-a-reel DB step is copy-pasted 5×, one missing version/duration → inconsistent reel records. *(export-write-path epic)*
- [T4430](tasks/T4430-ffmpeg-params-probe-consolidation.md) (imp 8) — `-shortest` truncation live in 2 render paths → truncated exported video. *(needs T4370)*
- [T4420](tasks/T4420-single-interpolation-module.md) (imp 7) — 4 diverging crop-interpolation copies → local vs Modal export crop differently. *(needs T4370)*
- [T4340](tasks/write-correctness/T4340-canonicalize-segments-at-write.md) (imp 7) — segments_data stored in two formats → the inverted-clip / wrong-recap render class. *(write-correctness epic, a pure single-server data bug)*
- [T4350](tasks/write-correctness/T4350-reexport-retransform-highlights.md) (imp 6) — highlights drift onto the wrong moments after a re-export. *(write-correctness epic; after T4340)*

### Milestone C: Editor correctness (epic-gated)

Single-server bugs sitting inside sequenced epics — do their prerequisite first:

- [T4450](tasks/keyframe-unification/T4450-shared-keyframe-track.md) (imp 7) — the "can't delete the first keyframe" bug. *(keyframe-unification; needs T4440 dead-code sweep first)*
- [T4500](tasks/editor-decoupling/T4500-selectedproject-selector.md) (imp 6) — stale selectedProject → wrong name/ratio after a rename. *(editor-decoupling; needs T4470–T4490 first)*

### For Alpha - Polish

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Notes |
|------|------|------|------|------|------|------|------|
|  | **[Lifecycle Email Drip](tasks/lifecycle-drip/EPIC.md)** | 8 | 6 | 1.3 |  |  |  |
| T7230 | ↳ [Drip stores + seed copy (drip.sqlite, R2 templates doc, unsubscribe markers)](tasks/lifecycle-drip/T7230-drip-schema-templates.md) | 7 | 2 | 3.5 | TODO | [ ] |  |
| T7240 | ↳ [Stage resolver + template selection/render engine](tasks/lifecycle-drip/T7240-stage-resolver-selection-engine.md) | 7 | 3 | 2.3 | TODO | [ ] |  |
| T7250 | ↳ [Unsubscribe endpoint + compliance footer](tasks/lifecycle-drip/T7250-unsubscribe-compliance.md) | 7 | 3 | 2.3 | TODO | [ ] |  |
| T7260 | ↳ [Drip tick + idempotent send pipeline + admin dry-run](tasks/lifecycle-drip/T7260-drip-scheduler-send-pipeline.md) | 8 | 5 | 1.6 | TODO | [ ] |  |
| T7270 | ↳ [Admin panel: template editor + send log](tasks/lifecycle-drip/T7270-admin-template-editor.md) | 6 | 4 | 1.5 | TODO | [ ] |  |
| T3750 | [Redo All E2E Tests](tasks/T3750-rewrite-new-user-flow-e2e.md) | 7 | 4 | 1.8 | TODO | [ ] |  |
| T1970 | [Annotate Mehdi Source Files](tasks/alpha-marketing/T1970-annotate-mehdi-source-files.md) | 8 | 2 | 4.0 | TODO | [ ] |  |
|  | **[Landing Page Polish](tasks/landing-page-redesign/EPIC.md)** | 7 | 4 | 1.8 |  |  |  |
| T2330 | ↳ [Before/After Examples](tasks/landing-page-redesign/T2330-before-after-section.md) | 10 | 5 | 2.0 | TODO | [ ] |  |
| T3300 | ↳ [Build Tutorial Video for Landing Page](tasks/T3300-tutorial-video-landing-page.md) | 8 | 3 | 2.7 | TODO | [ ] |  |
|  | **[Analytics: Attribution & Access Visibility](tasks/analytics-attribution-viz/EPIC.md)** | 7 | 5 | 1.4 |  |  |  |
| T3550 | ↳ [Games Uploaded vs Accessible](tasks/analytics-attribution-viz/T3550-games-uploaded-vs-accessible.md) | 6 | 3 | 2.0 | TODO | [ ] |  |
| T3560 | ↳ [User Attribution Graph](tasks/analytics-attribution-viz/T3560-attribution-graph.md) | 7 | 6 | 1.2 | TODO | [ ] |  |
| T3570 | [Track Annotation Playback Frequency](tasks/T3570-annotation-playback-frequency-event.md) | 5 | 2 | 2.5 | TODO | [ ] |  |
|  | **[Lifecycle Onboarding Emails](tasks/lifecycle-emails/EPIC.md)** | 8 | 6 | 1.3 | SUPERSEDED |  |  |
| T3580 | ↳ [Lifecycle Email Engine](tasks/lifecycle-emails/T3580-lifecycle-email-engine.md) | 8 | 6 | 1.3 | SUPERSEDED | [ ] |  |
| T3590 | ↳ [Day 7/14/30 Content & Personalization](tasks/lifecycle-emails/T3590-lifecycle-email-content.md) | 8 | 5 | 1.6 | SUPERSEDED | [ ] |  |
| T3595 | [Share Viewer Opt-In & Viewer Bucket](tasks/T3595-share-viewer-optin-bucket.md) | 7 | 6 | 1.2 | TODO | [x] |  |
| T3290 | [Tune NUF for Returning Users](tasks/T3290-tune-nuf-returning-users.md) | 8 | 4 | 2.0 | TODO | [ ] |  |

### Code Quality & Refactoring (2026-07-03 audit)

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
*Write Correctness & Concurrency epic (T4330/T4340/T4350/T4355/T4360) is complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*
|  | **[Export Write-Path Unification](tasks/export-write-path/EPIC.md)** | 9 | 7 | -- |  |  | One implementation per export/publish operation, behind a characterization harness. STRICT order. The T4010/T4020/T4110/rank-sweep incident class, removed structurally. |
| T4400 | ↳ [Backend-Authoritative Export (mark-exported)](tasks/export-write-path/T4400-backend-authoritative-export.md) | 9 | 6 | 1.5 | TODO | [ ] | Export still trusts CLIENT state: full-state PUT can clobber newer surgical edits (two tabs; T4020 class — guarded only by frontend conventions incl. an always-false predicate); multi-clip renders the payload then stamps DB exported WITHOUT reconciling (DB ≠ rendered video). Backend snapshots its own blobs; client sends no keyframes. Gate: verify no hook state exists that gestures never persisted. |
| T4410 | ↳ [Export Pipelines → Services + Sweep Unification](tasks/export-write-path/T4410-export-pipelines-to-services.md) | 9 | 8 | 1.1 | TODO | [ ] | routers/export/ = 5,878 L (YOLO, ffmpeg, a 640-line _export_clips in a router); duplicate send_progress/callback/sync pairs (only one sync is T4110-durable); sweep auto-export is a parallel universe (no job record, own ffmpeg/R2/status literals). Slices: merge helper pairs → code motion → dispatcher shape → sweep onto shared rails (T4160 semantics preserved as parameters). |
| T4420 | [One Crop-Interpolation Module (4 Catmull-Rom Copies)](tasks/T4420-single-interpolation-module.md) | 7 | 4 | 1.8 | TODO | [ ] | Rendering-identity math ×4 (app/interpolation.py canonical + upscaler + 2 Modal copies) — divergence = local vs Modal exports crop differently. Package canonical into the Modal image; parity fixtures captured from all copies FIRST (existing divergence = a finding to surface). Also: GPU-param on process_framing_ai (kills the L4 200-line copy) + delete the _optimized benchmark file. Modal redeploy (ask). Depends on T4370. |
| T4430 | [FFmpeg Encode-Params + Probe Consolidation](tasks/T4430-ffmpeg-params-probe-consolidation.md) | 8 | 7 | 1.1 | TODO | [ ] | ~55 hand-built ffmpeg arg lists in 13 modules; libx264 block ×15 in one file that ignores its own helper; `-shortest` truncation fix documented in one path, still live in two (output-correctness split); CRF drift 18/23/32 unnamed; 6+ ffprobe implementations each defaulting "30/1". Named encode profiles + one probe (raises on failure); -shortest migration is an isolated, golden-verified behavior commit. Depends on T4370. |
|  | **[Keyframe System Unification](tasks/keyframe-unification/EPIC.md)** | 8 | 6 | -- |  |  | Finish migrating overlay onto framing's keyframe systems (controller, resolveTargetFrame, flat-list rules). STRICT order. Absorbs T3810 + T3820. |
| T4440 | ↳ [Dead Keyframe/Timeline Code Deletion Sweep](tasks/keyframe-unification/T4440-dead-code-deletion-sweep.md) | 6 | 2 | 3.0 | TODO | [ ] | Delete the dead parallel stack that still absorbs fixes: OverlayTimeline + HighlightLayer + components/Timeline (no importers), useHighlight (T3810), name-colliding container wrappers, framingStore corpses (clipStates/videoFile/markExported), annotateHasSelectedClip + its reactive writer, ReferenceError-if-rendered OverlayVideoOverlays. ~800+ lines; grep-prove each. |
| T4450 | ↳ [Shared KeyframeTrack Rendering](tasks/keyframe-unification/T4450-shared-keyframe-track.md) | 7 | 4 | 1.8 | TODO | [ ] | CropLayer vs RegionLayer keyframe rendering forked; delete gating diverged into THE "can't delete first keyframe" bug (highlight path still enforces the dead permanent-keyframe model). One KeyframeTrack; flat-list delete rule uniform; the gating change is the single intended diff. |
| T4460 | ↳ [Overlay onto Keyframe Controller](tasks/keyframe-unification/T4460-overlay-onto-keyframe-controller.md) | 9 | 7 | 1.3 | TODO | [ ] | **Stage 2 gate.** useHighlightRegions re-implements the whole lifecycle (own snap window 5-vs-10 + own parallel fix for the resolveTargetFrame identity bug + fps=30). Controller grows region-scoped tracks; T3820's snap direction decided by user here; payload-parity tests per gesture (persistence semantics = the T350-class risk). |
|  | **[Editor State Decoupling](tasks/editor-decoupling/EPIC.md)** | 8 | 6 | -- |  |  | Kill cross-screen timing contracts + duplicate state (T1670-family breeding ground). Independent except T4530 last. |
| T4470 | ↳ [FramingContainer: One Next-State per Gesture](tasks/editor-decoupling/T4470-framing-single-nextstate.md) | 8 | 4 | 2.0 | TODO | [ ] | 8 hand-mirror sites rebuild segments/crop payloads to fight React batch timing ("won't have the new value yet"); trim handler mirrors a stale value today. Pure computeNext per gesture → hook + store + API from the same object; batching workarounds deleted; surgical payloads unchanged. |
| T4480 | ↳ [Kill clipMetadata Event-Bus + One Overlay Loader](tasks/editor-decoupling/T4480-clipmetadata-bus-removal.md) | 7 | 4 | 1.8 | TODO | [ ] | clipMetadata = stored derived data AND a cross-screen message consumed by an effect whose first act is a store write; fires "fresh export" on ordinary loads. Plus two duplicate 60-line overlay-data loaders (5 setters already wired twice). Explicit navigation payload (pendingNavigation pattern); one loadOverlayData; clipMetadata derived via selector. |
| T4490 | ↳ [Working-Video State Machine](tasks/editor-decoupling/T4490-working-video-state-machine.md) | 8 | 6 | 1.3 | TODO | [ ] | Working-video truth spread across 2 stores + project fields + 4 OverlayScreen guard refs + a 65-line reconcile effect with reactive recovery — the T1670/stuck-loading locus. One {status,video} machine in projectDataStore, one loadWorkingVideo action (dedup + bounded retry); FramingScreen stops writing overlayStore; all refs deleted. |
| T4500 | ↳ [selectedProject → id + Selector](tasks/editor-decoupling/T4500-selectedproject-selector.md) | 6 | 4 | 1.5 | TODO | [ ] | selectedProject is an independently-fetched snapshot of projects[]; rename patches only the list → ProjectContext (both editors) serves stale name/ratio/URL. Store selectedProjectId; derive via selector; detail fields merge into the list entry (or the extra fetch dies). |
| T4510 | ↳ [Annotate API Data → gamesDataStore](tasks/editor-decoupling/T4510-annotate-data-to-store.md) | 7 | 5 | 1.4 | TODO | [ ] | gameVideos/tags/share state in container useState with two mount-restore effects re-syncing parallel copies (T1540/T4060 bug class, onboarding surface). Store keyed by gameId, raw shape + selectors + deduped fetch actions; restore effects deleted; upload-completion writes at the upload-event site. |
| T4520 | ↳ [Reactive-Effect Cleanup Batch](tasks/editor-decoupling/T4520-reactive-effect-cleanups.md) | 6 | 4 | 1.5 | TODO | [ ] | Ten verified small violations, one commit each: audio auto-toggle race → gesture; toast dismissal via identity-watching effects ×2 → gesture wrappers; clip-selection triple-owner; getFilteredKeyframesForExport duplicated verbatim; FramingScreen triple load/restore paths → one loadClipIntoEditor; gamesDataStore stored derivations + version counter; hasFramingEdits ×3; setGlobalAspectRatio stale transform path; useState-initializer side effect; export-dirty slice factory. |
| T4530 | ↳ [Editor-Mode Isolation Harness](tasks/editor-decoupling/T4530-mode-isolation-harness.md) | 6 | 4 | 1.5 | TODO | [ ] | LAST in epic. Per-mode mount helpers (real captured API fixtures) proving each mode loads with zero sibling-mode state + regression checks that keep the timing-contract table empty. Overlay mounting alone IS the epic's proof. |
| T4540 | [frameMath + Canonical Framerate](tasks/T4540-framemath-canonical-framerate.md) | 7 | 3 | 2.3 | TODO | [ ] | getFramerate() stub always returns 30; `\ |
| T4560 | [Frontend Primitives Sweep](tasks/T4560-frontend-primitives-sweep.md) | 6 | 4 | 1.5 | TODO | [ ] | Five mechanical consolidations: formatTime ×9 (divergent null/rounding); EDITOR_MODES + KeyframeOrigin constants exist with ZERO imports while raw literals circulate (~15 files / 31 sites — absorbs T301/T302/T303; flips T4290 lint to error); createStrictContext (Crop≡Highlight contexts); Modal primitive that enforces no-backdrop-close + Spinner (31/48 hand-rolled); apiJson helper (exemplar store migration). |
| T4570 | [useEditorScreenShell + Shared Shortcuts](tasks/T4570-editor-screen-shell.md) | 6 | 5 | 1.2 | TODO | [ ] | Framing/Overlay screens are 1,100-line siblings with character-identical shell blocks; Overlay re-implements keyboard inline with DIFFERENT arrow-key semantics than framing's shared hook. Shell hook for the identical 20%; Overlay onto useKeyboardShortcuts (arrow behavior = user decision, applied to both). No full screen merge. After the decoupling epic. |
| T4580 | [usePlaylistPlayback](tasks/T4580-useplaylistplayback.md) | 5 | 4 | 1.3 | TODO | [ ] | Recap + highlights playback hooks return the same 15-key interface with line-identical cores; story playback repeats the rAF core a third time. One engine with an advanceStrategy seam (virtual vs per-clip); ended-advance + pendingSeek race pinned by tests; manual playback pass on all three surfaces. |
| T4590 | [historyStack Extraction](tasks/T4590-historystack-extraction.md) | 5 | 4 | 1.3 | TODO | [ ] | The only undo (useSegments trimHistory, bespoke, already patched once) gets its stack mechanics extracted to a pure historyStack module BEFORE keyframe undo is built from scratch as a second system. Behavior byte-identical; undo-vs-persistence semantics documented for the next consumer. |
| T4600 | [regionTrack Interval Engine](tasks/T4600-regiontrack-engine.md) | 8 | 7 | 1.1 | TODO | [ ] | **Stage 2 gate.** Sorted-non-overlapping-intervals model ×3 (annotate clips / overlay regions / framing segments): same id-generation, overlap, clamping, percent layout. Waves: layout → overlap/creation → boundary drag (characterize per-mode semantics first) → segments adoption depth decided in design (T3120 precedent: partial adoption is a valid outcome). After keyframe epic. |
| T4610 | [require_admin Router Dependency](tasks/T4610-admin-router-dependency.md) | 7 | 2 | 3.5 | TODO | [ ] | ~25 imperative _require_admin() calls — one forgotten = open admin endpoint. Router-level Depends + a meta-test iterating router.routes so FUTURE handlers are covered automatically. Security-shaped, tiny. **Do this BEFORE T5940** — its meta-test becomes the safety net for the split, and doing it after means applying the dependency 8 times instead of once. |
| T5950 | [Verify cross-machine CAS conflict (blocked: 1 box)](tasks/T5950-cross-machine-cas-conflict-verification.md) | 6 | 3 | 2.0 | TODO | [ ] | **BLOCKED until we run more than one backend machine — not actionable today.** Prod runs a SINGLE Fly machine, so a CAS conflict cannot occur as deployed, and the single-container dev stack cannot produce one either. User call 2026-07-26: "we are still on 1 box so I'm not worried about it." The durability epic's guards (T4310 CAS upload, T4315 restore-if-newer, T5870 pending/failed/conflict + honest Retry) are all unit-tested and red-verified, but the human-facing sequence has never run against a REAL conflict: two machines write the same user DB -> second refused -> conflict banner -> Retry does restore-if-newer -> **user is TOLD their local changes were replaced** -> page reloads so render matches disk. That last mile is exactly what T5870 round 1 got wrong (silently discarded the edit and reported success); now fixed + unit-covered both sides, never exercised for real. Pick up when we scale out. |
| T5940 | [Split admin.py into cohesive sub-routers](tasks/T5940-split-admin-router-cohesion.md) | 5 | 5 | 1.0 | TODO | [ ] | Divergent Change, measured: admin.py is 1880 LOC / 34 endpoints / ~10 unrelated domains, changed by **25 distinct task ids across 50 commits** (T525…T5760). The frontend ALREADY found these seams (components/admin/ is split into AnalyticsDashboard, RevenueReconciliation, CreditGrantModal, UserTable, …) — only the backend is monolithic. Analytics alone is ~700 LOC of aggregation logic inline in the router with no services/analytics.py. **Honest scoping: this would NOT have prevented the T5840×T4315 conflict that prompted it** (both edited the credit-grant code specifically — same feature, not accidental adjacency); justify it on Divergent Change, not on that conflict. What weak cohesion DID cost there was blast radius + one real trap: tests/test_persistence_risk_coverage.py mixes middleware-sync tests with admin-refresh tests, so a whole-file resolution silently drops the other task's durability work — splitting that test file is the part with genuine safety value. Sub-routers under routers/admin/ mounted on the same prefix so every URL is byte-identical. BINDING process rules: route-table snapshot test BEFORE any motion; one sub-router per mechanical commit <200 lines; motion never mixed with behavior change (the analytics service extraction is a separate later commit); no dynamic router auto-discovery (greppability). Sequence AFTER T4610 and AFTER T5840 lands. |
| T4620 | [fetch_or_404 + Enums + queries Straggler](tasks/T4620-fetch-or-404-enums.md) | 6 | 4 | 1.5 | TODO | [ ] | ~45 hand-rolled existence checks / 34 "not found" wordings → per-entity helpers (frontend error-string grep first); finish constants.py adoption (games.py imports GameStatus then writes literals; missing enums for storage/export-type/mode/share; absorbs T304/T305); projects.py:338 hand-rewrites latest_working_clips_subquery with a divergent tiebreak — decide correct ordering with a test (T1532 class). |
| T4630 | [R2StreamProxy Service](tasks/T4630-r2streamproxy-service.md) | 7 | 5 | 1.4 | TODO | [ ] | Streaming proxy ×4; the pooled-httpx TTFB fix reached 1 of 4 (games/clips/projects still pay per-request client latency); retry generator duplicated verbatim; must carry T1690's don't-commit-before-R2 fix everywhere. One service; TTFB measured before/after; scrubbing verified on all four surfaces. |
| T4640 | [games.py Services: Activation + One Share Flow](tasks/T4640-games-services-extraction.md) | 6 | 6 | 1.0 | TODO | [ ] | activate_game = 185-LOC handler orchestrating 3 datastores with a deliberate mid-handler commit, guarded only by bug26p comments; share vs share_playback copy-paste ~130 lines incl. except-pass revoke paths. GameActivationService (invariants from T4360 enforced between named steps) + one share_game_flow. Depends on T4360. |
| T4650 | [raw_clips Write-Path Consolidation](tasks/T4650-rawclips-write-path-consolidation.md) | 7 | 5 | 1.4 | TODO | [ ] | Bulk save_annotations_to_db (full-table UPDATE/INSERT/DELETE, own boundaries-version copy) coexists with the gesture path (clips.py save/update). Caller census → legit-bulk keeps a renamed import path using the ONE extracted version logic; illegitimate callers route through gestures. Unclear callers escalate, not guessed. After T4270. |
| T4660 | [open_sqlite Factory + game_display Service](tasks/T4660-sqlite-factory-game-display.md) | 5 | 2 | 2.5 | TODO | [ ] | Connection PRAGMA recipe copy-pasted 4 ways — privacy.py connects with NO busy_timeout/PRAGMAs (lock errors under sync load); game display naming ~100 lines byte-identical in projects.py + downloads.py (naming rules just churned in T4160/T4190). One factory + one game_display module. |

### Keyframe Identity Cleanup (follow-ups from crop/overlay duplicate-keyframe fix)

From the [code quality audit](audit-2026-07-03-code-quality.md) (directives: DRY / sync model / dependence minimization), user-approved 2026-07-03. Bug tier is in the Bugs section above (T4200-T4280). Guardrails land first; epics run in listed order internally; standalone tasks are independent. Epics with **Stage 2 gates** (T4460, T4600) need design approval before implementation.

T3810 (Delete Dead useHighlight Hook) fully absorbed into [T4440](tasks/keyframe-unification/T4440-dead-code-deletion-sweep.md) — no standalone row; see T4440's description for scope.

Surfaced while fixing the keyframe-identity divergence (display snaps an edit to a nearby keyframe, but the surgical persistence sent the raw clicked frame/time, so the backend accumulated near-duplicate keyframes that, on delete, stripped a permanent boundary). Root fix + profile_db v014 heal shipped on branch `fix/crop-keyframe-dup-snap`; these are the remaining DRY/UX cleanups.

### Player Moments, AI-found moments for a tapped player (user request 2026-10-31, prototype-gated, runs after For Alpha polish)

**Deprioritized 2026-09-01 (user order)** — held below the active milestones for cleanup/hardening work that isn't blocking anything else right now.

*T7140 (faststart remux) moved to the For Launch — Infrastructure section (2026-09-02, user order), next to T2580 (Faststart Upload Validation).*

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Player Moments](tasks/player-moments/EPIC.md)** | 9 | 8 | 1.1 |  |  | Any sport; parent taps the child (no jersey OCR); two tiers (cheap presence, better criticality); beat Veo's AI on precision and recall; models as registry parameters; prototype before build with KPIs and a decision tree; output = scored suggested plays in `play_suggestions` (T13200 model), promoted by gesture. Risk register R0 to R15 in EPIC.md. |
| T14295 | ↳ [Research refresh: candidate registry for every slot](tasks/player-moments/T14295-research-refresh-candidate-registry.md) | 8 | 3 | 2.7 | TODO | [ ] | Epic 1/6 (R0; feeds R4, R8, R10, R12). Deep-research rerun building on the 2026-10-31 report: for each slot (hosted-video-search, person-detector, tracker, video-vlm, optional audio-prefilter) 2 to 4 candidates with dated price, license, terms (children's video), and benchmark scores (Video-MME / v2, MVBench, LongVideoBench, SPORTU-video, SportR for VLMs; SoccerNet / SportsMOT / VOT-LT for trackers). Output `candidates.json` + dated note; ladder-check verdict (does a new entrant change the decision tree?). Reruns in refresh mode before any prototype on a registry older than 60 days. |
| T14300 | ↳ [Ground truth and the Veo bar: parent-marked moments on 3 to 5 games, Veo's P and R on the same games](tasks/player-moments/T14300-ground-truth-games.md) | 7 | 2 | 3.5 | TODO | [ ] | Epic 2/6 (R1, R15). 3 to 5 real games (2+ sports, 1+ phone, 1+ Veo wide shot), one target child each: clicks, parent-marked moments with labels, 10+ presence minutes. Veo baseline files per game (Veo-Spotlight if the add-on exists, else the team-level zip via the T13200 parser) scored with the same `score.py` (hit rule, P@K, R@K incl. K_veo, AP, label kappa, presence, lost-then-recovered, wrong-child seconds); Veo's P, R, K_veo written into EPIC.md as the bar. Floors confirmed by the user before any prototype (proposed R@20 >= 0.6, presence >= 0.85, <= 4 re-clicks per game). |
| T14310 | ↳ [Prototype 1: hosted video-search slot end to end (upload, tap-crop query, scored moments)](tasks/player-moments/T14310-twelve-labs-pilot.md) | 8 | 3 | 2.7 | TODO | [ ] | Epic 3/6 (R4, R12). Cheapest registry candidate first (Twelve Labs Marengo 3.0 at filing), under $50 and one week per candidate, at most two: transcode, index, three query styles (number + kit color; description only; composed crop-from-tap + action text), optional label pass on the top 20. KPIs: P@K_veo, R@K_veo, R@20, AP, $/game (plan + storage at 50 games/month), wall-clock, terms verdict. **PASS = beats Veo on P and R, R@20 >= floor, <= $5, terms OK -> T14340 hosted, T14320 / T14330 OBSOLETE; NEAR = one tuning round (second candidate or VLM re-rank of top 40); FAIL -> T14320, failure mode recorded.** |
| T14320 | ↳ [Prototype 2: click-seeded tracking bake-off (detector slot x tracker slot) through exits and re-entries](tasks/player-moments/T14320-click-seeded-tracking-bakeoff.md) | 8 | 5 | 1.6 | TODO | [ ] | Epic 4/6 (R2, R3, R10, R14), only if T14310 failed. Every registry tracker (at filing ByteTrack baseline, ARC-SORT, Deep-EIoU, BoT-SORT CMC-off + OSNet; SAM family excluded as backbone) on one permissive detector at 5 / 10 fps, with and without 2x2 tiling, same clicks, one interface. Clicks as re-anchor and as offline stitching constraints. KPIs: presence accuracy, re-clicks, lost-then-recovered, wrong-child seconds (by kit), detector recall, $/game on L4 and A100, confidence signal. **PASS = presence >= floor within re-click budget, tier 1 <= $2 -> T14330; NEAR = re-clicks over budget, user sets the budget; FAIL = epic stops and parks until a registry refresh adds a tracker.** |
| T14330 | ↳ [Prototype 3: video-VLM slot on the child's windows (interesting / highlight / learning opportunity)](tasks/player-moments/T14330-gemini-flash-criticality-prototype.md) | 8 | 4 | 2.0 | TODO | [ ] | Epic 5/6 (R5, R6, R7, R9, R13), only if T14320 passed. 15 to 30 s windows where the child is present; structured JSON with reasoning before scores asking the user's three questions; box as text coordinates (A/B vs drawn box, per candidate); timestamps snapped to the tracker. Every in-cap registry candidate on all windows, over-cap ones as top-20 re-rankers (at filing Gemini 2.5 / 3.5 Flash-Lite, 3.8 Flash, 3.1 Pro, Claude Haiku 5.5 frames-only, Qwen3-VL-8B); benchmark scores order the runs, ground truth decides. Listwise re-rank; optional audio pre-filter; whole-game no-tracking baseline. KPIs: P@K_veo, R@K_veo, R@20, AP, label kappa, timestamp error, $/game (standard and Batch, plus tier 1). **PASS = beats Veo, R@20 >= floor, total <= $5 -> T14340; NEAR = next candidate up as re-ranker within $2; FAIL = epic stops; hybrid pilot only with user approval.** |
| T14340 | ↳ [Productize the winning path: tap a player in Annotate, get scored suggested plays](tasks/player-moments/T14340-productize-winning-path.md) | 9 | 7 | 1.3 | TODO | [ ] | Epic 6/6 (R8, R11, R12, R13), L tier, design gate. Gated on T14310 PASS or T14320 + T14330 PASS. Annotate gesture "Find my player's moments" (tap, kit color); background job in the Live Queue pattern with change events; candidates named by registry id in a greppable config constant; cost computed from the registry's dated price and refused above the cap; rows in `play_suggestions` with score / label / source (profile_db migration if columns are missing); promote and dismiss as per-sport calibration; user decisions on learning-opportunity display, privacy disclosure, and credits. Staging run on the T14300 games must still beat Veo and cost under $5, recorded in the task file. |

### Alpha Marketing

Make far-side-of-field action look good — the #1 quality ceiling for Trace/Veo footage (far-side crops are ~206x366 px of compressed mush; per-frame Real-ESRGAN can't recover detail a single frame doesn't contain). Strategy: build a quality testbed FIRST (no upscale change ships without a testbed run proving it), harvest cheap encode/denoise wins, A/B heavier GAN models, then the headline bet — temporal video super-resolution (FlashVSR/SeedVR2), which aggregates detail across frames. Ships behind crop-size routing so near-side clips stay on the cheap pipeline. Epic tasks are STRICTLY ordered. Research basis + decision gates: [tasks/upscale-quality/EPIC.md](tasks/upscale-quality/EPIC.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1980 | [Alpha Outreach Email](tasks/alpha-marketing/T1980-alpha-outreach-email.md) | 9 | 3 | 3.0 | TODO | [ ] | "Save your best moments before you lose the videos" — email with demo clip link, feature screenshots, CTA to app |
| T1990 | [Alpha List](tasks/alpha-marketing/T1990-alpha-list.md) | 9 | 1 | 9.0 | TODO | [ ] | Contact list for alpha outreach: Zack, Arshia, Chris Choie, WhatsApp group, John Gleaves, Jack's dad, Jett's dad, current team, Shannon |

### Milestone: Framing/Overlay Clarity

Outcome-first UX pass on the two steps where non-technical parents fall off. P0 guarantees a zero-effort valid export and kills keyframe jargon; P1 fixes button naming, hides pro readouts, makes hints replayable; P2 adds presets + clearer manual affordances. Each phase is independently shippable.

*The original P0-P2 pass and the 2026-08-25 naming/UX round (T7700, T7710, T7720) are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### For Launch — Infrastructure

User ran the full local Playwright suite 2026-08-25 (`npx playwright test`, no filter): 348 passed / 144 failed / 23 skipped / 34 did not run, 4.6 hours wall-clock. Two-part directive, both required: (1) fix every real issue the failures reveal, (2) cut a full run to somewhere in the 5-20 minute range (clarified 2026-08-25 — not a strict 10-minute ceiling), driven by removing REDUNDANT coverage ("no code paths should be checked twice" — user's words), not brute-force deletion or added Playwright parallelism alone. Full triage (all 144 failures categorized, 8 concrete bugs identified with exact file:line fixes, slow-test duration data): [docs/testing/playwright-triage-2026-08-25.md](../testing/playwright-triage-2026-08-25.md).

*T7730, T7740, T7750, T7760, T7770, T7780, T7790, and T7800 are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Session Scaling Epic](tasks/session-scaling/EPIC.md)** | 8 | 5 | 1.6 |  |  | Session pinning + write-back R2 sync + data loss recovery. Makes per-user SQLite correct and fast at multi-machine scale. |
| T2250 | ↳ [Write-Back R2 Sync](tasks/session-scaling/T2250-write-back-r2-sync.md) | 8 | 5 | 1.6 | TODO | [ ] | Move R2 sync from blocking-per-gesture to periodic background (~3 min). Sync on sign-out, export, session invalidation. Writes respond in <5ms instead of ~200ms. |
| T40 | ↳ [Single Active Session Handoff](tasks/session-scaling/T40-single-active-session-handoff.md) | 8 | 5 | 1.6 | TODO | [ ] | Auto-signout old device on new login, sync R2 before 401, retry on failure, "signed in elsewhere" UX. Orchestrates device handoff end-to-end. |
| T2260 | ↳ [Data Loss Detection & Recovery](tasks/session-scaling/T2260-data-loss-detection-recovery.md) | 7 | 4 | 1.8 | TODO | [ ] | Detect version gaps on reconnect after crash. Auto-grant goodwill credits, notify user with clear explanation. |
| T1537 | ↳ [Consolidate Achievement POSTs (fire-and-forget analytics)](tasks/session-scaling/T1537-consolidate-achievement-posts.md) | 5 | 3 | 1.7 | BLOCKED | [ ] | Depends on T2250 (write-back). The achievement POST's ~610ms is synchronous `record_milestone` (Postgres + user.sqlite); it's already FE fire-and-forget so the user feels none of it. Fold the achievement INSERT into the action handler AND make the milestone emit fire-and-forget — a persistence-model change deferred until sessions are single-machine + write-back. Design ready: [T1537-design.md](tasks/T1537-design.md). Moved here from the Quests Latency epic. |
|  | **[Analytics System (OpenPanel)](tasks/analytics/EPIC.md)** |  |  |  |  |  | Replace CF Web Analytics with self-hosted OpenPanel: 41 events, 4-tier dashboards, credit-economy metrics, computed intelligence (churn/LTV/tiers), alerts |
| T1700 | ↳ [Foundation](tasks/analytics/T1700-foundation.md) | 6 | 5 | 1.2 | TODO | [ ] | Deploy OpenPanel VPS, SDK integration (frontend + backend), 8 activation events, L1 Daily Pulse dashboard, remove CF Web Analytics |
| T1701 | ↳ [Core Analytics](tasks/analytics/T1701-core-analytics.md) | 6 | 5 | 1.2 | TODO | [ ] | Full 41-event taxonomy, L2 Weekly Health dashboard (7 sections), session replay, quest funnels, admin panel -> OpenPanel links |
| T1702 | ↳ [Monetization + Intelligence](tasks/analytics/T1702-monetization-intelligence.md) | 6 | 5 | 1.2 | TODO | [ ] | Credit events, Stripe revenue tracking, nightly analytics engine (churn risk, engagement tiers, credit health, LTV), hourly/weekly alerts, viral attribution |
| T1703 | ↳ [Optimization](tasks/analytics/T1703-optimization.md) | 5 | 4 | 1.3 | TODO | [ ] | L3 deep-dive template, feature release protocol, aha moment regression, magic number testing (requires 200+ users) |
|  | **[R2 CDN Video Serving](tasks/r2-cdn/EPIC.md)** | 4 | 5 | 0.8 |  |  | Custom domain + HMAC auth + HTTP/2 + CDN caching. Presigned URL streaming done in T3250; this epic adds edge infrastructure. Re-scoped 2026-06-18 (T3760): latency justification debunked (measured TTFF 266 ms, seeks don't stall even saturated); surviving value = caching + egress-at-scale + auth = low-urgency infra. Impact 9->4. Depends on T3250. |
| T2550 | ↳ [CDN + Auth Worker](tasks/r2-cdn/T2550-r2-custom-domain-cdn.md) | 4 | 4 | 1.0 | TODO | [ ] | Custom domain (`cdn.reelballers.com`) + HMAC auth Worker + HTTP/2 + CDN caching. Auth-only Worker (no byte proxying). **Re-scoped 2026-06-18 (T3760):** HTTP/2 6-socket-cap latency story is empirically weak (seeks don't stall even saturated; R2 TTFB ~150 ms). Surviving value = CDN caching + egress-at-scale + HMAC auth, not a latency fix. Impact 8->4. |
| T2570 | ↳ [Remove Fly.io Video Proxy](tasks/r2-cdn/T2570-remove-flyio-video-proxy.md) | 4 | 3 | 1.3 | TODO | [ ] | Delete proxy endpoints made redundant by T3250 + CDN path. After CDN stable 2+ weeks. |
| T2580 | ↳ [Faststart Upload Validation](tasks/r2-cdn/T2580-faststart-upload-validation.md) | 6 | 2 | 3.0 | TODO | [x] | Validate faststart on upload, auto-remux if needed, store is_faststart flag. Prevents non-faststart regression after T3250 drops proxy moov windows. |
| T7140 | [Remux uploaded game videos with faststart (moov at front)](tasks/T7140-game-video-faststart-remux.md) | 6 | 4 | 1.5 | TODO | [ ] | **Moved here 2026-09-02 (user order)** from Milestone: Final Polish. **Deprioritized 2026-09-01 (user order)** — moved out of Milestone TOP, no longer sequenced first-after-reshoot; the Game Pools epic's upload-post-processing rail depends on this task's Modal-dispatch redesign, so Game Pools now waits for T7140 here too (resequenced with it, 2026-09-01 user order — see that milestone's sequencing note). **Renumbered from T7020 on 2026-08-17** (T7020's PLAN.md slot became the Preview Video Improvements epic below; no content change, see the task file's top note). Was sequenced first after T5140 (DONE, deployed 2026-08-17 prod; user-ordered 2026-08-15) — deliberately held out of the next deploy for more thorough testing, not blocked on anything technical. A synchronous version was prototyped and worked (commit `7f2aeb4e`, CI green, reliability-hardened — fixed a real retry-classifier gap found live-testing it) but added ~as much wall-clock to `finalize_upload` as the original upload itself (measured 65-78s remux on a 278MB test, matching a 58.5s upload) because the remux round-trips the file through R2 twice more. User reviewed a design note comparing that against dispatching the remux to Modal (mirrors T4945's `stitch_members` pattern, keeps the response near-instant, never adds upload-time cost) and prefers the Modal-dispatch redesign — full comparison + sequence diagrams: [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c). The prototype branch is deleted (2026-08-14) — its reusable pieces (retry-classifier fix, moov-probe helpers, fail-open remux module) are embedded verbatim in the task file's "Preserved Implementation" section, so no checkout is needed when this is picked back up. |
| T12890 | [Archive Fly app logs to R2 (self-hosted log shipper + window fetch script)](tasks/T12890-fly-log-archive-to-r2.md) | 6 | 4 | 1.5 | TODO | [ ] | Filed 2026-10-18. `fly logs` only holds ~2 min of buffer, so prod history is unqueryable. Self-hosted only (user decision: no hosted vendors): fly-log-shipper -> private R2 bucket, hour-partitioned, 30-day expiry, plus `scripts/fetch_prod_logs.py --hours N` that writes one file for `reduce_log`. No backfill. |
| T2270 | [Session Inactivity TTL](tasks/T2270-session-inactivity-ttl.md) | 5 | 2 | 2.5 | TODO | [ ] | Expire sessions after N days of inactivity using last_seen_at. Absorbs T420 inactivity portion. Depends on T1190. |
| T3440 | [Cache CORS Preflight Responses](tasks/for-launch/T3440-cors-preflight-caching.md) | 5 | 1 | 5.0 | TODO | [ ] | No Access-Control-Max-Age header -- browser fires OPTIONS preflight on every cross-origin request. 826ms overhead (17.8% of page time). One-line fix: add max_age=7200 to CORSMiddleware. |
| T1730 | [Performance Optimization Pass](tasks/for-launch/T1730-performance-optimization-pass.md) | 7 | 5 | 1.4 | TODO | [ ] | Pre-launch audit: slow endpoints, UI jank, bundle size, slow queries, unnecessary R2 round-trips |
| T2650 | [Move Sweep Auto-Export to Modal](tasks/T2650-sweep-to-modal.md) | 7 | 4 | 1.8 | TODO | [ ] | Sweep runs FFmpeg/recap on Fly.io via asyncio.to_thread — violates fast-server principle. Move auto-export compute to Modal; server becomes lightweight orchestrator (DB queries + Modal RPC). |
| T11905 | [overlayDraft.js e2e helper permanently skips in every environment](tasks/T11905-overlay-draft-helper-stale-regex.md) | 5 | 2 | 2.5 | TODO | [ ] | Found by T11740's reviewer: stale "In Spotlight" regex vs the real "In Overlay" chip label (since T9320, 2026-09-10) silently skips 9+ specs across the codebase, not just a missing-fixture issue. |

### For Launch — Features

Growth work on the marketing site (`src/landing`), which shipped as static Astro on 2026-07-24. Not a bug milestone -- per the Priority Policy below it sits behind open infrastructure bugs, but it is genuinely actionable and the feedback loop is measured in weeks, so starting it early matters more than finishing it fast. **The SEO Content & Landing Value Props epic (below) is sequenced to start after Milestone TOP (the Durable Sync campaign) finishes** -- it is growth work, not a UI-runway or infrastructure item, so it does not queue alongside T7020/JIT Migration/Collection Download despite also following the reshoot chronologically.

Ordered: instrumentation first so we can measure what we fix; then the two user-visible stalls we already traced; then the structural infra wins.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Overlay 2](tasks/overlay-2/EPIC.md)** |  |  |  |  |  |  |
| T2180 | ↳ [Manual Telestration](tasks/overlay-v2/T2180-manual-telestration.md) | 6 | 5 | 1.2 | TODO | [ ] | Phase 2: freeze frame + draw arrow/circle/line, hold 1-2s, resume. Recruiting use case. CPU-only. |
| T2130 | ↳ [Player Label Overlay](tasks/overlay-v2/T2130-player-label-overlay.md) | 8 | 5 | 1.6 | TODO | [ ] | Name/number text tag following player tracker. Auto-positions, "minimal" and "broadcast" style presets. |
| T2140 | ↳ [Screen-Anchored Event Overlays](tasks/overlay-v2/T2140-screen-anchored-event-overlays.md) | 7 | 4 | 1.8 | TODO | [ ] | Score bug, GOAL/ASSIST badge, match metadata, time of play. Timestamp-triggered, corner-anchored. |
*T6370 is complete (merged 2026-08-17, already part of the 2026-08-19 prod deploy — status was left stale at STAGING) — row archived to [PLAN-archive.md](PLAN-archive.md).*

#### Video Load Latency (from HAR 2026-06-17)

Traced from `Downloads/localhost.har`: the framing clip *appeared* to take ~4.3s due to a cold over-fetch from R2. **Debunked by the T3760 spike (2026-06-18):** that 4.3s was a HAR misread (`receive` time = playback-stream duration, not TTFF). Measured cold TTFF is 266 ms; the over-fetch is harmless. T3760 closed WON'T-FIX. The per-file tag/JS "downloads" the user noticed are a dev-mode Vite artifact (bundled+gzipped in prod) and are NOT a bottleneck — no task created for them.

> **Coordination:** T3760 + T3770 ship on branch `feature/perf-page-load` (separate conversations, disjoint files). They're part of the wider perf batch with the quest tasks — see [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md).

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### For Alpha - Video Streaming

Fix playback stalls observed on staging (2026-06-02). Video proxy bottleneck (~590 KB/s) causes buffering during game playback. Must fix before alpha testers hit this.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

### Epic Prioritization

**Epics compete with other epics and standalone tasks at the milestone level.** Each epic gets aggregate Impact/Complexity/Priority scores based on the collective value and effort of its tasks.

- **Milestone level:** Epics and standalone tasks are ordered by Priority (Impact / Complexity). Higher priority = do first.
- **Within-epic level:** Tasks are ordered by **dependency** — foundational layers first, since all tasks in an epic touch similar code. DB/model changes before API, API before UI.
- **Impact over complexity:** When prioritizing within a milestone, favor high-impact work even if it's harder. The priority formula (Impact / Complexity) naturally rewards this.

---

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### For Launch — Marketing

Final pre-alpha polish: source material, analytics review, returning-user experience, and landing page refinement.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T445 | [Vehicle Window Cards](tasks/T445-business-cards.md) | 6 | 2 | 3.0 | TODO | [ ] | Design + print cards to place on vehicle windows at games promoting reelballers.com with QR code. Targets parents already at the field. |
| T1930 | [Influencer Marketing](tasks/marketing/T1930-influencer-marketing.md) | 8 | 4 | 2.0 | TODO | [ ] | Identify top influencers that youth soccer parents follow who align with video technology use. Outreach strategy + partnership plan. |

### Movement Tracking (Activity Timeline for Annotate)

Outreach to our network once alpha milestone is complete. Ordered: create source material first, then compose email, then send.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Movement Tracking](tasks/movement-tracking/EPIC.md)** | 8 | 7 | 1.1 |  |  | Testbed-proven dead-time detection: labeling env + ground truth → classical signal bake-off → detection/fusion tuning to KPI gates → Modal job + profile artifact → Annotate activity layer → smart playback → paid opt-in. |
| T7060 | ↳ [Motion Testbed + Labeling Env + Dataset](tasks/movement-tracking/T7060-motion-testbed-labeling.md) | 8 | 5 | 1.6 | TODO | [ ] | Renumbered from T5430 on 2026-08-15 — that ID collided with an already-merged, unrelated task (overlay touch targets) reusing the same number; see `project_planmd_status_drift_batched_commits` memory / PLAN.md sweep. The instrument: `experiments/motion_testbed/` (sr_testbed pattern), keyboard-driven HTML labeler (A/D/E state stamping at 4x), 8 games labeled across veo-static/follow/phone cameras (5 dev / 3 held-out, labels committed, media gitignored), G1-G6 metrics harness + HTML report, inter-annotator kappa, trivial baselines. Blocks the whole epic. |
| T7070 | ↳ [Classical Signal Bake-off](tasks/movement-tracking/T7070-classical-signal-bakeoff.md) | 7 | 5 | 1.4 | TODO | [ ] | Renumbered from T5440 on 2026-08-15 (ID collision, see T7060's row). CPU-only signals measured on labeled games: bitstream motion vectors (mv-extractor/PyAV, near-free), frame diff/MOG2, DIS optical flow — each with camera-motion compensation on/off per camera class. ROC-AUC comparison, cost curve vs sampling rate, per-second feature cache for T7080. |
| T7080 | ↳ [Detection + Fusion + Smoothing → Gate](tasks/movement-tracking/T7080-detection-fusion-tuning.md) | 9 | 7 | 1.3 | TODO | [ ] | Renumbered from T5450 on 2026-08-15 (ID collision, see T7060's row). The go/no-go: YOLO+ByteTrack semantic features (player count nails EMPTY/halftime) fused with classical features via tiny classifier + hysteresis/HMM decode; tune G1 first (>=99.5% play preservation) then maximize dead capture; leave-one-game-out on dev, single frozen-recipe run on held-out; error analysis + Modal cost projection <=$0.50/game. |
| T5460 | ↳ [Modal Movement Job + Profile Persistence](tasks/movement-tracking/T5460-modal-movement-job.md) | 8 | 6 | 1.3 | TODO | [ ] | BLOCKED by T7080 go. `analyze_movement` Modal fn (reuses baked yolov8x, generator progress, presigned-URL sampled decode of 90-min input) + `call_modal_movement` unified dispatch + local engine; msgpack profile artifact in R2 with storage ref; profile_db `movement_profiles` table + migration; admin/dev trigger + GET endpoint; testbed-parity test so prod recipe can't drift. |
| T5470 | ↳ [Annotate Activity Layer](tasks/movement-tracking/T5470-annotate-activity-layer.md) | 7 | 4 | 1.8 | TODO | [ ] | Canvas area-sparkline over the Annotate timeline (y = normalized score, max-pool downsampling so goal spikes survive), DEAD tinted / EMPTY hatched, session toggle. Read-only derived display — zero persistence; no profile = no layer, no errors. UI Designer pass required. |
| T5480 | ↳ [Smart Playback](tasks/movement-tracking/T5480-smart-playback.md) | 8 | 5 | 1.6 | TODO | [ ] | Pure client playbackRate state machine: 1x through ACTIVE, configurable 2-8x skim through DEAD (2s lead-in back to 1x), hard-skip EMPTY >2min with toast + undo; protected zones ±10s around top-decile spikes (never skip a goal); manual interaction suspends smart control. Exhaustively unit-tested pure hook + real-browser verify. |
| T5490 | ↳ [Upload Opt-in + Paid Add-on Gating](tasks/movement-tracking/T5490-upload-optin-pricing.md) | 6 | 5 | 1.2 | TODO | [ ] | LAST deliberately (dogfood free internally first): opt-in checkbox at Add Game with price, entitlement on existing credits rails (no parallel payment path), dispatch-on-upload-complete, auto credit-back on hard failure, admin free-flag for beta accounts, funnel analytics. |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*

### Epic: For Launch (IN_PROGRESS)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

#### Multi-Feed Shared Games

Scale, performance, and reliability — must be solid before feature work.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Game Pools — Multi-Feed Shared Games](tasks/dual-camera/EPIC.md)** | 9 | 8 | 1.1 |  |  | One link pools both teams' footage: N feeds on one game clock, per-feed lanes in Annotate, per-clip camera picking at export, rent-model storage, autosync by audio. Value→UX→architecture→task trace table in EPIC.md. |
| T5495 | ↳ [Add Game Overhaul](tasks/dual-camera/T5495-add-game-overhaul.md) | 7 | 6 | 1.2 | TODO | [ ] | Video OPTIONAL at create (awaiting-video games; T1180 zero-video exception), folder upload with contiguous-segment detection, client-side mvhd creation_time parse, metadata-ordered EDITABLE role chips — and "Per Half" + the whole Video Format control REMOVED, evidence-based: 16/16 real multi-file uploads (incl. all sarkarati prod half-pairs) carry embedded creation_time that orders halves correctly; File.lastModified banned (ordered a real pair wrong). ALIGNMENT.md § Half-order evidence. |
| T5498 | ↳ [Crop Before Upload](tasks/dual-camera/T5498-crop-before-upload.md) | 6 | 7 | 0.9 | TODO | [ ] | Full-screen client-side crop stage for ≥4K sky-heavy sources (the DJI class): crop handles + filmstrip sanity-scrub, why-line + LIVE size/credit recompute as the rect moves, WebCodecs on-device re-encode (uncropped bytes never leave the machine; charged on cropped size), honest fallback when the browser can't encode. |
| T5500 | ↳ [Pool Entity + Invite/Join Backend](tasks/dual-camera/T5500-shared-game-backend.md) | 7 | 5 | 1.4 | TODO | [x] | Postgres: shared_games (per-SIDE invite tokens, side names, sport + team-name snapshots, wall-clock origin as a stored constant) + members (cap 50) + feeds + feed_videos (wall_offset/source/confidence/creation_time); public status endpoint; join binds a profile + derives game info from the claimed side (invert Home↔Away only cross-team, opponent from the sharer's team); claim-through-signup on the T5730 rails; shared_by provenance (T5330). |
| T5510 | ↳ [Invite / Status / Join / No-Video UX](tasks/dual-camera/T5510-create-join-ux.md) | 8 | 6 | 1.3 | TODO | [ ] | Entry ONLY inside the Share game modal (zero new chrome for basic users); invite sheet with Anyone-default one-tap link + optional side tags + team-name capture (saved to profile, prefills cross-team opponents); public pool status page (counts pre-join, never names); join confirm (whose athlete + which team, consequence lines); pool tile chips; no-video Annotate setup panel (upload-or-share, bug-27p pattern). |
| T5520 | ↳ [Feed Propagation + Rent + Live Sync](tasks/dual-camera/T5520-upload-binding-propagation.md) | 8 | 7 | 1.1 | TODO | [x] | profile_db migration: `game_videos.feed_id` + `games.shared_game_id` (+ `raw_clips.feed_id` for T5550); refresh-on-load + ~60s/focus poll materializes reference rows + per-feed storage refs (initial window copies the uploader's expiry; head-guarded T4820); RENT ENFORCED at the presign/stream path (your own live ref required — no free-riding); sweep recount audited to provably cover cross-ACCOUNT refs; cancel rails at every upload stage. |
| T5530 | ↳ [Alignment: Autosync + Line-Up View](tasks/dual-camera/T5530-time-alignment.md) | 7 | 6 | 1.2 | TODO | [ ] | ALIGNMENT.md cascade: per-blake3 cached envelope + fingerprints, fingerprint coarse match + GCC-PHAT fine, verdict ladder (manual authoritative, offsets NEVER fabricated), export-time-stamp classifier (order-only, never seeds windows); Modal `align_feed` beside the mov-atom probe; line-up view with waveform strips (slide with the nudge), comparison-camera selector among lined-up feeds, short-clip variant, no-audio state. |
| T5540 | ↳ [Camera Lanes + Main + Prefer Pill](tasks/dual-camera/T5540-annotate-camera-toggle.md) | 9 | 6 | 1.5 | TODO | [ ] | Per-feed lanes (clips PACK — non-intersecting share a lane, intersecting split); Main lane = resolved default (a covering clip wins → member's preference spans → reference feed) with owner-named segments + visible pin strip; "Prefer this camera from here" pill is the ONLY preference gesture (member-local feed_preferences); tap/C-key switching preserves the moment (session-only); coach-mark on first multi-feed render; short-viewport chip fallback. |
| T5550 | ↳ [Per-Clip Picker + Extraction](tasks/dual-camera/T5550-clip-from-active-camera.md) | 7 | 7 | 1.0 | TODO | [x] | `raw_clips.feed_id` stamp; picker strip of FULL-coverage cameras only (partial coverage omitted entirely — never a truncated export); Main tile first, tap = pick + preview, "Use Main instead" undo; export resolves the picked feed through a Python `feed_time_map` twin (shared test vectors, loud failure on inconsistency); `_export_brilliant_clip` honors the pick. |
| T7300 | ↳ [Per-Feed Keep Checklist](tasks/dual-camera/T7300-per-feed-keep-checklist.md) | 6 | 5 | 1.2 | TODO | [ ] | Rent UX: per-feed rows (owner, size, cost; pre-check ONLY own feed + explicit clip picks — never pre-bill), "Keep nothing for now" as a first-class informed exit, consequence line (what stops playing, what stays), hash-selective extend (today's extend re-refs every hash), per-feed storage_status, clip feeds cost the 1-credit minimum (no recap surcharge). |
| T7310 | ↳ [Preview Proxies](tasks/dual-camera/T7310-preview-proxies.md) | 5 | 5 | 1.0 | TODO | [ ] | EVIDENCE-GATED (only if real pools feel slow): 480p renditions generated by the mov-atom Modal job, blake3-keyed beside the source; Annotate/preview surfaces stream the proxy, Framing/export ALWAYS resolve the full-res master; shipped .LRF proxies (T5495) use the same rendition slot. |
| T5560 | ↳ [Auto Best-Camera Suggestions](tasks/dual-camera/T5560-auto-best-camera.md) | 6 | 6 | 1.0 | BLOCKED | [ ] | BLOCKED by T5460 + T5540. Per-source (blake3) movement profiles score feeds — other members' profiles come free; "Main" earns the "Auto" name (Wand2) only when this ships; conservative hysteresis (never strobe, never switch away from a goal); the manual preference pill stays the override. |

#### Deprioritized (evidence-gated / narrow-audience)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T5750 | [Perspective/keystone correction in Framing (acquisition-corrections family)](tasks/T5750-perspective-keystone-correction.md) | 4 | 6 | 0.7 | TODO | [ ] | **EVIDENCE-GATED — do not implement until >=2 real user clips show keystone distortion rotation can't fix.** Third member of the acquisition-corrections family (per-clip, fix-it-not-creative, before-crop): T5640 rotation fixed camera ROLL; this fixes off-axis aim (yaw/pitch -> converging goalposts, trapezoidal skew) via FFmpeg `perspective` homography. Canonical order dewarp -> perspective -> rotate -> crop; T5640 coordinate contract + safe-area clamp generalize to the composed transform. Prereq architecture (extract T5640's triple-site rotate-before-crop insertion into ONE shared corrections builder) belongs to T5657's design gate — whichever lands second inherits it. UX candidate: drag-2-vertical-guides (Lightroom Guided-Upright style, consistent with the straighten tool). Filed 2026-07-22 to name the family + reserve design constraints, not to schedule work. |
|  | **[Multi-File Ingest & Prep](tasks/prepare-stage/EPIC.md)** | 3 | 8 | 0.4 | TODO |  | DEPRIORITIZED 2026-07-31 (user): "most users won't need this." Impact 6 -> 3, so Priority 0.8 -> 0.4 ("consider if it's worth doing at all"), and the block moves to the bottom of Next Up. The deprioritization is an AUDIENCE judgment, not a technical one: the core customer is a soccer parent with a phone or a Veo, and multi-file 62GB 8K drone ingest serves a narrow slice of that. Nothing here is wrong or blocked — the design spike is still valid and the 50-200x reduction still holds if it is ever picked up. Child scores are unchanged: they express value RELATIVE to each other inside the epic, while the epic row is what competes at milestone level (see Epic Prioritization). Revisit if real users start arriving with multi-file/high-res footage. PARTIAL SUPERSESSION (user-approved 2026-08-19): the Game Pools epic pulled several pieces forward — folder upload + metadata ordering (T5495), crop-before-upload (T5498), and the proxy/preview rendition slot (T7310) absorb T5651/T5652's ingest surface and T5654's annotate-on-proxy; see per-child notes below. The unique remaining value here is T5653's client trim/assemble workspace and T5655's conform-crop-from-master. Reconcile scopes against the Game Pools task files before picking ANY child up. Original scope: Bring in large, multi-file, non-Veo footage (62GB 8K DJI folder) without uploading the raw monster. Relevant video drops 50-200x (50GB -> <1GB) via edit-on-proxy + manual trim + conform-crop-from-master. Design spike DONE (hands-on ffmpeg + YOLO on the real footage): [study](research/T5650-dji-8k-ingest-reduction-study.md) (section 0 = locked decisions). Decisions: manual client trim (auto-trim dropped); dual-asset pipeline (upload LRF+MP4, Annotate+Framing-preview on LRF, Framing conforms crop ROI from MP4, upscale only when native crop < target); new `VideoMode.MULTI_FILE` ("Multiple Files") -> client-side Prep (assemble, manual trim, low-fi LRF preview + "annotate this" markers, stream-copy trim+concat, resumable dual-asset upload); use shipped .LRF else generate. Pairs with T5640 (rotation) + T5657 (fisheye de-warp). |
| T5651 | ↳ [Proxy/master asset pairing data model + credit accounting](tasks/prepare-stage/T5651-proxy-master-data-model.md) | 6 | 5 | 1.2 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310's blake3-keyed rendition slot** (Game Pools epic) — one proxy store, not two. Reopen only if frame-accurate proxy/master credit accounting turns out to need more than the rendition slot. |
| T5652 | ↳ [`MULTI_FILE` mode + client-side Prep workspace shell](tasks/prepare-stage/T5652-multifile-mode-prep-shell.md) | 6 | 5 | 1.2 | TODO | [ ] | Epic 2/7. Third `VideoMode` ("Multiple Files") beside Full Game / Per Half -> folder pick -> full-screen client-side Prep shell (file rail + timeline + preview + Create). Full Game / Per Half stay byte-identical. Engine is T5653. |
| T5653 | ↳ [Client assemble/trim/concat + resumable dual-asset upload](tasks/prepare-stage/T5653-client-assemble-trim-upload.md) | 7 | 8 | 0.9 | TODO | [ ] | Epic 3/7 (hardest). Auto-order by timestamp + drag; manual multi keep-range trim; STREAM-COPY concat both proxy+master (ffmpeg.wasm/WebCodecs, lossless, keeps 8K); resumable dual-asset upload. Validate browser ceiling on the real 62GB folder; cross-codec/fallback explicit. |
| T5654 | ↳ [Annotate reads the proxy (LRF)](tasks/prepare-stage/T5654-annotate-on-proxy.md) | 6 | 4 | 1.5 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310** (Game Pools epic): Annotate/preview stream the rendition, Framing/export always resolve the master — the same invariant, one implementation. |
| T5655 | ↳ [Framing conform-from-master + upscale-only-as-needed](tasks/prepare-stage/T5655-framing-conform-upscale-as-needed.md) | 7 | 6 | 1.2 | TODO | [ ] | Epic 5/7. Framing preview on proxy; export conforms crop ROI x clip window from the MASTER (native, never whole 8K); AI upscale runs ONLY when native crop < target (8K crops usually already >=1080p -> skip). Shares filter-stage design with T5640/T5657. |
| T5656 | ↳ [Prep markers -> Annotate clip candidates](tasks/prepare-stage/T5656-prep-markers-to-annotate.md) | 5 | 4 | 1.3 | TODO | [ ] | Epic 6/7. "Annotate this" markers dropped during the low-fi Prep preview persist on the game and surface in Annotate as pre-seeded clip candidates (human-in-loop, not auto-clips). |
| T5657 | ↳ [Fisheye de-warp + horizon level](tasks/prepare-stage/T5657-fisheye-dewarp-level.md) | 5 | 6 | 0.8 | TODO | [ ] | Epic 7/7. Lens de-warp (OpenCV cv2.fisheye / ffmpeg lenscorrection |

#### Completed

- T1150 Fix Pending Sync Retry No-Op — DONE
- T1152 Persist Sync-Failed State — DONE
- T1160 Clean Up Unused DB Rows — DONE
- T1170 Size-Based VACUUM on Init — DONE
- T1180 Fix NULL video_filename Root Cause — DONE
- T1200 Modal Job ID Logging & Retry — DONE
- T1380 Recover Orphaned Jobs Per-User at Startup — DONE
- T1390 Process Modal Queue Per-User at Startup — DONE
- T1130 Multi-Clip Stream Not Download — DONE
- T1120 Framing Video Cold Cache — DONE
- T1020 Fast R2 Sync — DONE
- T1010 Slow fetchProgress Response -- DONE

### Post Launch

A game becomes a pool: up to 50 contributors — parents from BOTH teams — add their Veo/Trace cameras and iPhone clips through one link pasted in the team WhatsApp; every feed aligns to one game clock (audio-fingerprint autosync, manual line-up fallback); each family picks the best camera per play of their kid. Cross-team pooled angle-picking is competitive white space (Trace MultiCam is single-team + own hardware; Veo can't multi-cam), and every link is organic acquisition — the other team's parents sign up to join. Rent-model storage: the uploader's charge covers everyone for 30 days, then continued access is per-member per-feed. REDESIGNED 2026-08-19 from the two-camera draft (same task IDs, generalized scope); normative specs live in the epic folder: [UX-SPEC.md](tasks/dual-camera/UX-SPEC.md) (every changed screen) + [ALIGNMENT.md](tasks/dual-camera/ALIGNMENT.md) (algorithm + real-file evidence). **2026-09-03 scope amendment (user directive, recorded in EPIC.md Captured requirements): the single-owner path is first-class — "Add Video" on your OWN game adds overlapping feeds (auto timestamp alignment, separate layer over the Veo/Trace reference, per-clip feed choice at annotation) with NO pool sharing required; T5510's share-modal-only entry is amended at design time.** Epic tasks are STRICTLY ordered: [tasks/dual-camera/EPIC.md](tasks/dual-camera/EPIC.md).

**Sequencing (user-approved 2026-08-19, bugs → UI/UX → infra):** (1) NOW, before the epic: T7280 + T7170 (small pure-UX wins) and land the in-flight T7290 (same GameTile surface as §4's chips). (2) **Named prerequisites:** [T6770](tasks/T6770-game-refcount-derived-set.md) (the rent model depends on cross-ACCOUNT ref counting — fix the drifting counter first) and [T6780](tasks/T6780-guard-asymmetries-detections-materialization.md) part B (the join flow reuses the materialization copy-game path with its unguarded below-head writes); both are bug-class and go first per the Priority Policy. (3) [T7140](tasks/T7140-game-video-faststart-remux.md) remains a named prerequisite — this epic's upload-post-processing rail reuses its Modal-dispatch moov-probe redesign (ALIGNMENT.md's `align_feed` and T7310's proxies ride the same pattern). **Resequenced 2026-09-01 (user order):** T7140 was deprioritized to the Milestone: Final Polish section (placed right before Upscale Quality), so Game Pools now waits for it there instead of first-after-reshoot — this epic effectively moves down with it. (4) Then the epic, UI-forward children first (T5495 → T5498 ship user-visible upload UX for everyone, weeks before any pool backend). JIT Migration slots either just before T5500's schema work (its migrations are then born JIT) or after the whole epic — not between the epic's children.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T710 | [Share with Coach](tasks/post-launch/T710-share-with-coach.md) |  |  | 1.2 | TODO | [x] | Coach account type + sharing: roster uploads, assign annotations to players, clip ratings, notes, send-back flow. Absorbs T1060 (Coaches View) |
| T720 | [Art Frames](tasks/T720-art-frames.md) |  |  | 1.1 | TODO | [x] | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |
| T2170 | [Glow & Arrow Primitives](tasks/overlay-v2/T2170-glow-arrow-primitives.md) |  |  | 1.5 | TODO | [ ] | Soft radial glow aura + floating arrow pointer for wide shots. |
| T2190 | [Extended Presets](tasks/overlay-v2/T2190-extended-presets.md) |  |  | 2.5 | TODO | [ ] | "Recruiting" (minimal + persistent label) and "Social" (pulse + glow + broadcast name) presets. |
| T2200 | [Outline Trace Primitive](tasks/overlay-v2/T2200-outline-trace-primitive.md) |  |  | 0.7 | TODO | [ ] | Edge-detect player silhouette outline. Expensive to compute, premium-feel. |
| T2210 | [Spotlight Cone Primitive](tasks/overlay-v2/T2210-spotlight-cone-primitive.md) |  |  | 1.2 | TODO | [ ] | Darken/desaturate everything outside player region. High-drama cinematic effect. |
|  | **[Overlay 3](tasks/overlay-v2/EPIC.md)** |  |  |  |  |  | Composable overlay system: player labels, pulse rings, score bugs, event badges, presets. Clips look like pro TikTok/IG edits. |
| T2100 | ↳ [Composable Overlay Architecture](tasks/overlay-v2/T2100-composable-overlay-architecture.md) |  |  | 1.3 | TODO | [ ] | Refactor single ellipse into composable primitive system with common config, composition engine, stacking rules |
| T2120 | ↳ [Pulse Ring Primitive](tasks/overlay-v2/T2120-pulse-ring-primitive.md) |  |  | 2.3 | TODO | [ ] | Animated scale + opacity loop for dramatic moments (goals, big saves). 1-2s duration. |
| T2150 | ↳ [Overlay Presets System](tasks/overlay-v2/T2150-overlay-presets-system.md) |  |  | 2.0 | TODO | [ ] | One-click templates: "Spotlight", "Goal", "Custom". Wire up multiple primitives at once. |
|  | **[On Fire: NBA Jam heat effects](tasks/on-fire/EPIC.md)** |  |  | 0.7 | TODO |  | Filed 2026-09-08 as a thought experiment for the "spice it up" tail of the roadmap, AFTER Overlay 3 (T2100 is a hard prerequisite). NBA Jam's rule (3 consecutive baskets, "He's heating up" at 2, "He's on fire" at 3, flaming ball, burning net) mapped onto a reel: per-region heat level off/heating/fire, flames anchored to the spotlight ellipse with a trail along the spline velocity, and an auto-escalation preset across a 3-clip reel. Audit verdict: there is NO player tracker today (spotlight motion between keyframes is Catmull-Rom interpolation; YOLO samples 4 frames per clip, person-only, no track ids) and every effect must be mirrored in SVG preview + backend numpy + Modal inline numpy (T5250 dropped glow/pulse for this), so v1 = sprite-sheet flames driven by a pure placement function with a parity test, exactly NBA Jam's own technique. Ball flames are evidence-gated behind a recall spike on Focus OUTPUT video (COCO class 32; no ball detection exists anywhere in src/). Original art only, no announcer audio, no new Postgres state, no migration for Phase 1. |
| T9210 | ↳ [Flame asset pipeline + heat placement spec (mirrored x3)](tasks/on-fire/T9210-flame-assets-and-placement-spec.md) |  |  | 1.3 | TODO | [ ] | Epic 1/6. Offline deterministic sprite generator (original art: plume, trail, ember, smoke, ring, burst; 24-frame loops), pure `heat_placements(t, level, anchor, velocity, radius, ...)` in 3 mirrored copies + `TestModalInlineParity`, spline velocity helper (central difference). Ships inert. |
| T9220 | ↳ [Per-region heat level: data key, action, settings UI](tasks/on-fire/T9220-region-heat-level-data-and-ui.md) |  |  | 1.7 | TODO | [ ] | Epic 2/6. First per-region style field: additive `heat` key on the region dict in `highlights_data` (no migration, T4355 precedent), `set_region_heat` action with CAS bump, Off/Heating/Fire control on the active region in OverlaySettingsCard, carry-forward preserves it. |
| T9230 | ↳ [Render the fire in all three paths (preview, backend, Modal)](tasks/on-fire/T9230-render-fire-three-paths.md) |  |  | 0.9 | TODO | [ ] | Epic 3/6. SVG `<image>` layer with screen blend in HighlightOverlay; numpy sprite blend in `_process_frames_to_ffmpeg` and Modal `_render_highlight` (sprites shipped as bytes per call, T5225 pattern); fire ring replaces the stroke; reveal-envelope fade; frame-level parity test + preview-vs-export QA spec. Modal redeploy gate. |
| T9240 | ↳ ["NBA Jam mode" auto-escalation preset + goal burst](tasks/on-fire/T9240-nba-jam-mode-preset.md) |  |  | 1.5 | TODO | [ ] | Epic 4/6. One-gesture preset via T2150: play 1 off, play 2 heating, play 3+ fire (fans out surgical `set_region_heat` actions, nothing stored twice); burst in the last 0.4 s of a fire region or at T2140's GOAL badge; optional "{Name} is on fire" text beat via T2130/T2140. No audio. |
| T9250 | ↳ [Dense tracking for feet fire + scorch footprints](tasks/on-fire/T9250-dense-tracking-feet-fire.md) |  |  | 0.7 | TODO | [ ] | Epic 5/6. New Modal `track_region_modal` (Ultralytics ByteTrack, person-only, every frame of fire regions on the WORKING video), athlete track picked by IoU with the user's ellipse, 1-euro smoothed feet, spline gap-bridge under 0.5 s, derived `heat_tracks` region key, scorch decals, credit-estimated GPU cost. Shares design with T2160/T2220. |
| T9260 | ↳ [Ball on fire: recall spike, then possession + shot trail (evidence-gated)](tasks/on-fire/T9260-ball-on-fire-spike.md) |  |  | 0.4 | TODO | [ ] | Epic 6/6. Stage 1 = measure COCO class 32 recall inside hand-labeled possession windows on 10 real Focus-output videos at imgsz 640/1280; GATE >= 80% or close with numbers. Stage 2 = Kalman ball track, possession (ball within 0.6 x bbox height of feet for 3 frames), shot detection on release speed, ball_flame + shot_trail placements. Never ship a blinking ball flame. |
|  | **[PWA Epic](tasks/pwa/EPIC.md)** |  |  |  |  |  | Background export + push notifications + background uploads + share target + offline playback |
| T443 | ↳ [Background Export Tracking](tasks/pwa/T443-background-sync.md) |  |  | 1.4 | TODO | [ ] | Export survives app close -- service worker tracks Modal job, notifies on completion. |
| T444 | ↳ [Push Notifications & Badges](tasks/pwa/T444-push-notifications-badges.md) |  |  | 1.6 | TODO | [ ] | Push for export complete + shared clips received. Badge count on app icon for pending items. |
| T447 | ↳ [Background Fetch for Uploads](tasks/pwa/T447-background-fetch-uploads.md) |  |  | 2.0 | TODO | [ ] | Multi-GB game uploads survive app close/switch. Parents upload at the field on cellular. THE differentiator. |
| T448 | ↳ [Share Target API](tasks/pwa/T448-share-target-api.md) |  |  | 2.3 | TODO | [ ] | Receive videos FROM camera roll directly into Reel Ballers upload flow. Eliminates file picker friction. |
| T449 | ↳ [Offline Reel Playback](tasks/pwa/T449-offline-reel-playback.md) |  |  | 2.0 | TODO | [ ] | Cache exported reels for offline viewing + persistent storage. Show reels without cell signal. |
| T1910 | ↳ [Tutorial Video](tasks/for-launch/T1910-tutorial-video.md) |  |  | 2.7 | TODO | [ ] | Record walkthrough video: upload game, annotate clips, frame, overlay, export. Embeddable on landing page and in-app onboarding. |

### Deprioritized (evidence-gated / narrow-audience)

Moved here 2026-08-14 (user-ordered), after Movement Tracking + Dual-Camera Shared Games -- not gating anything, pick up if evidence/audience changes.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T5750 | [Perspective/keystone correction in Framing (acquisition-corrections family)](tasks/T5750-perspective-keystone-correction.md) | 4 | 6 | 0.7 | TODO | [ ] | **EVIDENCE-GATED — do not implement until >=2 real user clips show keystone distortion rotation can't fix.** Third member of the acquisition-corrections family (per-clip, fix-it-not-creative, before-crop): T5640 rotation fixed camera ROLL; this fixes off-axis aim (yaw/pitch -> converging goalposts, trapezoidal skew) via FFmpeg `perspective` homography. Canonical order dewarp -> perspective -> rotate -> crop; T5640 coordinate contract + safe-area clamp generalize to the composed transform. Prereq architecture (extract T5640's triple-site rotate-before-crop insertion into ONE shared corrections builder) belongs to T5657's design gate — whichever lands second inherits it. UX candidate: drag-2-vertical-guides (Lightroom Guided-Upright style, consistent with the straighten tool). Filed 2026-07-22 to name the family + reserve design constraints, not to schedule work. |
|  | **[Multi-File Ingest & Prep](tasks/prepare-stage/EPIC.md)** | 3 | 8 | 0.4 | TODO |  | DEPRIORITIZED 2026-07-31 (user): "most users won't need this." Impact 6 -> 3, so Priority 0.8 -> 0.4 ("consider if it's worth doing at all"), and the block moves to the bottom of Next Up. The deprioritization is an AUDIENCE judgment, not a technical one: the core customer is a soccer parent with a phone or a Veo, and multi-file 62GB 8K drone ingest serves a narrow slice of that. Nothing here is wrong or blocked — the design spike is still valid and the 50-200x reduction still holds if it is ever picked up. Child scores are unchanged: they express value RELATIVE to each other inside the epic, while the epic row is what competes at milestone level (see Epic Prioritization). Revisit if real users start arriving with multi-file/high-res footage. PARTIAL SUPERSESSION (user-approved 2026-08-19): the Game Pools epic pulled several pieces forward — folder upload + metadata ordering (T5495), crop-before-upload (T5498), and the proxy/preview rendition slot (T7310) absorb T5651/T5652's ingest surface and T5654's annotate-on-proxy; see per-child notes below. The unique remaining value here is T5653's client trim/assemble workspace and T5655's conform-crop-from-master. Reconcile scopes against the Game Pools task files before picking ANY child up. Original scope: Bring in large, multi-file, non-Veo footage (62GB 8K DJI folder) without uploading the raw monster. Relevant video drops 50-200x (50GB -> <1GB) via edit-on-proxy + manual trim + conform-crop-from-master. Design spike DONE (hands-on ffmpeg + YOLO on the real footage): [study](research/T5650-dji-8k-ingest-reduction-study.md) (section 0 = locked decisions). Decisions: manual client trim (auto-trim dropped); dual-asset pipeline (upload LRF+MP4, Annotate+Framing-preview on LRF, Framing conforms crop ROI from MP4, upscale only when native crop < target); new `VideoMode.MULTI_FILE` ("Multiple Files") -> client-side Prep (assemble, manual trim, low-fi LRF preview + "annotate this" markers, stream-copy trim+concat, resumable dual-asset upload); use shipped .LRF else generate. Pairs with T5640 (rotation) + T5657 (fisheye de-warp). |
| T5651 | ↳ [Proxy/master asset pairing data model + credit accounting](tasks/prepare-stage/T5651-proxy-master-data-model.md) | 6 | 5 | 1.2 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310's blake3-keyed rendition slot** (Game Pools epic) — one proxy store, not two. Reopen only if frame-accurate proxy/master credit accounting turns out to need more than the rendition slot. |
| T5652 | ↳ [`MULTI_FILE` mode + client-side Prep workspace shell](tasks/prepare-stage/T5652-multifile-mode-prep-shell.md) | 6 | 5 | 1.2 | TODO | [ ] | Epic 2/7. Third `VideoMode` ("Multiple Files") beside Full Game / Per Half -> folder pick -> full-screen client-side Prep shell (file rail + timeline + preview + Create). Full Game / Per Half stay byte-identical. Engine is T5653. |
| T5653 | ↳ [Client assemble/trim/concat + resumable dual-asset upload](tasks/prepare-stage/T5653-client-assemble-trim-upload.md) | 7 | 8 | 0.9 | TODO | [ ] | Epic 3/7 (hardest). Auto-order by timestamp + drag; manual multi keep-range trim; STREAM-COPY concat both proxy+master (ffmpeg.wasm/WebCodecs, lossless, keeps 8K); resumable dual-asset upload. Validate browser ceiling on the real 62GB folder; cross-codec/fallback explicit. |
| T5654 | ↳ [Annotate reads the proxy (LRF)](tasks/prepare-stage/T5654-annotate-on-proxy.md) | 6 | 4 | 1.5 | SUPERSEDED | [ ] | **SUPERSEDED 2026-08-19 by T7310** (Game Pools epic): Annotate/preview stream the rendition, Framing/export always resolve the master — the same invariant, one implementation. |
| T5655 | ↳ [Framing conform-from-master + upscale-only-as-needed](tasks/prepare-stage/T5655-framing-conform-upscale-as-needed.md) | 7 | 6 | 1.2 | TODO | [ ] | Epic 5/7. Framing preview on proxy; export conforms crop ROI x clip window from the MASTER (native, never whole 8K); AI upscale runs ONLY when native crop < target (8K crops usually already >=1080p -> skip). Shares filter-stage design with T5640/T5657. |
| T5656 | ↳ [Prep markers -> Annotate clip candidates](tasks/prepare-stage/T5656-prep-markers-to-annotate.md) | 5 | 4 | 1.3 | TODO | [ ] | Epic 6/7. "Annotate this" markers dropped during the low-fi Prep preview persist on the game and surface in Annotate as pre-seeded clip candidates (human-in-loop, not auto-clips). |
| T5657 | ↳ [Fisheye de-warp + horizon level](tasks/prepare-stage/T5657-fisheye-dewarp-level.md) | 5 | 6 | 0.8 | TODO | [ ] | Epic 7/7. Lens de-warp (OpenCV cv2.fisheye / ffmpeg lenscorrection |

### Epic: Post Launch (TODO)
[tasks/post-launch/EPIC.md](tasks/post-launch/EPIC.md)

Improvements after real user traffic. Target audience: highly engaged soccer parents with enough
technical ability to use the app. Reach them where they already spend attention. Landing Page
Redesign core tasks (hero, nav, visual foundation) in For Alpha -- polish tasks (how-it-works,
features cut, sample reels, FAQ) deferred to For Launch. Pricing dropped (freemium model).

| ID | Task | Status | Pri | Migr | Description |
|------|------|------|------|------|------|
| T710 | [Share with Coach](tasks/post-launch/T710-share-with-coach.md) | TODO | 1.2 | [x] | Coach account type + sharing: roster uploads, assign annotations to players, clip ratings, notes, send-back flow. Absorbs T1060 (Coaches View) |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 1.1 | [x] | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |
| T2170 | [Glow & Arrow Primitives](tasks/overlay-v2/T2170-glow-arrow-primitives.md) | TODO | 1.5 | [ ] | Soft radial glow aura + floating arrow pointer for wide shots. |
| T2190 | [Extended Presets](tasks/overlay-v2/T2190-extended-presets.md) | TODO | 2.5 | [ ] | "Recruiting" (minimal + persistent label) and "Social" (pulse + glow + broadcast name) presets. |
| T2200 | [Outline Trace Primitive](tasks/overlay-v2/T2200-outline-trace-primitive.md) | TODO | 0.7 | [ ] | Edge-detect player silhouette outline. Expensive to compute, premium-feel. |
| T2210 | [Spotlight Cone Primitive](tasks/overlay-v2/T2210-spotlight-cone-primitive.md) | TODO | 1.2 | [ ] | Darken/desaturate everything outside player region. High-drama cinematic effect. |
|  | **[Overlay 3](tasks/overlay-v2/EPIC.md)** |  |  |  | Composable overlay system: player labels, pulse rings, score bugs, event badges, presets. Clips look like pro TikTok/IG edits. |
| T2100 | ↳ [Composable Overlay Architecture](tasks/overlay-v2/T2100-composable-overlay-architecture.md) | TODO | 1.3 | [ ] | Refactor single ellipse into composable primitive system with common config, composition engine, stacking rules |
| T2120 | ↳ [Pulse Ring Primitive](tasks/overlay-v2/T2120-pulse-ring-primitive.md) | TODO | 2.3 | [ ] | Animated scale + opacity loop for dramatic moments (goals, big saves). 1-2s duration. |
| T2150 | ↳ [Overlay Presets System](tasks/overlay-v2/T2150-overlay-presets-system.md) | TODO | 2.0 | [ ] | One-click templates: "Spotlight", "Goal", "Custom". Wire up multiple primitives at once. |
|  | **[On Fire: NBA Jam heat effects](tasks/on-fire/EPIC.md)** | TODO | 0.7 |  | Filed 2026-09-08 as a thought experiment for the "spice it up" tail of the roadmap, AFTER Overlay 3 (T2100 is a hard prerequisite). NBA Jam's rule (3 consecutive baskets, "He's heating up" at 2, "He's on fire" at 3, flaming ball, burning net) mapped onto a reel: per-region heat level off/heating/fire, flames anchored to the spotlight ellipse with a trail along the spline velocity, and an auto-escalation preset across a 3-clip reel. Audit verdict: there is NO player tracker today (spotlight motion between keyframes is Catmull-Rom interpolation; YOLO samples 4 frames per clip, person-only, no track ids) and every effect must be mirrored in SVG preview + backend numpy + Modal inline numpy (T5250 dropped glow/pulse for this), so v1 = sprite-sheet flames driven by a pure placement function with a parity test, exactly NBA Jam's own technique. Ball flames are evidence-gated behind a recall spike on Focus OUTPUT video (COCO class 32; no ball detection exists anywhere in src/). Original art only, no announcer audio, no new Postgres state, no migration for Phase 1. |
| T9210 | ↳ [Flame asset pipeline + heat placement spec (mirrored x3)](tasks/on-fire/T9210-flame-assets-and-placement-spec.md) | TODO | 1.3 | [ ] | Epic 1/6. Offline deterministic sprite generator (original art: plume, trail, ember, smoke, ring, burst; 24-frame loops), pure `heat_placements(t, level, anchor, velocity, radius, ...)` in 3 mirrored copies + `TestModalInlineParity`, spline velocity helper (central difference). Ships inert. |
| T9220 | ↳ [Per-region heat level: data key, action, settings UI](tasks/on-fire/T9220-region-heat-level-data-and-ui.md) | TODO | 1.7 | [ ] | Epic 2/6. First per-region style field: additive `heat` key on the region dict in `highlights_data` (no migration, T4355 precedent), `set_region_heat` action with CAS bump, Off/Heating/Fire control on the active region in OverlaySettingsCard, carry-forward preserves it. |
| T9230 | ↳ [Render the fire in all three paths (preview, backend, Modal)](tasks/on-fire/T9230-render-fire-three-paths.md) | TODO | 0.9 | [ ] | Epic 3/6. SVG `<image>` layer with screen blend in HighlightOverlay; numpy sprite blend in `_process_frames_to_ffmpeg` and Modal `_render_highlight` (sprites shipped as bytes per call, T5225 pattern); fire ring replaces the stroke; reveal-envelope fade; frame-level parity test + preview-vs-export QA spec. Modal redeploy gate. |
| T9240 | ↳ ["NBA Jam mode" auto-escalation preset + goal burst](tasks/on-fire/T9240-nba-jam-mode-preset.md) | TODO | 1.5 | [ ] | Epic 4/6. One-gesture preset via T2150: play 1 off, play 2 heating, play 3+ fire (fans out surgical `set_region_heat` actions, nothing stored twice); burst in the last 0.4 s of a fire region or at T2140's GOAL badge; optional "{Name} is on fire" text beat via T2130/T2140. No audio. |
| T9250 | ↳ [Dense tracking for feet fire + scorch footprints](tasks/on-fire/T9250-dense-tracking-feet-fire.md) | TODO | 0.7 | [ ] | Epic 5/6. New Modal `track_region_modal` (Ultralytics ByteTrack, person-only, every frame of fire regions on the WORKING video), athlete track picked by IoU with the user's ellipse, 1-euro smoothed feet, spline gap-bridge under 0.5 s, derived `heat_tracks` region key, scorch decals, credit-estimated GPU cost. Shares design with T2160/T2220. |
| T9260 | ↳ [Ball on fire: recall spike, then possession + shot trail (evidence-gated)](tasks/on-fire/T9260-ball-on-fire-spike.md) | TODO | 0.4 | [ ] | Epic 6/6. Stage 1 = measure COCO class 32 recall inside hand-labeled possession windows on 10 real Focus-output videos at imgsz 640/1280; GATE >= 80% or close with numbers. Stage 2 = Kalman ball track, possession (ball within 0.6 x bbox height of feet for 3 frames), shot detection on release speed, ball_flame + shot_trail placements. Never ship a blinking ball flame. |
|  | **[PWA Epic](tasks/pwa/EPIC.md)** |  |  |  | Background export + push notifications + background uploads + share target + offline playback |
| T443 | ↳ [Background Export Tracking](tasks/pwa/T443-background-sync.md) | TODO | 1.4 | [ ] | Export survives app close -- service worker tracks Modal job, notifies on completion. |
| T444 | ↳ [Push Notifications & Badges](tasks/pwa/T444-push-notifications-badges.md) | TODO | 1.6 | [ ] | Push for export complete + shared clips received. Badge count on app icon for pending items. |
| T447 | ↳ [Background Fetch for Uploads](tasks/pwa/T447-background-fetch-uploads.md) | TODO | 2.0 | [ ] | Multi-GB game uploads survive app close/switch. Parents upload at the field on cellular. THE differentiator. |
| T448 | ↳ [Share Target API](tasks/pwa/T448-share-target-api.md) | TODO | 2.3 | [ ] | Receive videos FROM camera roll directly into Reel Ballers upload flow. Eliminates file picker friction. |
| T449 | ↳ [Offline Reel Playback](tasks/pwa/T449-offline-reel-playback.md) | TODO | 2.0 | [ ] | Cache exported reels for offline viewing + persistent storage. Show reels without cell signal. |
| T1910 | ↳ [Tutorial Video](tasks/for-launch/T1910-tutorial-video.md) | TODO | 2.7 | [ ] | Record walkthrough video: upload game, annotate clips, frame, overlay, export. Embeddable on landing page and in-app onboarding. |

---

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
- `T2100-T2220` - Overlay System v2 epic
- `T2250-T2260` - Session Scaling epic
- `T2300-T2380` - Landing Page Redesign epic
- `T2400` - Grace Period for Expired Games
- `T2410-T2430` - Expired Game Experience epic
- `T12910-T12950` - Keep Only Marked Plays epic (T12910 bug prerequisite, T12950 tile brilliant count)
- `T14295-T14340` - Player Moments epic (research refresh / candidate registry, ground truth + Veo bar, hosted video-search pilot, tracking bake-off, video-VLM criticality, productize)
- `T2450-T2470` - Auto-Export Reliability epic
- `T2480` - Modal Spline Interpolation
- `T2550-T2570` - R2 CDN Video Serving epic
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
- `T1536, T1537, T3760, T3770` - **Perf batch (HAR 2026-06-17)** — coordinated rollout across 2 branches / 3 conversations. See [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md). Branch `feature/perf-quests-latency`: **T1536 DONE (deployed 2026-06-18)** as a correctness/DRY cleanup — HAR re-attribution showed `/progress` had no above-baseline server cost; **T1537 moved to the [Session Scaling epic](tasks/session-scaling/EPIC.md)** (BLOCKED on T2250 write-back, since its fix needs fire-and-forget analytics). Branch `feature/perf-page-load`: T3760 (framing clip cold-load over-fetch, re-opens T2560 clamp on latency grounds) + T3770 (StrictMode duplicate page-load fetch confirm, disjoint files).

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
