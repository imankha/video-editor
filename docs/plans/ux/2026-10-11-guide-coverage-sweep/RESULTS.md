# T12590 guide coverage sweep: results (live staging walk, 2026-10-12)

Target: https://reel-ballers-staging.pages.dev (API reel-ballers-api-staging.fly.dev), deployed from master 51f58e93a (T12570, T12580, T11940 all in).
Account: `e2e@test.local`, reset to blank with `scripts/reset-test-user.py --env staging` (through a `fly proxy 15432`), Guidance ON. Driven with Playwright (Chromium, touch emulation at 768 and 390), one session at a time.
Credits: 88 at start, 62 at end (upload 2, three highlight generations 8 each; the spotlight generation was free).
End state of the account: 1 game, 2 finished highlights (Play 1 and Play 2, no spotlight and with spotlight and text), Play 3 framed but not finished, Play 4 made but not framed.
Screenshots: only the ones cited below were kept (`screens/`); the rest were discarded. Raw sweep numbers were printed during the run, the figures that matter are quoted in the tables.

Legend: P = pass, F = fail (maps to a task), n/t = not tested (reason in section 8). The 2026-10-18 re-walk (section 10) fills most n/t cells below; where a cell here and section 10 differ, section 10 is newer, `-` = not applicable. Viewport order everywhere: 1440x900 / 1024x768 / 768x1024 / 390x844.

## 1. Result in one paragraph

The T12580 shade works as designed on the paths it covers (shade with blur, cutout, Got it, Esc, shade swallows taps, Guidance switch stays live, progress states are dialog only). The sweep found 10 gaps, filed as T12620 to T12710. The three worst: the Focus Play button (and the video controls) are under the action band at 1440x900 and 1024x768 so the guide's "Tap Play" is unreachable and Generate stays locked until the user plays (T12630); several shaded steps leave the control the sentence names shaded (T12620); the Overlay spotlight walk is not a focused step, covers the video it asks the user to click, and is off-screen on phones (T12640). Layout: no horizontal overflow at 320, 360, 375, 390, 768 on any of the four screens.

## 2. The three new features

### T12580 shaded guide steps: PARTIAL PASS

| Check | Result | Evidence |
|---|---|---|
| Each step opens Focused (shade with blur, step control and dialog sharp, Got it button) | P on Home, Annotate, Focus at all four viewports | `guide-shade` = `backdrop-filter: blur(4px) brightness(0.75)` with an evenodd clip-path cutout; [t1-home-focused-1440](screens/t1-home-focused-1440.jpg), [f1-768](screens/f1-768.jpg), [h-games-390](screens/h-games-390.jpg) |
| Got it frees the screen until the step changes; Esc acts as Got it | P | Home 1440: shade gone after both; the next rule re-opened Focused |
| Tap on the shade does nothing | P | a tap on the Clips tab through the shade did not change tabs (1440) |
| Guidance switch stays clickable under the shade | P at 1440, 1024, 390; covered at 768 Focus by the header collision | `elementFromPoint` on the toggle; see T12670 |
| Progress and error states show the dialog only | P | Focus generating at 1440 and 1024: dialog, no shade |
| Watch steps keep the video sharp | P at 1440, 1024, 768; F at 390 where the docked dialog covers the video control row | T12650 |
| Spotlight pick shades once per rule | F: the pick walk has no shade at all (inline guide) | T12640 |
| At 390 no cutout is unreachable | P for reachability; F where the dialog covers the cutout (Focus step 2) | T12650 |
| Guidance OFF = no shade, no dialog | P (Overlay 1440: toggled off, shade and dialog gone) | |
| Cutout contains what the sentence names | F on 5 rules | T12620 |

### T11940 status vocabulary: PARTIAL PASS

"Clipped", "Framed", "Spotlight started", "Overlaid", "Not framed" appear nowhere on Home Games, Clips, Finished at 1440, 768, 390 (page text scan). Tiles and badges use only "In progress" and "Finished" ("Not started" never appeared; a highlight made but not framed shows "In progress"). F: the Clips By-game legend reads "Done, In Progress, In progress, Draft" and lists the same status twice ([c-bygame-768](screens/c-bygame-768.jpg)), T12680.

### T12570 polish bundle: PARTIAL PASS

