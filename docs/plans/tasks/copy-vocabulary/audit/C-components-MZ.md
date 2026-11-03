# Copy audit: src/frontend/src/components M-Z (+ overlay, ranking, recap, settings, shared, textspec, timeline)

Method: 106 in-scope files (~8.7k lines). Found copy via grep of string literals, JSX text, title/aria-label/placeholder, toast/alert/confirm, then read around hits. Files that only render displayNames constants (OverlayPublishActionBar, PublishLinkFlow, PlaysOnlyPanel, WhoCanWatch, CreditCostRow, EmptyTabGuide, VeoZip*) are context only. Paths are relative to src/frontend/src/components/. Legal pages (PrivacyPolicy, TermsOfService) are inventoried but only vocabulary is flagged. Line numbers are from the grep and may be off by 1-2 inside multi-line JSX.

## 1. TERM INVENTORY

### Marked moment / its in-progress edit (5+ names)
| Word | Examples (file:line) |
|---|---|
| highlight | "Move N highlights to..." MoveToProfileModal:78; "Create highlight" RecapPlayerModal:513,684; tab "Highlights" RecapPlayerModal:439; "Added N highlights" ProjectManager:1263; "This highlight could not be added." ProjectManager:1861; "Opening highlight" NavigationGateOverlay:29; "Show highlights list" RecapPlayerModal:519; "Other highlights" ProjectManager:1099,2394,2401; "Legacy highlights" ProjectManager:2470,2480; "Highlights for {email}" ShareGameModal:99; default name "Highlight @ 0:12" ShareGameModal:54; "this highlight" SourceExpiredPanel:37,46; "Share (N highlights)" ShareWithTeammatesModal:352; "Highlight Region N" RegionLayer:439; settings panel title "Highlight" FocusSettingsPanel:40 |
| play | "Mark Plays" ProjectManager:1478, RecapPlayerModal:682; "Hide plays" RecapPlayerModal:626; "Plays shared with N recipients" SharePlaybackDialog:68; "tag this play" NoSportTagWarning:45; "Tag your athlete's plays" ProjectManager:1477; fallback "Play N" SegmentedProgressStrip:64; "Brilliant Play!" clipConstants:24; "a play to learn from" clipConstants:112 |
| clip | "find it on the Clips tab" RecapPlayerModal:266; "Clips" tab (SECTION_NAMES); CLIP_UPLOAD.UPLOAD_CLIP EmptyTabGuide:165,199 |
| draft | "This highlight is already a draft" RecapPlayerModal:266,509; "Create a draft highlight" :510; OVERLAY_PUBLISH.SAVE_DRAFT_LABEL OverlayPublishActionBar:80 |
| moment | "from this moment" RecapPlayerModal:510; "at this moment" :682 |
| started / in progress | "Highlight started" RecapPlayerModal:266; "Started - generate to complete" SegmentedProgressStrip:197 |
| matchup / pick | "Which is better?" RankingGame:157, HeroIntroModal:23; "Loading matchup" RankingGame:222; "a few matchups" RankingGame:214; "Pick" HeroMatchup:164 |

### Finished exported video (6+ names)
| Word | Examples |
|---|---|
| highlight | "Download this highlight" SharedCollectionView:180; "Could not download highlight" PublishedReelsPanel:523,896; "highlight will be deleted for good" PublishedReelsPanel:816; "Could not re-rank this highlight" :201 |
| video | "Shared Video" SharedVideoOverlay:207; "Download video" :214; "Loading shared video..." :87; "Could not load shared video" :63; "this video" PublishedReelsPanel:622 |
| generated video / generate | "generated videos for this profile" ManageProfilesModal:476; "generated everything you need" StorageExpiryBanner:44; "Generating..." SegmentedProgressStrip:196; "generate ... to complete" :197; "generated video" FocusSettingsPanel:58 |
| export | "Exporting..." SegmentedProgressStrip:151; "export completion" PrivacyPolicy:94 |
| finished | "finished video" SourceExpiredPanel:46; "You can still finish, download and share" ProjectManager:2476 |
| reel | "re-rank this one" PublishedReelsPanel:196 (about a finished video); "Reels" (comments); ReelMatchCard (file) |
| comparison video | "Failed to generate comparison video" PublishedReelsPanel:633 |
| status | "Done" SegmentedProgressStrip:129 vs "Complete" :194 vs "Done" RankingGame:216 |

