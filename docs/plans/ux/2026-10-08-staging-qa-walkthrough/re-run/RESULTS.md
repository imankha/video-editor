# T12310 staging re-run: results (2026-10-11)

Target: https://reel-ballers-staging.pages.dev (API reel-ballers-api-staging.fly.dev), redeployed from master minutes before the run (includes T12430).
Account: `e2e@test.local`, reset to blank just before. Guidance toggle ON (default) for all journey screenshots.
Game video: `wcfc-carlsbad-trimmed.mp4` (46 MB, 1:29, same as the first walkthrough) for journeys A and B; `staging-verification-fixture-5min.mp4` (172 MB) uploaded once on a phone to get a second game with zero plays.
Credits: 88 at start, 66 at end (2 + 8 + 8 + 2 + 2 spent: two uploads, three generations). Enough for everything attempted.
Screenshots are in this folder: `rr-NN-*.jpg` (journey order, size in the name) and `sweep-<screen>-<W>x<H>.jpg`. Scripts: `scripts/` (Playwright, node). Raw sweep numbers: `scripts/sweep-all.json`, `scripts/blank-sweep.json`.

Method notes. Mobile contexts used `hasTouch` + `isMobile`. Mobile journey B (390x844) was done on plays 2 and 3 of the same game (play 1 belongs to journey A at 1440x900). The blank-account empty states of Games, Clips and Finished were captured at all nine sizes BEFORE anything was uploaded (`rr-00-blank-*`). Annotate-empty at 1440 is `rr-04/05`; Annotate-empty at 390 is `rr-98/99` (second game).
One run artifact to know about: staging allows ONE live session per account. A second test-login (mine, from another browser) signed the first browser out. After that the Finished viewer on the phone showed "Couldn't load the video" (`rr-90..92`, network log: `downloads/2/stream` and `projects/2/poster.jpg` ERR_BLOCKED_BY_ORB). In a clean single-session run the same highlight played fine (`rr-122`). I treat that as caused by my own concurrent login, not as a product bug (see N20 for the one product point in it).

---

## 1. Summary and counts

Journeys: A (1440x900) blank account to Finished, Share, Clips, Games: completed. B (390x844) upload, 2 plays, Make highlight, Focus, Generate, Spotlight (4 moments), Add text, Generate, Finish, Finished viewer: completed. Sweep: 9 sizes x 6 screens (Home/Games, Clips, Finished, Focus, Overlay, Annotate) = 54 loads, all screenshotted.

| Area | Fixed | Partly | Not fixed |
|---|---|---|---|
| Bugs B1-B8 (8) | 5 (B1, B4, B5, B6, B7) | 3 (B2, B3a, B3b) plus B8 changed form, counted partly below | 0 |
| Jargon / confusing items (18 rows) | 10 | 6 | 2 |
| CTA table rows (9) | 9 | 0 | 0 |
| Guide table rows (16) | 14 on desktop | 2 (wording) | 0 on desktop; but see N2: on phones almost none of them are visible |
| T12320 hand-off checks (5) | 3 resolved (a ruled, c ruled, item 5 fixed) | | |

(B8 is listed under "partly": the `ERR_FILE_NOT_FOUND` console error is gone, but a `blob:` request is still aborted after upload, see table in section 2.)

New findings: **34** (6 HIGH, 16 MED, 12 LOW, 0 CRITICAL). Sweep: **no horizontal page overflow at any of the 9 sizes** (document and every large scroll container measured), but several phone-size layout problems listed below.

T12430 verified: no "Play added" toast after tapping Mark play, and `Added play "Play 3"` appears about 60 ms after tapping Done (`rr-74`). Caveat: a play rated 5 stars opens the "Make this a highlight now?" card first and the toast is deferred; choosing "Keep Marking Plays" then shows a different toast, "Highlight moved to Clips so you can edit it later" (`rr-72`), see N13.

Top issues, short list (details in section 3):
1. N1 The bottom action band hides the video's Play button, bottom of the video and the whole timeline on Focus and Overlay at every desktop size, while the guide says "Tap Play".
2. N2 On phones (<= ~430 px) the guide bubble does not appear on Home, Annotate or Focus at all (host stays `visibility:hidden`); on Overlay it sits under the action band.
3. N3 On phones the action band takes 35 to 55% of the screen, shrinking the video to a sliver exactly where the user must drag a box or click their athlete; the "highlight is ready" panel shrinks the finished video to about 100 px.
4. N6 The floating guide bubble still covers the content it explains, including the main CTA (Generate highlight, Make highlight) (B2 in a new form).
5. N4 During upload the "Preparing" toast covers the Mark play card on a phone.
6. N5 Phone "Tags and Notes" is a full-screen dialog with no Done button, only a 32 px unlabeled X.
7. N10 Add text on a phone for a short clip dead-ends with "No text region under the playhead. Open Text under the timeline and click the lane to add one."
8. N13 "Keep Marking Plays" on a 5-star play silently turns it into a highlight.
9. N15 Two different games get the identical default name "Game uploaded Oct 11".
10. N16/N17 Phone header: credit pill and Guidance toggle overlap at 320; "On" with no "Guidance" label at <= 390; the "You start with 88 free credits" tooltip squeezes into 6 lines over the Games tab.