- P: upload modal X is named "Close" and 44x44, Escape closes it (1440 and 390).
- P: Edit game and More actions are 44 px on touch (768 and 390 tap-target scan found none under 44 on Home).
- Still open (T12700): coach X 28x28, clip-count chip 51x34, speed "1x" 39x32, "Report a problem" 108x20 at 390, viewer Share and Download 32 px high, game type buttons 36 px, box glyph in locked gauges, empty circle icons in the Share modal tiles.
- N34 (sport from the upload modal): not conclusive. The sport was chosen with a scripted select followed by a scripted file pick; "Pick sport" stayed in the header and "What sport is this?" appeared at the first play. Needs one real tap check (T12700).

## 3. Per-screen verdicts

Coverage = is there a guide (rule id). Content = does it point at the shortest path to another export. Layout and Placement are per viewport (1440 / 1024 / 768 / 390). Placement = dialog near the item, on the side facing the centre, not covering it, on-screen.

| Screen / state | Coverage | Rule | Content | Layout | Placement | Task | Screenshots |
|---|---|---|---|---|---|---|---|
| Sign-in gate (signed out by a second login) | none (needs none) | - | -: no editor facts; shown correctly after the session was replaced | n/t / n/t / n/t / F | - / - / - / - | T12700 | [signin-390](screens/signin-390.jpg) |
| Home Games, blank account | yes | home.games.empty | P: one action: Tap Upload game | P / n/t / n/t / n/t | P / n/t / n/t / n/t | - | [t1-home-focused-1440](screens/t1-home-focused-1440.jpg) |
| Home Games, game with finished highlight(s) | yes | home.games.finished | F: text says Open Finished but the sharp item is the game card | P / P / F / P | P / P / P / F | T12620, T12650, T12670 | [h-games-390](screens/h-games-390.jpg) |
| Home Clips, empty | yes | home.clips.empty | F: text says open a game; the sharp item is a heading, Upload highlight and the Games tab are shaded | P / n/t / n/t / n/t | F / n/t / n/t / n/t | T12620 | [t1-blank-Clips-focused-1440](screens/t1-blank-Clips-focused-1440.jpg) |
| Home Clips, drafts | yes | home.clips.drafts | F: shortest path in words; the clip tile named is shaded (heading is sharp) | P / P / P / P | P / P / P / F | T12620, T12650 | [h-Clips-1024](screens/h-Clips-1024.jpg), [h-Clips-390](screens/h-Clips-390.jpg) |
| Home Finished, first highlight | yes | home.finished.first | F: ends at sharing, never points at the next export; Share and the card are shaded | P / P / P / P | P / P / P / F | T12620, T12650, T12660 | [t2-finished-tab-1440](screens/t2-finished-tab-1440.jpg) |
| Home Finished, 2+ highlights (groups collapsed) | NO | - | F: no guide, no advanced-settings invitation | P / n/t / n/t / P | - / - / - / - | T12660, T12710 | - |
| Finished viewer right after Finish, and share modal | yes | finished.viewer, share.modal | P: guide says Get share link, button says Create share link (T12700); phone Share copies the link directly | P / n/t / n/t / P | P / n/t / n/t / n/t | T12700 | - |
| Upload modal (choose, details) | yes | upload.choose | P: plain; Close is named and 44x44; Escape closes | P / n/t / n/t / P | P / n/t / n/t / P | - | - |
| Upload in flight (Annotate, game preparing) | yes | home.games.uploading / annotate.progress | P: one sentence: Getting your game ready. Keep this tab open. | P / n/t / n/t / n/t | n/t / n/t / n/t / n/t | - | - |
| Upload failed, add footage, clip upload limits, too large, report a problem | n/t | - | n/t: not reached on this account (no failing upload) | n/t / n/t / n/t / n/t | n/t / n/t / n/t / n/t | - | - |
| Game details (Edit game) modal | none | - | -: needs none; Escape ignored, type buttons 36 px | n/t / n/t / n/t / P | - / - / - / - | T12690, T12700, T12710 | - |
| Annotate, nothing marked / watch (docked strip) | yes | annotate.progress.watch | P: Tap Play ... tap Mark play, shortest path | F / n/t / n/t / n/t | F / n/t / n/t / n/t | T12650 | [t1-annotate-markplay-1440](screens/t1-annotate-markplay-1440.jpg) |
| Annotate, playing | yes | annotate.progress.watch.playing | P: See a great moment? Tap Mark play | P / n/t / n/t / n/t | P / n/t / n/t / n/t | - | [t1-annotate-markplay-1440](screens/t1-annotate-markplay-1440.jpg) |
| Annotate, plays marked, nothing selected | yes | annotate.has-plays | P: Keep going, or tap a play to make it a highlight | P / n/t / P / n/t | P / n/t / P / n/t | - | - |
| Annotate, a play selected | yes | annotate.selected | F: sends the user to Edit play; Make highlight is the shortest path and is shaded and covered | P / F / P / P | F / F / F / F | T12620, T12650, T12670 | [t1-after-esc-1440](screens/t1-after-esc-1440.jpg), [a-open-1024](screens/a-open-1024.jpg), [a-open-768](screens/a-open-768.jpg) |
| Annotate play editor | yes | annotate.editor | F: names ends and rating, only Done is sharp | P / n/t / P / n/t | P / n/t / P / n/t | T12620, T12690 | [t1-play-editor-1440](screens/t1-play-editor-1440.jpg) |
| Sport picker modal at first play | none | - | -: self explanatory with Skip for now | n/t / n/t / P / n/t | - / - / - / - | T12710 | - |
| Annotate post-Done choice card, review plays, expired source | n/t | - | n/t: not reachable (4-star plays skip the choice card) | n/t / n/t / n/t / n/t | n/t / n/t / n/t / n/t | - | - |
| Focus steps 1 to 3 (drag, play, pause) | yes | focus.progress.drag/play/keep | F: good wording; Play is under the band at 1440 and 1024 and Generate also needs a play (parent finding 1) | F / F / P / P | P / P / P / F | T12630, T12650, T12670 | [t1-focus-step2-1440](screens/t1-focus-step2-1440.jpg), [t1-focus-free-1440](screens/t1-focus-free-1440.jpg), [f1-768](screens/f1-768.jpg), [f1-390](screens/f1-390.jpg), [f-free-390](screens/f-free-390.jpg) |
| Focus step 4 (Preview highlight) | yes | focus.progress.preview | P: Tap Preview highlight to see exactly what you will share | P / P / P / P | F / F / F / P | T12650 | [f4-1024](screens/f4-1024.jpg), [f4-768](screens/f4-768.jpg) |
| Focus preview playing | yes | focus.progress.watchPreview | P: Watch it through; Back to full video | P / n/t / n/t / n/t | P / n/t / n/t / n/t | - | - |
| Focus generating | yes (dialog only, no shade) | focus.progress.export | P: Making your highlight ... we will tell you when it is ready | P / P / n/t / n/t | P / P / n/t / n/t | - | - |
| Focus ready panel | yes (inline) | focus.ready | P: Add a spotlight or Finish without spotlight; Finish subtitle is truncated | P / P / n/t / n/t | P / P / n/t / n/t | T12700 | [t1-focus-ready-1440](screens/t1-focus-ready-1440.jpg), [f-ready-1024](screens/f-ready-1024.jpg) |
| Focus settings panel (aspect ratio, straighten, dim) | NO | - | F: advanced controls unguided, no 2+ highlight invitation | P / n/t / n/t / n/t | - / - / - / - | T12660, T12710 | - |
| Focus failed, needs credits, finishing, already rendered | n/t | - | n/t: not reached (rendered state is silent by design) | n/t / n/t / n/t / n/t | n/t / n/t / n/t / n/t | - | - |
| Overlay spotlight pick walk and Spotlight set | yes (inline, unshaded) | overlay.pick.* | F: good wording; guide covers the video and the athlete (1440, 1024), hidden below the fold on phones | F / F / P / F | F / F / P / F | T12640 | [t1-overlay-m2-1440](screens/t1-overlay-m2-1440.jpg), [t1-overlay-done-1440](screens/t1-overlay-done-1440.jpg), [o1-1024](screens/o1-1024.jpg), [o1-390](screens/o1-390.jpg) |
| Overlay text lane and sheet | yes | overlay.text | F: text tip floats over Generate and a stale Spotlight set guide stays live | F / n/t / n/t / n/t | F / n/t / n/t / n/t | T12640 | [t1-overlay-text-1440](screens/t1-overlay-text-1440.jpg) |
| Overlay generating and ready | yes (dialog only) | overlay.progress / overlay.ready | P: Adding your spotlight; Looks good? Tap Finish | P / n/t / n/t / n/t | P / n/t / n/t / n/t | T12640 | - |
| Account menu and Buy Credits | none | - | -: needs none; Escape ignored, card pills bleed over the modal (1440) | F / n/t / n/t / P | - / - / - / - | T12690, T12700 | [t1-account-1440](screens/t1-account-1440.jpg) |
| Share and claim pages a recipient sees | n/t | - | n/t: not walked (needs a second signed-out context and a live link) | n/t / n/t / n/t / n/t | n/t / n/t / n/t / n/t | - | - |

