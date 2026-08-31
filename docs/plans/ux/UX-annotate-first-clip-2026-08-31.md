# Annotate: users get a game video in, then never make a single clip

UX Designer agent investigation, 2026-08-31. Screen: Annotate (upload -> FIRST CLIP), the decisive funnel cliff per the 2026-08-27 drop-off refresh.

**Data source: PRODUCTION, read-only.** Funnel + failure reasons from prod Postgres (`user_segments` / `user_actions`, SELECT-only via `.env.prod` DATABASE_URL). Per-user trails from each user's `user_action_log` (prod `user.sqlite` downloaded read-only from R2 to a temp dir). Screen reproduction on local dev (chromium emulation, NOT real iOS Safari), fresh No-Sport profile on the e2e dev account. Nothing was written to any environment.

**Caveats stated up front (small N, mixed instrumentation eras):**
- N = 55 real signups all-time, 45 in the last 30 days. At this N, every number below is users, not percentages of significance. Relative comparisons only.
- Event vocabulary grew mid-August: `game_upload_succeeded` / `clip_save_attempted` / `add_clip_opened` (T7510, ~Aug 19), `add_game_opened` / `upload_file_selected` (T7890, ~Aug 27), impressions + session-exit breadcrumbs (T7515, ~Aug 29-30). Cross-era ratios (e.g. all-time `clip_created`=10 vs `add_clip_opened`=5) partly reflect instrumentation age, not behavior. Where it matters I use last-30d numbers.
- Zero `*_impression` rows exist yet (instrumentation days old), and only the newest stuck user (chenyh1225) has session-exit breadcrumbs. Frustration-wall evidence is therefore thin by construction, not because no walls exist.
- Weekend-game seasonality: Aug 23-30 spans two weekends; signup surge (2026-08-24 refresh) is unattributed organic.
- The dev account used for reproduction was not virgin (user-level quest state was 4/6 on its default profile); the Annotate screens below were captured on a freshly created No-Sport profile with zero games, which matches a true new signup (T7850 makes `no_sport` the default for all new profiles).

---

## Evidence

### Funnel (prod, distinct real users, excluding the owner account)

| Step | All-time (N=55) | Last 30d (N=45) |
|---|---|---|
| signed up | 55 | 45 |
| session_started | 43 | 35 |
| add_game_opened (T7890 era only) | 10 | 10 |
| upload_file_selected (T7890 era only) | 3 | 3 |
| game_created (upload ATTEMPT) | 24 | 19 |
| game_upload_succeeded (T7510 era only) | 6 | 6 |
| annotation_completed (watched annotate video) | 17 | 11 |
| add_clip_opened (T7510 era only) | 5 | 5 |
| clip_save_attempted (T7510 era only) | 3 | 3 |
| **clip_created** | **10** | **6** |
| framing_opened | 7 | 3 |
| export_completed | 4 | 1 |
| share_completed | 2 | 0 |

Failure reasons (all-time): `game_upload_failed:network` 3 users / 21 events, `game_upload_failed:refused` 1 user / 1 event. `clip_save_failed`: **zero** — no one who tried to save a clip was refused by the system; the loss is upstream of the save.