---

## 2. Finding by finding (findings.md B1-B8, jargon, CTA table, guide table)

### 2.1 Bugs

| # | Verdict | Evidence |
|---|---|---|
| B1 guide covers Upload game on Games | **Fixed** (1440). Bubble now sits beside the game card; Upload game is clear. Still wrong at 844x390: bubble covers the tab row and the scroll chevron covers Upload game (N9). | `rr-59-games-after-1440`, `rr-01-home-empty-1440`, `sweep-home-games-844x390` |
| B2 floating overlays cover content | **Partly.** The Guidance toggle no longer covers Make Highlight / Add footage / "Effects are free". New or remaining overlaps: guide bubble over card text and CTAs (N6), Report a problem button over Copy link / Delete play / Add footage (N8), toasts over CTAs (N9), generating toast corner under the feedback button. | `rr-05-annotate-scrolled-to-cards-1440`, `rr-17`, `rr-45`, `rr-23-focus-generating-t30-1440`, `rr-51-overlay-ready-1440`, `rr-53-share-modal-1440` |
| B3a Focus preview bar | **Partly.** Fixed: bar no longer wraps, Generate is first on the same row, "Back to full video" subtitle is now "Return to dragging the box." Still: the bar covers the bottom of the preview video and the play controls (N1). | `rr-18-focus-preview-1440`, `rr-23-focus-generating-t30-1440` |
| B3b Overlay Add text stranded | **Partly.** Fixed: "Add text" sits right beside "Generate highlight with spotlight", footer metadata no longer collides. Still: bar covers video bottom and timeline; controls are below the fold while the guide says "Press Play" (N1). | `rr-40-overlay-start-1440`, `rr-44-overlay-moment4-1440`, `rr-46-overlay-scrolled-1440` |
| B4 debug label `410x730 @ (...)` | **Fixed.** No label while dragging the crop box. | `rr-12-focus-dragging-1440` |
| B5 stale Focus screen after "Highlight ready" | **Fixed.** Generating shows progress (5% to 92%) with its own guide ("Making your highlight. You can wait here or go mark more plays..."), then the "Your highlight is ready" panel with guide appears immediately; credits updated (86 to 78). Progress text is now "Sharpening the picture 22%" (see jargon). | `rr-19-focus-generating-t0-1440`, `rr-23-focus-generating-t30-1440`, `rr-39-focus-highlight-ready-1440` |
| B6 click inside spotlight ignored | **Fixed.** Clicking inside the existing ellipse is accepted and advances "Moment 3 of 4" to "Moment 4 of 4"; the guide and sidebar agree on the step (but use different words, N12). | `rr-43-overlay-click-inside-ellipse-1440`, `rr-44-overlay-moment4-1440` |
| B7 closing finished viewer lands on Annotate | **Fixed.** X lands on Home with the Finished tab open, a "Just finished" hero (Share, Copy link, Download) and the guide "Your highlight is ready. Tap it to share it or download it." | `rr-54-after-close-viewer-1440`, `rr-55-finished-tab-1440` |
| B8 console `ERR_FILE_NOT_FOUND blob:` after upload | **Partly / cannot call fixed.** No `console.error` of that kind now; Playwright `requestfailed` still logs the `blob:` preview URL as `net::ERR_ABORTED` right after upload (benign abort of the local preview). No screenshot possible; evidence is the Playwright event log of the run. | (log only) |

### 2.2 Confusing moments and jargon