Verdict tally (coverage, content, and 4 layout and 4 placement cells per screen, n/t and not-applicable cells excluded from pass/fail): **111 pass, 41 fail, 130 not tested**.

Placement anchors (for the failing and passing cases): Home 1440 and 1024, anchor = Upload game or game card, dialog beside it toward the centre (P). 390 Home, anchor = game card or tile mid-screen, dialog docked at the bottom over the lower half of the card (F). Annotate Mark play at 768, anchor bottom-left, dialog above (P). Play editor, anchor Done at the bottom, dialog above it (P at 1440 and 768). Focus step 4, anchor bottom-right band tile, dialog to its left over the sibling tiles (F at 1440, 1024, 768), above at 390 (P). Focus step 2 at 390, anchor the video Play button, dialog docked over it (F). Overlay pick at 768, anchor athletes in the lower half, dialog at the top (P); at 1440 and 1024 inside the video over the athletes (F); at 390 below the viewport (F).

## 4. Content rule on both account shapes

- Under two finished highlights (first finish): Home "Your highlight is ready to share. Open Finished." then Finished "Tap it to share it or download it": both end at sharing, neither points at marking the next play; wording is plain, no jargon, no claim that the app frames or tracks.
- Two or more finished highlights (same account after the second finish): the same Home, Focus ("Step 1 of 5 Drag the box onto your athlete") and Annotate ("Tap Edit play to adjust this play") text; no advanced controls are invited anywhere; the Finished tab with two collapsed highlights has no guide. The editor guides have no finished-count fact. Filed as T12660 (the likely child the task named) and T12710.
- Shortest path to another export, per state: Home Games finished, Clips drafts, Annotate has-plays, Focus steps 1 to 4, Overlay: on the shortest path. Annotate selected play: sideways (Edit play instead of Make highlight). Home Clips empty: sideways ("Open a game in Games" while Upload highlight is the visible button).