Two cliffs converge on this report's screen:
1. **add_game_opened (10) -> upload_file_selected (3)** — 7 of 10 users who opened the Add Game modal never picked a file (T7890's contract: picker/entry failure or bail).
2. **annotation_completed (11, last-30d) -> add_clip_opened (5) -> clip_created (6)** — roughly half the users who watch their uploaded game video never open the clip form at all. The loss is "never attempted", not "attempted and failed".

Also: `watched_annotate_tutorial` = **15 users, only 3 of whom ever created a clip** — more users have watched the how-to-clip tutorial than have ever selected a file to upload.

### Case studies (6 stuck users, uploaded-or-attempted but zero clips; from prod `user_action_log`)

**1. mostafaali452010 (mobile)** — the purest annotate-screen loss. Upload durably succeeded 11:49:32; opened Add Clip 11:50:10; session ended 11:51:28. Opened the clip form, spent <=78s in it, never saved (no `clip_save_attempted`), never returned. 408s total engaged.

**2. lincdyn.j19 (desktop)** — upload succeeded 03:14:00; left Annotate after ~33s (annotation_completed 03:14:33); **watched the annotate tutorial two minutes AFTER leaving** (03:16:20); never came back. Classic "couldn't see what to do, went looking for instructions, instructions didn't bring them back."

**3. kristi.defelice (mobile)** — watched tutorial first, then uploaded **4 separate "games" in 2.5 minutes** (each finalized within ~5-10s, i.e. short phone clips uploaded one-per-game), then `payment_started` x2 ($3.99) at 21:08, then gone. Never visited the Annotate screen at all. Reading: her highlights were already cut on her phone; she uploaded them as four games, exhausted her 2-credit balance (each game costs 2 credits at submit), hit the buy screen, and quit at the till having seen zero output. 837s engaged.

**4. t_tolovaeball (desktop)** — `game_created` but the upload never durably landed (stranded pending); still spent **31.6 minutes engaged**, hitting the Annotate screen twice. Long dwell, almost no actions: annotating against a video that would never exist.

**5. roooooooooom1h (desktop)** — the known T7490 stranded multipart (0 parts). Same shape as #4: annotate visits over a dead upload, gone in 6 minutes.

**6. chenyh1225 (desktop + mobile + PWA)** — 7 upload attempts across three platforms in 27 minutes: 1 `refused` on mobile, then `network` x6 on desktop/PWA (Aug 30 — post-T7480, upload failures are still live). Session-exit breadcrumbs (the only user who has them) show every session dying on `annotate` or `project-manager`; watched the tutorial mid-retries; opened Add Clip once at 13:41:37 (with no durable video) and exited 16s later. Fought hard, got nothing.

Contrast (converted cohort, N=10): the users who DID clip skew long-engaged (bknoto 15,635s, stephmckinnon 1,814s) — when someone gets over the first clip, they binge (clip_created = 205 events across 10 users, ~20 clips/user).

---

## The Screen

Screenshots in `screenshots/` (dev reproduction; mobile 390x844 first, then desktop 1440x900).

### Mobile (the demographic's primary context)

| # | File | What it shows |
|---|---|---|
| 1 | `mobile-02-quest-overlay-blocks-dropzone.png` | **The Get Started quest panel sits ON TOP of the Add Game modal**, completely hiding the Video Format field and the video upload dropzone. Playwright's tap on the dropzone was intercepted by the quest panel's "Watch tutorial" button — a real thumb tap lands on the tutorial, not the picker. |
| 2 | `mobile-05-quest-overlay-blocks-create-profile.png` | Same panel, different flow: it covers the Add Profile Cancel/Create buttons. It also **re-expands itself after navigation** — collapsing it once does not keep it out of the way. |
| 3 | `mobile-07-add-game-ready-credits.png` | The commitment moment: "2 credits for 30 days of storage — Balance: 2" directly above the submit button on a user's FIRST upload. |
| 4 | `mobile-08-annotate-during-upload.png` | First landing on Annotate. The actual first-clip action is the **tiny unlabeled green "+" icon** in the transport bar. The two largest, loudest buttons — "Playback Annotations" (disabled) and "Shared" — are both useless to a first-timer. The empty-state copy says *Use "Add Clip" button or pause in fullscreen to add clips* — **no button labeled "Add Clip" exists on this screen**, and "pause in fullscreen" is a second, unexplained gesture. Footer says clips are saved "as you annotate" (jargon). |
| 5 | `mobile-09-add-clip-overlay.png` + `mobile-10-add-clip-overlay-bottom.png` | The Add Clip form: range editor (defaults 00:00.0 -> 00:03.0), rating labeled **"Rating (press 1-5)"** (keyboard copy on a phone), an amber warning **"Pick your sport to tag this clip"** (every new signup is `no_sport` since T7850, so 100% of first-timers see a warning state mid-first-clip), a free-text Clip Name, a My Athlete/Team "Layer" choice — and **Save is below the fold**; the form must be scrolled to find it. Five decisions + a scroll for the very first unit of work. |
| 6 | `mobile-11-after-first-clip-save.png` | After saving the first clip: a "1" badge and a small green tick on the timeline. No confirmation moment, no preview of the clip, no "that's 1 of your reel". The video keeps playing. |

### Desktop

| # | File | What it shows |
|---|---|---|
| 7 | `desktop-01-annotate-one-clip.png` | At 1440x900 the **Team lane and the bottom action row are below the fold**; the quest panel (expanded, bottom-left) overlaps the sidebar/lane labels. The sidebar teaches a THIRD gesture: "Click timeline to add clip". Import/Export (TSV power features) sit at the top of the sidebar in a first-timer's face. |
| 8 | `desktop-03-annotate-scrolled-timeline.png` | After scrolling: two labeled lanes (My Athlete / Team), "No Team clips yet", giant "Playback Annotations" + "Shared w/ Tagged Teammates" buttons. Desktop's transport DOES have a labeled "+ Add Clip" button. |

### Checklist violations (heuristic sweep)

- **B (hierarchy):** the primary action is the visually weakest interactive element on mobile; two big irrelevant buttons out-shout it. First plausible-looking element is NOT the correct next step.
- **B (copy):** three surfaces instruct three different gestures ("Add Clip button" / "pause in fullscreen" / "click timeline"); the named button doesn't exist on mobile. Jargon on the critical path: annotate, Layer, Import/Export, Playback Annotations.
- **E (mobile):** ~24px tap target for the primary action; Save below the fold; "press 1-5" keyboard copy; quest overlay eats taps and re-expands.
- **D (errors/safety):** the sport-warning renders the first clip form in an alarm state for every new user; nothing tells the user a clip is editable later ("you can change this later" is missing at the range/name/rating moments).
- **H (funnel psychology):** the onboarding's own step 1 is *watch a video* (consumption before action); credits are demanded before any value is shown; the first save has no celebration and no accruing-value meter ("1 clip toward your reel"); annotating during a dying upload burns half an hour of the scarcest resource (parent motivation) with zero feedback that the upload died.
- **G (editor grammar):** the backward-capture model ("Add clip **ending at** current time" — tap when the play finishes) is genuinely good for sports but is never taught; CapCut grammar users expect select-start/select-end.

---

## Candidate explanations considered (before ranking)

1. Upload never durably lands, user annotates a ghost (reliability + honesty of status).
2. Quest overlay mechanically blocks the pre-upload path on phones (tap-stealing).
3. Gulf of execution on Annotate: first-clip action invisible/contradictory (never attempted).
4. First-clip form is a five-decision wall (attempted, then abandoned).
5. Credits/paywall before any value; short-clip uploaders exhaust balance instantly.
6. Mental-model mismatch: parents with pre-cut phone clips don't need a game annotator at all ("done-enough": camera roll already has the clip).
7. Tutorial detour substitutes watching for doing.
8. Backward-capture clip semantics never explained; degenerate 0:00->0:03 first experience.
9. Value never visible: no example of a finished highlight anywhere on the path; effort precedes all payoff.
10. Interruption/context: 90-minute game film scrubbed one-thumb on a couch; finding one play costs minutes.

Ranked below by fit with the six trails, then severity x reach. Theories 6/8/9/10 fold into T1/T3/T4 as mechanisms rather than standing alone.

---

## Theories (ranked)

### T1: Nothing on the Annotate screen points at the first-clip action (gulf of execution, cross-platform)

- **Mechanism:** differential row 1 — *key action never attempted* (signifier failure). Checklist B: primary action weakest element; three contradictory instructions; the named "Add Clip" button doesn't exist on mobile. The two loudest buttons do nothing useful for a first-timer.
- **Evidence for:** last-30d: 11 users watched their game video on Annotate, only 5 ever opened the clip form; `clip_save_failed` = 0 (the system never refuses — users never arrive). lincdyn.j19 stared at the screen 33s, left, went looking for the tutorial. t_tolovaeball spent 31 minutes without ever opening the form.
- **Evidence against:** desktop HAS a labeled "+ Add Clip" and still converts only 7 of 14 annotate-reachers (all-time) — so labeling alone isn't the whole story; the contradictory triple-instruction and buried value apply to both platforms though.
- **Falsifiable prediction (checked):** if signifier strength were the only cause, desktop (labeled button) should convert annotate->clip far better than mobile (unlabeled icon). **Checked: desktop 7/14, mobile 3/5 (+1/1 pwa-mobile)** — roughly equal. So the failure is the *whole screen's hierarchy* (both platforms bury the action among louder irrelevancies), not just the missing label. Prediction that remains open: making the clip CTA the single loudest element should raise annotate->add_clip_opened from ~1/2 toward the ~95% first-try target.
- **Proposed fix (smallest):** one primary CTA, same words everywhere: a full-width high-contrast button under the video — **"Clip a play"** — present on both platforms; demote "Playback Annotations"/"Shared" to text-level until clip_count > 0; delete the two alternate instructions; empty-state copy becomes the button itself.
- **Fuller redesign:** first-visit coach mark sequence on that one button ("Watch. When something great happens, tap here — we grab the last few seconds"), teaching the backward-capture model in one sentence, replacing the tutorial-video quest step.
- **Expected movement:** annotation_completed -> clip_created (activation input metric; T7460 scorecard "first clip" goal). Watch add_clip_opened/annotation_completed weekly.

### T2: The Get Started overlay physically steals the taps that lead to the first clip (mobile mechanical blocker — reproduced)

- **Mechanism:** differential row 1 again, but literal: the control is *hidden under another element*. Checklist E/F violations: overlay covers modal controls at 390x844, re-expands after every navigation, and its "Watch tutorial" button sits exactly where the upload dropzone is.
- **Evidence for:** reproduced twice in dev (screenshots 1-2): it intercepted the dropzone tap in the Add Game modal and the Create button in Add Profile. Prod: mobile add_game_opened 6 -> upload_file_selected 2; 15 users watched the tutorial vs 3 who ever clipped — consistent with taps landing on "Watch tutorial" and with the overlay pushing consumption over action. kristi (mobile) watched the tutorial before managing an upload.
- **Evidence against:** webapp-desktop also loses 3 of 4 at the same step, and the overlay does NOT cover the centered modal at desktop sizes — so the overlay cannot be the only force in the add-game gap (file-picker bail, video-not-on-this-device, etc. remain live at desktop). N=12 total, era-limited.
- **Falsifiable prediction (checkable now in code, checked in dev):** any tap in the dropzone's lower region while the quest panel is expanded triggers the tutorial or is swallowed — confirmed by Playwright interception logs. Prod-checkable once T7515 impressions age: mobile users with `add_game_opened` and no `upload_file_selected` should show tutorial opens within the same minute.
- **Proposed fix (smallest):** quest overlay auto-hides (fully, not collapses) whenever ANY modal/form is open; never auto-re-expands after a user collapses it; z-order beneath modals. One state check + persistence of the collapsed flag.
- **Expected movement:** add_game_opened -> upload_file_selected on webapp-mobile (currently 2/6); secondarily watched_annotate_tutorial should FALL (accidental opens disappear).

### T3: The first clip costs five decisions and a scroll (effort wall inside the Add Clip form; mobile worst)

- **Mechanism:** differential row 2 — *acted, then quit*: gulf of evaluation + effort. Hick's law violation (checklist B: every deferrable option must be deferred); Tesler violation (sport choice pushed onto the parent mid-clip); checklist E (Save below fold, keyboard copy on phone).
- **Evidence for:** mostafaali (mobile) opened the form and abandoned within 78 seconds without saving — the only pure in-form abandonment we can see, and he is 1 of only 5 users to ever open it. Every new signup since T7850 sees the amber "Pick your sport" warning IN the form (reproduced). T7540's save-dead-end (fixed Aug 25) lived in this same form — this form has already produced one shipped trap.
- **Evidence against:** N=1 clean in-form abandonment; 3 of 5 openers did save (small N cuts both ways). The T7922 inline sport picker already softened the sport wall (shipped Aug 28; mostafa's Aug 27 session predates it).
- **Falsifiable prediction:** users who open the form and DON'T save should cluster on mobile portrait (scroll-to-Save + typing). Not yet checkable (need form-level impressions; T7515 vocabulary can carry `dialog_impression:add_clip_opened_no_save` cheaply). Check after 2 weeks of data.
- **Proposed fix (smallest):** Save visible without scrolling (sticky footer in the overlay); default everything: clip saves with one tap (range default + rating 4 + auto-name "Clip 3" + My Athlete), details editable afterward from the clip row. Move the sport prompt out of the critical path (ask once, at first save, as a full-screen one-question step — TurboTax style — not an amber warning inside a form).
- **Expected movement:** add_clip_opened -> clip_created; time-to-first-clip within first session.

### T4: The app asks for money before it has shown any value (anxiety at the commitment moment + camera-roll mental model)

- **Mechanism:** differential row 3 — *quit at commitment point*: anxiety, plus HABIT (the camera roll already has the clips; any friction and the raw video gets posted instead). Checklist H: dessert before vegetables inverted — the bill arrives before the meal.
- **Evidence for:** "2 credits for 30 days / Balance: 2" sits above the very first submit (reproduced). kristi uploaded 4 pre-cut short clips as 4 games in 2.5 minutes, hit `payment_started` twice, quit, never saw Annotate. **Checked: 2 of the 4 users who ever started a payment had zero clips at that moment.** bigajosue PAID (credit_purchased) before creating anything and ended with nothing.
- **Evidence against:** only 1-2 clean cases; kristi's shape also fits T7860's missing direct-clip-upload path (her real need was "upload clips", which doesn't exist yet, so 'games' was the only door).
- **Falsifiable prediction:** users whose first-session uploads finalize in <15s (short clips) convert to clip_created at near zero and hit payment/credit surfaces at elevated rates. Checkable now against `[UPLOAD_LIFECYCLE]` durations + trails, and continuously once more users arrive.
- **Proposed fix (smallest):** suppress all credit UI while `clip_created` = 0 (first game simply free, no counter shown); price talk first appears after first export moment. Fuller: ship the reserved `clip_uploaded` direct path (T7860) so pre-cut clips don't cost per-"game".
- **Expected movement:** upload_file_selected -> game_upload_succeeded -> clip funnel for the short-video cohort; payment_started moves later in user lifetime (and completes more).

### T5: The upload dies quietly while the user annotates a ghost (reliability + status honesty — still live, not historical)

- **Mechanism:** differential row 7 — *same wall across sessions, genuine blocker*, compounded by a gulf-of-evaluation on Annotate: annotate-during-upload is supported, but when the upload dies the screen doesn't confront the user; they invest against nothing.
- **Evidence for:** 21 `network` failure events from 3 users, **Aug 30** — after T7480 shipped. t_tolovaeball: 31 engaged minutes over a stranded pending. roooooooooom1h: the known T7490 0-part multipart. chenyh1225: 7 attempts, 3 platforms, exits all on annotate/project-manager; one mobile `refused` (worth a separate look: what did validation refuse about a phone video?). The dev repro also hit the same family: a "Game ready!" toast, then the game row vanished (the unfiled ojedalucas19 shape).
- **Evidence against:** upload reliability is its own epic (T7470-T7510) and outside this screen's redesign; listed because the Annotate screen is where the cost lands.
- **Falsifiable prediction:** stranded/pending games with `viewed_duration > 0` exist in prod (users annotating ghosts). Checkable read-only against game rows; the two T7490 accounts already confirm the shape.
- **Proposed fix (smallest, screen-side):** a persistent, honest upload-state strip ON Annotate ("Uploading: 34%... / Upload failed — Retry") that cannot be missed, replacing silence; block nothing (annotate-during-upload stays), but never let a death pass silently.
- **Expected movement:** game_created -> game_upload_succeeded; fewer multi-platform retry spirals.

### T6: The product teaches watching, not doing (tutorial as detour)

- **Mechanism:** checklist A ("tooltips and help text are admissions of failure") + H (consumption before action drains the psych budget). The quest's own step for this screen is *Watch Annotate Tutorial*.
- **Evidence for (checked):** 15 users watched the tutorial; 3 ever created a clip. lincdyn watched it AFTER failing on the screen and still never returned — the tutorial demonstrably did not close his gap. Partial confound: T2 says some watches are accidental taps; selection effect says strugglers watch tutorials.
- **Falsifiable prediction:** replacing the tutorial quest-step with a do-step (coach mark on the clip CTA) raises first-session clip_created for new signups vs the tutorial cohort baseline (3/15).
- **Proposed fix:** quest step 1 for this screen becomes "Clip your first play" pointing at the real button; tutorial demoted to a "watch how" link inside the coach mark.
- **Expected movement:** watched_annotate_tutorial down, clip_created up — the ratio is the tell.

### T7 (runner-up): Backward-capture semantics are never taught

"Add clip **ending at** current time" is the right grammar for sports but foreign to CapCut-trained users; at t=0 it produces a degenerate 0:00->0:03 clip, and the saved clip's sidebar row shows `0'00"`. No trail directly implicates it (the loss happens before most users reach this point), so it rides behind T1/T3's fixes (the coach-mark sentence teaches it). Listed so the copy fix isn't forgotten.

---

## Recommended experiment order (cheapest leap-of-faith test first)

1. **Quest overlay yields to modals** (T2 — config-level change, no redesign). We believe hiding the quest overlay whenever a modal is open will cause mobile users to reach the file picker, measured by webapp-mobile `upload_file_selected / add_game_opened` rising from 2/6 toward parity with pwa-desktop (2/2). Also watch watched_annotate_tutorial fall.
2. **One loud clip CTA + kill contradictory copy** (T1 — copy/signifier only). We believe a single full-width "Clip a play" button under the video (both platforms, disabled states demoted) will cause more first-timers to attempt a clip, measured by `add_clip_opened / annotation_completed` rising from ~1/2.
3. **One-tap first clip** (T3 — small form change: sticky Save, defaults, sport question moved out). We believe removing the four optional decisions will cause openers to save, measured by `clip_created / add_clip_opened` and time-to-first-clip.
4. **Credits silent until first value** (T4). We believe hiding credit UI before the first clip/export will cause short-clip uploaders to continue past upload, measured by zero-clip `payment_started` going to zero and the <15s-upload cohort's clip rate.
5. **Honest upload strip on Annotate** (T5 — screen-side; the reliability epic continues in parallel). Measured by `game_upload_succeeded / game_created` and the disappearance of 20-minute ghost-annotation sessions.
6. **Do-step replaces tutorial step** (T6 — quest config). Measured against the 3/15 tutorial-watcher baseline.

Items 1-2 test the shared leap-of-faith assumption behind everything else: *that these users still want the clip and are being physically/perceptually prevented* — if mobile file-selection and add_clip_opened don't move, the residual explanation is motivational (T4/T6 territory, or T7860's missing direct-clip path), and a screen redesign should pause until that's known.

---

*Screenshots: `docs/plans/ux/screenshots/`. Probe scripts (read-only) ran from the session scratchpad; queries reproducible from `user_actions`/`user_segments` + per-user `user_action_log`. Dev residue: one "UX Fresh" profile with 1 game + 1 clip on the e2e dev account.*