### Collection
| Word | Examples |
|---|---|
| collection | "Could not download collection" PublishedReelsPanel:392; "This collection is restricted" SharedCollectionView:56; "Could not load this collection" :67; Intro for "{title}" PublishedReelsPanel:849 |
| highlights | default title 'Highlights' SharedCollectionView:79; "Loading highlights..." :121; "No highlights yet" :195; "these highlights" PublishedReelsPanel:372 |
| recap | "Team Recap"/"Full Game Recap"/"Game Recap" RecapPlayerModal:396-431; "My Recap" :74; "Loading team recap..." SharedGameView:61; "team recap" ShareGameModal:460 |

### Editing modes / steps
| Word | Examples |
|---|---|
| Framing | MODE_NAMES.FRAMING ProjectManager:1274; "Reframe, trim & speed" ModeSwitcher:66 |
| Focus (retired name) | "re-edited in Focus" ProjectManager:2477; REAPPLY_FOCUS_* constants; FocusSettingsPanel (file) |
| Spotlight | "Spotlight" SegmentedProgressStrip:96,154; "Spotlight, text & cover" ModeSwitcher:74; "This spotlight" OverlaySpotlightPanel:116; "Delete this spotlight?" RegionLayer:561 |
| Overlay / layer | "Disable highlight layer" Timeline:133; "Highlight overlay creation" TermsOfService:57; "overlay settings" PrivacyPolicy:65 |
| Annotate | "Mark Plays" ProjectManager:1478; "annotations stay playable" StorageExpiryBanner:45; "Highlight extraction and annotation" TermsOfService:55 |
| Phase / Status | "Phase" ProjectManager:2235; "By status" :2314 |

### Crop / spotlight / text / timeline
| Word | Examples |
|---|---|
| crop | "crop keyframes" PrivacyPolicy:65; "Video framing and cropping" TermsOfService:56 |
| keyframe / boundary | "Copy keyframe" KeyframeMarker:92; "Delete keyframe" :123; "Auto keyframe at 1.20s" RegionLayer:382; "Boundary at 0.00s" :536; "Delete boundary" :549 |
| region / segment | "Delete region" RegionLayer:327, TextLayer:363; "Delete region (and all its text)" TextManagementPanel:179; "Expand region" :161; "Click to add a region" RegionLayer:68; "Segment N: 0.5x" :438; "Highlight Region N" :439; "Trim segment" :277 |
| text | "Delete text block" TextManagementPanel:219; "Hide text (keep element)" :211; "Select a text element" :289; "Text region ..." TextLayer:323 |
| text style | "Shadow blur", "Stroke width", "Align", "Font", "Size", "Color" TextSpecEditor:61,77,115,134,175,191 |
| cover | "Cover" ModeSwitcher:74; "cover frame" ThumbnailPanel:68; "Custom image in use" :46,59; "Frame you picked" :48; "Auto-picked" :34; "Use a frame instead" :80 |
| position | "Position: top left", "Custom position (no preset selected)" PositionPresetGrid:52,67 |
| settings | "Aspect ratio", "Include audio" FocusSettingsPanel:41,47; "Settings", "Close settings" SettingsRail |

### Credits / payment / storage
| Word | Examples |
|---|---|
| credit | "Credits Added!" PaymentResultModal:30; "Credits purchased! Extending storage..." StorageExtensionModal:103; "Extend Storage - N credit(s)" :202 |
| payment | "Payment Issue" PaymentResultModal:30; "verifying your payment" :49 |
| storage | "Extend Storage" StorageExtensionModal:121; "Extend storage" SourceExpiredPanel:56, StorageExpiryBanner:41; "Storage extended until" :82; "No expiry set" :142; "Storage Credits and Payments" TermsOfService:32 |
| expire | "Source video expired" SourceExpiredPanel:37; "let it expire" StorageExpiryBanner:44; "Games expire after 30 days unless credits are applied" TermsOfService:143 |

### AI upscaling
"using AI upscaling" ProjectManager:1627, SignInScreen:66; "AI-assisted upscaling" TermsOfService:56; "Process, enhance, crop, overlay, and export" PrivacyPolicy:89; "GPU video processing" PrivacyPolicy:118.

### Upload
| Word | Examples |
|---|---|
| upload | "Upload failed" ProfileIntroSection:64; "Upload didn't finish." ProjectManager:1861, UploadingGameTile:205; "Upload incomplete" :253; "Upload photo"/"Re-upload" ProfileIntroSection:151,132; "Cancel upload" UploadingGameTile:263 |
| save online | "This game didn't save online." UploadPreviewNotice:53 |
| queued / resume / discard | "Queued" UploadProgressIndicator:133; "Tap to resume" UploadingGameTile:224; "Discard"/"Discard for good?" :308; "Retry upload of" :287 |
| add | "Go to Games" EmptyTabGuide:180; "Add Video"/"Add Game" (comments); "Your browser does not support the video tag" MediaPlayer:212 |