## 5. Overflow sweep (assertNoHorizontalOverflow equivalent)

Measured `document.documentElement.scrollWidth > clientWidth` and horizontal scrollers taller than half the viewport, on Home, Annotate (game open), Focus (Play 4) and Overlay (Play 3).

| Width | Home | Annotate | Focus | Overlay |
|---|---|---|---|---|
| 320 | P | P | P | P |
| 360 | P | P | P | P |
| 375 | P | P | P | P |
| 390 | P | P | P | P |
| 768 | P | P | P | P |

All 20 cells pass (the Annotate and Overlay timeline strips scroll inside their own containers by design). Also P at 1024 and 1440. Tap targets under 44 px at touch sizes: see T12700.

## 6. Parent Usability Audit close (12 findings)

| # | Finding (priority) | Verdict | Evidence |
|---|---|---|---|
| 1 | Hidden crop-box drag unlocks Generate (Critical) | partly fixed: step 1 names the drag, but Generate also needs a play and pause and Play is hidden under the band at 1440 and 1024 | [t1-focus-step2-1440](screens/t1-focus-step2-1440.jpg), [f1-768](screens/f1-768.jpg) (T12630) |
| 2 | "In Spotlight" after skipped / "In Overlay" (Critical) | fixed: only In progress / Finished on tiles | [c-bygame-768](screens/c-bygame-768.jpg) (legend residual T12680) |
| 3 | /annotate and /focus overflow on iPhone (High) | fixed | section 5 |
| 4 | Fixed Generate panel covers controls on iPhone (High) | fixed on phones (band is in the layout, Play reachable); still open at 1440 and 1024 | [f1-390](screens/f1-390.jpg), [t1-focus-free-1440](screens/t1-focus-free-1440.jpg) (T12630) |
| 5 | Upload conflicting progress (High) | not verified in detail: one sentence seen ("Getting your game ready. Keep this tab open.") | |
| 6 | Highlight silently gated by 5-star rating (High) | fixed: a 4-star play offers Portrait and Landscape Make highlight | [t1-after-esc-1440](screens/t1-after-esc-1440.jpg) |
| 7 | Done returns to empty-looking editor (High) | fixed: the play stays selected with Make highlight tiles | [a-open-768](screens/a-open-768.jpg) |
| 8 | Upload cost/balance wrap on iPhone (Medium) | not verified (modal opened at 390 but not inspected for wrap) | |
| 9 | Game titles truncate on iPhone (Medium) | fixed (title wraps to two lines at 390) | [a-open-390](screens/a-open-390.jpg) |
| 10 | Tablet game cards half-width (Medium) | partly: one game only, so one half-width card at 768 | [c-bygame-768](screens/c-bygame-768.jpg) |
| 11 | Editor vocabulary (Medium) | partly: "box", "Moment" remain; spotlight hint says "tracking" | T12700 |
| 12 | Blocking loader says "Ready" (Low-Medium) | not observed | |
| T11890 | Silent Google sign-in failure | **not verified**: T11890 was closed 2026-10-09 by user decision without the Google console origin check or a real-device repro; `[auth-diag]` log lines are the only signal | |

