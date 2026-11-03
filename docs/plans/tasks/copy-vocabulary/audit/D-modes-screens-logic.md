# Copy audit D: modes / screens / containers / App / logic folders

Scope: src/frontend/src/{modes,screens,containers,App.jsx,hooks,stores,utils,services,api}. Paths below are relative to src/frontend/src. Method: grep of every quoted/JSX string plus targeted reads of context. Many labels come through config/displayNames.js (other sweep); where an inline string diverges from it, it is tagged HARDCODED. Lines marked (comment) are code comments, not user copy, and are NOT counted. Note: much of the "Add Play / Create clip / Frame Later / Add Overlay / Keep Annotating / Open Focus" vocabulary survives ONLY in comments now; the live copy is the displayNames version.

Canonical vocabulary the code itself declares (displayNames.js): marked moment = "play"; in-progress/finished product = "highlight"; Finished tab = "Finished"; in-progress list = "Clips" tab; modes "Mark Plays" / "Frame" (header) / "Framing" (noun) / "Spotlight". The inline copy below is judged against that and against what a soccer parent would say.

---------------------------------------------------------------------------
## 1. TERM INVENTORY

### 1.1 Game video (the uploaded full game)
| Variant | Example (file:line) | Notes |
|---|---|---|
| "game" | `'This game no longer exists'` screens/AnnotateScreen.jsx:168, containers/AnnotateContainer.jsx:1897; `'Game not found'` AnnotateContainer.jsx:1641; `'Game ready!'` stores/uploadStore.js:113 | dominant for the container |
| "video" | `'Video failed to load'` modes/AnnotateModeView.jsx:890; `'Retry Loading Video'` AnnotateModeView.jsx:896, FocusModeView.jsx:697; `'Source video expired'` AnnotateModeView.jsx:825; `'That is past the end of the video.'` modes/annotate/trimBounds.js:52; `'Loading video...'` (x6) FocusModeView.jsx:837,839, FocusCockpit.jsx:264,266, OverlayModeView.jsx:135, OverlayScreen.jsx:1766, AnnotateModeView.jsx:953 | same word also used for the finished output and for angle videos |
| "Game video" | modes/annotate/footageLanding.js:20; displayNames ORIGINAL_VIDEO | |
| "footage" | `'Add footage'` AddFootageButton.jsx:29-52,239,242,246; `'Failed to add footage'` :197; `"Drop your footage here..."` :36 | extra camera/half |
| "Extra video {n}" | footageLanding.js:21; hooks/useVirtualTimeline.js:332,357,610 | |
| "Main camera" / "angle(s)" / "Angles" | AnnotateContainer.jsx:497-498; AnnotateTimeline.jsx:160,164; AngleLanes.jsx:211,300 | "angle" and "camera" and "video" all name an extra file |
| "source video" | `'Source video expired'` AnnotateModeView.jsx:825; `'Source video expired — cannot mark plays'` :1368 | JARGON (source) |
| "recording" | displayNames SHARING.SCOPE_DISCLOSURE (other sweep) | third noun |
| "file" / "video file" | `'No video file loaded'` ExportButtonContainer.jsx:514; `'File is too large. Maximum size is 4GB.'` utils/fileValidation.js:33 | |
| "working video" | `'Loading working video...'` FocusModeView.jsx:838, FocusCockpit.jsx:265, OverlayScreen.jsx:1766, hooks/useProjectLoader.js:224; `'Failed to load working video'` OverlayScreen.jsx:603 | JARGON (internal pipeline stage shown to user) |
| "library" | `'Already in your library'` stores/uploadStore.js:108 | vs "account" in the next line, vs Games tab |

### 1.2 Marked moment (and its in-progress edit)
| Variant | Example (file:line) | Count (enumerated) |
|---|---|---|
| "play" | `'Mark play'`, `'Edit play'`, `'Review plays'`, `'Share plays'` AnnotateModeView.jsx:1366-1388; `'Play added'` AnnotateContainer.jsx:155,1919,2372; `'Delete play'` DeletePlayButton.jsx (via ANNOTATE.DELETE_PLAY); `'Name this play'` AnnotateFullscreenOverlay.jsx:756,873; `'Enter play name...'` :472; `'No plays yet'` ClipsSidePanel.jsx:297, ClipRegionLayer.jsx:107; `'Jump to play'` ClipListItem.jsx:207; `'Preview play'` ClipScrubRegion.jsx:617; `'Edit selected play (A)'` AnnotateControls.jsx:255,269 | ~35, canonical |
| "moment" | `"Review these moments with your athlete."` AnnotateModeView.jsx:755; `"Return to the game and mark more moments."` :759; `"Save a moment to highlight or review."` :1374; `"Watch the moments you have marked."` :1383 | 4 (in descriptions of the same buttons that say "play") |
| "clip" | `'No ${LAYER} plays'` n/a; `'Failed to save crop keyframe'` n/a; `title="New clips go to"` is comment; live: `'Open Clips'` tab words: `'View in Clips'` AnnotateScreen.jsx:310 (comment) ; `"Imported N plays"` ClipsSidePanel.jsx:114; `{clip}` in `'Failed to fetch raw clips'` hooks/useRawClips.js:26; `Cut from ${angleName}` ClipListItem.jsx:156 (live, "cut" = clip) | clip = play in code but "Clips" tab = highlight drafts |
| "highlight" used for the marked moment | `"Your highlight wasn't saved. Please try again."` hooks/useRawClipSave.js:23 (this is the create-play failure copy); `'Failed to update highlight'` :267; `'Failed to delete highlight'` :314; `Delete highlight` ANNOTATE.DELETE_CLIP | CONTRADICTION: same object called play (AnnotateContainer.jsx:1853 "Could not save this play") and highlight |
| "annotation(s)" | `aria-label='Annotation playback'`, `'Preparing annotation playback'` AnnotateModeView.jsx:625,642; `'Annotation video'` :847,864; `'No valid annotations found in file'` modes/annotate/hooks/useAnnotate.js:221 | JARGON (never used elsewhere) |
| "Annotate" (mode) | `Mark Plays` mode name; "Annotate" survives in file/var names and comments only | ok |
| "marker" | `'Player assigned at frame N - Click to revisit'` DetectionMarkerLayer.jsx:112-ish; `Drag the cover-image marker` PosterMarkerLayer.jsx:426 | JARGON |
| "region" | `emptyMessage="Click to add a highlight region"` modes/overlay/OverlayMode.jsx:357; `'No text region under the playhead'` OverlayModeView.jsx:1069,1379 | JARGON |
| "draft" | `"Couldn't open this draft"` ProjectsScreen.jsx:230,282, utils/resumeFocusCompletion.js:107; `Failed to open highlight as draft` hooks/useReEditReel.js:90; `moved to drafts on this device` useReEditReel.js:74; `Save draft` is comment/funnel only | vs "highlight" for the same object (see next) |
| "project" | `'This project was edited elsewhere'` utils/actionConflictPrompt.js:24; `'Loading project...'` hooks/useProjectLoader.js:113; `'Failed to fetch project'` stores/projectsStore.js:108; `'Cannot generate: No project selected. Please save your project first.'` ExportButtonContainer.jsx:641; `Failed to rename project` projectsStore.js:226 | JARGON; parents never see "project" elsewhere |