### Sharing
| Word | Examples |
|---|---|
| share | "Share" SharePlaybackDialog:153, SharedCollectionView:172; "Share With Teammates" ShareWithTeammatesModal:205; "Shares sent" ShareModal:133; "Game shared with N recipients" ShareGameModal:377; "Shared with N teammates" ShareWithTeammatesModal:176 |
| link | "Copy link" ShareModal:246, ShareGameModal:470; "Copy share link" ShareModal:290; "Revoke link" ShareGameModal:178,474; "Revoke access" ShareModal:334; "Link revoked" ShareGameModal:449; "Keep link" :183; "Public link copied" PublishedReelsPanel:370 |
| invite | "Invite a friend" ProfileDropdown:110; "Invite a Friend to ReelBallers" SharedAnnotationView:145, SharedVideoOverlay:148; "(invite)" ShareModal:284 |
| people | "Add people" ShareModal:218, ShareGameModal:413, SharePlaybackDialog:132; "People with access" ShareModal:307; "recipient(s)" ShareGameModal:377; "teammate(s)" ShareWithTeammatesModal:176 |

### Athlete / profile / sport
| Word | Examples |
|---|---|
| profile | "Manage Profiles" ManageProfilesModal:299; "Manage Profile" PublishedReelsPanel:723; "Profile Name" :140; "Add/Edit/Delete Profile" :411,426,480; "Default" fallback ManageProfilesModal:352, MoveToProfileModal:53, ReferenceGameCard:46 |
| athlete / player | "Athlete Intro Card(s)" ManageProfilesModal:449, ProfileIntroSection:99; "My Athlete" RecapPlayerModal:702; "athlete" ProjectManager:1477; "this player's likeness" ProfileIntroSection:207; "Select player" EDITOR_PANELS |
| sport | "No Sport Selected" ProfileSportButton:54; "Change sport" InlineSportSelect:62; "Set your sport (top bar) for tags" NoSportTagWarning:36 |
| team | "Team layer" ProjectManager:1478; "Team highlights" RecapPlayerModal:712; "team chat" ShareGameModal:293 |
| account | "Account Settings" ProfileDropdown:120; "Sign In" SignInButton:23 / "Sign in" :21 / "Sign Out" ProfileDropdown:132 |

### Guidance
"Quests: 3/7" QuestIcon:45; "{step} guidance" EmptyTabGuide:257 (aria); "Get the app to make your own highlights" SharePageInstallBanner:14.

### Status / system words
| Word | Examples |
|---|---|
| Loading | "Loading video..." VideoPlayer:70; "Loading preview..." PosterFramePreview:114; "Loading shares..." ShareModal:348; "Loading email mappings..." ShareWithTeammatesModal:224; "Loading matchup" RankingGame:222 |
| Connecting | "Connecting to server..." VideoLoadingOverlay:43; "Downloading video... Ns" :39; "Connecting... Ns" :41; "Buffering N%" :37 |
| Failed / Could not | "Failed to load games" ProjectManager:1926; "Failed to load recap" RecapPlayerModal:333; "Failed to create link" ShareGameModal:298; "Could not create link" PublishedReelsPanel:375; "Could not save to the cloud" SyncStatusIndicator:100; "Video failed to load" VideoPlayer:313,352; "Report not sent" ReportProblemButton:367 |
| Delete / Remove / Revoke / Discard / Dismiss | "Delete" ManageProfilesModal:382, RegionLayer:567; "Remove {email}" ShareGameModal:131; "Revoke link" :178; "Discard" UploadingGameTile:305; "Dismiss" ProjectManager:1876 |
| Retry | "Retry" SyncStatusIndicator:108; "Retry report" ReportProblemButton:399; "Retry Loading Video" VideoPlayer:320,359 |
| Click / Tap | "Click to add a region" RegionLayer:68 vs "Tap to resume" UploadingGameTile:224, "Tap again to confirm" :263, "Tap" SharePageInstallBanner:38; "(Scroll Down)" ZoomControls:37 |

## 2. FINDINGS