The journey at 1440 does NOT complete without a hidden gesture: Generate needs the video played and paused and the Play button is covered (Space key was needed), so the "no hidden gesture" criterion is not met until T12630 lands.

## 7. Coverage decisions for screens without a guide

Needs none (ruled final by T12710, 2026-10-13): sign-in, sport picker (self-explanatory, has Skip for now), Edit game, Buy Credits, Account menu. Guide added (T12660, rules `home.finished.many` and `focus.progress.generate.advanced`, fixtures in GUIDE_STATES): Finished with 2+ highlights, Focus settings panel advanced-control invitation (T12710 adds no further rule). Not walked: recipient share and claim pages (no ruling; needs a second signed-out context and a live link). Escape and card-pill bleed on Edit game / Buy Credits stay with T12690.

## 8. What I could not test, and why

(2026-10-18 update: items marked RESOLVED were reached in the re-walk, section 10. The rest keep their exact reason.)

- RESOLVED 2026-10-18: Blank-account states at 1024, 768, 390 (Home Games, Clips, Finished empty) captured on a freshly reset account (section 10).
- Upload failed, add footage, clip upload limits, too large to export, report a problem: no failing upload or oversize file on this account, and no credits to burn on repeats.
- Annotate post-Done choice card, review plays, expired source: 4-star plays skip the choice card; no expired game.
- Focus failed, needs credits, finishing: not reachable without spending or breaking credits.
- Annotate watch states at 1024, 768, 390: the account had plays by then (only the has-plays states were reachable).
- RESOLVED 2026-10-18: Sign-in and lost session captured at 1440, 1024, 768 and 390 (section 10).
- PARTLY RESOLVED 2026-10-18: recipient share page captured at all four viewports; the claim page cannot be walked on staging (Open ReelBallers leaves staging for app.reelballers.com); a phone Share still copies the link with no modal (section 10).
- Second fixture account: the 2+ shape was checked on the same account after the second finish.
- Real devices (iOS Safari chrome, keyboard): Chromium emulation only.

## 9. Filed tasks

| Task | Gap | Severity |
|---|---|---|
| T12620 | Shade cutout leaves the named control shaded (5 rules) | HIGH |
| T12630 | Focus Play under the action band at 1440 and 1024; Generate needs a play | HIGH |
| T12640 | Overlay pick walk not focused, covers the video, off-screen on phones, two guides | HIGH |
| T12650 | Dialog covers its item (390) or sits beside bottom items | HIGH at 390, MED elsewhere |
| T12660 | No finished-highlight count: no advanced tier, no next-export pointer | MED |
| T12670 | Guidance toggle collides with title, tabs, breadcrumb at 768 and 1024 | MED |
| T12680 | Clips By-game legend status words | MED |
| T12690 | Esc closes the editor behind a guide; modals ignore Escape; card pills over Buy Credits | MED |
| T12700 | T12570 leftovers and copy nits | LOW |
| T12710 | Coverage decisions for remaining screens | MED |

## 10. 2026-10-18 re-walk (host session, live staging)

Target: https://reel-ballers-staging.pages.dev after the production release landed on staging. Account `e2e@test.local`, reset with `scripts/reset-test-user.py --env staging` (the reset deletes the Postgres user, so it was recreated with `/api/auth/test-login`; new user id eb7320b2, profile 4345b661; the 88 starting credits came back by default, so no admin grant was needed). Driven with local Playwright 1.57 Chromium, touch emulation at 768 and 390, one session at a time, Guidance ON. A fly proxy on 15432 was already running when I started (owned by another session), so I reused it and neither started nor stopped one.
Credits: 88 at start, 52 at end (36 used: two uploads at 2, four highlight generations at 8; spotlight generations were free).
End state: game 1 (5 plays, 3 finished highlights Play 1, 2, 3, each shared; Play 4 generated but not finished; Play 5 framed up to preview, not generated) and game 2 (a 5 s green test clip, 0 plays).
Screenshots: about 200 local files `screens/r2-*.png` (not committed). Placement verdicts combine an automated geometry check (card on-screen, not covering the anchor, anchor on-screen, card on the centre-facing side, card within about 250 px of the anchor) with a look at the screenshot.