### 1.3 Finished/exported video
| Variant | Example | Notes |
|---|---|---|
| "highlight" | `'Highlight ready'`, `'Generate highlight'`, `"Couldn't finish your highlight"` App.jsx:598; `'Highlight loaded'` hooks/useProjectLoader.js:258; `"Your highlight edits are ready."` stores/overlayActionStore.js:167 | canonical for the product, but ALSO used for in-progress edit, for the 5-star rating level, for the spotlight, and for a timeline layer (see 1.8) |
| "video" | `'Export complete!'` (x5: ExportButtonContainer.jsx:303,391,688,733,822; stores/exportStore.js:267); `'Got your video ready'` n/a | |
| "reel" | `Reel` in `useMoveReels.js` (file/hook name); user copy there says "highlights" (useMoveReels.js:35,111,135) | internal only now |
| "Finished" | `toast.success('Finished', ...)` screens/OverlayScreen.jsx:1667; `'Finished removing'` hooks/useMoveReels.js:75 (means something else!); `'Finished highlight'` NotesOverlay.jsx:11; `draftStage.js:149 label:'Finished'` | "Finished removing" collides with "Finished" tab |
| "result" / "download" | `'Failed to fetch downloads'` hooks/useDownloads.js:69 ; `'Download failed: 403 Forbidden'` utils/reelDownload.js:18,26 | |
| "published/publish" in copy shown to users | `'Failed to finish'` usePublishProject.js:100; `'Could not finish'` :174 (good) ; `'Failed to restore highlight'` | internal name "publish" leaks only in code, OK |

### 1.4 Collection
Only copy in scope: `'Failed to fetch collections summary'` hooks/useCollections.js:59, `'Failed to fetch members'` :103 (thrown, console only). `'Collection download failed: 404 Not Found'` hooks/useDownloads.js:247 (RAW-ERROR if surfaced). No user-facing collection noun in scope.

### 1.5 Editing modes / steps
| Concept | Variants seen | Where |
|---|---|---|
| Step 1 | "Mark Plays" (mode), "Mark play" (button), "Annotate" (aria `'Annotation video'`), "Annotation playback", "Keep Marking Plays" | displayNames; AnnotateModeView.jsx:625,847 |
| Step 2 | "Frame" (header tab), "Framing" (noun), "frame" (verb), "Focus" (testids/ids only), "Make highlight" (the button that opens Framing!), "Edit framing", "Reapply Framing" (comment), "Generate Framing" (comment), "Setup" / "Preview" (cockpit rail, FOCUS_COCKPIT) | AnnotateModeView.jsx:1374; FocusCockpit.jsx:328 |
| Step 3 | "Spotlight" (mode/tab), "overlay" (comments, aria?), "Add spotlight" (button), "highlight layer"/"highlight ellipse"/"highlight region" (timeline), "text layer", "Spotlight settings", "Overlay Settings" (comment) | OverlayModeView.jsx:1070,1313; modes/overlay/OverlayTimeline.jsx:93 |
| Render action | "Generate" (button, error text, mode-switch dialog), "Export" (progress, errors), "Generation" (errors), "Create a new video", "Rebuild your highlight", "Re-generate", "Re-created" | see findings F-04 |
| Commit action | "Finish" / "Finish without spotlight", "Done for now", "Save draft" (code only), "publish" (code only) | |

### 1.6 Crop
"crop" ("Crop mode" FocusModeView.jsx:1012; `'No crop keyframes defined. Please add at least one crop keyframe.'` ExportButtonContainer.jsx:528), "crop box" (CropOverlay.jsx:687), "focus point" (FocusContainer.jsx:463,789,845; EDITOR_PANELS.FOCUS_POINT), "keyframe" (CockpitTimelineStrip.jsx:212-223; FocusContainer.jsx:454,785,906), "frame" ("Keep your player in frame" FocusContainer.jsx:416 comment/hint; "Use a wider frame" :457), "Pan/Zoom mode" (FocusModeView.jsx:1012), "rotation" (CropOverlay.jsx:804-846), "Setup", "position (x, y)" CropOverlay.jsx:706 title (`Crop: 640x1136 at position (10, 40)`). Four names for one object (crop box / focus point / keyframe / frame).

### 1.7 Trim / speed
"Trim and slo-mo" (displayNames), "Speed & trim" FocusTimeline.jsx:114, "Split Segments" SegmentLayer.jsx:135, "segment" (:156,188), "boundary" (:251,263), "detrim" (`'Failed to save detrim changes'` FocusContainer.jsx:645,711), "Normal speed" / "0.5x slow-mo" SegmentLayer.jsx:169, "Set speed to 0.5x" :203.

### 1.8 Spotlight / circle
"spotlight" (OverlayModeView.jsx:564,1313; HighlightOverlay.jsx:635), "highlight" for the same circle (`'Click to highlight'` PlayerDetectionOverlay.jsx:200; `'Click the circle icon to enable highlight layer'` HighlightLayer.jsx:192; `'Drag the highlight ellipse...'` :198; `'Disable highlight layer'` OverlayTimeline.jsx:93), "ellipse", "circle icon", "player boxes" (OverlayMode.jsx:213), "Player tracking disabled" (DetectionMarkerLayer.jsx:110), "Detecting players..." (PlayerDetectionOverlay.jsx:111), "Pick your player" / "Click your player" (comment), "athlete" ("Around athlete", "My athlete", "Rate your athlete's play"), "player" (most picker copy), "kid" (none inline).

### 1.9 Text overlay
"Add text", "Text" (sheet title), "text layer" (OverlayMode.jsx:193), "text region" (OverlayModeView.jsx:1069,1379), "caption" (`Add a name, number, or caption.` OverlayModeView.jsx:1401), "Your text" (hooks/useTextOverlays.js:134 default text), "Custom position" (:120).