### A. The marked moment has 5+ names (INCONSISTENT)
1. One marked moment is "play" (NoSportTagWarning:45; ProjectManager:1477; SharePlaybackDialog:68; RecapPlayerModal:626), "highlight" (RecapPlayerModal:513; ProjectManager:1263,1861; ShareWithTeammatesModal:352), "clip" (RecapPlayerModal:266 "Clips tab"), "draft" (RecapPlayerModal:266,509), "moment" (RecapPlayerModal:510,682). Parent cannot tell if these are the same thing. Suggest: marked moment = "clip" (or "play", decide once); finished video = "highlight". E.g. RecapPlayerModal:513,684 "Create highlight" -> "Create clip".
2. "highlight" means three things: marked moment (RecapPlayerModal:513), finished video (SharedCollectionView:180), and the circle (Timeline:133 "Disable highlight layer"; RegionLayer:439 "Highlight Region N"; FocusSettingsPanel:40 panel "Highlight"). Rewrite circle words to "spotlight": "Turn spotlight off", "Spotlight N", panel title "Video".
3. ProjectManager:1861 "This highlight could not be added." / :1263 "Added N highlights" are results of uploading a clip. Rewrite: "Added N clips"; "This clip could not be added."
4. ProjectManager:1099,2394,2401 "Other highlights"; :2470,2480 "Legacy highlights" label groups in the Clips tab; diverge from SECTION_NAMES.CLIPS. Rewrite: "Other clips", "Older clips".
5. RecapPlayerModal:266 "Highlight started - find it on the Clips tab" / "This highlight is already a draft"; :510 "Create a draft highlight from this moment". "draft", "started", "moment" are jargon. Rewrite: "Clip added. Find it on the Clips tab." / "This clip is already added." / "Create a clip from this play".
6. RecapPlayerModal:700,712 aria "My Athlete highlights"/"Team highlights" and tab "Highlights" :439 are lists of marked plays, not finished highlights. Rewrite "My player's plays"/"Team plays"; "My Athlete" :702 is odd.
7. ShareGameModal:54 default name "Highlight @ 0:12" -> "Play at 0:12".
8. SourceExpiredPanel:37,46 mixes clip and finished video under "highlight"; rewrite: "this clip can't be edited"; "If you already exported this clip, the finished video is unaffected."
9. ManageProfilesModal:399,476 "videos and highlights", "highlights, projects, and generated videos". "projects" is internal; four overlapping nouns. Rewrite: "All games, clips, and finished videos for this profile will be permanently deleted. Games shared with other profiles are not affected."
10. MoveToProfileModal:78 "Move N highlights to..." and NavigationGateOverlay:29 "Opening highlight": use the same noun as chosen for clip vs finished video.
11. clipConstants.js:24-28,111-142 ratings call it "play" ("Brilliant Play!", "a play to learn from"), buttons say highlight. Also "Mental lapse"/"Technical lapse" (:112-113,134-135), "Skill miss"/"Decision miss" (:14-15) are coach jargon and harsh for a parent tagging their kid. Rewrite: "Needs work: decision", "Needs work: skill".

### B. Finished video: 6+ names (INCONSISTENT)
12. highlight (SharedCollectionView:180), video (SharedVideoOverlay:207,214,87,63), reel (PublishedReelsPanel:196), generated video (ManageProfilesModal:476; FocusSettingsPanel:58), finished video (SourceExpiredPanel:46), comparison video (PublishedReelsPanel:633). Suggest "highlight" throughout; SharedVideoOverlay:207 "Shared Video" -> "Shared highlight", :214 "Download highlight", :87 "Loading highlight...", :63 "Could not load this highlight."
13. Verb for the AI render: "Exporting..." SegmentedProgressStrip:151; "Generating..." :196; "generate to complete" :197; "generated" FocusSettingsPanel:58, StorageExpiryBanner:44; "finish" ProjectManager:2476; "export" PrivacyPolicy:94. Pick one (e.g. "Export"). Rewrite :197 "Started - export to finish".
14. SegmentedProgressStrip:129 "Done" vs :194 "Complete" for the same state.
15. SegmentedProgressStrip:134,147,195 "Not Connected" is data-model jargon (upstream step changed). Rewrite: "Needs re-export".
16. SegmentedProgressStrip:64 fallback "Play N" vs clip naming (see A).
17. PublishedReelsPanel:196-197 "We'll re-rank this one / It re-enters the ranking game so its spot can move." "re-rank", "ranking game" internal; the screen says "Which is better?". Rewrite: "We'll ask you to compare this one again."
18. PublishedReelsPanel:622,633,648 native alert() with raw error text: "Before/After comparison not available for this video", "Failed to generate comparison: ${error.message}". Use a toast: "Couldn't make the before/after video. Please try again."
19. PublishedReelsPanel:849 'Intro for "..."' vs "Athlete Intro Card" (ProfileIntroSection:99; ManageProfilesModal:449): same concept, two names. Use "Intro card".
20. PublishedReelsPanel:723 "Open your profile menu -> Manage Profile -> Athlete Intro Card" uses ASCII arrows, singular "Manage Profile" vs modal title "Manage Profiles" (ManageProfilesModal:299), "Athlete Intro Cards" plural row :449.
21. PublishedReelsPanel:815 `Delete "${deletingDownload?.project_name}"?` exposes internal field name; ensure friendly fallback.