Viewport order: 1440x900 / 1024x768 / 768x1024 / 390x844. Anchor = the pulsing control the sentence names. "far" = the card is more than 250 px from the anchor.

### 10.1 Blank-state captures

| State | Guide text | Anchor | Placement | Layout | Screenshots |
|---|---|---|---|---|---|
| Home Games, blank | Start with your game video. Tap Upload game. | Upload game | P / P / P / P (right of it at 1440, below at 1024 and 768, docked bottom at 390) | P / P / P / P, no overflow | r2-blank-games-{1440,1024,768,390} |
| Home Clips, empty | Highlights you're still working on wait here. Open a game in Games to start one. | none (no pulse) | no anchor; card clear of every control at all four | P / P / P / P | r2-blank-clips-* |
| Home Finished, empty | Finished highlights show here. Open a game to make your first one. | none | no anchor; card clear | P / P / P / P | r2-blank-finished-* |
| Upload modal, choose | Pick your game video. Name and details are optional. | modal | card beside the panel (1440) or inline in it | P / P / P / P | r2-upload-modal-choose-* |
| Annotate, nothing marked (game 1 with the plays load emptied, then game 2) | Tap Play to watch the game. When your athlete does something great, tap Mark play. | Play + Mark play | F / F / P / P (see N1) | F / F / P / P | r2-annotate-watch-* |
| Annotate, playing | See a great moment? Tap Mark play. | Mark play | F / F / P / P (Mark play below the fold at 1440 and 1024) | same | r2-annotate-playing-* |
| Sign-in (signed out) | none needed | - | - | P at 1440, 1024, 768; 390: the Google button is wider than the form column (T12700 residual) | r2-signin-* |
| Lost session (a second login replaced it) | none | - | - | same as sign-in; the app returns to the plain sign-in card with no sentence saying the session ended (N6) | r2-lostsession-* |

### 10.2 Filled dialog-placement cells

Rule text is what the live card said.

| Screen / state | Anchor | 1440 | 1024 | 768 | 390 | Notes |
|---|---|---|---|---|---|---|
| Home Games, plays not all reviewed ("You haven't watched all of your game yet...") | game card | P | P | P | P | card right of, below or above the card, 12 to 182 px away |
| Home Games before a highlight ("Open your game and turn your best play into a highlight.") | game card | P | n/t | n/t | n/t | only seen at 1440 before the first finish |
| Home Clips, drafts ("Pick up where you left off. Tap a clip to finish its highlight.") | first draft tile | F far (664) | F far (435) | F far (412) | F far (451) | card parks at the top, the tile is at the bottom of the screen |
| Home Finished, first ("Your highlight is ready. Tap it to share it or download it.") | none | n/t | P | P | P | 1440 not re-creatable once 3 highlights exist |
| Home Finished, 3 highlights ("You have 3 highlights. Tap one to share it ... or open a game to mark another play.") | none | P | P | P | P | no pulse; at 768 the shade cutout shows a 460 px column and clips the Highlight ready toast |
| Finished viewer right after finish ("Done! Tap Get share link ...") | Get share link | P (beside it, 155 px) | n/t | n/t | n/t | on a revisit of a published highlight no guide shows; the pre-publish viewer was only reached at 1440 |
| Share confirm bar | Create share link | P | n/t | n/t | n/t | an end card shows while the bar is open; at 390 a phone Share copies the link, toast "Link copied", no modal |
| Annotate has-plays ("You've marked N plays...") | none | P | P | P | P | at 768 the card sits over the timeline lane, markers stay visible |
| Annotate selected ("Tap Make highlight ... or Edit play") | Make highlight slots | F anchor below fold | F anchor below fold | P | P | at 768 Edit play is shaded though named; at 390 Edit play is off-screen |
| Annotate play editor ("Drag the green ends ...") | Done | F (Done below fold, card over the video) | F (same) | F far (638) | F far (472) | |
| Annotate choice card ("Play added. Tap Make highlight ...") | Make highlight | P | P | P | P | |
| Annotate review plays ("Your plays, back to back. Tap Share plays ...") | Share plays | F (card covers the tile) | F (tile below fold) | P | P | |
| Focus step 1 ("Drag the box onto your athlete") | crop box | F far (429, over Settings) | P | P | P | |
| Focus step 2 ("Tap Play and watch your athlete") | Play | F far (989) | F far (507) | P | P | Play is reachable at every size (T12630 holds) |
| Focus step 4 ("Tap Preview highlight") | Preview tile | P (above) | F (beside, over the Generate and Trim tiles) | P | P | |
| Focus preview playing ("Watch it through ...") | none | P | P | P | P | |
| Focus step 5 ("Looks right? Tap Generate highlight") | Generate | P | P | P | P | with 2+ finished the text adds "or open Trim and slow motion first to cut dead time" (1440) |
| Focus trim split ("Click the timeline to split ...") | segment track | P | n/t | n/t | n/t | trim adjust step not reached |
| Focus generating ("Making your highlight ...") | none | P | P | P | P | dialog only, no shade |
| Focus ready panel ("Your highlight is ready. Add a spotlight ...") | Add spotlight | P | P | P | P | Finish without spotlight and Edit framing subtitles truncate (T12700); at 768 the first letter of "Finish" is clipped |
| Overlay pick, moments 1 and 2 ("Tap your athlete ...") | athlete boxes | P (right of video) | P | P (top strip, 385 px above; the video fills the screen) | P (top, over the top fifth of the video) | moments 3 and 4 show no card after Got it on the earlier moment (rule id acknowledged, by design) |
| Overlay Spotlight set ("Tap Generate highlight with spotlight") | Generate | P | P | P | P | |
| Overlay generating | none | P | n/t | n/t | n/t | |
| Buy credits dialog ("Tap a credit pack to buy it.") | pack | inline card at the dialog top | n/t | n/t | n/t | |
| Edit game dialog ("Change what you need, then tap Save Changes.") | Save Changes | inline | n/t | n/t | n/t | |