| Item | Verdict | Evidence / current wording |
|---|---|---|
| First Home guide "Press on a game" with no game | **Fixed** | "Start with your game video. Tap Upload game." `rr-01-home-empty-1440` |
| Sport button unexplained `?` icon | **Fixed** (blank state shows a labeled "Pick sport" button; later a soccer ball) | `rr-00-blank-games-1440x900`, `rr-54` |
| Tags need a sport, found only inside Add Tags and Notes | **Partly.** The editor still says "Pick your sport to tag this play" and needs a dropdown pick even though a sport was offered in the upload modal (could not verify whether my upload selection was applied, N34). | `rr-07-play-editor-tags-notes-1440` |
| "Finding players for spotlight" progress text when none requested | **Fixed.** Generation says "Sharpening the picture 22%"; spotlight is offered, not assumed. | `rr-23`, `rr-39` |
| Header tabs locked without explanation; one goal, many names | **Partly.** Explanation added ("Generate your highlight to add a spotlight."), tab names are Mark Plays / Frame / Spotlight. Names for the one goal still vary: "Make highlight", "Generate highlight", "Generate highlight with spotlight", "Back to preview", "Frame" (N12). | `rr-11-focus-first-1440`, `rr-40` |
| Timeline lanes "My athlete / Team" and "Play category" unexplained | **Fixed.** Now a labeled filter "SHOW: All / My athlete / Team" and a single "Plays" lane; the editor asks "Who is this play about?". | `rr-06-annotate-play-editor-1440` |
| Identical gold stars; "Mental Lapse / Technical Lapse" | **Fixed.** Five buttons with 1 to 5 stars and plain names: Decision miss, Skill miss, Interesting, Good, Brilliant. Remaining: the "!" / "!!" glyph in the play list and timeline is unexplained (N25). | `rr-06`, `rr-66-m390-play-editor` |
| Tags/notes section opens below Done/Delete | **Partly.** Desktop: Done and Delete are now below the tags (but below the fold at 1440x900 until you scroll). Phone: tags open as a separate full-screen dialog with no Done (N5). | `rr-08-play-editor-tags-after-sport-1440`, `rr-67-m390-play-editor-tags` |
| Focus step 3: pause and re-drag, box does not follow | **Partly.** Guide now says "If your athlete leaves the box, pause and drag it back. The view moves smoothly between the spots you set." Jargon "box" remains (suggested "frame"); step 4 appeared after pausing even though I did not drag again. | `rr-16-focus-step3-playing-1440`, `rr-17` |
| Focus settings "Straighten", "Background Dim / VIEW ONLY", "Advanced editing" | **Fixed.** "Fix a tilted camera: Drag along a straight line on the field to level it." and "Darken outside the box: Editing view only. Your highlight is not changed." | `rr-110-focus-more-options-1440` |
| "Enhancing video - 15/92" | **Fixed.** "Sharpening the picture 22%", "Less than a minute remaining". | `rr-23`, `rr-47-overlay-generating-0s-1440` |
| Spotlight guide internal terms ("player tracker"), bubble covers video, two-column wrap, never says click athlete, misleading toast | **Partly.** Wording fixed ("Click your athlete . Moment 1 of 4"), misleading toast not seen. Still: the bubble covers the upper half of the video the user must click, and its title wraps into two columns ("Click your / athlete" beside "Moment / 1 of 4"). | `rr-40-overlay-start-1440`, `rr-41b-overlay-moment2-1440` |
| Finished tab: locked gauges share the page with the user's highlight | **Not fixed.** Game Highlights / Top Plays / Ranking Progress (now "8s / 30s", "16s / 30s") still sit under the highlights. | `rr-55`, `rr-57-finished-scrolled-1440`, `rr-117-m390-finished-tab` |
| Link and download icon-only; "Link ready / Get Link" contradiction | **Fixed.** Hero has labeled Share, Copy link, Download. Viewer "Create share link" turns into "Link ready" with the URL in one tap (but see N8). | `rr-54`, `rr-52-after-finish-1440`, `rr-53` |
| Share modal "Restricted to recipients" with no default stated | **Partly.** Modal now has "Who can watch: Only people I add / Anyone with the link" plus "Anyone with the link can watch. Creating a link does not send it." Could not verify the default for a never-shared highlight (I had already created a link); modal Share/Cancel tiles show an empty circle where an icon belongs (N30). | `rr-56-share-modal-1440` |
| Clips tab empty with marketing line, no count | **Fixed.** "Highlights in progress / Plays you've started turning into highlights wait here until you finish them." and a count badge on every tab. | `rr-00-blank-clips-1440x900`, `rr-00-blank-clips-390x844` |
| Games page left-aligns card under centered header | **Not fixed.** Card starts at x=432 under a centered header, "YOUR GAMES" at x=144. | `rr-59-games-after-1440` |

### 2.3 CTA table

| Screen | Verdict | Evidence |
|---|---|---|
| Annotate cards | **Fixed / good model**: Mark play first, Review plays, Share plays, Add footage. (At 1440x900 the four cards start below the fold, `rr-04`; scroll needed.) | `rr-05-annotate-scrolled-to-cards-1440` |
| After Done | **Fixed.** Cyan full-width "Make highlight" first, "Keep Marking Plays" second. | `rr-10-after-done-make-highlight-1440` |
| Focus bottom | **Fixed.** Generate highlight first (left, largest). | `rr-11-focus-first-1440` |
| Focus preview | **Fixed.** Same row, main first. | `rr-18-focus-preview-1440` |
| Overlay | **Fixed.** "Generate highlight with spotlight" then "Add text". | `rr-40-overlay-start-1440` |
| Highlight ready (1st and 2nd) | **Fixed.** Same panel, same tile style, main first ("Add spotlight", then "Finish"); "Done for now" is the same quiet tile in both. | `rr-39-focus-highlight-ready-1440`, `rr-51-overlay-ready-1440` |
| Share modal | **Fixed.** Share first, Cancel second. | `rr-56-share-modal-1440` |
| Clips empty state | **Fixed.** One CTA, "Upload highlight". | `rr-00-blank-clips-1440x900` |
| Play editor | **Fixed.** Done left (green), Delete play right (red outline). | `rr-08b-play-editor-filled-1440`, `rr-66-m390-play-editor` |
| Side items: primary color varies by screen | **Not fixed.** Upload game is cyan on the empty state and green once a game exists (`rr-01` vs `rr-59`); Upload highlight is cyan then green (`rr-00-blank-clips-1440x900` vs `rr-77`); the Finished tab is orange. | as listed |
| Side item: "Cover image" tab wraps | **Fixed** at 1440 and 390 (single line). | `rr-40`, `rr-88-m390-add-text` |

