# ReelBallers staging QA — October 16, 2026

## 1. Parent summary

Partially: I finished, downloaded, and anonymously played an 8-second vertical highlight with a spotlight, using the fallback test pattern.
The supplied soccer footage uploaded and supported touch marking and framing, but was not generated again because the requested paid-generation allowance had already been used.
Invalid files sent me to a blank screen; the ready notification could not open my preview; reload sent me home.
The app explains manual framing well, but the crisp-HD promise on real soccer footage remains unverified.
I would try again with real footage, but would not pay on the evidence of this test alone.

## 2. Bugs

Screenshot paths below are relative to this report's qa-screenshots folder. Findings describe observed behavior, not inferred causes.

| ID | Severity | Screen | Viewports | Steps to reproduce | Expected | Actual | Screenshot files | Console/network evidence |
|---|---|---|---|---|---|---|---|---|
| B02 | Major | Upload → game editor | 1440×900 | Open Upload game; select a text file; return with Back. Repeat using tiny.mp4 containing non-video bytes. | Reject the file with a readable error and leave upload usable. | Navigates to /annotate with an empty body; no error or recovery action. Browser Back recovers. Confirmed with a .mp4 extension as well as .txt. | [Corrupt MP4](qa-screenshots/B02_upload_1440x900_tiny-mp4-blank.png), [non-video](qa-screenshots/B02_upload_1440x900_nonvideo.png) | [Captured log](qa-screenshots/B02_network.txt); no specific failing endpoint established. |
| B05 | Major | Game / generation notification | 1440×900 | Generate a vertical highlight; leave generation running while viewing the game; click View on Highlight ready. | Open generated preview. | “Couldn't open the preview. Open the highlight from Clips to finish it.” Opening the thumbnail through Clips works. | [Ready View failure](qa-screenshots/B05_game_1440x900_ready-view-fails.png) | [Captured log](qa-screenshots/B05_network.txt); no causal endpoint established. |
| B01 | Minor | First play tags | 1440×900 | On first upload choose Soccer; immediately select the video; mark a play and expand Tags and Notes. | Soccer tags already available. | “No Sport” and “Pick your sport to tag this play”; selecting Soccer a second time reveals tags. Subsequent soccer upload used the saved sport correctly. | [Sport not carried](qa-screenshots/B01_mark-play_1440x900_sport-not-carried.png) | No associated error observed. |
| B03 | Minor | Game editor navigation | 1440×900 | Open saved game at /annotate, then reload. | Reopen the same game/editor state. | Redirects to /home/games. Saved game and plays remain, but must be reopened. Reproduced on supplied soccer game. | [Before reload](qa-screenshots/B03_game_1440x900_before-reload.png), [after reload](qa-screenshots/B03_reload_1440x900_editor-returns-home.png) | [Observed URLs](qa-screenshots/B03_navigation.txt). |

## 3. Confusing UI

Ordered by practical impact. These are usability findings, not claims that a feature is absent everywhere.

| ID | Screen | What confused me as a parent | What I expected | Suggested wording or behavior | Screenshot files |
|---|---|---|---|---|---|
| C04 | Spotlight, phone | The large fixed export/actions area takes much of the screen. Initially I can see the athlete but not playback, the timeline, or settings. Scrolling brings controls into view; it is not a hard blocker. | See the athlete and essential editing controls together. | Use a compact Generate bar; put secondary actions in a small menu. Keep playback next to the visible video. | [390×844](qa-screenshots/C04_spotlight_390x844_large-footer.png); additional baselines at 430×932, 360×800 and 768×1024. |
| C05 | Games / game menu | Upload and credit help say 30 days and that I can extend storage, but I could not find the expiry date or extension action in the game menu/details. | “Available until [date]” and “Keep 30 more days,” with a cost. | Put retention and Extend beside each uploaded game. | [Game menu](qa-screenshots/C05_game-menu_1440x900_no-retention-extension.png), [details](qa-screenshots/baseline_game-details_1440x900.png). |
| C01 | Soccer tags | Tags cover Goal, Assist, Pass, Tackle, Keeper Save, etc.; I did not find positions or a named teammate selector. “My athlete / Team” is broader than the landing description. | Position plus play type, and a way to identify the athlete/teammate. | Label the existing group “Play type”; add a separate position/player field or narrow the promise. | [Soccer tags](qa-screenshots/C01_tags_1440x900_no-position.png). |
| C06 | Clips / Finished | A play becomes a highlight, lives in Clips, is described as In progress after generation, and only reaches Finished after another Finish step. Clicking the title did not open it; the thumbnail did. | One clearly named object with an obvious Open/Finish action. | Use “Highlight drafts” and “Finished highlights”; make the whole card open, including its title. | [Clips](qa-screenshots/baseline_clips_1440x900.png), [Finished](qa-screenshots/baseline_finished_1440x900.png). |
| C02 | Game details | The title preserves “2026-10-10 Vs Rangers,” but Opponent and Game Date remain empty. | Filename date/opponent to prefill, or a clear prompt to enter them. | Prefill recognizable values for review; explain that title and game metadata are separate if no inference is intended. | [Blank metadata](qa-screenshots/C02_game-details_1440x900_filename-not-parsed.png). |