### C. Collection vs highlights vs recap (INCONSISTENT)
22. "collection" (PublishedReelsPanel:392; SharedCollectionView:56,67) but default title 'Highlights' (SharedCollectionView:79) and "Loading highlights..."/"No highlights yet" (:121,195); the recap's tab "Highlights" (RecapPlayerModal:439) means plays. Use one name for a combo of finished videos (e.g. "highlight reel") and never reuse "Highlights" for plays.
23. SharedCollectionView:180 "Download this highlight" on a collection page: unclear whether it downloads one video or all.
24. RecapPlayerModal:479,604 "This game's video is no longer available." duplicate, one with period one without.
25. "Recap" (RecapPlayerModal:74,396-431; SharedGameView:61; ShareGameModal:460) is an unfamiliar word for a parent; "My Recap" :74 vs "My Athlete" :702.

### D. Modes / editing controls (INCONSISTENT, JARGON)
26. ProjectManager:2477 "re-edited in Focus": retired name. Also :2476 "old multi-highlight builder" is jargon. Rewrite: "Made with an older version of the editor. You can still download and share these, but they can't be edited anymore."
27. ModeSwitcher:66,74 descriptions "Reframe, trim & speed" / "Spotlight, text & cover" are HARDCODED beside constants; "&" vs "and"; "cover" explained nowhere. 
28. ThumbnailPanel:34-80 "Auto-picked", "Frame you picked", "cover frame", "Use a frame instead": "frame" collides with the Framing mode. Rewrite: "Cover picked automatically at 0:12. Drag the marker to change it." / "Use a still from the video instead".
29. ProjectManager:2235 "Phase" vs :2314 "By status" for the same filter group.
30. ProjectManager:2269 "Aspect Ratio" (Title Case) vs FocusSettingsPanel:41 "Aspect ratio"; "aspect ratio" is jargon for a parent (suggest "Shape: vertical / wide").
31. FocusSettingsPanel:40 panel title "Highlight" for the Framing settings; :58 "generated video".
32. RegionLayer:68 "Click to add a region": "Click" is wrong on phones and "region" is jargon. Rewrite: "Tap to add a spotlight" (mode-specific). Same jargon: RegionLayer:327 "Delete region"; TextLayer:323,363; TextManagementPanel:161 "Expand region", :179 "Delete region (and all its text)". Rewrite: "Delete spotlight", "Delete text".
33. RegionLayer:438 "Segment N: 0.5x", :277 "Trim segment", :439 "Highlight Region N": rewrite "Section N", "Spotlight N".
34. KeyframeMarker:92,123 "Copy/Delete keyframe"; RegionLayer:382 "Auto keyframe at 1.20s"; :536,549 "Boundary at ...", "Delete boundary". Animation jargon. Rewrite: "Delete position marker".
35. RegionLayer:562 "any custom positioning for this part of the highlight will be lost" mixes highlight (clip) / positioning. Rewrite: "its custom position for this part of the clip will be lost."
36. TextManagementPanel:211 "Hide text (keep element)", :219 "Delete text block", :289 "Select a text element to edit its settings." ("element", "block" jargon). Rewrite: "Hide text", "Delete text", "Select text to edit it."
37. TextSpecEditor:61,77,175 "Shadow blur", "Stroke width", "Align"; rewrite "Shadow softness", "Outline thickness", "Alignment". Labels are uppercase via CSS, mixing with Title Case elsewhere.
38. PositionPresetGrid:67 "Custom position (no preset selected)": "preset" jargon.
39. Timeline:133 "Disable/Enable highlight layer": "layer", "disable". Rewrite: "Turn spotlight off/on".
40. ZoomControls:37,49,79,97 "Zoom Out (Scroll Down)" (Title Case) vs TimelineZoomChip:30 "Zoom out" (sentence case); TimelineBase:442,455 "Scroll to zoom timeline" (desktop only, fine).
41. VideoControls:74 "Chapters": jargon (plays?). :411 "Fullscreen (F)" vs ranking HeroMatchup:115, ReelMatchCard:37 "Play full screen".
42. QuestIcon:45 "Quests: 3/7": "Quests" is gamified jargon not used elsewhere. Rewrite: "Getting started: 3 of 7".