### 2.4 Guide table (Guidance ON)

Desktop 1440 unless noted. "Seen" means a guide with sensible text was on screen.

| State | Verdict | Text seen / screenshot |
|---|---|---|
| Home, blank | Fixed | "Start with your game video. Tap Upload game." `rr-01` |
| Upload modal | Fixed | "Pick your game video. Name and details are optional." `rr-02` |
| Annotate, no plays | Fixed | "Tap Play to watch the game. When your athlete does something great, tap Mark play." `rr-04` |
| Play editor after Mark play | Fixed | "Drag the green ends so the play starts and stops where you want. Pick how good it was, then tap Done." `rr-06` |
| After Done | Fixed | "Play added. Tap Make highlight to turn it into a video you can share, or keep marking plays." `rr-10` |
| Focus load / step 1 | Fixed ("box" still used) | "Step 1 of 5 Drag the box onto your athlete..." `rr-11` |
| Focus step 3 | Fixed | see 2.2. `rr-16` |
| Focus generating | Fixed | "Making your highlight. You can wait here or go mark more plays. We'll tell you when it's ready." `rr-23` |
| Highlight ready, 1st | Fixed | "Your highlight is ready. Add a spotlight so people know which athlete is yours, or tap Finish without spotlight." `rr-39` |
| Highlight ready, 2nd | Fixed | "Looks good? Tap Finish to get your link." `rr-51` |
| Spotlight start | Fixed | "Click your athlete . Moment 1 of 4 ..." `rr-40` |
| Spotlight all set | Partly | "Spotlight set. Tap Generate highlight. Tap Play first if you want to check it." The button is labeled "Generate highlight with spotlight" and the Play button is hidden behind the bar (N1). `rr-44` |
| Overlay generating | Fixed | "Adding your spotlight. We'll show you when it's ready." `rr-47` |
| Finished viewer | Partly | "Done! Tap Share to send it, or Download to save it." The button says "Create share link" (desktop) / "Share link..." (phone). `rr-52` |
| Finished tab | Fixed | "Your highlight is ready. Tap it to share it or download it." `rr-54` |
| Clips tab | Fixed | empty: "Every clip is finished. Open a game to mark more plays." `rr-58`; with drafts: "Pick up where you left off. Tap a clip to finish its highlight." `rr-77` |

On phones (390x844 and below) the guide is mostly not visible, see N2. Visible on phone: Focus "Your highlight is ready" (`rr-84`), the Finished viewer "Done! ..." (`rr-90`), the Upload modal guide (`rr-61`).

---

## 3. New findings

Severity: HIGH = blocks or badly misleads a first-timer, MED = confusing or ugly but workable, LOW = polish / hygiene. "Sizes" lists where it was observed; "not checked" means I only have metrics, not a viewed screenshot.