Not filled, with reason: Overlay text lane and text sheet, Overlay ready panel and Focus trim adjust (each needs a fresh draft per viewport and I stopped spending), Finished viewer and share modal at 1024 / 768 / 390 (the viewer only shows its guide before the highlight is published), Home Games before a highlight at 1024 / 768 / 390 and Home Finished first at 1440 (state not re-creatable on the same account).

### 10.3 Findings from the re-walk

Existing tasks were checked by title against PLAN.md and `docs/plans/tasks`; none matched. Filed 2026-10-18 as T13010 to T13100 in PLAN.md's Release check bugs section (also: upload failed state T13010, add footage T13040, clip size limit T13080).

- **[T13020]** **N1 (HIGH). Annotate is taller than 1440x900 and 1024x768, so the guided control is below the fold.** Mark play (watch and playing steps), the Make highlight slots (selected), Done (editor) and Share plays (1024) are off-screen. The shade has no cutout, the card docks at the bottom or sits over the video, and at 1440 the "Scroll down to continue" pill overlaps the card's Got it. Evidence: r2-annotate-watch-1440, r2-annotate-selected-1440, r2-annotate-editor-1440, r2-annotate-review-1440, r2-annotate-selected-1024. Proposal: keep the guided control inside the first viewport at 1440x900 and 1024x768, and never let the scroll pill overlap the card.
- **[T13060]** **N2 (MED). Card parks far from its anchor.** Focus steps 1 and 2 at 1440 and 1024 (card over the Settings panel, 429 to 989 px away), Home Clips drafts at all four sizes (card at the top, tile at the bottom, 412 to 664 px), Annotate editor at all four. Proposal: when room exists beside or above the anchor, take it before the top strip.
- **[T13030]** **N3 (MED). The "Highlight ready" View/Dismiss toast stays until clicked and covers real controls and guide anchors.** It covered the Preview tile at 768 (it blocked a tap), the Add text tile at 1024 and the Play 3 tile at 390, and Home showed "Scroll down to continue" over a fully visible game card at 390. Evidence: r2-toast-over-band-768, r2-overlay-pick-0-1024, r2-many-games-390. Proposal: auto-dismiss it and keep it out of the action band and guide anchors.
- **[T13050]** **N4 (MED). Finished viewer header at 390 and 768.** At 390 the Guidance switch sits on the Download button and the header row clips at the left edge; at 768 the title truncates to "0...". Evidence: r2-share-modal-390, r2-share-modal-768. Related to T12670, which covered title, tabs and breadcrumb only.
- **[T13070]** **N5 (LOW, verify). The recipient share page "Open ReelBallers" on staging goes to https://app.reelballers.com/home (production).** I did not trace where the host is set (the string is not in `src/frontend/src`); it may be intentional, but it means the claim flow cannot be walked on staging. The share page itself is clean at all four sizes with no overflow (r2-recipient-share-*, r2-recipient-claim-*); its Download label is low contrast grey.
- **[T13090]** **N6 (LOW). A lost session shows the bare sign-in card with no sentence saying the session ended.** r2-lostsession-*.
- **[T13100]** **N7 (LOW). Review plays at 1440 shades the whole playing video** while the card names a tile below it.
- Confirmed fixed since 2026-10-12: Focus Play and the action band no longer collide (T12630), the selected-play shade cuts out the Make highlight slots (T12620), Home draft and finished cards use only In progress and Finished, and the 2+ highlight invitations exist (home.finished.many; Focus step 5 invites Trim).

