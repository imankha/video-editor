# T12590 guide coverage sweep: results (live staging walk, 2026-10-12)

Target: https://reel-ballers-staging.pages.dev (API reel-ballers-api-staging.fly.dev), deployed from master 51f58e93a (T12570, T12580, T11940 all in).
Account: `e2e@test.local`, reset to blank with `scripts/reset-test-user.py --env staging` (through a `fly proxy 15432`), Guidance ON. Driven with Playwright (Chromium, touch emulation at 768 and 390), one session at a time.
Credits: 88 at start, 62 at end (upload 2, three highlight generations 8 each; the spotlight generation was free).
End state of the account: 1 game, 2 finished highlights (Play 1 and Play 2, no spotlight and with spotlight and text), Play 3 framed but not finished, Play 4 made but not framed.
Screenshots: only the ones cited below were kept (`screens/`); the rest were discarded. Raw sweep numbers were printed during the run, the figures that matter are quoted in the tables.

Legend: P = pass, F = fail (maps to a task), n/t = not tested (reason in section 8), `-` = not applicable. Viewport order everywhere: 1440x900 / 1024x768 / 768x1024 / 390x844.

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

Needs none (recorded): sign-in, sport picker, Edit game, Buy Credits, Account menu. Guide needed (filed): Finished with 2+ highlights (T12660), Focus settings panel (T12710, after the finished-count fact). Not walked: recipient share and claim pages.

## 8. What I could not test, and why

- Blank-account states at 1024, 768, 390 (Home Games, Clips, Finished empty): the account stopped being blank after the first upload; only the 1440 blank states were captured.
- Upload failed, add footage, clip upload limits, too large to export, report a problem: no failing upload or oversize file on this account, and no credits to burn on repeats.
- Annotate post-Done choice card, review plays, expired source: 4-star plays skip the choice card; no expired game.
- Focus failed, needs credits, finishing: not reachable without spending or breaking credits.
- Annotate watch states at 1024, 768, 390: the account had plays by then (only the has-plays states were reachable).
- Sign-in and lost session at 1440, 1024, 768: seen only at 390 (second login replaced the session).
- Recipient share and claim pages, Finished viewer share modal at 390 (a phone Share copies the link, no modal).
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