### 1.10 Credits / payment
`${credits} credits added to your balance!` App.jsx:352 and ExportButtonContainer.jsx:1108 (duplicate; no singular: "1 credits"); `'Payment is still processing. Your credits will appear shortly.'` App.jsx:361; `'Could not verify payment...'` :367; `Insufficient credits: need N, have M` uploadManager.js:831 (RAW-ERROR, but modal is the surface); `Your credit has been refunded` ExportButtonContainer.jsx:957 ("credit" singular regardless of cost); `what you generate and are billed for` FocusModeView.jsx:55 ("billed" is wrong: it's credits, not billing). Words: "credits", "credit", "billed", "balance", "cost", "charge".

### 1.11 AI upscaling
`"AI upscaler works best with 4x scaling. Current crop will require more than 4x upscale."` CropOverlay.jsx:718 (JARGON: "4x scaling/upscale"); `'Reconnecting to cloud GPU...'` hooks/useExportRecovery.js:268 (JARGON: GPU); `(GPU processing)` App.jsx:1024; `Generation continues on the server` ExportButtonContainer.jsx:350,842,917; "Modal status" comment. Consumer-friendly words (displayNames): "Sharpening the picture". Inline copy leaks "GPU", "server", "backend", "upscale".

### 1.12 Uploading
Progress strings (shown by UploadProgressIndicator.jsx:104): `'Analyzing video...'` uploadManager.js:638, `'Computing file hash...'` :672, `'Computing hash... 42%'` :677, `'Hash complete'` :684, `'Preparing upload...'` :753, `'Already uploaded - finishing up'` :843, :1149, `'Finalizing upload...'` :921, `'Upload complete'` (x7), `'Game linked'` :1183, `'Footage added'` / `'Video added'` :1528. Toasts: `'Game ready!'` + `${name} uploaded successfully` uploadStore.js:113-114; `'Upload failed'` :142; `'Upload cancelled'` :390 (British spelling); `'Already queued'` :236. displayNames equivalents exist ("Your game is uploaded.", "Finishing up", "Getting your game ready to upload") and DIVERGE (see F-12).

### 1.13 Sharing
`SHARING.SHARE_PLAYS` ("Share plays"), "Sharing settings" (displayNames); inline: `Shared by ${name}` ClipListItem.jsx:166,219 / ClipDetailsEditor.jsx:230; `'Invite link copied!'` + `Share it with a friend via text, email, or social media.` utils/inviteEmail.js:69; `'Failed to create share link'` hooks/useWebShare.js:26; `'Failed to update shared version'` :105; `Review these moments with your athlete.` (Share plays card description, AnnotateModeView.jsx:755) vs `Review the game with your athlete.` (:1388, same button, different text). Variants: "Share plays", "share link", "invite", "invitation", "shared version", "Shared by".

### 1.14 Athlete / profile
"athlete" (`My athlete`, `Around athlete`, `Rate your athlete's play`), "player" (spotlight, detection, "Pick your player"), "Teammates" (ClipDetailsEditor.jsx:356, AddDetailsPopup.jsx:107, AnnotateFullscreenOverlay.jsx:524,682), "profile" (`Failed to switch profile` stores/profileStore.js:75 console), "Team" layer, "Who is this play about?". athlete vs player vs teammate vs kid: two nouns for the same person in one flow.

### 1.15 Team / shared games
"Team" / "My athlete" layers (LAYER_TEAM / LAYER_MINE), "Shared by", "Tagged players" (SHARING.TAGGED_SHARE_SHORT).

### 1.16 Guidance / coach
"Got it" (OverlayContainer.jsx:303,554,607; useGuidedAthletePick.js; CockpitIntroCard; FocusCockpit.jsx:111,284 - mostly comments referencing GUIDE copy), `"Getting Started"` is a comment (FocusModeView.jsx:1071), "Skip for now" SportQuestionOverlay.jsx:44, "Dismiss" (OverlayMode.jsx:254 aria `Dismiss highlight notice`).

### 1.17 Status words
| Word | Where |
|---|---|
| "Not started" / "In progress" / "Finished" | modes/annotate/clipStage.js:45-47, utils/draftStage.js:90-94,147,149 (canonical, good) |
| "Private" / "Only you can see it" | utils/draftStage.js:148 (extra status not in the 3-word map) |
| "Not generated yet" | draftStage.js:147 |
| "Highlight made, not finished yet" | modes/annotate/components/NotesOverlay.jsx:12-14 (HARDCODED, a 4th phrasing of "In progress") |
| "Draft" / "drafts" | useReEditReel.js:74,90; ProjectsScreen.jsx:230,282 |
| "ready" | `'Game ready!'`, `'Highlight ready'`, `'Your highlight edits are ready.'` overlayActionStore.js:167 (means "saved", not "ready") |
| "Export complete!" | 5 places |
| "Finished" (toast title) | OverlayScreen.jsx:1667 |
| "Failed" / "Could not" / "Couldn't" / "didn't" / "wasn't" | mixed everywhere (see F-14) |

### 1.18 Other recurring
Navigation: "Back" / "Back to plays" ClipsSidePanel.jsx:158 / "Back to games" AnnotateContainer.jsx:1902 / "Back to Preview" (comments; live "Back to preview") / "Back to main camera". Close: "Close" (AddFootageButton.jsx:271, AddDetailsPopup.jsx:82), "Close (Esc)", "Close plays" AnnotateScreen.jsx:875. Gesture verb: "Click" vs "Tap" (F-10). Sport tags: "Defence" vs "Defender" (UK/US) VeoImportSheet.jsx:9, utils/veoHighlights/merge.js:8, soccerTags.js:76.

---------------------------------------------------------------------------
## 2. FINDINGS

Format: [ID] category | verbatim | file:line | why it confuses | suggested rewrite

### Terminology collisions (highest impact)

F-01 CONTRADICTION | `"Couldn't open this highlight"` (x3) vs `"Couldn't open this draft"` (x3 + resumeFocusCompletion) | screens/AnnotateScreen.jsx:249,290,320 vs screens/ProjectsScreen.jsx:230,282 and utils/resumeFocusCompletion.js:107 | Same failure (open an in-progress highlight from the Clips tab) called "highlight" in one screen and "draft" in the other. "Draft" is not used anywhere else a parent sees. | Use "highlight" everywhere: `"Couldn't open this highlight"`.

F-02 CONTRADICTION | create-a-PLAY failure says highlight: `title: 'Could not save to the cloud', message: "Your highlight wasn't saved. Please try again."` | hooks/useRawClipSave.js:22-23 (create), :26-27 update, :30-31 delete `"Your highlight wasn't deleted."`, :36-37 link `"Your highlight's game wasn't updated."`; also throws `'Failed to update highlight'` :267, `'Failed to delete highlight'` :314, `'Failed to save play'` :204 | The same object is "play" at AnnotateContainer.jsx:1853 (`'Could not save this play'`) and "highlight" here. A parent deleting a play sees "highlight wasn't deleted" and thinks something finished was lost. | Use "play" for marked moments: `"Your play wasn't saved."`, `"Your play wasn't deleted."`; keep "highlight" only for the generated video. Drop "to the cloud" (see F-16).

F-03 CONTRADICTION | Same CTA, different wording on one screen: `"Review these moments with your athlete."` (Share plays description) vs `"Review the game with your athlete."` | modes/AnnotateModeView.jsx:755 vs :1388; also `"Save a moment to highlight or review."` :1374, `"Watch the moments you have marked."` :1383 | Buttons say "play"/"plays", descriptions say "moments". Two nouns for one thing in 4 lines. | `"Share your marked plays with your athlete."`, `"Watch the plays you've marked."`, `"Save a play to turn into a highlight."` Pick play OR moment; "play" matches buttons.

F-04 INCONSISTENT | render verb: "Generate" vs "Export" vs "Generation" vs "Create" vs "Rebuild" | ExportButtonContainer.jsx:303 `'Export complete!'`, :340 `'Export failed'`, :379 `'Checking export status...'`, :350 `'Connection lost. Generation continues on the server...'`, :408 `'Generation failed on server'`, :482 `'Generation timed out'`, :893 `'Generation failed'`, :973 `'Generation failed. Please try again.'`; stores/exportStore.js:146 `'Starting generation...'`, :267 `'Export complete!'`; App.jsx:1024 `Generate: Create a new video (GPU processing)` and `Generate: Rebuild your highlight (GPU processing)`; OverlayScreen.jsx:589 `Re-generate to rebuild it.`; ExportButtonContainer.jsx:1054 `retry saving before generating` | Button says "Generate highlight" but the completion message says "Export complete!" (and the spec elsewhere says "Highlight ready"). A parent never "exports"; one flow, three verbs. | One verb: "Generate". `'Highlight ready'` (use EXPORT_JOBS.*.completed) instead of `'Export complete!'`; `'Generation failed'`, `'Checking status...'`, `'Starting...'`.

F-05 HARDCODED | `'Export complete!'` x5 duplicates and contradicts displayNames EXPORT_JOBS.*.completed ('Highlight ready' / 'Highlight with spotlight ready') | ExportButtonContainer.jsx:303,391,688,733,822; stores/exportStore.js:267 | Progress panel text and toast title disagree about what just happened. | Read from EXPORT_JOBS[type].completed.

F-06 JARGON | `Uncommitted Spotlight Changes` / `Uncommitted ${MODE_NAMES.FRAMING} Changes` ; `You have Spotlight edits that haven't been generated yet.\n\n• Generate: Create a new video (GPU processing), then switch modes\n• Discard: Throw away changes and switch modes\n• X: Cancel and stay in Spotlight mode` ; `• Generate: Rebuild your highlight (GPU processing), then switch modes. This will reset any Spotlight work.` | App.jsx:1022-1026 | "Uncommitted" (git word), "GPU processing", "switch modes", "X" as a button, "Throw away" vs "Discard". Longest and scariest dialog in the app, with the word "mode" and "GPU". Also HARDCODED (not in displayNames). Also "Spotlight mode" / "Framing mode" suffix vs header calling it "Frame". | Title: `Unsaved changes`. Body: `You changed your spotlight but haven't generated the highlight yet.` Buttons: `Discard changes` / `Generate highlight` plus visible `Keep editing`. Drop "GPU".

F-07 JARGON | `'Generate required for Spotlight mode'`, `You have multiple plays loaded. Generate in Framing first before adding overlays.`, `You have made edits in Framing mode. Generate first to apply them before adding overlays.` | modes/OverlayModeView.jsx:1279-1285 | "overlays" (never defined; step is "Spotlight"), "mode", "loaded". Also Add Spotlight called "overlay" in same sentence. | `Generate your highlight first` / `Generate your highlight in Framing, then add a spotlight.`

F-08 CONTRADICTION | In-progress status, 4 phrasings: `'In progress'` (clipStage.js:46, draftStage.js:91-94), `'Highlight made, not finished yet'` (NotesOverlay.jsx:12-14), `'Add spotlight'` as status+label (clipStage.js:142), `Not generated yet` (draftStage.js:147) | listed | The T11940 comment says "three words, one map", but NotesOverlay hardcodes its own sentence; `Private` is a fourth status. | Use HIGHLIGHT_STATUS labels in NotesOverlay: `In progress`, `Finished`.

F-09 INCONSISTENT | Title Case vs sentence case for the same kind of label | clipStage.js:135 `'View Highlight'`, :139 `'Preview Highlight'` vs :142 `'Add spotlight'` vs ANNOTATE.MAKE_A_HIGHLIGHT `'Make highlight'` vs `'Make Another Highlight'` (displayNames) vs DeletePlayButton `Confirm Delete` (DeletePlayButton.jsx:59) vs `'Retry Loading Video'` (AnnotateModeView.jsx:896, FocusModeView.jsx:697) vs `'Video Error'` (FocusModeView.jsx:686) vs `'Import Errors'` (ClipsSidePanel.jsx:265) vs `'Tags and Notes'` (AddDetailsPopup.jsx:71) vs `'Uncommitted Spotlight Changes'` (App.jsx:1022) | clipStage/others | Mixed casing reads as unfinished; the app's own style guide is sentence case for buttons. | Sentence case: `View highlight`, `Preview highlight`, `Confirm delete` (better: `Delete`), `Try again`, `Video error`, `Import errors`.

F-10 INCONSISTENT | "Click" vs "Tap" | Click: `Click to highlight` modes/overlay/overlays/PlayerDetectionOverlay.jsx:200; `Click the circle icon to enable highlight layer` HighlightLayer.jsx:192; `Click to add a highlight region` OverlayMode.jsx:357; `Click to select playhead layer (arrow keys step frames)` AnnotateTimeline.jsx:133; `Video track - click anywhere to scrub through the highlight. Use Space to play/pause.` FocusTimeline.jsx:94; `click segments to change playback speed` :114; `click to add a focus point (a crop keyframe)` :105; `Player assigned at frame N - Click to revisit` DetectionMarkerLayer.jsx:112; `click OK to continue` / `click Cancel` ProjectsScreen.jsx:368-369. Tap: `Tap the spotlight to adjust` OverlayModeView.jsx:564, `Tap to change`, `Tap Play to watch the game` (GUIDE) | Parents are on phones; "Click" appears in phone-visible spots (instructions inside the editor, the confirm dialog). | Use "Tap" in visible instructions (or "Tap or click" where desktop-only is not guaranteed); keep "Click" only in hover titles on fine-pointer-only controls.

F-11 JARGON | `Click to add a highlight region`, `Disable highlight layer` / `Enable highlight layer`, `Drag the highlight ellipse on the video to add keyframes`, `No text region under the playhead`, `Show text layer` / `Hide text layer`, `Hide player boxes` / `Show player boxes`, `Player tracking disabled`, `Click to select playhead layer` | OverlayMode.jsx:357,193,213; OverlayTimeline.jsx:93; HighlightLayer.jsx:192,198; OverlayModeView.jsx:1069,1379; DetectionMarkerLayer.jsx:110; AnnotateTimeline.jsx:133 | region / layer / playhead / keyframe / ellipse / tracking are editor-tool words. "highlight" here means the spotlight circle, a third meaning of "highlight". "tracking" overclaims (user clicks the kid; app does not track). | `Tap to add a spotlight`, `Hide spotlight` / `Show spotlight`, `Drag the spotlight on the video` , `No text at this point in the video`, `Hide/Show text`, `Hide/Show player outlines`, remove "tracking" (see feedback memory: no autonomous tracking claim).

F-12 HARDCODED/INCONSISTENT | upload outcome copy diverges from displayNames UPLOAD_PROGRESS_COPY | stores/uploadStore.js:113-114 `'Game ready!'` / `${name} uploaded successfully`; :142 `'Upload failed'` / `didn't upload. Please tap Retry to try again.`; services/uploadManager.js:638 `'Analyzing video...'`, :672 `'Computing file hash...'`, :677 `'Computing hash... 40%'`, :684 `'Hash complete'`, :843 `'Already uploaded - finishing up'`, :921 `'Finalizing upload...'`, :1183 `'Game linked'` (displayed via UploadProgressIndicator.jsx:104) vs displayNames `'Getting your game ready to upload'`, `'Uploading your game'`, `'Finishing up'`, `'Your game is uploaded.'` | "hash" is jargon shown on screen; "Game linked" and "Finalizing" mean nothing to a parent. | Route all `notify(...)` messages through UPLOAD_PROGRESS_COPY: `Getting your game ready`, `Uploading your game`, `Finishing up`, `Your game is uploaded.` Remove "hash" entirely. Rename `'Game ready!'` to `'Your game is uploaded'`.

F-13 RAW-ERROR | Backend/dev text rendered to users | ExportButtonContainer.jsx:601 `'Server connection timed out. The backend may be slow or unresponsive.'`; :603 `'Cannot connect to server. Please ensure the backend server is running on port 8000.'`; :608 `'Server unreachable'`; :946 `Server error (500). Check backend console for details.`; :941 `${error}: ${message}\n\nCheck console for stack trace.`; :966 `Server error (503): Service Unavailable`; :580 `Server returned 500: Internal Server Error`; :591 `'Server waking up, retrying...'`; :901 `'Storage error'`; :907/921 `'Network error'`; :641 `'Cannot generate: No project selected. Please save your project first.'`; :644 `'Cannot generate: Highlight state manager not available. Please reload the page and try again.'`; :558 `'Cannot determine video duration. Please reload and try again.'`; :514 `'No video file loaded'`; :528 `'No crop keyframes defined. Please add at least one crop keyframe.'` | These go to `setError(...)` and are shown in the export panel. "port 8000", "backend console", "stack trace", "state manager", "crop keyframe" mean nothing to a parent and tell them to run a server. | `We couldn't reach our servers. Check your connection and try again.`; `Something went wrong while generating. Please try again.`; for missing crop: `Drag the box onto your player first.`; for no project: `Open a highlight first.` Log the technical part to console only.

F-14 INCONSISTENT | apology/failure phrasing: "Could not" vs "Couldn't" vs "Failed to" vs "didn't/wasn't" vs bare "failed" | `'Could not save which video to show here...'` AnnotateContainer.jsx:552; `"Couldn't open..."` AnnotateScreen.jsx:249; `'Failed to load game. Please try again.'` AnnotateContainer.jsx:1655; `'Failed to undo framing edit'` FocusContainer.jsx:365,369; `'Failed to save crop keyframe'` :454; `'Failed to save rotation'` :517; `'Failed to save trim changes'` :579; `'Failed to save detrim changes'` :645,711; `'Failed to delete keyframe'` :785; `'Failed to move focus point'` :845; `'Failed to paste crop keyframe'` :906; `'Failed to split segment'` :952; `'Failed to remove split'` :996; `'Failed to set segment speed'` :1060 | FocusContainer toasts expose editor internals (keyframe, detrim, segment, split) and carry `{ message: result.error }` = raw string from lower layers. Also same action called "Failed to save crop keyframe" (move) vs "Failed to move focus point". | One pattern: `Couldn't save that change. Please try again.` for all Framing edits; rename "keyframe" to "focus point" if a noun is needed; never show `result.error`.

F-15 JARGON | `'Failed to delete keyframe'`, `'Failed to paste crop keyframe'`, `Copy keyframe` / `Delete keyframe` (CockpitTimelineStrip.jsx:212-223), `Add focus point` (FOCUS_COCKPIT) | listed | The same timeline marker is called focus point, keyframe, crop keyframe, boundary (SegmentLayer.jsx:251,263), split. | `Copy focus point`, `Delete focus point`; `Delete boundary` -> `Remove split`.

F-16 JARGON | "cloud" / sync language | hooks/useRawClipSave.js:22,26,30,36 `'Could not save to the cloud'`; hooks/useMoveReels.js:110 same; hooks/useReEditReel.js:74 `alert('Could not save to the cloud yet. Your highlight moved to drafts on this device and will sync when you retry.')`; stores/syncStore.js:131 `'Your local changes were replaced'` / `A newer version of your work, saved on another device, replaced your unsynced edits.`; utils/actionConflictPrompt.js:24 `'This project was edited elsewhere'` / `Refresh to load the latest.`; `'Reconnecting to cloud GPU...'` hooks/useExportRecovery.js:268 | "cloud", "sync", "device", "GPU", "project" are all dev concepts; native `alert()` also breaks the app style. | `We couldn't save that. Check your connection and try again.`; `This was changed on another device`; `Reconnecting...`

F-17 CONTRADICTION | `Finished removing` toast + `Finish removing` action (hooks/useMoveReels.js:41,75,82) uses the word "Finish" that elsewhere means "move to Finished tab" | hooks/useMoveReels.js | "Finish" = publish elsewhere; parents will think removing finishes the highlight. | `Remove from this profile` / `Removed`.

F-18 CONTRADICTION | The "Finished" tab/word has three UI meanings: `toast.success('Finished', { message: 'Nobody else can see this until you share a link.' })` screens/OverlayScreen.jsx:1667 (title alone says nothing; "Finished" what?), `'Couldn't finish your highlight'` App.jsx:598, `'Could not finish'` hooks/usePublishProject.js:174 / `'Failed to finish'` :100 | Titles are verbs with no object; for a published highlight the user should learn where it went. | `Highlight finished` + `Find it in Finished.`; errors: `Couldn't finish your highlight`.

F-19 UNCLEAR | `'Your highlight edits are ready.'` stores/overlayActionStore.js:167 (shown after retrying failed saves) | "ready" + "highlight edits" here means "your changes are saved" and collides with "Highlight ready" (generated). | `Your changes are saved.` Also contradicts the no-"Saved"-copy policy: prefer silent success.

F-20 UNCLEAR/JARGON | `"Your edits aren't saving"` / `Some highlight changes could not be saved. Retry before generating.` / `"That highlight change didn't save"` / `The change is still on screen but was not stored. Undo it and try again.` | stores/overlayActionStore.js:183-185,203-205 | "stored", "highlight change" (means spotlight/text edit). | `Some spotlight changes didn't save` / `Tap Retry, then generate your highlight.`

F-21 INCONSISTENT | `"Some edits haven't saved. Retrying now -- please generate again once they save."` ExportButtonContainer.jsx:504; `"Some edits haven't saved -- retry saving before generating"` :1054; `"Some highlight edits haven't saved yet. Please try again."` utils/updateFlush.js:56,63 | Three phrasings, " -- " double hyphen (ASCII em dash stand-in), "edits" vs "highlight edits". | `Some changes haven't saved yet. Try again in a moment.` (no dash).

F-22 TONE | Em dashes and " -- " in user-visible strings | `— use the switcher` AngleLanes.jsx:300; `Camera angles — click a bar to switch` AnnotateTimeline.jsx:160; `${rating} — from an angle` ClipRegionLayer.jsx:285,286; `Source video expired — cannot mark plays` AnnotateModeView.jsx:1368; `Framing timeline — click to add...` FocusTimeline.jsx:105; `...cover-image marker` PosterMarkerLayer.jsx:426,422; `Output length after slow-motion / trim -- what you generate and are billed for` FocusModeView.jsx:55-56 (2 more " -- "); `Generation still running -- reconnecting...` ExportButtonContainer.jsx:418; `Could not reach server -- will keep trying...` :434; `Reconnected -- resuming progress...` :356; plus ExportButtonContainer.jsx:504,1054; ` - ` hyphen as separator: FocusTimeline.jsx:94,114; PlayRatingRow.jsx:81; ClipRegionLayer.jsx:263; DetectionMarkerLayer.jsx:112; `Already uploaded - finishing up` uploadManager.js:843,1149 | Project rule: no em dashes in shipped copy. | Replace with period, comma or colon.

F-23 JARGON | `Output length after slow-motion / trim -- what you generate and are billed for` / `Output length (matches source -- no speed or trim changes)` | modes/FocusModeView.jsx:55-56 | "billed" (credits, not billing), "source", "Output". | `Length of your highlight. Credits are based on this.` / `Length of your highlight (no slow-mo or trim).`

F-24 JARGON | `AI upscaler works best with 4x scaling. Current crop will require more than 4x upscale.` | modes/focus/overlays/CropOverlay.jsx:718 | "4x scaling/upscale" is meaningless; alarmist. Contradicts division-of-work copy ("sharpen the picture"). | `This crop is very tight, so the sharpened video may look softer. Try a slightly wider box.` Also `Crop: 640x1136 at position (10, 40)` title CropOverlay.jsx:706 -> remove or `Crop box`.

F-25 UNCLEAR | `Drag to move the crop box. Drag corners or edges to resize. This sets the visible area of your highlight.` | CropOverlay.jsx:687 | "crop box" vs "focus point" vs "frame" (see 1.6); "highlight" here means the output video. | `Drag the box onto your player. Drag the corners to resize it. Only what's inside the box is kept.`

F-26 JARGON | `Switch to Pan/Zoom mode` / `Switch to Crop mode` | FocusModeView.jsx:1012 | Pan/Zoom vs Crop, plus "mode" colliding with the header "mode" concept (Mark Plays / Frame / Spotlight). | `Move the video` / `Move the box`.

F-27 UNCLEAR | `Split Segments to trim or control speed` | modes/focus/layers/SegmentLayer.jsx:135 | "Split Segments" capitalised like a button but is a hint; segment/boundary/split. | `Split the highlight to trim it or slow it down.`

F-28 INCONSISTENT | loading text for the same screen state: `'Loading highlights...'` (clips stage) / `'Loading video...'` / `'Loading working video...'` / `'Loading...'` | FocusModeView.jsx:836-839, FocusCockpit.jsx:263-266, OverlayModeView.jsx:135, OverlayScreen.jsx:1766, hooks/useProjectLoader.js:113 `'Loading project...'`, :145 `'Loading clips...'`, :224 `'Loading working video...'`, :258 `'Highlight loaded'` | Four nouns (highlights/video/clips/project) for the same loading step; "working video" is pipeline jargon. | `Loading your highlight...` for all stages.

F-29 HARDCODED | `'Highlight made, not finished yet'`, `'Finished highlight'` | modes/annotate/components/NotesOverlay.jsx:11-14 | see F-08. | HIGHLIGHT_STATUS.

F-30 HARDCODED | `Add footage` x4 in AddFootageButton.jsx (:29,31,239,242,246) with a local COPY object and `title="Add footage"` plus displayNames LIBRARY_ACTIONS.ADD_FOOTAGE 'Add footage to game' | modes/annotate/AddFootageButton.jsx:24-52 | Parallel copy blocks; the button reads "Add footage" while the library action reads "Add footage to game". Also "footage" vs "video" within the same card (`Add another video to this game.` :37). | One name: `Add video` or `Add footage` everywhere (parents say "another video").

F-31 UNCLEAR | `Add another half, a sideline angle, or footage you got later. It's placed by when it was filmed and appends to this game, so your existing plays stay put.` | AddFootageButton.jsx:33 | "placed ... appends" is mechanism talk; long. | `Add the other half or another camera's video. We'll line it up by when it was filmed, and your marked plays stay where they are.`

F-32 UNCLEAR | `We couldn't tell which game this play belongs to, so it was not saved. Reload the game and try again.` / `...your change was not saved...` | AnnotateContainer.jsx:1854,2040 | "belongs to", "reload". Titles `'Could not save this play'`, `'Could not save this change'`. | `We couldn't save this play. Please reopen the game and try again.`

F-33 UNCLEAR | `'Could not save which video to show here. Please try again.'` AnnotateContainer.jsx:552; `'Could not save the timing change. Please try again.'` :836 | "which video to show here" is unintelligible | `Couldn't change the camera. Please try again.`

F-34 INCONSISTENT | game-not-found copy: `'This game no longer exists'` + `It was removed, so we returned you to your games.` (AnnotateScreen.jsx:168-169) vs `'Game not found'` (AnnotateContainer.jsx:1641) vs `'This game no longer exists'` + GHOST_GAME_SAVE_MESSAGE (:1897) | listed | Two titles for the same event. | `This game was removed` everywhere.

F-35 UNCLEAR | `'Source video expired'` / `Source video expired — cannot mark plays` | AnnotateModeView.jsx:825,1368 | "Source" and "expired" with no explanation of the 30-day storage rule or what to do. | `The full game video is no longer stored, so you can't mark new plays. Your plays are still listed.` (ANNOTATE.SOURCE_EXPIRED_PLAYS_LISTED exists).

F-36 RAW-ERROR | `File is empty`, `Invalid header: expected N columns (...), got M`, `Invalid header column N: expected "start_time", got "..."`, `Line N: Invalid start_time "..." (expected M:SS or MM:SS)`, `Invalid rating ... (must be integer 1-5)`, `Invalid clip_duration`, `has too many decimal places (max 1)`, `Failed to read file: ${err.message}`, `No valid annotations found in file` | modes/annotate/hooks/useAnnotate.js:123-221, components/ClipsSidePanel.jsx:119; shown under "Import Errors" ClipsSidePanel.jsx:265 | Raw column names (`clip_duration`) in a user-facing error list; "TSV file" (ClipsSidePanel.jsx:226 title `Import plays from TSV file`) is jargon. | `Import plays from a spreadsheet file`; `Line 3: the start time should look like 12:30.`

F-37 INCONSISTENT | `Shot on goal` / `Defence` British spelling; `Cancelled` British | VeoImportSheet.jsx:9, utils/veoHighlights/merge.js:8, stores/uploadStore.js:390 `'Upload cancelled'` | App is US (`Goalie`, `Defender`, "color"). | `Upload canceled`; keep Veo's own tag names only if they are Veo's labels, otherwise `Defense`.

F-38 UNCLEAR | `'Already in your library'` + `${name} is already in your account, so we opened your existing game.` | stores/uploadStore.js:108-110 | "library" vs "account" vs "game": three nouns in one toast. | `This game is already uploaded` / `We opened your existing copy of ${name}.`

F-39 UNCLEAR | `'Already queued'` / `${fileName} is already uploading or in the queue.` | uploadStore.js:236-237 | "queued/queue" | `Already uploading` / `${fileName} is already on its way.`

F-40 TONE | `'Game ready!'` exclamation + `'Video'` fallback + `uploaded successfully`; `'Export complete!'` `'Invite link copied!'` `... added to your balance!` | uploadStore.js:113-114; App.jsx:352; inviteEmail.js:69 | Exclamation marks inconsistent (`Upload complete` has none); "successfully" filler. | Drop "!" and "successfully" for consistency.

F-41 UNCLEAR | `${credits} credits added to your balance!` duplicated in App.jsx:352 and ExportButtonContainer.jsx:1108 | | No singular; no CREDITS constant. | Single helper: `1 credit added` / `N credits added`.

F-42 UNCLEAR | `Generation failed due to a temporary issue. Your credit has been refunded. Please try again.` ExportButtonContainer.jsx:957 | | always "Your credit" even if more than one; "Generation failed" vs "Export failed" (:340). | `Something went wrong, so we refunded your credits. Please try again.`

F-43 JARGON | `Connection lost. Generation continues on the server...` ExportButtonContainer.jsx:350,842,917; button labels `"Retry connection"` / `"Check status"` (:372 comment) ; `'Checking export status...'` :379 | server/connection | `We lost connection, but your highlight is still being made. Reconnecting...` | |

F-44 UNCLEAR | `Preparing your highlight...` (ANNOTATE.PREPARING_CLIP) vs `'Preparing playback...'` AnnotateModeView.jsx:663 vs `'Preparing annotation playback'` aria :625,642 | | three phrasings; "annotation" jargon. | `Getting ready...` / aria `Playing your marked plays`.

F-45 JARGON | aria/labels `Annotation video`, `Annotation playback` | AnnotateModeView.jsx:625,642,847,864 | Screen-reader text uses a word the product retired. | `Game video`, `Playing your marked plays`.

F-46 INCONSISTENT | "Teammates" label vs "athlete"/"player" | ClipDetailsEditor.jsx:356; AddDetailsPopup.jsx:107; AnnotateFullscreenOverlay.jsx:524,682 | These tags name who is in the play; elsewhere "My athlete"/"Team". | `Players in this play` or `Tag players`.

F-47 INCONSISTENT | `Rating` / `Rate this play` / `How good was this play?` / star titles `"4 stars"` + 5-star label "Highlight"/"Brilliant" (`GAME_CARD.BRILLIANT_COUNT`) | ClipDetailsEditor.jsx:254; PlayRatingRow.jsx:11,81-82; GAME_CARD | 5 stars = "Highlight" in the rating adjective list, "Brilliant" on the game card, and drives the "Make this a highlight now?" card (AnnotateContainer.jsx:978 comment: "rated Highlight (5)") | the rating word is another meaning of "highlight". | Rename 5-star label to "Brilliant" and keep "highlight" for the video.

F-48 UNCLEAR | `'Tag not submitted'` / `You typed a teammate name but didn't submit it. Press Enter in the teammate field to add the tag.` | screens/AnnotateScreen.jsx:1085-1086 | "submit", "Enter" (no Enter on phones). | `Add the player name first` / `Tap Add (or the check) next to the name to tag them.`

F-49 JARGON | `Detecting players...` / `Player tracking disabled` / `Click to highlight` | PlayerDetectionOverlay.jsx:111,200; DetectionMarkerLayer.jsx:110 | AI jargon; the user is picking their kid. | `Finding players...` / `Tap your player`.

F-50 UNCLEAR | `Custom cover image in use. This marker is inactive.` ; `Drag to choose the cover frame — the still people see before playing. Currently at ${t}.` | PosterMarkerLayer.jsx:405,424-426 | "marker", "inactive", "still", "frame" | `You're using your own cover photo.` / `Drag to pick the cover picture people see before they press play.`

F-51 INCONSISTENT | video control labels differ between two near-identical components: AnnotateControls (`Back 5 seconds (Left arrow)`, `Step backward (one frame)`, `Restart`) vs TransportRail (`Step back`, `Step forward`) vs PlaybackControls (`Restart`) | AnnotateControls.jsx:170-218; TransportRail.jsx:60-82 | "frame" step language; keyboard hints on phone. | `Back 5 seconds`, `Back a moment` (frame step); drop "(Left arrow)" from titles shown on touch.

F-52 UNCLEAR | `Step one frame (1/30 s)` | TrimTimeField.jsx:171,180 | frame math | `Nudge a tiny bit`.

F-53 UNCLEAR | `That range is not possible.`, `Start must stay at least 0.5s before the end.`, `That is before the start of the video.`, `That is past the end of the video.` | TrimTimeField.jsx:82; trimBounds.js:35-52 | "range", "stay", "0.5s" | `The start has to be before the end.`

F-54 INCONSISTENT | `Fix timing` / `Fix timing: ${name}` / `Moved +2s` | AngleLanes.jsx:23, FixTimingStrip.jsx:27, ANNOTATE.fixTimingFor | "timing", "nudge", "angle", "lane" mix: a parent adding a second camera sees "Fix timing". Copy `Line it up: find a moment you can hear in both, like a whistle or a big cheer` is good. | Keep; rename "angle" to "camera" consistently (`Camera angles` AnnotateTimeline.jsx:160 vs `Main camera`).

F-55 TONE | `Angle: ${a.name}` aria AngleLanes.jsx:211; `${overflow} more angle(s) — use the switcher` :300 | "switcher" | `${n} more cameras`.

F-56 INCONSISTENT | headings for the same editor: `Play details` (ClipDetailsEditor.jsx:225), `Tags and Notes` (AddDetailsPopup.jsx:71), `Optional details`/`Add details` (comments), ANNOTATE.DETAILS 'Details', `Add Tags and Notes` / `View Tags and Notes` (AnnotateFullscreenOverlay.jsx:401) | | four names. | `Details` everywhere.

F-57 INCONSISTENT | `Notes` vs `Notes (optional)` vs `Add notes (shown as overlay during playback)` / `Add a note about this play...` / `Add notes...` | ClipDetailsEditor.jsx:306,317; DetailsFields.jsx:66,77 | "overlay" = another meaning. | `Notes (optional)`, placeholder `Add a note about this play`.

F-58 TONE | `Name this play` placeholder vs `Enter play name...` (AnnotateFullscreenOverlay.jsx:472) vs `Play name` (:621-622) | | three placeholders for one field; ellipsis style differs. | `Name this play`.

F-59 INCONSISTENT | `No plays yet` ClipsSidePanel.jsx:297 / `No plays match this filter` :301 vs `emptyMessage = 'No plays yet'` ClipRegionLayer.jsx:107 vs `No My athlete plays` / `No Team plays` (ClipsSidePanel.jsx:19-20, built from layer names) | "No My athlete plays" is ungrammatical. | `No plays for your athlete yet` / `No team plays yet`.

F-60 UNCLEAR | `Show` (filter chip label) ClipsSidePanel.jsx:198, `aria-label="Show"` SuggestedPlaysList.jsx:243, `aria-label="Label"` :256 | bare words | `Show plays for:` / `Play type`.

F-61 INCONSISTENT | `Loading plays...` ClipsSidePanel.jsx:293, `Loading plays` aria AnnotateScreen.jsx:909 vs `Loading your plays...` (MODE_SWITCHER_LOCKED) | ellipsis style/words | `Loading your plays...`

F-62 INCONSISTENT | `Close plays` AnnotateScreen.jsx:875 / `Show plays` :905 / `Back to plays` ClipsSidePanel.jsx:158 / `Back to mark plays` (ANNOTATE) | four labels for open/close the list. | `Show plays` / `Hide plays` / `Back to plays`.

F-63 UNCLEAR | `Pick sport` / `What sport is this?` / `Pick your sport to unlock its tags. You can change it later.` | SportQuestionOverlay.jsx:24-26 | fine, but "unlock" is odd: tags are labels. | `Pick your sport so we can suggest tags.`

F-64 UNCLEAR | `'Highlights only partly moved'` / `They were copied to the other profile but not removed from here. Finish removing them?` | hooks/useMoveReels.js:35-37 | uses highlights for finished videos (fine) but "profile" (athlete?) not defined; "copied/removed" | `Moved, but not removed here` / `They're in the other profile too. Remove them from this one?`

F-65 INCONSISTENT | `Find them under the other profile’s ${SECTION_NAMES.PUBLISHED}.` hooks/useMoveReels.js:129 | uses the tab name constant (good) but curly apostrophe vs straight elsewhere (`didn't`, `couldn't` straight). Mixed `’` (OverlayScreen.jsx:589 `highlight’s`) vs `'`. | Pick straight apostrophes.

F-66 UNCLEAR | `This highlight’s video is no longer available. Re-generate to rebuild it.` OverlayScreen.jsx:589; `'Failed to load working video'` :603 (shown via workingVideoLoadError) | "Re-generate", "rebuild", "working video". | `This highlight's video isn't available anymore. Go back to Framing and generate it again.`

F-67 RAW-ERROR | `'Failed to fetch video: 403'` hooks/useVideo.js:207; `'Video loading timed out'` utils/videoUtils.js:48; `'Failed to load video metadata'` utils/videoMetadata.js:550, videoUtils.js:40; `Video metadata loading timed out` | surfaced as `error` in the "Video Error" box (FocusModeView.jsx:686-687 prints `{error}` verbatim) | "metadata" and status codes. | `We couldn't load this video. Please try again.`

F-68 RAW-ERROR | `Download failed: 403 Forbidden` utils/reelDownload.js:18,26; `Collection download failed: 404 Not Found` hooks/useDownloads.js:247; `Failed to rename`, `Failed to delete download`, `Failed to set Athlete Intro Card` useDownloads.js:419,133,457 | If surfaced via toast/alert | status text | `Couldn't download. Please try again.`

F-69 RAW-ERROR | `Insufficient credits: need ${upload_cost}, have ${balance}` uploadManager.js:831,1069 | thrown Error; shown in progress `message` before the modal? uploadStore sets `message` only for non-credit errors, so low risk | `You need N more credits.`

F-70 RAW-ERROR | `alert(\`Failed to open highlight as draft: ${error.message}\`)` hooks/useReEditReel.js:90; `alert('Could not save to the cloud yet. Your highlight moved to drafts on this device and will sync when you retry.')` :74; native `window.confirm` in screens/ProjectsScreen.jsx:366-370: `The selected file "x" has a different name than the original "y".\n\nIf this is the same video file (just renamed), click OK to continue.\nIf this is a different file, click Cancel and select the correct file.` | Native alerts are unstyled, say "draft", say "click OK/Cancel" on phones, and interpolate raw error text. | Use the toast/ConfirmationDialog with `Use this file` / `Choose another`.

F-71 INCONSISTENT | Landscape/Portrait highlight button strings built with regex post-processing: `.replace(/Make (Portrait|Landscape) Highlight/g, 'Make highlight')` ... | modes/annotate/components/HighlightOrientationSlots.jsx:64-66 | Copy is rewritten at runtime from Title-Case constants (`Continue Framing Portrait Highlight`, `Add Spotlight to Portrait Highlight`, `Make Portrait Highlight`) to sentence case: two parallel vocabularies; `aria-label` = `${title} highlight, ${summary}` (:71) reads "Portrait highlight highlight". | Store sentence-case strings; stop string surgery.

F-72 INCONSISTENT | Step verbs for opening the next mode: "Make highlight" (opens Framing), "Frame" (header tab), "Add spotlight", "Continue framing highlight", "Continue adding spotlight", "Open Framing" (toast action, AnnotateContainer.jsx:114,118 via `Open ${MODE_NAMES.FRAMING}`), "Preview Highlight", "View Highlight" (clipStage.js) | | Tab says "Frame", CTA says "Make highlight", toast says "Open Framing". Same step, three names. | Use `Frame` as the step name: `Frame it` / `Continue framing` / `Add spotlight` / `Open Framing` -> `Start framing`.

F-73 TONE | `Highlight moved to Clips so you can edit it later` (displayNames) vs inline `${name} is now in ${SECTION_NAMES.CLIPS}` (AnnotateContainer.jsx:121) default | | two toasts for one event; the default fallback `'Your highlight'` (:120) when no name. | Pick one sentence: `${name} is in Clips`.

F-74 HARDCODED | `"Couldn't finish your highlight", { message: 'Please try again.' }` App.jsx:598; `'Check your network and try again.'` AnnotateScreen.jsx:249,290,320; `'The connection dropped. Check your network and try again.'` ProjectsScreen.jsx:231,283; resumeFocusCompletion.js:93,107,128 | six near-identical retry sentences, none in displayNames | | Move to a constant `COMMON.RETRY_NETWORK`.

F-75 UNCLEAR | `title="Dock position"` AnnotateFullscreenOverlay.jsx:24; `More controls` | | "Dock" | `Move controls`.

F-76 UNCLEAR | `Resolution:` / `Format:` / `Size:` info line | AnnotateModeView.jsx:1431-1443; OverlayModeView.jsx:1345 (`fps`) | file-properties row shown to parents. | Remove or label `Quality`.

F-77 TONE | `Waiting in line, other videos are being made` ; `Sharpening the picture` fine; `Reconnected -- resuming progress...` | | | |

F-78 UNCLEAR | `'Server waking up, retrying...'` ExportButtonContainer.jsx:591 | "Server" | `Getting things started...`

F-79 UNCLEAR/JARGON | `Optional: rotate your phone for a larger video` OK; `Nudge rotation counter` / `Rotation angle` aria labels CropOverlay.jsx:804-846 (typo "counter" for "counterclockwise") | | | `Rotate left`, `Rotate right`, `Reset rotation`.

F-80 JARGON | `Edit in Annotate` (comment App.jsx:115) / `Annotate` aria; user-facing mode is "Mark Plays" | App.jsx | comment only; verify no live label | n/a

---------------------------------------------------------------------------
## 3. JOURNEY NOTES

1. Home. Tabs: Games / Clips / Finished (SECTION_NAMES). Header modes: Mark Plays / Frame / Spotlight. First shift: tab "Clips" holds in-progress HIGHLIGHTS (the toast says "${name} is now in Clips"), but errors on the same cards say "draft" (ProjectsScreen.jsx:230) and `drafts on this device` (useReEditReel.js:74). "Finished" tab vs verb "Finish".
2. Upload / add a game. Button: "Upload game". Progress text from uploadManager: `Analyzing video...` -> `Computing file hash...` -> `Hash complete` -> `Preparing upload...` -> `Finalizing upload...` -> `Upload complete` -> toast `Game ready!` + `uploaded successfully`. Nouns: game, video, file, hash, upload.
3. Open game (Mark Plays). Header "Mark Plays". Player controls: "Mark play" (ActionCard, desc "Save a moment to highlight or review."), "Edit play", "Review plays" ("Watch the moments you have marked."), "Share plays" ("Review these moments with your athlete."). Shift: play / moment / highlight / review. Extra camera copy: `Add footage`, `Add another video to this game.`, "angle", "main camera", `Extra video 2`, `Source video expired`.
4. Mark a play. Toast `Play added` or `Added play "name"` (AnnotateContainer.jsx:155). Rate: "How good was this play?" 1-5 stars; 5 = "Highlight". Name: `Name this play`. Details: `Tags and Notes` / `Play details` / `Teammates`. Delete: `Delete play` -> `Confirm Delete`. Errors say `Could not save this play`, OR `Your highlight wasn't saved` (useRawClipSave). Shift: play -> highlight on failure.
5. Plays list. Heading "Plays"; empty `No plays yet`; filters "Show"; layer "My athlete" / "Team" (`No My athlete plays`); `Import plays from TSV file`; `Import Errors` with `Invalid clip_duration`. Shift: play / clip / annotation.
6. Make highlight. After 5-star: card `Make this a highlight now?` -> `Make highlight` / `Keep Marking Plays` (subtext: "Saves this play as a highlight in Clips"). Toast: `Highlight moved to Clips so you can edit it later` with no action, or `${name} is now in Clips` with action `Open Framing`. Same step called: Make highlight / Frame / Framing / Continue framing highlight / Open Framing.
7. Frame (Framing). Header "Frame". Screen words: crop box, focus point, keyframe, setup, preview, "Trim and slo-mo", segment, boundary, split, rotation, Pan/Zoom mode, Crop mode, settings. Loading: `Loading highlights...` / `Loading video...` / `Loading working video...`. Locked hint: "Drag the box onto your player, then press Play, to unlock". Length tooltip: "billed". Primary CTA: `Generate highlight` (cockpit: `Generate` / `Highlight`). Errors: `Failed to save crop keyframe`, `Failed to save detrim changes`, `Failed to split segment`. Credit/AI: `AI upscaler works best with 4x scaling...`.
8. Generate. Progress: `Getting your video ready` -> `Generating your highlight` -> `Sharpening the picture` -> `Finishing up`; but in-panel `Export complete!`, `Checking export status...`, `Generation continues on the server...`. Errors: `Server error (500). Check backend console for details.` / `port 8000`. Completion: `Your highlight is ready` with `Add spotlight` / `Finish without spotlight` / `Edit framing` / `Done for now`; later toasts: `Added to Clips: Your highlight is still a draft` (draft again!).
9. Spotlight. Header "Spotlight". Lock text if not generated: `Generate required for Spotlight mode` / `Generate in Framing first before adding overlays`. Picker: `Detecting players...`, `Click to highlight`, `Player tracking disabled`, step guide. Controls: `Spotlight settings`, `Pick your highlight color` (comment), `highlight layer`, `highlight ellipse`, `highlight region`, `player boxes`, `text layer`, `No text region under the playhead`, `Add text` ("Add a name, number, or caption."). CTA: `Generate highlight with spotlight`, cost note `Effects are free, no credits needed`. Dialog on leaving: `Uncommitted Spotlight Changes` ... `(GPU processing)`.
10. Finish. `Finish` -> toast `Finished` + `Nobody else can see this until you share a link.`; error `Couldn't finish your highlight` / `Could not finish`. Moves to the Finished tab. Re-edit: `Failed to open highlight as draft`. Share: `Get share link` -> `Create share link` -> `Link ready`; `Invite link copied!` is for referrals.
11. Finished. "Finished" tab; per-item `Finished` status; `Shared by`; `Finished highlight` on play marker; download errors `Download failed: 403 Forbidden`.

Biggest cross-step shifts: (a) play / moment / clip / annotation; (b) highlight (rating, in-progress, finished, spotlight circle, timeline layer, pre-publish) vs draft; (c) Frame / Framing / Focus / Make highlight / crop / focus point / keyframe; (d) Generate vs Export vs Create vs Rebuild; (e) Click vs Tap; (f) dev text in errors (server, backend, port 8000, GPU, hash, metadata, project, keyframe).