### 10.4 Section 8 rows reached or ruled unreachable

| Row | Result |
|---|---|
| Upload failed | Not reached after one focused attempt: aborting `*r2.cloudflarestorage.com` requests with `page.route` did not raise a failed state within 30 s (game 2 was created, Annotate played the local blob, Home listed it with 0 plays). Credits charged: 2. |
| Add footage | The "Add footage / Add another video to this game" tile is present in Annotate (game 2) but two bounded click attempts did not open anything. |
| Clip upload limits | Not reached after one attempt: with the bootstrap `max_clip_upload_bytes` mocked to 1 MiB, setting a 45 MB file on the Clips upload input did not show `clip-size-limit-modal` within 15 s. |
| Too large to export | Not attempted: it only renders from an `export_too_large` WebSocket error frame; needs `page.routeWebSocket` injection on a spending generate. |
| Report a problem | Reached at 1440: the floating button bottom right opens "Report a problem / One sentence helps us fix it ... Send report". No guide on it. 390 not driven. |
| Credit failure / needs credits | Reached with a mocked balance of 0 (GET credits and bootstrap): Focus step 5 reads "You need more credits for this highlight. Tap Generate highlight to add them, then generate the highlight." and tapping Generate opens Buy credits with "Tap a credit pack to buy it." (card 344 px from Generate, F far). A real zero-credit account and a real 402 were not tested. 1440 only. |
| Recipient share and claim pages | Share page reached at four viewports, signed out. Claim unreachable on staging (N5). |
| Annotate post-Done choice card, review plays | Reached. Expired source, Focus failed and finishing: not reachable without breaking real jobs. |

### 10.5 Parent-audit CRITICAL and HIGH findings (re-proof)

| # | Verdict 2026-10-18 | Evidence |
|---|---|---|
| 1 Hidden crop-box drag unlocks Generate (Critical) | fixed: step 1 names the drag, step 2 Play is reachable at 1440, 1024, 768 and 390, Generate unlocks after the preview step and is the pulsing target at step 5 | r2-focus-drag-390, r2-focus-play-1440, r2-focus-preview-done-1440 |
| 2 "In Spotlight" / "In Overlay" (Critical) | fixed: tiles show In progress and Finished only | r2-drafts-clips-1440, r2-many-finished-768 |
| 3 /annotate and /focus overflow on iPhone (High) | fixed: no horizontal overflow on any probed screen at the four sizes | probe overflowX false on every row |
| 4 Fixed Generate panel covers controls (High) | fixed at all four sizes | r2-focus-play-1440, r2-focus-keep-1024 |
| 5 Upload conflicting progress (High) | not verified: only the in-flight toast was seen in passing | r2-upload-modal-details-1440 |
| 6 Highlight gated by 5-star rating (High) | fixed: 4-star plays offer Portrait and Landscape Make highlight | r2-annotate-selected-768 |
| 7 Done returns to empty-looking editor (High) | fixed: after Done the play stays selected with the choice card or the Make highlight tiles | r2-annotate-choice-1440 |

Full journey at 1440 with no hidden gesture: NOT met. Upload, mark, make highlight, Focus (drag, play, preview, generate), spotlight pick, generate and share all completed and nothing needed a keyboard shortcut, but on Annotate the guided control (Mark play, Make highlight, Done) is below the fold at 1440x900 and the card's own scroll pill collides with it (N1). A user must scroll without a reliable prompt.