| ID | Sev | Sizes | Finding, repro, screenshot, suggested fix |
|---|---|---|---|
| N1 | HIGH | all desktop (1024x768, 1440x900, 1920x1080 viewed; 768x1024 OK) and phones (see N3) | **Action band hides the video Play button, the bottom of the video and the timeline** on Focus and Overlay. Repro: open any clip in Focus at 1440x900; the 144 px band starts at y=668 while the video controls sit at y=779 beneath it, and the pane does not scroll on Focus (wheel zooms the timeline). The guide says "Step 2 of 5 Tap Play and watch your athlete" but Play is not visible; only the Space key plays (I used it). Overlay has the same hiding of the frame chips and Play, until you scroll the main pane a full screen (`rr-46`). Shots: `rr-14-focus-scrolled-1440`, `rr-18`, `rr-40`, `sweep-focus-1024x768`, `sweep-focus-1920x1080`. Fix: make the band part of the layout (reserve its height under the video/timeline) instead of overlaying them, or move Play into the video area above the band. |
| N2 | HIGH | phones: 320, 360, 375, 390 (home, annotate, focus); also landscape home | **Guidance never appears on phones for most steps.** The floating guide host stays `visibility:hidden` (DOM text exists, e.g. "Step 1 of 5 Drag the box onto your athlete..."). Cause evidence on Focus: the parked Settings drawer (`role="dialog"`, `visibility:hidden`, off-screen) matches the "blocking layer" selector in `FloatingCoach.jsx` (`[role="dialog"]`), so the coach hides itself permanently. On Annotate (`watch` phase, 0 plays) and Home no blocking layer exists but position stays null (anchor not found) so it stays hidden too. On Overlay the inline guide renders at y=797 under the action band (`rr-85`). Result: the product's main hand-holding is absent for the mobile-heavy audience; the toggle still says "On". Shots: `rr-76-m390-focus-first`, `rr-98-m390-annotate-empty-newgame`, `rr-101-m390-first-play-editor-newgame`, `rr-85`. Fix: ignore hidden dialogs in the blocking check (`checkVisibility()`), and dock the coach even when the target is missing; test per phase at 390. |
| N3 | HIGH | 320x568, 360x740, 375x667, 390x844 | **Action band squeezes the video on phones.** Focus at 390: band is about 340 px tall, the video about 270 px, Play and timeline need a scroll (`rr-79`, `rr-80`, `rr-81`); at 320x568 the Focus video is about 70 px high and Overlay about 120 px (`sweep-focus-320x568`, `sweep-overlay-320x568`), exactly where the user must drag the box or click their athlete. The "Your highlight is ready" panel at 390 leaves a roughly 100 px-high video (`rr-84-m390-focus-ready`) so the payoff can barely be watched; "Finish without spotlight" label runs to the card edges and its subtitle is cut ("Only you can see it unt..."). Fix: collapse the band to one full-width CTA on phones (secondary tiles into a sheet), and keep the finished video at least half the screen on the ready panel. |
| N4 | HIGH | 390 (also 1440) | **Upload progress toast covers the Mark play card** for the whole upload. Repro: upload on a phone; the toast sits over the first card (`rr-64-m390-uploading-2s`). At 1440 it covers the feedback button (`rr-03`). The banner "Local preview, not uploaded yet. Preparing" uses internal wording. Fix: put upload progress in the header or above the cards; plain text "Uploading your game, 15%. Keep this tab open." |
| N5 | HIGH | 390 | **Phone "Tags and Notes" is a full-screen dialog with no Done/Save button.** Only a 32 px unlabeled X at the top right closes it (`rr-67-m390-play-editor-tags`). The Done button underneath is unreachable until you find the X (my tap on Done timed out under the dialog). The toggle also flips to "View Tags and Notes". Fix: add a full-width "Done" at the bottom of the dialog, label the X "Close". |
| N6 | HIGH | 1440 (also 1024) | **Floating guide bubble still covers what it explains, including the main CTA.** Examples: play editor description and "Add Tags and Notes" (`rr-06`); Focus step 4 covers the Generate and Trim cards (`rr-17`, `rr-18`); Annotate cards text (`rr-05`, `rr-96`); on a draft the Text tip "Make the text your own..." sits ON the Generate highlight button and stays after the text is deleted (`rr-45`, `rr-113`); body text on Clips (`rr-58`, `rr-00-blank-clips-1440x900`). Fix: dock the bubble in a reserved strip (above the band), never over cards. |
| N7 | MED | 1440 | **Two guides at once, or a stale one.** Share dialog shows "Choose who can watch..." plus the Finished-tab bubble behind it (`rr-56`); after Finish an empty second bubble (hidden) lingers; on Overlay "Spotlight set. Tap Generate..." stays in the DOM while the Text tip shows (`rr-45`); a draft that is already rendered still says "Step 2 of 5 Tap Play and watch your athlete" and covers More options (`rr-110`, `sweep-focus-1024x768`). Fix: one guide at a time, keyed to the real state. |
| N8 | MED | 1440 | **Report a problem button covers controls.** Over the Copy link icon in the share-link row (`rr-53`), the right end of Delete play (`rr-06`), the Add footage card (`rr-05`). Fix: move the button off content (header menu) or give it a gutter. |
| N9 | MED | 1440, 390, 844x390 | **Toasts and the scroll-down chevron cover CTAs.** "Finished" toast over the Create share link row (`rr-52`); "Highlight with spotlight ready" toast over the "Done for now" tile (`rr-51`); the amber chevron FAB covers a toast (`rr-74-m390-play3-after-done-0.5s`), a timeline marker (`sweep-annotate-320x568`) and the Upload game button in landscape (`sweep-home-games-844x390`, where the guide bubble also hides the tabs). |
| N10 | MED | 390, 1440 | **Add text is a dead end for a short clip, and the empty Text lane stays.** On a 2 s clip at 390, tapping "Add text" opens the sheet "Spotlight settings" (wrong title for the Text tab) saying "No text region under the playhead. Open Text under the timeline and click the lane to add one." (`rr-115`, `rr-116`). At 1440 the lane appears only after Add text, but deleting the last text leaves an empty lane (`rr-111` vs `rr-112` vs `rr-113`). Words "text region", "playhead", "lane" are editor jargon. Fix: Add text creates a text at the current moment always and says "Type your text"; empty lane collapses. |
| N11 | MED | 1440, 390 | **Default text is "1.1".** Add text prefills a meaningless "1.1" (`rr-45`, `rr-88`). Fix: empty field with placeholder "Name or number, e.g. #7 Maya". |
| N12 | MED | 1440 | **Same thing, three names, and guide/button wording mismatches.** Spotlight step: guide "Moment 2 of 4", sidebar "Frame 1 / Frame 2 (now)", mode tab "Frame" is something else entirely (`rr-41b`). Guide says "Tap Generate highlight" (button: "Generate highlight with spotlight"), "Tap Share" (button: "Create share link" / "Share link..."), "Tap Make highlight" (accessible name: "Make portrait highlight"). Fix: one word per thing ("moment" everywhere; button text copied from the guide). |
| N13 | MED | 390 | **"Keep Marking Plays" silently creates a highlight.** Card copy: "Saves play in Clips so you can make your highlight later". After tapping it on a 5-star play the app shows "Highlight moved to Clips so you can edit it later" and the Mark Plays / Frame / Spotlight tab strip appears (`rr-71`, `rr-72`). Fix: make the 5-star auto-highlight explicit on the card, or not create the highlight until asked. |
| N14 | MED | 1440 | **Guide points to a button that is not on screen.** With a play selected: "Tap Edit play to adjust this play, or tap Mark play for another moment." but the Mark play card is replaced by Portrait/Landscape/Edit play and the bubble covers "Make highlight" (`rr-95`, `rr-96` after deselecting shows the correct "You've marked 3 plays..."). Also confirms T12320 item 6: coach guidance persists after the first play. |
| N15 | MED | all | **Identical default game names.** Every upload without a name becomes "Game uploaded Oct 11"; the Annotate title also flips from the file name ("wcfc-carlsbad-trimmed") to that default right after upload (`rr-03` vs `rr-04`), and the account now has two games with the same name in Games, Continue and the breadcrumbs. Fix: use the file name, or add time and sport. |
| N16 | MED | 320 to 390 | **Phone header problems.** At 320 the credit pill is overlapped by the Guidance toggle (`rr-00-blank-games-320x568`); at 390 and below the "Guidance" label is hidden so the control reads just "On" (`rr-60`); the sticky header overlaps tabs and the Continue card when the page scrolls (`rr-62`, `rr-105-m390-after-done-for-now`). |
| N17 | MED | 320 to 390 | **"You start with 88 free credits" tooltip** wraps to 6 narrow lines and covers the Games tab (`rr-00-blank-games-390x844`, `rr-00-blank-games-320x568`). At 1440 it is a clean one-liner. |
| N18 | MED | 320 to 1440 | **Contradictory state on an already generated draft.** Focus shows primary "Back to preview" next to "Preview highlight: Finish the steps above to unlock" and the stale step guide (`sweep-focus-768x1024`, `sweep-focus-320x568`, `rr-110`). |
| N19 | MED | 320, 360 (Finished tab load) | **HTTP 422 on `POST /api/exports/acknowledge`** (console "Failed to load resource ... 422") when the Finished tab loads; logged in `scripts/sweep-all.json`. Not visible to the user but a real 4xx on a core screen. |
| N20 | MED | 390 | **Lost session shows "Couldn't load the video" instead of asking to sign in.** After my second login signed the phone browser out, the viewer sat on "Loading your highlight..." and "Couldn't load the video. Try again." at the same time, with a Retry that cannot work (`rr-90`, `rr-91`, `rr-92`); the page behind was already the sign-in screen after reload (`rr-93`). Cause is my concurrent login, but the app should detect a 401 and prompt sign-in. The two contradictory messages overlapping the Play button are a separate small bug. |
| N21 | MED | 1440, 390 | **Odd status words in Clips.** Tile badge "Spotlight started" on a draft whose spotlight has not been started; "Draft, framed" / "Draft, not framed yet" / "Not framed" and the empty-state card "Give each highlight a Framing pass. Add an optional Spotlight..." (`rr-77`, `rr-105`). Suggest "Ready for spotlight", "Draft", plain sentences. |
| N22 | MED | 320 | **Mid-word wrap** "Game upload / ed Oct 11" in the Continue card (`sweep-home-games-320x568`); the card truncates elsewhere ("Game uploaded ..." in breadcrumbs at 1024, `sweep-focus-1024x768`). |
| N23 | LOW | 320 to 768 | **Tap targets under 44 px** (touch sizes): Edit game and More actions 32x32 on game cards; coach close X 28x28; Annotate clip-count chip 51x34 and speed "1x" 39x32; Tags dialog X 32x32; upload modal X 28x28; "Report a problem" is a 20 px high text link at <= 390 (`rr-60`, `rr-67`, `rr-61`; numbers in `scripts/sweep-all.json`). |
| N24 | LOW | 1440 | **Upload modal:** the close X has no accessible name and Escape does not close it (checked at 390 with Escape; X is the only way). Also says "Drop any game video here." on a phone. |
| N25 | LOW | all | Rating glyphs "!" and "!!" in the plays list and timeline are unexplained (`rr-95`, `rr-63-m390-annotate-with-play`). |
| N26 | LOW | 390, 1440 | Locked Finished gauges use a "▯" icon that reads as a missing glyph (`rr-117-m390-finished-tab`, `rr-55`). |
| N27 | LOW | 390 | Finished carousel thumbnails are blank dark cards for the newest highlights (`rr-119-m390-finished-expanded`); poster requests were blocked by ORB in the broken-session run. Not re-checked on a clean session. |
| N28 | LOW | 1440 | Copy "so the spotlight stays on them" (`rr-40`) implies the spotlight follows the athlete. Safer: "Tap your athlete on each of 4 moments so the spotlight lands on them." (no other forbidden claim found: no "frames/tracks/follows automatically" text on any screen I saw). |
| N29 | LOW | 1440 | Hover label "click to highlight" is cut off at the left edge of the video (`rr-42`, `rr-44`). |
| N30 | LOW | 1440 | Share modal tiles "Share" and "Cancel" show an empty circle where an icon should be (`rr-56`). |
| N31 | LOW | all | Console noise on every screen: `[VIDEO] Suspend ...` warnings, `[useHighlightRegions] region has detections but no usable box for auto-select; using centered default`, repeated `[SLOW FETCH]` (staging API 2 to 4 s for health, bootstrap, games/activate, collections). No `pageerror` on any screen. |
| N32 | LOW | 1440 | `Share plays` stays enabled with zero plays while `Review plays` is locked (`rr-99-m390-annotate-cards-locked`); sharing nothing should be locked or explained. |
| N33 | LOW | 1440, 390 | Mixed vocabulary: Clips tab says "Every clip is finished" while a clip elsewhere is a "play"; "Game uploaded" is both a game name and a status. (No "reel" misuse found: only "Instagram Reels" as a platform name; no em dashes seen in UI text I captured, not an exhaustive scan.) |
| N34 | LOW | 1440 | **Unverified:** I selected Soccer in the upload modal, yet the play editor asked "Pick your sport to tag this play" (`rr-07`). I could not tell if my select was applied (the screenshot of the modal with the choice was lost); worth a 1 minute check. |