## 4. Landing-page promises compared with staging

Production was not visited, per the explicit instruction. Value proposition, hero believability, and CTA assessment use the supplied summary only; landing layout was not independently tested.

| Promise / expectation | Observed staging result |
|---|---|
| 88 free credits | Confirmed initial balance 88. First upload reduced it to 86; 8-second generation to 78; real soccer upload to 76. No purchase made. |
| 1 credit per finished second; upfront cost | Framing showed ~8 credits before generation. Upload showed 2 credits and balance. Spotlight export said free and did not reduce the balance. |
| $12.99 / $22.99 / $32.99, no expiry | Confirmed packs: 340 / 690 / 1,120 credits. “Credits never expire” visible. Checkout, payment, and lack of auto-renewal were not transaction-tested. |
| Upload/storage example | 2-credit upload cost visible. The 90-minute/6GB/30-day example and extension billing were not verified. |
| Any camera, no conversion | Generated 720p MP4 and provided 1080p soccer MP4 both uploaded. MOV, WebM, large games, and other codecs were not tested. Only MP4/MOV/WebM are advertised in the upload picker. |
| 11 sports and soccer presets | Eleven sport choices visible. Soccer play-type tags, ratings, notes, and My athlete/Team present. Position and named-teammate tagging not found (C01). Searchable library functionality was not fully exercised. |
| A few drags; AI does the rest | Guide clearly says I mark plays and drag the box; app smooths motion and sharpens output. Guidance explains returning the box when the athlete moves out. Manual touch drag worked on real soccer footage. AI-proposed player boxes were not established. |
| Wide and vertical | Portrait 9:16 and Landscape 16:9 controls exist in framing, and the game offers separate versions from a marked play. Vertical was exported; wide was not generated because exports were limited. |
| Animated spotlight | A default region appeared, could be moved, and was included in the free spotlight export. The supplied soccer highlight was not rendered, so athlete tracking quality was not established. |
| 30-day source retention; permanent generated storage; drafts need source | These terms appear in How credits work. Upload also says 30 days. Expiry/extension discovery is weak (C05). Long-term deletion/retention cannot be verified in one session. |
| One link, browser, no account | Confirmed public staging share in a fresh context with no authentication. Video loaded at 810×1440, about 8.067 seconds, readyState 4. Play/pause and Download were present. |
| Download | Confirmed saved MP4, 417,559 bytes, suggested filename video.mp4. First download took longer than a 6-second automation listener; a later attempt succeeded. Not filed as an app bug. |
| Zoomed in, crisp HD / toward 4K | Generated portrait output is 810×1440 and visibly reframed, with spotlight. The rendered source is a test pattern, so honest judgment of a child's detail, motion, blur, or HD improvement is not possible. Real soccer uploaded and was framed on touch, but not rendered again. No 4K export claim was verified. |

## 5. Responsive matrix

Each listed screen has PNG baselines at 1440×900 plus all eight requested sizes. OK means the saved layout was reviewed without an additional confirmed layout finding; it does not certify all interactions at that size. Shared playback, desktop primary flow, and real soccer touch marking/tagging/framing at 390×844 were exercised. Full interaction repetition at every size remains incomplete.

