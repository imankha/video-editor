# Sweep A: config/, constants/, data/, index.html copy catalog

Scope read in full: src/frontend/src/config/{displayNames.js (1245 lines), emptyStates.js, pricing.js, questDefinitions.jsx, tutorialVideos.js}, src/frontend/src/data/questDefinitions.js, src/frontend/src/constants/*.js (only aspectRatios, highlightColors, shareClipScope, sourceTypes hold visible strings), src/frontend/index.html. No src/content/ exists. Paths are relative to src/frontend/. "DN" = src/config/displayNames.js; "ES" = src/config/emptyStates.js; "QD" = src/config/questDefinitions.jsx. Counts are approximate grep counts (DN+ES+QD), some include key names.

Headline: the file's own comment declares "a GAME holds PLAYS; a PLAY produces a highlight", but strings still mix play / clip / highlight / draft / reel, the mode is called Framing / Frame / Focus / Crop, and the Home tab named "Clips" holds items headlined "Highlights in progress".

---------------------------------------------------------------------
## 1. TERM INVENTORY
---------------------------------------------------------------------

### 1.1 Game video (full recording)
| Word | Verbatim example | file:line | ~n |
|---|---|---|---|
| game | "Upload game" | DN:384 | ~40 |
| game video | "Game video" (ORIGINAL_VIDEO); "Start with your game video. Tap Upload game." | DN:29, DN:743 | 5 |
| game recording | "watch this entire game recording" | DN:256 | 1 |
| game footage | "Review game footage" (Games empty headline) | ES:37 | 1 |
| footage | "Add footage to game"; "This footage is kept for 30 days."; "Added X after the previous video" | DN:386, 1130, 18 | 9 |
| game film | "Transform game film into high-quality highlights..." | index.html:11 (+meta dupes 15, 22) | 3 |
| video | "Videos", "Video 2 of 3", "Previous video", "Restore the full video?" | DN:22, 32, 43, 230 | ~50 |
| full video | "Full video restored", "Back to full video" | DN:233, 1068 | 6 |
| camera / angle | "Main camera", "Back to main camera", "switches cameras" | DN:30-31, 42 | 4 |
| source / working video | "Watching X"; "Loading working video..."; "you need its source to re-edit" | DN:33, 295, 1144 | 3 |

### 1.2 Marked moment ("play") and its in-progress edit
| Word | Example | file:line | ~n |
|---|---|---|---|
| play (noun) | "Mark play", "Edit play", "Delete play", "Plays", "How good was this play?" | DN:48,49,68,56,81 | ~120 |
| marked plays | "Marked plays only", "Watch marked plays", "Keep only marked plays" | DN:222, 1154, 395 | 6 |
| Mark Plays (mode) | `ANNOTATE: 'Mark Plays'`; "Back to mark plays" | DN:277, 46 | 3 |
| Annotate (visible) | "Watch Annotate tutorial" | QD:121 | 2 |
| moment | "Moment 2 of 5"; "Pick the moments you want."; "mark another moment"; "6 moments" | DN:1032, 1169, 1216; QD:171 | ~18 |
| suggested plays | "Suggested plays"; "Add as suggested plays to X" | DN:1230, 1200 | 4 |
| clip | "Preview clip"; "Tap a clip to finish its highlight."; "Every clip is finished."; "You can link the Clip to a game from the Clips tab."; "Click the timeline to split your clip"; "Pick videos or a zip of clips." | DN:125, 752, 753, 443, 777, 445 | ~30 |
| Clips (tab / location) | "Clips"; "Added to Clips"; "View in Clips"; "It's in Clips as a draft."; "Highlight moved to Clips so you can edit it later" | DN:358, 909, 920, 918, 101 | ~20 |
| highlight (in-progress edit) | "Make highlight"; "Make Another Highlight"; "Highlights in progress"; "Make Portrait Highlight"; "Continue Framing Portrait Highlight" | DN:94, 140, 154, 148; ES:45 | ~100 |
| draft | "Your highlight is still a draft."; "It's in Clips as a draft."; "A draft you haven't generated stays viewable" | DN:910, 918, 1144 | 3 |
| Highlight Clip / Custom Reel | `'Highlight Clip'`, `'Custom Reel'` (source-type labels) | constants/sourceTypes.js:47-48 | 2 |
| status | "Not started"; "Continue"; "Framed"; "Not framed yet. Set a focus point on your athlete."; "X is framed" | DN:156, 161, 1080, 1081, 917 | 5 |

### 1.3 Finished exported video
| Word | Example | file:line | ~n |
|---|---|---|---|
| highlight | "Your highlight is ready"; "Share this highlight"; "Watch finished highlight"; "Highlight ready" | DN:663, 342, 1153, 564 | ~160 |
| Finished (tab) | `PUBLISHED: 'Finished'`; "Go to Finished"; "Open Finished" | DN:372, 412; ES:50; DN:748 | ~10 |
| "completed work" | "View your completed work." | ES:61 | 1 |
| "Ready for coaches and family" | Finished partial headline | ES:95 | 1 |
| video | "turn it into a video you can share"; "Highlights you generate are kept for good" | DN:725, 1143 | few |
| result | "check the finished result"; "see exactly what you'll share" | DN:731, 767 | 3 |
| preview | "Preview highlight"; "Back to preview"; "Preview"; "Preview clip"; "Watch your preview" | DN:1067, 679, 696, 125; QD:149 | ~12 |
| reel | "Instagram Reels" (platform, fine); `SECTION_NAMES.REELS: 'Reels'` (comment says renders nowhere); "Custom Reel" | DN:146, 367; sourceTypes:48 | 0 live except sourceTypes |
| Published | key names only (`PUBLISHED`, PUBLISH_REEL); no visible use in scope | DN:372, 394 | 0 visible |

### 1.4 Collection
Almost no visible "collection" noun in scope. aspectRatios.js names a collection by ratio ("Portrait" / "Landscape"; "Portrait (9:16)" via ratioWithName; "▯ Portrait" via ratioDisplay) and holds COLLECTION_MIN_DURATION_SEC=30. QD/DN guide keys "collectionShare": "Add people, then tap Share." / "Shared. Tap Done." (DN:824-825). Other sweeps own the noun.

### 1.5 Editing modes / steps
| Mode | Words used | file:line |
|---|---|---|
| Marking | "Mark Plays" (MODE_NAMES), "Mark Plays" (switcher), "Back to mark plays", "Annotate" (quest), "Mark play" (button) | DN:277, 285, 46, 48; QD:121 |
| Framing | "Framing" (MODE_NAMES), "Frame" (switcher verb), "Frame Your Highlight" (quest title), "Focus" ("Focus point", "Focus the action on your player", "Focus the video on your athlete", "put the focus on your athlete"), "Edit framing", "Framing timeline", "Framing focuses the camera on your player" | DN:278, 287, 992, 310, 727; data/questDefinitions.js:18; QD:158; DN:668, 993, 166 |
| Spotlight | "Spotlight" (mode), "Open in Spotlight", "Redo spotlight", "Add Spotlight to Portrait Highlight", "Continue Adding Spotlight to Portrait", "Add spotlight"; "Overlay" appears only in comments/QD header text | DN:279; QD:142; DN:955, 150, 152, 664 |
| Text | "Text" (sheet/lane); "Tap Add text to put a name or number on the video."; "title, name, or caption" | DN:270, 272, 1077 |
| Finish | "Finish", "Finish highlight", "Finish without spotlight", "Watch Finish tutorial" | DN:953, 389, 666; QD:124 |
| Locked reasons | "Generate your highlight to add a spotlight."; "Loading your plays..."; "Loading working video..."; "Previously generated video no longer matches your settings. Generate the latest video before adding a spotlight." | DN:293-296 |

### 1.6 The crop action
| Word | Example | file:line | ~n |
|---|---|---|---|
| frame / framing | "Frame", "Edit framing", "Not framed yet", "Keep your athlete in frame" | DN:287, 668, 1081; QD:137 | ~35 |
| crop | "Crop in tighter on the highlight(s) below"; "crop out everything else"; "1920x1080 crop"; "crop tighter or shorten it" | DN:610, 310, 618, 840 | ~8 |
| focus point | "Focus point"; "Add focus point"; "No focus points yet." | DN:992, 710, 889 | 6 |
| spot(s) | "The view moves smoothly between the spots you set." | DN:766 | 1 |
| box | "Drag the box onto your athlete"; "Darken outside the box" | DN:764, 1060 | ~11 |
| trim/slow | "Trim and slow motion"; "Trim and slo-mo"; "Add slow-mo..."; "Add a slow-mo moment"; "Tap 0.5x to slow a section" | DN:865, 707; QD:138; DN:778 | ~10 |
| split | "Split this highlight into segments"; "Split Segments layer" | DN:1055; QD:176 | 2 |
| tilt | "Fix a tilted camera" | DN:1058 | 1 |

### 1.7 Spotlight / circle
spotlight ("Add spotlight", "Spotlight color", "Spotlight fill", "Spotlight duration", "Play spotlight", "Spotlight set.") DN:664, 996, 1004, 1050, 1045, 808 (~61). circle: "Drag the circle onto your athlete." DN:807-808 (2). outline: "Outline thickness", "My athlete isn't outlined" DN:1003, 1036. glow: "or a glow under them?" QD:186. Shapes: "Around athlete", "Under athlete" DN:1000-1001. Dim: "Dim background" DN:1005 vs "Darken outside the box" DN:1060. Colors: White/Cyan/Yellow/Pink/Orange/None/Custom (constants/highlightColors.js:11-16,34); "Custom color", "Match color from uniform" DN:998-999. Internal const is still `HighlightColor` (not visible).

### 1.8 Text overlay
"Text" DN:270, 1076; "Tap Add text to put a name or number on the video." DN:272; "Name or number, e.g. #7 Maya" DN:271; "Type a name, number or caption" DN:811; "Add a title, name, or caption over the highlight." DN:1077; "It shows for N seconds." DN:273.

### 1.9 Credits / payment
credits: "Cost: 2 credits", "Balance: 54 credits" DN:1107-1108; "Tap Buy Credits." DN:835; "credit pack" DN:833; "Credit history" content DN:836; "Pay" DN:834. Cost verbs: "costs at least 1 credit" DN:1090; "Uses credits." DN:661; "No credits needed" DN:682; "Effects are free, no credits needed" DN:574; "free to store" DN:1143; "refunded"/"cost you nothing" DN:621. Storage: "Extend Storage" DN:839; "Adds N days of storage." DN:1131; STORAGE_RULE DN:1097. Rule: PER_SECOND_RULE DN:1089. pricing.js: CREDITS_PER_PLAY/approxPlays (pricing.js:44-52) use "play" to mean an exported highlight.

### 1.10 AI upscaling / generating
Generate ("Generate highlight", "Generate highlight with spotlight", "Generating highlight...", "Generate" CTA) DN:562-571, 698 (~20). "Generating your highlight" DN:585. "Sharpening the picture" DN:587 (+DIVISION_OF_WORK DN:432 "sharpen the picture"). "Enhance the video"/"We are enhancing your video" QD:140,178. "Render the spotlight"/"rendering your highlight with the spotlight burned in"/"render your close-up"/"Rendered 3:14 PM" QD:148,189,177; DN:684. "(AI upscaling)" DN:1093 (1). "upscaled on our video processor ... GPU time" DN:606. "Making your highlight" DN:773. "Adding your spotlight" DN:586, 796. "Finishing up" DN:539 and DN:584.

### 1.11 Uploading
"Upload game"/"Uploading game..." DN:384-385; "Upload highlight"/"Upload a highlight" DN:435, 442; "Add Game instead"/"use Add Game instead" DN:457-458; "Add footage to game" DN:386, "Tap Add footage" DN:816; "Already have a video?" ES:52; "Upload as clips" DN:1203; "Make a game from these highlights" DN:1204; "Pick videos or a zip of clips." DN:445; UPLOAD_STATE "Preparing / Uploading / Uploaded / Upload stopped / Retry upload" DN:524-530; UPLOAD_PROGRESS_COPY "Getting your game ready to upload / Uploading your game / Finishing up / Your game is uploaded. / Upload stopped." DN:537-541; Import: "Import Veo highlights / Importing... / Remove import" DN:1212, 1220, 1229; zip: "Reading the zip... / Unzipping your clips... / Checking the zip..." DN:1166, 1191, 1199.

### 1.12 Sharing
"Share plays"/"Share"/"Sharing settings"/"Sharing" DN:241-244; "Share with tagged players"/"Tagged players" DN:249-250; "Share this highlight" DN:342; "Get share link" DN:331; "Create share link" DN:336; "Share link..." DN:344; "Copy link" DN:343; "Link ready" DN:340; "Update shared version" DN:347; "Who can watch / Only people I add / Anyone with the link" DN:322-324; "Anyone you invite" DN:256; "Game invitations couldn't open." DN:259; recipient scope labels in constants/shareClipScope.js:18-27 ("All team highlights", "Only highlights they're tagged in", "Game only (no highlights)", "Every team highlight from this game", "Just this player's team moments", "Recap only - no highlights"); "Sign in"/"Sign In" DN:1157, 831.

### 1.13 Athlete / profile
athlete (~36): "Rate your athlete's play" DN:65; "My athlete" DN:127; "Tap your athlete" DN:803. player (~10): "Drag the box onto your player" DN:887; "Focus the action on your player" DN:310; "Not my player" DN:1235; "once you pick a player" DN:1021; "Share with tagged players" DN:249. kid: "Twenty-two kids in the same kit" DN:311. profile: "Tap a profile to switch to it, or tap + Add Profile for another athlete." DN:842; "athlete profile" DN:845. team: "Team" DN:128, "Rate your team's play" DN:66. teammates DN:826. sport "Pick sport" DN:1119-1122.

### 1.14 Team / shared games
"Someone shared this highlight with you." DN:830; "Pick who gets each tagged play" DN:826; "Played {date}"/"No match date set" DN:1201-1202; "Available until {date}" DN:214; "Plays only" chip DN:212; "Plays not backed up yet" DN:216.

### 1.15 Guidance / coach
"Turn off guidance for now" DN:790; "Turn guidance off for now." DN:789; "Got it" (DN:469, 622, 899, 1017); "Dismiss" DN:881, 921; tutorials "Watch tutorial / Watch Annotate tutorial / Watch Spotlight tutorial / Watch Finish tutorial" QD:46, 121-124; step counters "Step 1 of 3" DN:864 vs "Moment 2 of 5" DN:1032 vs "Video 1 of 3" DN:32. Quest titles: "Getting started", "Frame Your Highlight", "Configure Your Spotlight", "Finish your highlight" (data/questDefinitions.js:4, 18, 33, 48). "coaches" used as AUDIENCE (ES:95, DN:147), not as the in-app guide.

### 1.16 Status words
Not started DN:156 | Continue DN:161 | Framed / Not framed yet DN:1080-1081 | Done (button ANNOTATE.DONE DN:118; badge QD:91) | Finished (tab) DN:372 | ready ("Highlight ready", "Your highlight is ready", "Link ready") DN:564, 663, 340 | draft (see 1.2) | Open/Kept/Dismissed DN:1231-1233 | Plays only DN:212 | Preparing/Uploading/Uploaded/Upload stopped DN:524-527 | Saved-ish: "Just save this play" DN:57, "Saves this play as a highlight in Clips" DN:96, "Plays not saved" DN:105, "Play not saved" DN:112, "Could not save this play" DN:1242.

### 1.17 Other
Orientation: Portrait/Landscape (consistent). Rating: "Brilliant", "Good". Retention: "kept for 30 days", "kept for good", "extend it anytime". Back-labels: "Back", "Back to the play", "Back to game plays", "Back to full video", "Back to preview", "Back to main camera", "Back to mark plays". Times: "-1 s"/"+1 s" DN:1226-1227; "6s" DN:53, 1185; "about 6 min" DN:631; "30 days".

---------------------------------------------------------------------
## 2. FINDINGS
---------------------------------------------------------------------
Format: [CATEGORY] verbatim | file:line | why it hurts a parent | rewrite.

### A. play / clip / highlight / draft / reel collisions

1. [INCONSISTENT] Home tab "Clips" vs its own headline "Highlights in progress" and body "Plays you've started turning into highlights wait here until you finish them." | DN:358, ES:45-46 | Tab says clip, content says highlight; Finished tab also holds "highlights". | Tab "In progress" (Games / In progress / Finished); item always "highlight".
2. [INCONSISTENT] "clip" and "highlight" in one sentence: "Pick up where you left off. Tap a clip to finish its highlight." | DN:752 | Same thing, two words. | "Tap a highlight to finish it."
3. [INCONSISTENT] More "clip" for the same object: "Every clip is finished." (DN:753) "You can link the Clip to a game from the Clips tab." (DN:443, also stray capital C) "Click the timeline to split your clip where you want to trim or slow it." (DN:777) "Preview clip" (DN:125) "Creating a highlight from a framed clip" (DN:1093) | listed | One object, two nouns. | Use "highlight" for the item; "Preview" alone for the button.
4. [UNCLEAR] "highlight" names the marked moment's in-progress edit, the generated video, AND the shared object. "Make highlight" -> "Highlights in progress" -> "Your highlight is ready" -> "Share this highlight". A play can also have several highlights (portrait+landscape: "Make Another Highlight" DN:140). | DN:94, 140, 663, 342 | Parent cannot tell unfinished from finished by word alone. | Define: play = marked moment; highlight = finished video only. In-progress wording: "Make highlight" button, "In progress" tab, "unfinished highlight" only where needed.
5. [INCONSISTENT] "draft" appears in 3 places yet nowhere in UI labels: "Your highlight is still a draft." DN:910; "It's in Clips as a draft." DN:918; "A draft you haven't generated stays viewable" DN:1144. | | Third name (clip/highlight/draft) for the in-progress item. | "still in progress" / "A highlight you haven't created yet..."
6. [JARGON/INCONSISTENT] "Highlight Clip" and "Custom Reel" source-type labels | constants/sourceTypes.js:47-48 | Legacy mash-up; "reel" retired. If ever shown it contradicts all other copy. | "Highlight" / "Collection", or delete.
7. [INCONSISTENT] "Play" means three things: marked moment ("Mark play"), the transport button ("Tap Play to watch the game", DN:720; "Tap Play to confirm you have the full play." DN:724), and in pricing an exported highlight (CREDITS_PER_PLAY / approxPlays "~N plays", pricing.js:43-52). | | One sentence (DN:724) uses both senses. | Say "play button" for transport; in pricing say "about N highlights".
8. [INCONSISTENT] "Cut your first play" (ES:81) uses "cut" (editing verb) for what the body says is marking ("Tap Mark play on each moment worth keeping."). | ES:81-82 | Parent thinks they must trim a clip. | "Mark your first play".

### B. Verbs for the pipeline (Make / Generate / Create / Finish / Publish / Share)

9. [INCONSISTENT] Verbs: "Make highlight" DN:94, "Generate highlight" DN:562, "Generate highlight with spotlight" DN:569, "Finish highlight" DN:389, "Finish" DN:953, "Finish without spotlight" DN:666, "Get share link" DN:331, "Create share link" DN:336, "Get your link" DN:798; cost copy uses "create" ("Every highlight you create costs at least 1 credit." DN:1090; "Creating a highlight from a framed clip" DN:1093; "Re-creating a highlight" DN:1094) while buttons say "Generate". | | The credit-spending step is called Generate on the button but Create in the cost line. | One verb for the paid step: "Create highlight". Keep Make/Edit for starting, Finish for moving to Finished, "Get link" for sharing.
10. [INCONSISTENT] "Make highlight" is the value of four constants (FRAME_THIS_CLIP DN:137, MAKE_HIGHLIGHT_NOW DN:94, MAKE_A_HIGHLIGHT DN:143, FRAME_CLIP DN:177); siblings "Make Another Highlight" (DN:140), "Make Portrait Highlight" (DN:154) are Title Case. | | Visible casing clash on adjacent buttons. | Sentence case everywhere.
11. [CONTRADICTION] The Framing entry button reads "Make highlight" (DN:137, comment says verb "Frame" DN:134, header tab reads "Frame" DN:287, in-progress rows read "Continue Framing Portrait Highlight" DN:148). | | Button label differs from the tab it opens. | "Frame highlight"/"Continue framing" or rename the tab.
12. [CONTRADICTION] "Tap Finish to get your link." (GUIDE.overlay.ready DN:798) vs FINISH_CAPTION "Moves it to Finished. Only you can see it until you share a link." (DN:660). Finish does not create a link. | | Parent expects a link and doesn't get one. | "Tap Finish to move it to Finished, then Get share link."
13. [CONTRADICTION] "You need more credits for this highlight. Tap Generate highlight to add them, then generate the highlight." DN:772 | | One button both buys credits and generates. | "Tap Generate highlight. You'll be asked to buy credits first."
14. [UNCLEAR] "Tap Make highlight to turn this play into a video, or Edit play to adjust it." DN:726 vs "Tap Make highlight to turn it into a video you can share" DN:725 | "turn into a video" vs "highlight" for same output. | "turn it into a highlight".

### C. Mode names: Framing / Frame / Focus / Crop; Annotate / Mark Plays; Overlay / Spotlight

15. [INCONSISTENT] Four words for the crop step: Framing (DN:278), Frame (DN:287), Focus ("Focus point" DN:992, "Focus the action on your player, crop out everything else." DN:310, "Focus the video on your athlete" DN:727, "put the focus on your athlete" DN:158 QD), Crop ("Crop in tighter" DN:610, "crop tighter" DN:840). CLAUDE.md says "Focus" retired, still in ~8 visible strings. | | Parent searching for "crop" finds "framing", "focus point", "box", "spots". | Pick Frame for the step, "box" for the rectangle, and call each placement a "position" or "frame point"; remove "Focus".
16. [INCONSISTENT] Three words for each crop placement: "focus point" DN:992, "spots you set" DN:766, "the box" DN:764. | | | "box position" / "frame point" consistently.
17. [INCONSISTENT] Mark-mode name forms: "Mark Plays" (Title Case, DN:277), "Back to mark plays" (DN:46), "Mark play" (DN:48), "Annotate" (QD:121 "Watch Annotate tutorial"). | | "Annotate" is a developer word. | "Mark plays" everywhere; tutorial "Watch the marking tutorial".
18. [JARGON] Quest header/descriptions "Apply Overlay" (QD:10 comment) vs visible "Spotlight"; ok in visible strings, but "Overlay" remains a dev word to purge in any other file.
19. [INCONSISTENT] Spotlight labels: "Add spotlight" DN:664, "Add Spotlight to Portrait Highlight" DN:150, "Continue Adding Spotlight to Portrait" DN:152, "Redo spotlight" DN:955, "Open in Spotlight" QD:142, "Play spotlight" DN:1045 (preview) vs "Preview highlight" DN:1067 (also preview). | | Case and verb differ; "Play" vs "Preview" for the same idea. | "Add spotlight", "Edit spotlight", "Preview spotlight".
20. [INCONSISTENT] "preview" = (a) crop check before generating ("Preview highlight" DN:1067), (b) reopening the generated render ("Back to preview" DN:679), (c) cockpit "Preview" DN:696, (d) "Preview clip" DN:125, (e) "Review plays" DN:119 (play-all). | | The same button word means a rough crop check, then the real video. | "Check framing" before generating, "Watch highlight" after.
21. [INCONSISTENT] slow-mo spellings: "Trim and slow motion" DN:865, "Trim and slo-mo" DN:707, 711, "slo-mo" DN:166, "slow-mo" QD:138, "Add a slow-mo moment". | | | "slow motion"/"Slow-mo" chosen once.
22. [UNCLEAR] "Setup" cockpit button DN:695; "Preview" DN:696. | | "Setup" says nothing. | "Frame" / "Watch".

### D. Status words

23. [INCONSISTENT] Completion states: Framed DN:1080 / Done QD:91 / Finished DN:372 / ready DN:564 / "Not started" DN:156. Quest describes "the green 'Done' badge on a finished Clip card" (QD:85). | | Four words for complete. | Ladder: Not started / Framed / Finished. Reserve "Done" for the close button.
24. [UNCLEAR] "Done" means close editor (DN:118), "Done for now" (DN:670, 959), "Done placing athlete" (DN:1037), "Done!" success (DN:788). | | | Distinct labels: "Close", "Back to home".
25. [INCONSISTENT] "Finishing up" used for end of game upload (DN:539) and the 92% export phase, whose key is UPLOADING (DN:584). | | | Export: "Almost done".
26. [INCONSISTENT] Upload failure has 4 wordings: "Upload stopped" DN:527, "Upload stopped." DN:541, "Your game didn’t finish uploading." DN:739, "That upload didn’t finish." DN:761. | | | "Upload didn't finish" once.
27. [TONE/STYLE] UPLOAD_STATE.SAVED key holds "Uploaded" DN:526; owner rule: no "Saved" copy. Action copy still says save: "Just save this play" DN:57; "Saves this play as a highlight in Clips. Open it there to edit or finish it." DN:96 (also the subtext of "Keep Marking Plays", which doesn't match). | | | "Keep this play" / "Not now".

### E. Upload

28. [CONTRADICTION] Errors tell users to use "Add Game" ("use Add Game instead" DN:457, DN:478-479; button "Add Game instead" DN:458, "Tap Add Game instead" DN:819) but the button is "Upload game" (DN:384); DN:468 says "click Upload game". | | The named button doesn't exist. | "Use Upload game instead."
29. [INCONSISTENT] Upload objects/verbs: "Upload highlight" DN:435, "Add footage to game" DN:386, "Upload as clips" DN:1203, "Make a game from these highlights" DN:1204, "Already have a video?" ES:52. | | A raw video file is called a highlight/clip/footage/video. | "Upload a video".
30. [UNCLEAR] "This highlight is too large to upload" / "Highlight uploads are limited to 500MB" DN:455-457 | | They are uploading an unedited video, not a highlight. | "This video is too large" / "Videos are limited to 500 MB."
31. [JARGON] "Make sure it's a valid MP4, MOV, or WebM file." DN:481; "Use an MP4, MOV or WebM." DN:1128 | | File formats. | "Use a video from your phone or camera (MP4 or MOV)."
32. [UNCLEAR] "Keep this tab open." DN:528, 542 | | No tabs on a phone; screen lock matters more. | "Keep this page open until it finishes."
33. [JARGON] "Reading the zip...", "Only Veo highlights zips are supported." DN:1166-1167, "Unzipping your clips..." DN:1191 | | | "Only Veo highlight downloads work here."
34. [INCONSISTENT] Choose verbs: "Pick your game video" DN:759, "Choose the video file" DN:815, "Choose highlights to add" DN:1165, "Pick sport" DN:1119, "Pick your athlete" DN:1019, "Select all" DN:1170. | | | "Choose".

### F. Credits / AI / jargon

35. [JARGON] EXPORT_TOO_LARGE: "Every frame is upscaled on our video processor, and this batch needs more GPU time than one job can finish before it times out." DN:606-608; "Biggest contributors" DN:614; "1920x1080 crop, about 6 min" DN:615-618; "faster to process" DN:610. | | GPU, batch, job, timed out, contributors, resolution. | Title "This highlight is too long to make in one go." Body "Try a shorter highlight, or crop in tighter." Heading "Longest highlights".
36. [JARGON] STORAGE_RULE: "1 credit per GB per 30 days, rounded up to the next GB. Even a tiny file is 1 credit per 30 days. Uploading a game adds 1 credit for the automatic highlight export." DN:1097 | | GB, "automatic highlight export" is never explained elsewhere. | "Storing a game costs 1 credit per 30 days for each GB."
37. [JARGON] PER_SECOND_RULE "1 credit per second, rounded to the nearest second" DN:1089; billableLine "12.3s of video · 12 credits · 1 credit per second..." DN:1099 | | "rounded", "billable", decimals. | "Each second of highlight uses 1 credit."
38. [INCONSISTENT] Cost phrasing: "Cost: 2 credits" DN:1107, "Uses credits." DN:661, "No credits needed" DN:682, "Effects are free, no credits needed" DN:574, "free to store" DN:1143, "This attempt cost you nothing." DN:621. | | | "Costs N credits" / "Free".
39. [UNCLEAR] "Effects are free" DN:574 introduces "effects" (spotlight + text). | | | "Spotlight and text are free."
40. [CONTRADICTION?] "Highlights you generate are kept for good and are free to store." DN:1143 vs storage costs for games DN:1097 and "Available until {date}" DN:214. | | Parent can't tell what costs storage. | "Finished highlights are free to keep. Games cost credits to store."
41. [JARGON] AI step names: "Generate" DN:562, "Sharpening the picture" DN:587, "Enhance the video" QD:140, "rendering ... burned in" QD:189, "Render the spotlight" QD:148, "render your close-up" QD:177. | | Five terms for one step; "render"/"burned in" are editor jargon. | "Create highlight" (button), "Sharpening your video" (progress), "adding your spotlight".
42. [UNCLEAR] "Previously generated video no longer matches your settings. Generate the latest video before adding a spotlight." DN:296 | | | "Your highlight is out of date. Create it again, then add a spotlight."
43. [JARGON] "Loading working video..." DN:295 | | "working video" is internal. | "Loading your video..."
44. [UNCLEAR] "Update shared version" / "Your link still shows the previously generated video. Update it to point at the latest." DN:347-348 | | | "Update your link" / "Your link still shows the older video."
45. [UNCLEAR] "Waiting in line, other videos are being made" DN:583; "Time remaining varies." DN:591 | | | "Busy right now. You're in line."
46. [TONE/STYLE] Title Case buttons: "Buy Credits" DN:835, "Extend Storage" DN:839, "Save Changes" DN:820, "Add Profile" DN:842, "Move highlight" (sentence) DN:846, "Sign In" DN:831 vs "Sign in" DN:1157. | | | Sentence case.

### G. Athlete / player / kid

47. [INCONSISTENT] "Pick your athlete" DN:1019 then "once you pick a player" DN:1021; "Drag the box onto your player" DN:887-888; "Focus the action on your player" DN:310; "Not my player" DN:1235; "Twenty-two kids" DN:311; "My athlete" DN:127. Comment (DN:981-988) says athlete=your kid and player=others, but visible strings break it in the same panel. | | | Choose one: "your player" (sport-natural) everywhere, or "your child". 
48. [JARGON] "athlete", "My athlete", "Around athlete/Under athlete" (DN:127, 1000-1001) | | Soccer parents say my son/daughter/kid/player. Labels also drop the article. | "My player", "Around player", "Under player".
49. [UNCLEAR] Layer "Who is this play about?" "My athlete" / "Team" DN:126-128 | | "Team" ambiguous (teammates vs opponents). | "My player" / "Another player".
50. [UNCLEAR] Rating prompts: "Rate your athlete's play" DN:65, "Rate your team's play" DN:66, "How good was this play?" DN:81. | | Three prompts for one control. | One.
51. [CONTRADICTION] "Your plays, back to back. Tap Share plays to send them to your athlete." DN:733 vs SCOPE_DISCLOSURE "Anyone you invite can watch this entire game recording and every play you've marked in it." DN:256. | | Guide says send to your athlete; share goes to invitees; also shares the full game, not just plays. | "Tap Share to send them to family or coaches."

### H. Sharing

52. [CONTRADICTION] Button "Share plays" DN:241 shares the whole game video + every play (DN:256). | | Parent thinks only clips go. | "Share game".
53. [INCONSISTENT] Share vocabulary: invite DN:256, 259 / add people DN:824 / share DN:241 / link DN:331-347 / "Sharing" DN:244; objects "plays" vs "highlight" vs "tagged players". | | | "Share" + object.
54. [UNCLEAR] Recipient scope labels use "highlights" for marked plays, not finished videos: "All team highlights", "Only highlights they're tagged in", "Game only (no highlights)" constants/shareClipScope.js:18-20; sublabels "Every team highlight from this game", "Just this player's team moments", "Recap only - no highlights" :25-27. | | "highlights" here means plays; "team moments"/"Recap" are new words; spaced hyphen as dash. | "All team plays" / "Only plays they're tagged in" / "Game video only. No plays."
55. [UNCLEAR] "Tagged" DN:249-250, 826-827 | | "tag" also means rating tags. | "Share plays they're in".
56. [JARGON] "Link to game" / "Unlink from game" / "Highlight linked to game" / "Only uploaded highlights can be linked to a game." DN:498-513 | | | "Add to game" / "Remove from game".

### I. Guide/coach copy

57. [INCONSISTENT] Click vs Tap vs Press vs Hit: "Click your athlete to add a spotlight" DN:1020 (comment says deliberate), "Click the timeline to split your clip" DN:777, "Click Games, then click Upload game" DN:468, QD "click Mark play" :163, "Click the highlight's card" :180, "Click Generate highlight" :177, "Click Finish highlight" :191, "Hit the play button" :192, "hit pause" :175, "press Mark play" DN:45, "Press Done" DN:41. "Tap" is used ~80x. | | Phones are the main device. | "Tap" everywhere.
58. [UNCLEAR] "Drag the green ends so the play starts and stops where you want. Tap Play to confirm you have the full play. Rate the play and optionally add tags and notes, then tap Done." DN:724 | | One long 3-step sentence; relies on color. | Split; "Drag the handles".
59. [UNCLEAR] "Brilliant play. Make a portrait highlight." DN:727 | | "Brilliant" undefined at that point. | "Great play. Make a highlight."
60. [UNCLEAR] "Highlights unlock once your game finishes uploading." DN:736-737; "Finish the steps above to unlock" DN:866; "...then press Play, to unlock" DN:887 | | "unlock" suggests payment. | "You can make highlights once the upload finishes."
61. [UNCLEAR] "Turn off guidance for now" DN:790 / "Turn guidance off for now." DN:789 | | "guidance" odd; two near-duplicate strings. | "Hide tips".
62. [JARGON] "Fix timing: X" DN:37, "Press Done to apply the move first (or X to discard it)" DN:41, "Drag to reposition X" DN:38 | | Aligning extra camera video; "timing" unexplained. | "Line up X with the game".
63. [UNCLEAR] Camera copy: "Main camera", "Where two cover the same moment, tapping switches cameras without moving." DN:30, 42 | | Most parents have one phone video. | Only show in multi-video games (already gated).
64. [JARGON] Quest "On the bottom Split Segments layer of the timeline, click once where your big moment starts and again where it ends. Then set the section between those two splits to 0.5x for slow-mo." QD:176 | | layer/split/segments/timeline. | "Tap the bar under the video where the slow motion should start and end, then choose 0.5x."
65. [UNCLEAR] Quest copy still instructs UI that may be gone: "Set start time and end time precisely" QD:164; "Save your play" title QD:129 although plays auto-save. | | | "Rate your play".
66. [INCONSISTENT] Quest titles: "Getting started" (sentence), "Frame Your Highlight", "Configure Your Spotlight" (Title Case), "Finish your highlight" (sentence). data/questDefinitions.js:4, 18, 33, 48. | | | Sentence case.
67. [UNCLEAR] "Watch your preview" QD:149 / "Press play on the Done badge Highlight to preview the finished result." QD:190 | | "preview" of an already-finished video. | "Watch your highlight".
68. [UNCLEAR] "Plays only" / "Marked plays only" / "Keep only marked plays" / "Keep plays only" / "Keep-only" / "Restore video" / "Restore full video" | DN:212, 222, 395, 227, 231, 232, 396 | Six phrasings for one feature. | "Keep plays only" / "Restore full video".
69. [JARGON] "Plays not backed up yet" DN:216 | | | "Plays not saved yet".
70. [UNCLEAR] "Cover image" / "Choose cover frame" DN:1007-1009 | | "frame" here means a video frame, a third sense of Frame. | "Choose cover photo".
71. [INCONSISTENT] Two dim controls: "Dim background" DN:1005 (Spotlight) and "Darken outside the box" DN:1060 (Framing). | | | Same word: "Dim outside".
72. [INCONSISTENT] Empty-state headlines: "Review game footage" ES:37, "Highlights in progress" ES:45, "View your completed work." ES:61 (only one with trailing period), "Cut your first play" ES:81, "Finish your highlights" ES:86, "Ready for coaches and family" ES:95. Finished tab described three ways (completed work / ready / finished highlights DN:756). | | Games empty headline doesn't say to upload; mixed tone. | "Upload your game"; "Your finished highlights".
73. [UNCLEAR] Mode lock toast "Mark your first play to review it." DN:123 / "to share it." DN:124 | | OK.

### J. Number/unit/punctuation style

74. [TONE/STYLE] Seconds: "grabs last 6s and next 2s" DN:53 (typo-ish), "-1 s"/"+1 s" DN:1226-1227 (space + ASCII minus), "6s" DN:1185, "about 6 min" DN:631, "N seconds" DN:273. | | | "6 seconds", "+1 sec".
75. [TONE/STYLE] Apostrophes mixed straight and curly within the same file: GUIDE uses curly (DN:722, 739, 745) vs "couldn't" straight (DN:104, 106, 481); CLIP_LINK has both (DN:501 curly, DN:512 straight). | | | Normalize.
76. [TONE/STYLE] Error voice: "Could not read this zip." DN:1167; "Could not import these highlights. Try again." DN:1222; "Could not save this play. Try again." DN:1242; "Could not load your preview. Please try again." DN:686 vs "That didn't work. Please try again." DN:235; "Something went wrong marking this play." DN:113. | | Formal vs casual, "Please" inconsistent. | Contractions, no "Please".
77. [TONE/STYLE] Title Case labels beyond those above: "Keep Marking Plays" DN:95, "Make Another Highlight" DN:140, "Continue Framing Portrait Highlight" DN:148-149, "Add Spotlight to Portrait Highlight" DN:150, "Add Tags and Notes"/"View Tags and Notes" DN:191-192, "Tap Retry Loading Video" DN:780, "Add Game instead" DN:458, "Mark Plays" DN:277. Sentence case: "Mark play", "Edit play", "Add spotlight", "Generate highlight". | | | All sentence case.
78. [TONE/STYLE] "Recap only - no highlights" uses spaced hyphen as dash. constants/shareClipScope.js:27. "1920x1080", "0.5x" use letter x. | | | Use period/colon; "×".
79. [TONE/STYLE] Ellipsis as "..." everywhere (consistent). No em dashes found in shipped strings (QD comments contain "—" only in code comments; QD:165 `"— we'll offer to make it a highlight"` is a VISIBLE em dash in annotate_brilliant description). | QD:165 | Violates owner rule on em dashes in shipped copy. | Replace with a period or colon.
80. [TONE/STYLE] index.html: title "ReelBallers" (no descriptor); description uses "game film" and "AI upscaling" and "high-quality highlights" | index.html:10-11 | In-app word is "game video"; "AI upscaling" is jargon to parents. | "Turn your game video into sharp highlights in minutes. No subscription: pay only for what you use."
81. [UNCLEAR] "Highlight moved to Clips so you can edit it later" DN:101 | | Clip + highlight in one sentence. | "Added to In progress so you can edit it later."
82. [UNCLEAR] "Ready for coaches and family" / "Use Share or Copy Link on any card." ES:95-96 | | "Copy Link" (Title Case) vs label "Copy link" DN:343. | Align casing.
83. [UNCLEAR] "Skip ahead on Clips." ES:42 | | Depends on tab name. | Follows rename.
84. [UNCLEAR] "Brilliant" count: `${n} brilliant` DN:210 | | | "${n} great plays".
85. [UNCLEAR] "Congrats, you’ve reviewed your whole game and finished every highlight." DN:750 | | Claims the app knows you watched the whole game. | fine, soften.

---------------------------------------------------------------------
## 3. UNUSED / DEAD KEYS (obvious only)
- SECTION_NAMES.REELS and LIBRARY_ACTIONS.PUBLISH_REEL (comments say no remaining consumers); SOURCE_TYPE_LABELS ('Highlight Clip', 'Custom Reel') if not rendered; FOCUS_PUBLISH.SAVE_DRAFT_LABEL / OVERLAY_PUBLISH.SAVE_DRAFT_LABEL keys still say "draft" (value "Done for now").
- Constants files with no user-visible strings: editorModes, exportFps, exportStatus, gameConstants, keyframeOrigins, brandedOutro, highlightEffects, zLayers, textSpec, textPositionPresets, introBadge, index.js, tutorialVideos.js, pricing.js (copy-free). No admin-only strings found in scope.