---

## 4. Jargon / confusing UI and proposed wording

| Where | Current | Proposed |
|---|---|---|
| Focus guide and Back card | "Drag the box onto your athlete", "Return to dragging the box", "Darken outside the box" | "Drag the frame over your athlete" (and "frame" in the other two) |
| Overlay guide vs sidebar | "Moment 1 of 4" / "Frame 1 (now)" | "Moment 1 of 4" in both |
| Spotlight guide | "so the spotlight stays on them" | "Tap your athlete on each of 4 moments so the spotlight lands on them." |
| Text sheet on phone | "No text region under the playhead. Open Text under the timeline and click the lane to add one." | "Type your text below. It shows for 2 seconds." |
| Text sheet title | "Spotlight settings" on the Text tab | "Text" |
| Default text | "1.1" | empty, placeholder "Name or number" |
| Upload banner | "Local preview, not uploaded yet. Preparing" | "Uploading your game, 15%. Keep this tab open." |
| Clips cards | "Spotlight started", "Draft, not framed yet", "Give each highlight a Framing pass" | "Ready for spotlight", "Draft", "Add a spotlight if you want, or finish it any time." |
| Annotate guide with a play selected | "tap Mark play for another moment" | "Tap Edit play to adjust this play, or tap an empty spot on the timeline to mark another." |
| Finished viewer guide | "Tap Share to send it" | "Tap Share link to send it, or Download to save it." |
| 5-star choice | "Keep Marking Plays: Saves play in Clips so you can make your highlight later" | say plainly that a 5-star play becomes a highlight in Clips, or do not create it yet |
| Rating glyph "!" / "!!" | unexplained | use the star count already shown in the editor |
| Header (phones) | toggle labeled only "On" | "Guidance: On" or an info icon |
| Credits tooltip | "You start with 88 free credits" (6 lines at 320) | single line, anchored under the credit pill |