| Screen | 1920×1080 | 1366×768 | 1024×768 | 768×1024 | 430×932 | 390×844 | 360×800 | 667×375 |
|---|---|---|---|---|---|---|---|---|
| Production landing | N/T | N/T | N/T | N/T | N/T | N/T | N/T | N/T |
| Signed out | OK | OK | OK | OK | OK | OK | OK | OK |
| Games/home | C05 | C05 | C05 | C05 | C05 | C05 | C05 | C05 |
| Upload dialog | OK | OK | OK | OK | OK | OK | OK | OK |
| Game playback | OK | OK | OK | OK | OK | OK | OK | OK |
| Mark-play editor | OK | OK | OK | OK | OK | OK | OK | OK |
| Soccer tags | C01 | C01 | C01 | C01 | C01 | C01 | C01 | C01 |
| Framing | OK | OK | OK | OK | OK | OK | OK | OK |
| Spotlight | OK | OK | OK | C04 | C04 | C04 | C04 | C04 |
| Finished preview / Finish | OK | OK | OK | OK | OK | OK | OK | OK |
| Clips library | C06 | C06 | C06 | C06 | C06 | C06 | C06 | C06 |
| Finished library | C06 | C06 | C06 | C06 | C06 | C06 | C06 | C06 |
| Share dialog | OK | OK | OK | OK | OK | OK | OK | OK |
| Signed-out shared player | OK | OK | OK | OK | OK | OK | OK | OK |
| Buy credits | OK | OK | OK | OK | OK | OK | OK | OK |
| Credit explanation | OK | OK | OK | OK | OK | OK | OK | OK |
| Game details | C02 | C02 | C02 | C02 | C02 | C02 | C02 | C02 |
| Account settings | OK | OK | OK | OK | OK | OK | OK | OK |

Baseline naming is baseline_<screen>_<WxH>.png in qa-screenshots. Contact sheets use the eight sizes in the same order as the matrix. Landscape dialogs initially show only part of their content; credits scrolling was exercised and Cancel became reachable, so clipping alone was not filed as a blocker. Loading/generation/upload-progress, preview mode, and other transient states have 1440×900 captures but were not all repeated at every size.

## 6. Not tested / limits

- Production landing intentionally skipped; no production login or upload. No source code read or modified. Only e2e@test.local used, via the authorized staging test-login endpoint. No direct admin or /api/test/* calls. The app itself emitted some admin/me requests during normal startup.
- Exactly one paid highlight generation and one free spotlight export performed. A second upload used the real soccer footage supplied mid-test; it remains a draft. Consequently real-athlete output quality, real-motion interpolation, 4K, and wide-output generation remain unverified.
- Upload interruption/resume and navigating away mid-upload were not tested; both tested files uploaded quickly. Maximum size/duration, slow networks, and MOV/WebM not covered.
- Insufficient credits, purchases, refunds, extension charging, and actual 30-day expiry were not tested.
- Rapid repeated paid export/upload clicks were avoided to respect the action/credit limits. Empty play name fell back to note text; a long name was entered and restored without a confirmed failure. No exhaustive long-name responsive audit.
- A second play was created and deleted with the product confirmation; play count returned to one. Initial rating/tag/note persisted across sign-in. An immediate edit-then-navigation sequence appeared to lose an edit, but the evidence is insufficient for a separate bug; waiting before leaving preserved the later edit.
- Reload and Back were exercised, and sign-out/test-login preserved two games, the real draft, and the finished synthetic highlight. Direct editor reload returns home (B03). Exhaustive forward-history and every-screen deep-link checks not completed.
- Keyboard Tab produced visible focus in the framing screen, and Escape dismissed game details. No full keyboard-only journey, screen-reader, or measured contrast/tap-target audit.
- Responsive screenshots cover the listed screens; main interactions were not repeated in full at every size. True touch context was exercised at 390×844; other sizes primarily use viewport resizing.
- The initial in-app browser could not run the required login fetch. It was closed before using Playwright. Initial auth/me 401 is expected signed out. No observed cold-start 500; initial auth/init took 32.4 seconds (200), recorded once in session-notes.txt. Media request aborts and video waiting/suspend warnings were captured but not presumed to be app bugs.

## Evidence and test artifacts

- [Evidence folder](qa-screenshots/)
- [Downloaded finished highlight](qa-screenshots/finished-highlight.mp4)
- [Signed-out share link](https://reel-ballers-staging.pages.dev/shared/10e4b366-56db-4d2f-b4b2-332500b24336)
- [Console/network log, signed URL queries removed](qa-screenshots/network-console.txt)
- [Evidence inventory](qa-screenshots/findings-evidence.json)
- The account retains the synthetic game and finished highlight, the real soccer game/play/framing draft, and a private editable copy opened during follow-up layout checking. No additional generation was submitted for those drafts.