### E. Upload / video / loading wording
43. VideoPlayer:313,352 "Video failed to load" + :320,359 "Retry Loading Video" (Title Case, duplicated). Rewrite: "This video didn't load" / "Try again".
44. VideoLoadingOverlay:43 "Connecting to server..." (jargon), :39 "Downloading video... Ns", :41 "Connecting... Ns", :81 "First load may be slow. Subsequent loads will be faster." Rewrite: "Loading video...", "First load can take a bit. After that it's faster."
45. VideoPlayer:392-396 "Drag and drop a video or upload to get started" / "Release to upload": no drag and drop on phones.
46. MediaPlayer:212 "Your browser does not support the video tag." JARGON. Rewrite: "Your browser can't play this video."
47. UploadPreviewNotice:53 "This game didn't save online. Your file and details are kept." Unclear. Rewrite: "This game didn't finish uploading. Your video and details are still here. Try again."
48. UploadingGameTile:205,224,253,263,305,308 mixes "Cancel upload", "Discard", "Discard for good?", "Retry to resume" for similar actions; "Upload incomplete" vs "Upload didn't finish." (:205). Use one verb for removing (Remove/Delete) and one for retry.
49. Apostrophes mixed: curly ProjectManager:1477,1861 vs straight/&apos; UploadingGameTile:205, SignInScreen. 
50. ProfileIntroSection:64,76,91 "Upload failed", "Could not remove the image", "Could not update consent" (raw err.message appended); :111 "Photo missing"; :132 "Re-upload" vs :151 "Upload photo". Rewrite "Replace photo".
51. ProjectManager:1926,2187 "Failed to load games"/"Failed to load clips" with :1930,2191 "Cannot connect to server. Check your internet connection." Rewrite: "We couldn't load your games. Check your connection and try again."
52. Case mix on ProjectManager: :1647 "Continue Where You Left Off", :2060 "Your Games", :2269 "Aspect Ratio" vs sentence case elsewhere ("By status", :2337).
53. HARDCODED duplicate tagline "Transform game film into high-quality highlights in minutes using AI upscaling" ProjectManager:1627 and SignInScreen:66; "game film" vs "game video" elsewhere.
54. SharedGameView:74 "REEL BALLERS" vs "ReelBallers" (SharedAnnotationView:212, SignInScreen). Brand inconsistency.
55. ReportProblemButton:299,370,371 "The server rejected the report (status 500)", "Failed (500)", :422 "Copy error details", :428 "Known credentials are removed". JARGON / alarming. Rewrite: "We couldn't send your report. Your message is safe. Try again." Also "--" dashes (:235,370,371,428).