---

## 5. Per-viewport sweep (Home/Games, Clips, Finished, Focus, Overlay, Annotate)

Overflow = document scrollWidth > clientWidth OR any scroll container (taller than half the viewport) with horizontal overflow. Nothing was flagged at any size. "Wide" counts elements that extend past the viewport edge; at <= 768 these are the Annotate timeline strip (scrolls inside its own container, by design) and a few off-canvas settings drawers, not page overflow. "Viewed" = I looked at the screenshot; others are metrics only.

| Size | Overflow | Viewed | Issues |
|---|---|---|---|
| 320x568 | no (doc, containers) ; Annotate 21 wide timeline elements, Focus 5, Overlay 8 | home, focus, overlay, annotate, blank empty states | Credit pill overlapped by Guidance toggle; 6-line credits tooltip over Games tab; "Game upload/ed" word break; scroll chevron over section header and timeline marker; Focus video about 70 px, Overlay about 120 px (N3); guide hidden (N2); Finished card subtitle truncated ("Your top-rated highlights, once you have..."); tap targets: time chip 51x34, speed 39x32 |
| 360x740 | no | metrics only | Same pattern as 320 and 390 by metrics: Edit game / More actions 32x32; guide hidden |
| 375x667 | no | metrics only | Focus CTA at y=351 with 108 px band (video short of height, N3); guide hidden |
| 390x844 | no | many (journey B) | N2, N3, N4, N5, N10, N13, N16, N17; Games cards fine; Finished carousel works; sweep: Report a problem 108x20, coach X 28x28 |
| 768x1024 | no | focus | Clean. Coach X 28x28 and game card buttons 32x32 (touch size) only. Annotate timeline wide elements by design |
| 1024x768 | no | focus | Band covers video bottom and controls (N1); breadcrumb truncates ("Pla...", "Game uploaded ..."); stale "Step 2 of 5" guide on a rendered draft (N7) |
| 1440x900 | no | all journey A | N1, N6, N7, N8, N9; Annotate cards below the fold on first load (`rr-04`); Play editor Done below the fold when tags open (`rr-07`) |
| 1920x1080 | no | focus | Band still covers the bottom of the video and Play (N1); plenty of free space otherwise |
| 844x390 landscape | no | home, focus | Focus uses a dedicated landscape layout with a "More room in landscape" tip and Play on the left, Generate on the right: good (`sweep-focus-844x390`). Home: guide bubble covers the tab row and the chevron covers Upload game (`sweep-home-games-844x390`, the Upload button is reported as covered) |