### F. Sharing
56. Revoke/remove/stop: ShareGameModal:165,178,474 "Revoke link"/"Revoke this game link?"; ShareModal:334 "Revoke access"; ShareGameModal:131 "Remove {email}"; :313 "Game link revoked". "Revoke" is legal jargon. Rewrite: "Turn off link", "Stop sharing".
57. Status codes/technical errors in toasts: ShareGameModal:282,298,319 `Failed to create link (${resp.status})`, "Failed to revoke (404)"; ShareModal:122; SharePlaybackDialog:64; ShareWithTeammatesModal:161 `Share failed (${status})`, :50,146 "Failed to load/save email mappings"; PublishedReelsPanel:355 `Failed (${status})`; SharedCollectionView:103 `HTTP ${status}`; StorageExtensionModal:78 "Extension failed". Rewrite: "Couldn't create the link. Please try again."
58. ShareGameModal:293 "Game link copied — drop it in the team chat" (em dash); :295 `toast.success(url)` shows a bare URL as success; :449 "Link revoked — no one can watch via a link."; :460 "Watches the team recap — no account needed."
59. ShareGameModal:488 'set to "Only highlights they're tagged in" will receive 0 highlights (no tag match)': "tag match", highlights vs plays.
60. "Add people" (ShareModal:218; ShareGameModal:413; SharePlaybackDialog:132) vs "teammates" (ShareWithTeammatesModal) vs "recipient(s)" (ShareGameModal:377; SharePlaybackDialog:68); ShareModal:133 "Shares sent". Use "people".
61. Dialog/button titles: "Share" (SharePlaybackDialog:153), "Share With Teammates" (Title Case, ShareWithTeammatesModal:205), "Share with N" (ShareGameModal:497), "Share (N)" (ShareModal:359), "Share (N highlights)" (ShareWithTeammatesModal:352).
62. Email input hints differ: "Type an email and press Enter to add" SharePlaybackDialog:140; "Press Enter after each email" ShareWithTeammatesModal:285; "Enter emails, separated by commas" UserPicker:123; "Enter email addresses..." ShareGameModal:418; "Enter email addresses" ShareWithTeammatesModal:283. "Press Enter" does not exist on phone keyboards.
63. SharedAnnotationView:145, SharedVideoOverlay:148 "Invite a Friend to ReelBallers" (Title Case) vs ProfileDropdown:110 "Invite a friend". SharedAnnotationView:196 "Sign in to watch" vs :211 "Sign In".
64. Restricted copy: SharedCollectionView:56 "This collection is restricted. Sign in with the email it was shared to." / SharedVideoOverlay:52 "This video is restricted...": "restricted" unclear; two nouns. Rewrite: "Only people it was shared with can watch. Sign in with the email we sent the link to."
65. Dead-link copy has 4 phrasings: "This share link is no longer active." (SharedAnnotationView:46; SharedCollectionView:59; SharedVideoOverlay:55), "Share link not found." (:49,62,58), "This link is no longer active." (SharedGameView:127), "This game link could not be found." (:128). One pair is enough.
66. SharePageInstallBanner:14 "Get the app to make your own highlights"; :27 "Install App" vs :38 "Install app"; :38 describes a Chrome menu glyph, no iPhone Safari instructions (UNCLEAR).
67. Sign in/Sign In: SignInButton:21 title "Sign in" vs :23 "Sign In"; ProfileDropdown:63 "Sign in to save your work across devices", :66 "Sign In", :132 "Sign Out", :120 "Account Settings".
68. SharedVideoOverlay/SharedAnnotationView: "Loading shared highlights..." SharedAnnotationView:138 vs "Loading shared video..." (:87) vs "Loading team recap..." (SharedGameView:61).

### G. Credits / storage / payments
69. StorageExtensionModal:121 "Extend Storage" and :202 "Extend Storage - N credits" Title Case vs "Extend storage" (SourceExpiredPanel:56; StorageExpiryBanner:41). :168 "Extension"; :142 "No expiry set".
70. TermsOfService:32,141,143 "Storage Credits and Payments", "Games expire after 30 days unless credits are applied" vs PrivacyPolicy:135 "Game footage: 30 days after game expiry" (confusing and possibly contradictory). Credits are described as storage credits there but as AI-upscaling credits elsewhere (CONTRADICTION risk).
71. PaymentResultModal:30 "Credits Added!"/"Payment Issue" (Title Case); :49 "Something went wrong verifying your payment. Your credits may still be added shortly." Rewrite: "We couldn't confirm your payment yet. If you were charged, your credits will show up soon."
72. SourceExpiredPanel:37-47 uses "source video", "storage expired", "storage window has passed", "original footage": rewrite as "game video" throughout; "can no longer be recovered" is alarming.
73. StorageExpiryBanner:44 "generated everything you need from a game", "annotations stay playable". Rewrite: "Once you've exported everything you need, it's fine to let the game video expire. Your marked plays stay watchable."

### H. System / sync messages
74. SyncStatusIndicator:86-138: "Offline. Changes can't be saved until you reconnect"; "Some changes didn't reach the cloud."; "Could not save to the cloud"; "A newer version of your work exists. Retry to load it."; "A newer version of your work is available / Reload"; "Cloud backup pending -- your work is saved locally". Owner memory prefers silent persistence / no "Saved" copy; "cloud", "newer version" are confusing. Double hyphen at :138. Rewrite: "Not saved yet. We'll keep trying." / "This was edited somewhere else. Reload to see the latest."
75. UpdateGateModal:39,43 "Update paused" / "Could not save your latest changes." Rewrite: "Couldn't finish updating. Your latest changes aren't saved yet."
76. CtaBar:27 uses native window.confirm(`${title}?`): browser dialog with mechanically appended "?". Use ConfirmationDialog with a sentence.