---

## 6. Rulings on the three T12320 checkpoints

### (a) Overlay Text lane cannot be hidden once shown (T12400): **restore a minimal version**
Evidence: before any text the timeline has three lanes (`rr-111`, `rr-114`); "Add text" adds a Text lane (`rr-112`, 1440; `rr-116`, 390); deleting the last text leaves the empty lane behind and no control hides it (`rr-113`). At 390 it sits above the spotlight lane and takes about 80 px of an already squeezed screen, and the sheet text about "text region ... click the lane" makes the lane sound like the place to work.
Recommendation: not a user toggle (parents will not look for one); auto-hide the lane when it holds no text. Keep "Add text" as the one entry point. If hiding by toggle is too much work, the empty-lane auto-collapse alone resolves it.

### (b) Annotate capture-window hint "6 seconds before, 2 after" is gone (T12410): **restore, as one plain supporting line**
Evidence: Mark play creates an 8 s play from 6 s before the tap to 2 s after (0:18 to 0:26 when marked at 0:24 at 1440, `rr-06`; 0:54 to 1:02 at 390, `rr-101`). The Mark play card says only "Save a moment to highlight or review." (`rr-05`, `rr-99`). On desktop the editor guide "Drag the green ends so the play starts and stops where you want" explains it afterwards; on phones that guide is hidden (N2), so a first-time user at 390 has nothing telling them the last 6 seconds were captured. Parents naturally tap Mark play AFTER the goal, so this is the one number they need before the tap.
Recommendation: add under the Mark play card text: "Saves the last 6 seconds and the next 2. You can change it." Keep it off the guide so it works with Guidance off and on phones.

### (c) Locked Review plays card looks the same as an enabled one (T12420): **keep as is**
Evidence: at 1440 and 390 the locked card is visibly different: lock icon instead of the list icon, no outline, dimmer text, in contrast to the outlined, bright Share plays and Add footage cards (`rr-05`, `rr-99-m390-annotate-cards-locked`, enabled version `rr-96-annotate-cards-enabled-1440`). Tapping it at 390 shows an info toast "Mark your first play to review it." (`rr-100-m390-tap-locked-review-plays`), so the tap is explained, not a surprise. Only inconsistency: Share plays is enabled with no plays (N32).

### Also recorded
- **Edit play card accessible name (T12320 item 5): fixed.** The title now carries a visually hidden period ("Edit play." then the description), checked in the DOM (`rr-95`); no screenshot can show it.
- **Coach guidance after the first play (item 6): still shows.** With 3 plays the guide reads "Tap Edit play to adjust this play, or tap Mark play for another moment." (`rr-95`) or "You've marked 3 plays. Keep going, or tap a play to make it a highlight." (`rr-96`). So it is no longer first-run only; the design doc says it should disappear. Worth deciding whether the longer-lived coach is intended; if yes, it must not point to missing buttons (N14).

---

## 7. What I could not test, and why

- **First-run guide on phones.** The account stopped being blank after journey A, so I could not re-capture the blank Home with Guidance on at 390. The blank-state phone screenshots show no guide bubble (`rr-00-blank-games-390x844`), consistent with N2, but I did not read the DOM at that moment.
- **Sport carry-over from the upload modal** (N34): only one blank upload was possible.
- **Share modal default** for a never-shared highlight: I created a link via the viewer first.
- **Download of the file, Cover image tab, email share, Done for now at 1440** (done at 390, `rr-105`), play-by-play "Edit framing / Redo spotlight" re-entry.
- **Real devices** (iOS Safari safe areas, address bar resize, pinch, edge-swipe back): only Chromium emulation at the listed sizes with touch events. Landscape phone checked only for Home, Focus and metrics for the rest.
- **Sizes 360x740 and 375x667** were measured but I did not open every screenshot; N2/N3 findings are carried over from 320 and 390 views.
- **Contrast, focus order, screen reader behaviour**: only obvious label gaps were checked (no unnamed controls found on Focus at 1440; unlabeled X buttons on upload modal and Tags dialog are in N5/N24).
- **B5 timing** was verified by state sequence (progress, then ready panel with guide), not by stopwatch.
- **Slow networks / long uploads:** 46 MB upload was fast; the 5 min fixture's upload completion time was not measured.
- **Two sessions at once** is not supported by staging; I did not try to prove that is intended.

Account state left behind on `e2e@test.local` (dedicated test account): 2 games, 3 plays on game 1 plus 1 on game 2, 2 finished highlights (Play 1 with spotlight and text "#7 Maya", Play 3 with spotlight), 1 framed draft (Play 2), 66 credits.