### I. Ranking game
77. HeroIntroModal:27 "You're choosing the best highlight between two -- the one that plays first and the one that plays next." Confusing (user is comparing, not sequencing); :34 "Toggle between them by swiping, or by pressing the small thumbnail in the upper-left corner"; :40 "hit the back button". Rewrite: "Pick the better highlight. Swipe or tap the small preview to compare."
78. ConfidenceBanner:12,19-29 tiers + notes duplicate each other ("Just getting started"/"You're just getting started."), "--" at :24,29; "Confidence" (file/gauge) is stats jargon; :98,118,145 and RankingGame:167 "Ranking Progress"; :19 "All Highlights Ranked" Title Case; :90 "Why is this locked?" unexplained.
79. RankingGame:177 "Rematch -- undo your last pick": "Rematch" unclear. Rewrite: "Undo last pick". HeroMatchup:127 "swipe to compare" lowercase.
80. RankingGame:212,214 "You're caught up for now." / "New highlights will ask for a few matchups when you finish them." "matchups" jargon; "finish" ambiguous. Rewrite: "You're all caught up. We'll ask you to compare new highlights after you export them."

### J. Profiles / athlete / sport
81. ManageProfilesModal:140 "Profile Name (optional)", :374 "Edit name, color & sport" (&), :411 "Add Profile", :426 "Edit Profile", :317 "Open Admin Panel", :382 title "Delete" with no object. "athlete" (ManageProfilesModal:399, RecapPlayerModal:702) vs "player" (ProfileIntroSection:207, EDITOR_PANELS.SELECT_PLAYER_TITLE, PrivacyPolicy:50): pick one.
82. ProfileIntroSection:207 consent run-on: "I am the parent or guardian, I consent to using this player's likeness, and I understand it becomes publicly visible to anyone I share a link with." Rewrite as two short sentences.
83. ReferenceGameCard:46 "another profile"/"Default" fallbacks; :55-56 aria "reference, open in X profile": "reference" is internal. Rewrite: "Shared game. Open in {name}'s profile."
84. ProfileSportButton:54 "No Sport Selected" (Title Case) vs NoSportTagWarning:36 "Set your sport (top bar) for tags" / :45 "Pick your sport to tag this play" vs InlineSportSelect:62 "Change sport": mixed set/pick/select/change; "tags" jargon.
85. ProjectManager:1478 "This game is on your Team layer — open Mark Plays to tag your own athlete." "Team layer" jargon, em dash. Rewrite: "This game was shared with you. Open Mark Plays to tag your own player."

### K. Legal pages (lower priority, vocabulary drift)
86. TermsOfService:55-58 "Highlight extraction and annotation", "Highlight overlay creation", "Video generation and sharing" use old step names; PrivacyPolicy:137,214 "Processing artifacts" jargon; :153 "Right to Limit Sensitive PI"; :127 "With other users (future feature)" while sharing already exists (STALE); :141 "permanently removed immediately (within 45 days if via email)" contradicts itself; :135 "Game footage" vs "video" elsewhere.

## 3. Em dashes / double hyphens in visible copy (owner rule: none)
- Em dash: ProjectManager:1478; ShareGameModal:293,449,460; SharedCollectionView:195; StorageExtensionModal:202 (`Extend Storage — N credits`); HeroIntroModal:27 (&mdash;); ReferenceGameCard:56 (aria); PrivacyPolicy:51,202; TermsOfService:144.
- "--" as dash: ConfidenceBanner:24,29; RankingGame:177; SyncStatusIndicator:138; ReportProblemButton:235,370,371,428; TextLayer:323 (aria).
- ASCII "->": PublishedReelsPanel:723.

## 4. HARDCODED (inline copy that should move to displayNames)
Almost all inline strings above are hardcoded. Highest value: tagline duplicate (ProjectManager:1627, SignInScreen:66); load-error states (ProjectManager:1926-1930,2187-2191); sharing toasts (ShareGameModal:282-385, ShareModal:99-139, SharePlaybackDialog:68-75, ShareWithTeammatesModal:176-183); SegmentedProgressStrip:129-197; SyncStatusIndicator; UpdateGateModal; VideoLoadingOverlay; RegionLayer/TextLayer/TextManagementPanel/KeyframeMarker titles; ModeSwitcher:66,74; StorageExtension*/SourceExpiredPanel; ranking/*; clipConstants.js rating copy; ProfileIntroSection; ManageProfilesModal; ProjectManager group labels :1099,2394,2470 and legacy notice :2476.
Diverging from constants: ProjectManager:2477 "Focus" (retired) while :1274 uses MODE_NAMES.FRAMING; ModeSwitcher:66 "Reframe" vs MODE_SWITCHER_NAMES.FRAMING; RecapPlayerModal:266 "Clips tab" literal vs SECTION_NAMES.CLIPS; ProjectManager:1740 `label="Games"` literal while sibling tabs use SECTION_NAMES.
