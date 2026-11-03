# Sweep B: components A-L inline copy audit

Scope: src/frontend/src/components/*.jsx|js starting A-L, plus auth/, collections/, instructions/, introcards/. All paths below are relative to src/frontend/src/components/.

Method note: files were scanned with a string-literal/JSX-text extraction (all 99 in-scope files processed; comments and class names excluded), then the dense modals were read in context. Many surfaces (ClipSize/ClipUploadNotice/ClipUploadTooLarge modals, ExportTooLargeModal, FocusPublishActionBar, GameDetailsModal buttons, FramedBanner, FramingHeaderStatus, LinkReadyCard, FocusCompletionRecovery title, all of instructions/ guide text) render displayNames.js constants (CLIP_UPLOAD, EXPORT_TOO_LARGE, FOCUS_PUBLISH, LIBRARY_ACTIONS, RESULT_SURFACE, GUIDE, ...). Those are covered by the displayNames sweep and are only noted as surfaces. Multi-line JSX prose was spot-read; a few long paragraphs may be missing.

---------------------------------------------------------------------
## 1. TERM INVENTORY

### A. The marked moment (the thing a parent taps "Mark play" for) and its in-progress edit
Words in INLINE copy in scope:

| Word | Count | Examples (file:line) |
|---|---|---|
| "plays" / "play" (marked moment) | ~14 | `FileUpload.jsx:48` "Select a game video to mark plays and make highlights"; `FileUpload.jsx:55` "Import game video(s) to mark plays and make highlights"; `BuyCreditsModal.jsx:564` "~{n} plays" (price pack headline); `DraftTile.jsx:681` aria "{n} play(s) changed since this highlight was made"; `GameTile.jsx:235` "Watch plays"; `GameTile.jsx:251` "Plays stay playable."; `GameTile.jsx:397` "your {n} marked play(s)"; `ClaimGameView.jsx:228` "shared team plays"; `LockedReasonModal`: none |
| "clip(s)" | ~12 | `AttachVideoModal.jsx:154` "your existing clips stay exactly where they are"; `CreditHistoryModal.jsx:38-39` "Clip upload", "Clip upload refund"; `DraftTile.jsx:634` "Contains {n} highlights" (the same thing a clip count); `CreditHistoryModal.jsx:56` "Footage added to a game"; `ClipUploadNotice*` modals (constant) |
| "highlight(s)" for the marked moment / its edit | ~25 | `DraftTile.jsx:634,681`; `DraftTile.jsx:781` surface "Watch highlight"; `ReelTile.jsx:273` "Ranked #n of your highlights this season"; `ReelTile.jsx:328` "Rename highlight"; `ReelTile.jsx:282,293` "An intro plays before this highlight"; `CollectionPlayer.jsx:611` "Re-edit this highlight"; `CollectionPlayer.jsx:627` "Re-rank this highlight"; `CollectionShareModal.jsx:171` "Share highlights" |
| "draft" / "Drafts" | ~10 | `DraftTile.jsx:534,791` "Hide from Drafts"; `ReelTile.jsx:450,512` "Open as Draft"; `DraftReelPreview.jsx:221` "This draft changed; reopen it..."; `ExportButtonView` uses constant; `LockedReasonModal` n/a; `CollectionPlayer` "draft strip" (comment only) |
| "projectName" fallback "Your highlight" | 2 | `FocusCompletionRecovery.jsx:163`, `GlobalExportIndicator.jsx:50` |
| "generation"/"generated"/"generate" | ~12 | `GlobalExportIndicator.jsx:266` "Highlight generated"; `GlobalExportIndicator.jsx:275` "Couldn't generate highlight"; `ExportButtonView.jsx:172,195,220` "Monitoring generation...", "Generation continues on the server", "Generation failed:"; `CreditHistoryModal.jsx:21-25` "Video generation", "Generation refund"; `InsufficientCreditsModal.jsx:35` "This generation requires..." |
| "export" (user-visible) | 4 | `AccountSettings.jsx:45` Error('Export failed') (data export, different meaning); `DraftTile.jsx` etc. use constants; `CropControls.jsx:84` "during export" |
| "Preview" | 1 | `DraftTile.jsx:888` |

### B. Game video / footage
| Word | Count | Examples |
|---|---|---|
| "game video" | ~6 | `FileUpload.jsx:48,55`; `GameFootagePicker.jsx:18` "Drop any game video here."; `GameFootagePicker.jsx:31` "We didn't find any game videos in there"; `GameTile.jsx:...` "Restore full video" (constant) |
| "video" / "videos" (source) | ~12 | `AttachVideoModal.jsx:101` "Video added to game"; `AttachVideoModal.jsx:136` "Add a video"; `AttachVideoModal.jsx:200` "Click or drag to upload video"; `GameFootagePicker.jsx:22,29` "Tap to choose videos", "Checking your videos..."; `GameTile.jsx:238` "Add video"; `FileUpload.jsx:65` "Select Video File"; `DraftTile.jsx:698` "Source video expired" |
| "footage" | ~8 | `AttachVideoModal.jsx:242` "Add footage" / "Adding footage..."; `GameFootagePicker.jsx:21` "Drop footage to add to this game."; `CreditHistoryModal.jsx:37` "Footage added to a game"; file name `FootageList` |
| "recording" / "filmed" / "camera" | ~6 | `FootageList.jsx:29,39,44,326,363` ("recorded", "two parts of one recording", "filmed at the same time", "cameras", "angles") |
| "game" | many | `GameTile.jsx:290` "Delete game"; `EditGameModal.jsx:93` "Edit Game Details"; `GameTile.jsx:239` "Share game" |
| "Source" | 3 | `DraftTile.jsx:698-702` "Source video expired" / "Source expired" / "Source video expires in N days" |
| "Upload" vs "Add" vs "Attach" vs "Import" vs "Select" | | Upload: `AttachVideoModal.jsx:200`, `GameTile.jsx:418`; Add: `AttachVideoModal.jsx:136,242`; Attach: modal file name + `AttachVideoModal.jsx:154` "Attach another half"; Import: `FileUpload.jsx:55`, `ClaimGameView.jsx:126` "import this game"; Select: `FileUpload.jsx:65` |

### C. Finished exported video
Words: "highlight" (dominant), "video" (`GameTile`, `CreditHistoryModal:21` "Video generation"), "Finished" (`JustPublishedCard.jsx:136` "Just finished"), "Made With" (`BrandedEndCard.jsx:23`), "highlights" (`BrandedEndCard.jsx:49` "Make your own highlights at www.reelballers.com"), "version" (`DraftReelPreview.jsx:284` "Shared version updated"), "share" (`DraftReelPreview.jsx:27,37-40`, as noun for the link), "reel" (user-visible only via constants and `RESULT_SURFACE.WATCH_MARKED_PLAYS`/`LIBRARY_ACTIONS.PUBLISH_REEL`; inline: `collections/CollectionPlayer.jsx:562` uses LIBRARY_ACTIONS.PUBLISH_REEL), "content" (`LockedReasonModal.jsx:51,75,86` "more {rc} content"), "mixes" (`LockedReasonModal.jsx:75`, `RatioUnlockGroup.jsx:10`), "Intro".

### D. Collections
Words: "collection" (`CollectionShareModal.jsx:185,227` "Collection shared", "this collection"), "Share highlights" (`CollectionShareModal.jsx:171`), "mixes"/"cross-game mixes" (`RatioUnlockGroup.jsx:10`, `LockedReasonModal.jsx:75`), "game highlights" (`RatioUnlockGroup.jsx:9`), "top highlights" (`CollectionShareModal.jsx:186`), "Smart" (internal id in `LockedReasonModal.jsx:21`; user text `SmartLockedCard.jsx:7` "Your top-rated highlights"), "Play all" (`CollectionHeader.jsx:115,129`), "By game / By tournament / By month" (`CollectionsTab.jsx:29`), "Group highlights by" (`CollectionsTab.jsx:296`), "play as one video" (`LockedReasonModal.jsx:51,63,75,86`). Tab name for the same screen is "Finished" elsewhere ("Failed to load highlights" `CollectionsTab.jsx:138`).

### E. Editing modes / steps
| Word | Examples |
|---|---|
| "Spotlight" | `DraftTile.jsx:518,788` "Open in Spotlight"; `Controls.jsx:69` "Play spotlight (loops)"; `FocusPublishActionBar` ADD_SPOTLIGHT_LABEL (constant) |
| "Framing" | `DraftTile.jsx:785` `Open in ${MODE_NAMES.FRAMING}`; `ExportButtonView.jsx:127` (comment) "Generate Framing" |
| "Frame" / "Framed" | `FramingHeaderStatus`, `FramedBanner` (constants) |
| "Focus" | internal only (file/component names FocusPublishActionBar, FocusCompletionRecovery, `onRefocus`); not in inline text. `FocusCompletionRecovery.jsx:163` fallback. |
| "Annotate" | `AttachVideoModal.jsx:154` "appends to this game's timeline in Annotate" (user-facing; the screen is not otherwise described by that word) |
| "Overlay" | not inline. |
| "Editor" | none |

### F. Crop
"Crop Tool" (`CropControls.jsx:29`), "crop keyframes" (`CropControls.jsx:39` "Clear all crop keyframes"), "Move or resize the crop rectangle to create keyframes" (`CropControls.jsx:81`), "The crop will animate smoothly between keyframes during export" (`CropControls.jsx:84`), "Aspect Ratio" (`CropControls.jsx:60`), "Highlight aspect ratio, currently 9:16" (`AspectRatioSelector.jsx:19`), labels "16:9 (Landscape)", "9:16 (Portrait)", "1:1 (Square)", "4:3 (Classic)", "Free" (`CropControls.jsx:17-21`). Note: CropControls appears to be legacy; verify it is still mounted.

### G. Spotlight/circle, text overlay
"spotlight" (`Controls.jsx:69`), "Highlight aspect ratio" (`AspectRatioSelector.jsx:19`, here "Highlight" = the video not the circle), "Highlight" also names the circle in code but not in inline copy. Text overlay: none inline in scope.

### H. Credits / payment
"credits" (everywhere), "Credit pack(s)" (`BuyCreditsModal.jsx:364`), "Buy Credits" (`BuyCreditsModal.jsx:489`, `InsufficientCreditsModal.jsx:92`), "Insufficient Credits" (`InsufficientCreditsModal.jsx:56`), "Creating a highlight costs ..." (`BuyCreditsModal.jsx:117`), "Credits are spent on" (`:119`), "Always free" (`:126`), "plays" as the unit of a pack (`:564`), "Usage history" (`CreditHistoryModal.jsx:101`) vs "credit activity" (`:123,159`), "Balance adjustment" vs "Balance" column, "Signup bonus" vs "Welcome credits" (`CreditHistoryModal.jsx:31-36`), "Admin grant" (`:33`), "Video generation" (`:21-25`), "Storage extension" (`:27`), "Game upload" (`:26`), "Pending" (`:143`), "Payment failed, please send bug report." (`BuyCreditsModal.jsx:284`), "Processing..." (`:308`), "Secure payment by Stripe." (`:473`), "Credits never expire. Secure checkout by Stripe." (`:607`), "Credits purchased! Creating your game..." (`GameDetailsModal.jsx:225`), "{n} credits added to your balance!" (`CreditBalance.jsx:57`), "{balance} credits — click to buy more" (`CreditBalance.jsx:83`).

### I. AI upscaling
No inline occurrences of "upscale/upscaling/AI/enhance". The product vocabulary is "generate/generation/generated" (see A) and "Player detection" (`BuyCreditsModal.jsx:129`).

### J. Uploading
"Upload" ("Upload failed" `AttachVideoModal.jsx:114`, "Upload incomplete" `GameTile.jsx:418`, "Upload didn't finish" `GameTile.jsx:397-398`), "Preparing…" (`AttachVideoModal.jsx:98`), "Adding footage…", "Uploading..." (`introcards/IntroCardRail.jsx:329`), "Discard" vs "Delete for good?" (`GameTile.jsx:478`), "Retry".

### K. Sharing
"Share" (verb/button), "Share game" (`GameTile.jsx:239`), "Share highlights" (`CollectionShareModal.jsx:171`), "Shares sent" (`:149`), "Failed to send share emails" (`:150`), "Copy Link" (`ReelTile.jsx:427,491`, `GlobalExportIndicator.jsx:237`) vs "Copy link" (`CollectionHeader.jsx:123`, `JustPublishedCard.jsx:158,162`), "Link copied to clipboard" (`DraftReelPreview.jsx:226,246`, `GlobalExportIndicator.jsx:250,255`), "Add people" (`CollectionShareModal.jsx:203`), "share link", "Add this game to your account" / "Add to my account" (`ClaimGameView.jsx:167,245`), "Shared game" (`ClaimGameView.jsx:158`), "share" used as noun for the sharing link record (`DraftReelPreview.jsx:27-40`), "Update shared version" (`DraftReelPreview.jsx:221`), "Only you can see this until you get a share link." (`DraftReelPreview.jsx:342`), "Share failed" / "Copy failed" / "Download failed" / "Update failed" (toasts with raw err.message).

### L. Athlete / profile
"Athlete Intro Card" (`introcards/IntroCardCarousel.jsx:99`, `IntroCardsModal.jsx:106`, `IntroCardGrid.jsx:26`, `ConsentGate.jsx:34`), "New card" (`IntroCardCarousel.jsx:207`, `IntroCardGrid.jsx:68`), "Delete card" (`IntroCardGrid.jsx:52`), "Intro" (`CollectionShareModal.jsx:190`, `ReelTile.jsx:432,497`, `IntroStoryPlayer.jsx:219`), "No intro" (`IntroCardCarousel.jsx:173,188`), "profile" ("Manage Profile" `introcards/IntroCardPicker.jsx:227`, `CollectionShareModal.jsx:136` "Manage Profile -> Athlete Intro Card"), "athlete" (`ClaimGameView.jsx:195` "Add to which athlete?"), "Athlete Name" (`introCardEditorConstants.js:60`), "Move to profile…" (`ReelTile.jsx:456,518`), "Position/Class/Team" (`introCardEditorConstants.js:62-64`), "Use profile photo" (`IntroCardRail.jsx:340`), "Photo forward" (`introCardEditorConstants.js:34`).

### M. Team / shared games
"team annotations" / "team plays" / "Team layer" (`ClaimGameView.jsx:225,228`), "Shared game" (`:158`), "game link" (`:147`), "Add this game to your account".

### N. Guidance / coach
"Guidance" (`GuidanceToggle.jsx:11`, `AccountSettings.jsx:169`), "Helpful instructions" (`GuidanceToggle.jsx:57` aria-label, `AccountSettings.jsx:169` "helpful instructions"), "Turn off guidance" (`CompactGuide.jsx:45`, `InstructionCoach.jsx:44`), "Could not save guidance. Try again." (`CompactGuide.jsx:23`, `GuidanceToggle.jsx:63`, `InstructionCoach.jsx:30`), "Got it" (`InstructionCoach.jsx:64`, `LockedReasonModal.jsx:152`), "Scroll down/up to continue" (`FloatingCoach.jsx:328`). Guide copy itself is in the GUIDE constant.

### O. Status words
"Pending" (`CreditHistoryModal.jsx:143`), "Active"/"Linked" (`AccountSettings.jsx:117,166`; `ManageProfiles` out of scope), "Soon" / "Coming soon" (`collections/CollectionHeader.jsx:36,123,134,138,144`; `AccountSettings.jsx:122`), "New" (`ReelTile.jsx:259`), "Expired" ("Game expired — click to extend" `ExpirationBadge.jsx:42`; "Source expired" `DraftTile.jsx:702`), "Just finished" (`JustPublishedCard.jsx:136`), "Upload incomplete" (`GameTile.jsx:418`), "Server is waking up, one moment..." / "Connecting to server..." (`ConnectionStatus.jsx:62,107-108`), "Checking...", "Still loading..." (`CollectionPlayer.jsx:719`), "Loading…" vs "Loading..." (`ClaimGameView.jsx:139` vs `FileUpload.jsx:60`).

### P. Verbs: delete/remove, click/tap, close, etc.
- Delete: "Delete game" (`GameTile.jsx:290`), "Delete" (`ReelTile.jsx:462,524`), "Delete card" (`IntroCardGrid.jsx:52`), "Delete My Account" (`AccountSettings.jsx:161`), "Discard"/"Delete for good?" (`GameTile.jsx:478`). Remove: `FootageList.jsx:240,272,469` aria "Remove {name}", `FootageList.jsx:383` "remove them here". Hide: "Hide from Drafts" (`DraftTile.jsx:534`).
- Confirm pattern: "Click again to confirm" (`DraftTile.jsx:556,802`) vs "Tap again to confirm" (`GameTile.jsx:290`) vs "Delete for good?" (`GameTile.jsx:478`) vs confirm dialogs.
- Click vs Tap: "Click or drag to upload video" (`AttachVideoModal.jsx:200`), "Click again to confirm" (`DraftTile.jsx:556`), "click to extend" (`ExpirationBadge.jsx:42`), "click to buy more" (`CreditBalance.jsx:83`) vs "Tap to choose videos" (`GameFootagePicker.jsx:22`), "Tap again to confirm" (`GameTile.jsx:290`), "Tap the browser menu" (`InstallButton.jsx:84`).
- Download: "Download" everywhere (consistent). "Downloading…" / "Preparing your download… this can take up to a minute" (`CollectionHeader.jsx:172,185`).
- Dismiss / Close / Not now / Cancel: "Dismiss" (`AuthErrorBanner.jsx:23`, `ExportButtonView.jsx:187`, `FocusCompletionRecovery.jsx:179`, `JustPublishedCard.jsx:78`), aria "Close" (many), "Not now" (`ClaimGameView.jsx:253`), "Close" button (`ClaimGameView.jsx:152`).

---------------------------------------------------------------------
## 2. FINDINGS

Legend: INCONSISTENT / JARGON / UNCLEAR / CONTRADICTION / TONE / HARDCODED.

### Top issues (summary)
1. The marked moment has four names in one component family: play, clip, highlight, draft.
2. Credit packs are priced in "plays" (a marked moment), but credits actually buy generated highlights per second.
3. Raw technical error text reaches users (status codes, "Failed to fetch", "Verification failed (500)", raw err.message in toasts).
4. "Backend server" / "Cannot connect to backend server" in the connection banner.
5. "Draft" vs "Highlight" vs "Spotlight" vs "Framing" menu words overlap; "Open as Draft" is unexplained.
6. "Click" vs "Tap" mixed on phone-first surfaces.
7. Same action, different capitalisation/spelling: "Copy Link" vs "Copy link", "Loading…" vs "Loading...".
8. "Generate/generation" for the AI step instead of the outcome ("highlight" or "upscale").
9. Team jargon in sharing: "Team layer", "annotations".
10. Hardcoded strings next to displayNames constants (delete confirm, "Share", "Download").

### A. The marked moment (play / clip / highlight / draft)

1. INCONSISTENT. `BuyCreditsModal.jsx:564` "~{pack.plays} plays" (price pack headline) versus `BuyCreditsModal.jsx:117` "Creating a highlight costs ..." and `BuyCreditsModal.jsx:121` `CREDITS.PAID_HIGHLIGHT`. A pack is sold as "plays", but the thing that costs credits is a generated highlight. A parent reads "~40 plays" as "40 moments I can mark", which are free. Rewrite: "~{n} highlights" (or "~{n} minutes of highlights") with the credit count below.
2. INCONSISTENT. `DraftTile.jsx:634` "Contains {n} highlights" (aria/title) for the count of marked moments inside a project; `DraftTile.jsx:681` "{n} play(s) changed since this highlight was made" in the same tile. Same tile, count of the same thing called "highlights" at 634 and "plays" at 681, and the container is also "highlight". Rewrite: pick "clip" for the marked moment and "highlight" for the finished video: "Contains {n} clips", "{n} clip(s) changed since this highlight was made". (Owner decides final word; the point is one word.)
3. INCONSISTENT. `AttachVideoModal.jsx:154` "your existing clips stay exactly where they are" whereas `GameTile.jsx:397` "your {n} marked plays" and `FileUpload.jsx:48` "mark plays". Parent marks a "play" then is told about "clips". Rewrite: "your marked plays stay exactly where they are" (or the chosen word).
4. INCONSISTENT. `CreditHistoryModal.jsx:38-39` "Clip upload" / "Clip upload refund" (the separate clip-file upload flow) vs `CreditHistoryModal.jsx:37` "Footage added to a game" vs `CreditHistoryModal.jsx:26` "Game upload". Three words (clip, footage, game) for "video I uploaded". Rewrite: "Game video upload", "Video added to a game", "Clip upload" -> match chosen term.
5. CONTRADICTION. `ReelTile.jsx:328` "Rename highlight" and `ReelTile.jsx:450` "Open as Draft": a finished highlight is opened as a "Draft". The two words are used for the same object at different lifecycle moments with no explanation. Rewrite: "Edit again" (or "Re-edit", matching `CollectionPlayer.jsx:611` "Re-edit this highlight").
6. INCONSISTENT. Re-edit action names: `ReelTile.jsx:450,512` "Open as Draft", `CollectionPlayer.jsx:611` "Re-edit this highlight", `DraftTile.jsx:518,788` "Open in Spotlight", `DraftTile.jsx:785` "Open in Framing". Four verbs/destinations for "go back and change this". Rewrite: one pattern, e.g. "Edit highlight" with mode labels only inside the editor.
7. INCONSISTENT. `DraftTile.jsx:534,791` "Hide from Drafts" (title `Hide from Drafts (stays under {SECTION_NAMES.PUBLISHED})`). "Drafts" and "Published" are shown as sections; the Home tab is named "Finished" elsewhere and the toast says "Just finished" (`JustPublishedCard.jsx:136`). Three words (Published / Finished / Done) for one state. Also "Hide" is a surprising word for "move to Finished". Rewrite: "Move to Finished".
8. JARGON. `DraftReelPreview.jsx:221` "This draft changed; reopen it and try Update shared version." Nested terms (draft, reopen, shared version) and a semicolon. Rewrite: "You edited this highlight after sharing. Tap Update link to share the new version."
9. JARGON. `DraftReelPreview.jsx:28` "The re-generated video isn't ready yet; try again shortly." -> "Your new video is still being made. Try again in a minute."
10. JARGON. `DraftReelPreview.jsx:29` "This share changed; refresh and retry." / `:30` "This share does not belong to this project." ("share", "project"). "Project" is never a parent-facing term. Rewrite: "This link was changed. Reload the page and try again." / "This link belongs to a different highlight."
11. JARGON/INCONSISTENT. `DraftReelPreview.jsx:37-40` "That share no longer exists." / "This share was revoked." / "Only the sharer can update this share." / "This share can't be updated this way." "Share" as noun, "revoked", "sharer". Rewrite: "This link no longer works." / "The owner turned this link off." / "Only the person who made this link can update it." / "This link can't be updated."
12. INCONSISTENT. `DraftReelPreview.jsx:284` "Shared version updated"/"Shared version is up to date" vs `DraftReelPreview.jsx:342` "get a share link" vs `CollectionShareModal.jsx:227` "Collection shared". Link/share/version used loosely. Rewrite around "link".
13. TONE. `DraftReelPreview.jsx:321`, `DraftTile.jsx:928` "Couldn't save to the cloud." Reveals infrastructure and the owner's no-"Saved" copy rule is violated by implication. Rewrite: "Not backed up yet. We'll keep trying." (or drop).
14. INCONSISTENT. `GlobalExportIndicator.jsx:266` fallback "Highlight generated" and `:275` "Couldn't generate highlight" vs `ExportButtonView.jsx:172-220` "Monitoring generation via server polling...", "Generation failed: ..." and `CreditHistoryModal.jsx:21-25` "Video generation". "Generation" is the AI step, "highlight" is the result. Rewrite: "Your highlight is ready" / "We couldn't make your highlight. Try again." / "Highlight creation".
15. JARGON. `ExportButtonView.jsx:172` "Monitoring generation via server polling..." Rewrite: "Still working on your highlight..." (users do not know "polling").
16. JARGON/UNCLEAR. `ExportButtonView.jsx:195` "Connection lost. Generation continues on the server. Reconnecting..." Rewrite: "Lost connection. Your highlight is still being made. Reconnecting..."
17. UNCLEAR. `ExportButtonView.jsx:181,203` buttons "Check status" / "Retry connection" -> "Check progress" / "Try again".
18. JARGON + TECHNICAL. `ExportButtonView.jsx:220` "Generation failed: {failedExport.error || 'Unknown error'}" shows backend error text and "Unknown error". Rewrite: "We couldn't make your highlight. Please try again." (keep raw detail behind a help link).
19. JARGON. `ExportButtonView.jsx:291` "Recorded at {sourceFps}fps -- generated at 30fps for a smaller, cheaper file." fps and "--" double hyphen. Rewrite: "Your video was filmed at {fps} frames per second. We make highlights at 30 so the file is smaller and costs fewer credits."
20. TONE. `GlobalExportIndicator.jsx:245` text `Check out my ${projectLabel} highlight!` where projectLabel may be a project name (so "my Rangers vs X highlight highlight"); also fallback `GlobalExportIndicator.jsx:50` "Your highlight". Hardcoded share text diverges from displayNames. Rewrite: "Check out {name}!" (as DraftReelPreview.jsx:242 does with `Check out ${payload.name || 'this highlight'}!`). Inconsistent between two files.
21. INCONSISTENT. Share-link button label: `GlobalExportIndicator.jsx:237` 'Share' (mobile) / 'Copy Link' (desktop); `ReelTile.jsx:427,491` "Copy Link"; `CollectionHeader.jsx:123` "Copy link"; `JustPublishedCard.jsx:158-162` "Copy link". Capitalisation differs (Title vs sentence case). Pick "Copy link".
22. INCONSISTENT. Success toast on copy: `'Link copied to clipboard'` (DraftReelPreview.jsx:226,246; GlobalExportIndicator.jsx:250,255). "clipboard" is computer jargon; rewrite "Link copied". Fine but note "dedupKey" shared.
23. UNCLEAR. `CollectionPlayer.jsx:627` "Re-rank this highlight" and `ReelTile.jsx:273` "Ranked #n of your highlights this season", `LockedReasonModal.jsx:34` "Ranking lets you sort your highlights head-to-head so your best ones show first." "Head-to-head" and "Rank" concepts are new to the parent; "season" is undefined. Rewrite: "Pick your favorites" / "Your #n favorite highlight this season".
24. INCONSISTENT. `LockedReasonModal.jsx:51,75,86` "more {rc} content" (content!) vs `:63` "more {rc} highlights from this game". "Content" is a different word for the same object. Rewrite: "highlights" everywhere.
25. JARGON. `LockedReasonModal.jsx:75`, `RatioUnlockGroup.jsx:10` "cross-game mixes" and "mixes play as one video". "Mix" is unexplained; the rest of the app says collection. Rewrite: "highlights from different games".
26. INCONSISTENT. `RatioUnlockGroup.jsx:9` "game highlights" vs `SmartLockedCard.jsx:7` "top-rated highlights" vs `CollectionShareModal.jsx:186` "top highlights" vs `LockedReasonModal.jsx:21` "smart". Four labels for the auto-collections. "Smart" leaks as a CSS id only (fine) but "top-rated" vs "top" differ.
27. INCONSISTENT. `CollectionShareModal.jsx:171` 'Share highlights' (when no title) vs `GameTile.jsx:239` "Share game" vs `CollectionShareModal.jsx:227` "Collection shared". Surface "collection" appears only in the success line and "this collection" (`:185`); everywhere else the same object is "highlights". Choose either "collection" or "highlight reel"-like name consistently (user's vocabulary memo says reel is reserved for a collection).
28. INCONSISTENT. `CollectionShareModal.jsx:186` "Anyone with this link sees your current top highlights, including new ones you finish later, even if you never shared them." Long, with "finish later". Rewrite: "Anyone with this link sees your best highlights, including new ones you make later."
29. TONE. `CollectionShareModal.jsx:198` "Frozen when you share -- changing this highlight's intro later won't change this link." Double hyphen as dash; "Frozen". Rewrite: "Locked in when you share. Changing the intro later won't change this link."
30. TONE. Double hyphen used as em dash in copy: `GameFootagePicker.jsx:22` ("Tap to choose videos - pick..."), `FootageList.jsx:32,39,40,318,326,363`, `CollectionShareModal.jsx:198`, `ExportButtonView.jsx:291`. Spaced hyphen/double hyphen inconsistent across files; true em dashes in copy: `ExpirationBadge.jsx:42` (title: "Game expired — click to extend"), `CreditBalance.jsx:83` ("{balance} credits — click to buy more"), `GameTile.jsx:301,474` aria, `OtpAuthForm.jsx:168,217` ("Network error — check your internet connection and try again."), `introcards/IntroCardPicker.jsx:305` ("saved to your library, but it is not attached here yet — the previous intro choice would keep playing."), `IntroExposureNotice.jsx:12` ("includes a photo — it will be publicly visible"). Owner rule: no em dashes in content.
31. TONE. `introcards/IntroCardPicker.jsx:227`, `CollectionShareModal.jsx:136` toast "Open your profile menu -> Manage Profile -> Athlete Intro Card to give consent." ASCII arrow "->" as navigation; a long path in a toast. Rewrite: "To give consent, open your profile menu, then Manage Profile, then Athlete Intro Cards."
32. INCONSISTENT. "Athlete Intro Card" (`IntroCardCarousel.jsx:99`) vs "Athlete Intro Cards" modal title (`IntroCardsModal.jsx:106`) vs "intro" everywhere else (`ReelTile.jsx:432` "Intro", `CollectionShareModal.jsx:190` "Intro", `IntroCardGrid.jsx:48` "no intro") vs "card" (`IntroCardGrid.jsx:52` "Delete card", `IntroCardCarousel.jsx:207` "New card", `IntroCardPicker.jsx:317` "Attach card"). Pick "Intro card" (short) and use it everywhere.
33. UNCLEAR. `IntroCardPicker.jsx:304-317` title "Attach your new card?" message "...saved to your library, but it is not attached here yet — the previous intro choice would keep playing." Buttons "Don't attach" / "Attach card". "Library", "attach" are unclear. Rewrite: "Use your new intro card?" / "Your new card is saved but this highlight is still using the old intro." / "Keep old intro" / "Use new card".
34. JARGON. `ConsentGate.jsx:47` "understand it becomes publicly visible to anyone I share a link with." fine for consent but "publicly visible" is legal-ish; acceptable. Note first-person ("I") vs second person elsewhere.
35. TONE. `IntroExposureNotice.jsx:12` "This card includes a photo — it will be publicly visible to anyone ..." em dash.
36. JARGON. `IntroCardRail.jsx:47-49` "On the card" + "The layout adapts to the facts you show." "Facts" is internal data jargon. Rewrite: "Choose what appears on the card."
37. JARGON. `IntroCardRail.jsx:144,148` "Style" / aria "Treatment"; `introCardEditorConstants.js:34` "Photo forward"; `IntroCardRail.jsx:292` "Photo missing"; `:340` "Use profile photo". "Treatment" is design jargon (aria only). "Photo forward" -> "Big photo".
38. JARGON. `IntroCardStage.jsx:149` aria "Aspect preview"; `:211` "Motion preview"; `introCardEditorConstants.js:71-72` "9:16" / "16:9" without Portrait/Landscape. Parents do not know aspect ratio; use "Phone (tall)" / "TV (wide)" with a ratio hint.
39. UNCLEAR. `IntroCardCarousel.jsx:147-149` "Go to consent settings . "No intro" is always available." ("No intro" quoted with curly quotes; link text then sentence fragment).
40. INCONSISTENT. Empty state: `IntroCardCarousel.jsx:136` "No Athlete Intro Cards yet." vs `IntroCardGrid.jsx:26` "No Athlete Intro Cards yet. Create one to open a highlight with your player." (second has the guidance).

### B. Game video / footage / upload

41. INCONSISTENT. Source-video nouns: "game video" (`FileUpload.jsx:48,55`; `GameFootagePicker.jsx:18,31`), "video" (`AttachVideoModal.jsx:101,136,200`, `GameFootagePicker.jsx:22,29`, `GameTile.jsx:238` "Add video"), "footage" (`AttachVideoModal.jsx:242`, `GameFootagePicker.jsx:21`, `CreditHistoryModal.jsx:37`), "recording" (`FootageList.jsx:39`), "film" (`FootageList.jsx:44` "filmed"), "Source video" (`DraftTile.jsx:698-702`), "clips" (`AttachVideoModal.jsx:154`). Same thing, up to seven words. Rewrite: choose "game video" for the long recording and drop "footage".
42. INCONSISTENT. Button in same modal: `AttachVideoModal.jsx:136` title "Add a video" and `:242` button "Add footage" / "Adding footage…". Rewrite: "Add a video" / "Add video".
43. INCONSISTENT. `AttachVideoModal.jsx:154` "Attach another half or angle. It appends to this game's timeline in Annotate" - "Attach", "appends", "timeline", "Annotate" (jargon); modal also titled "Add". Rewrite: "Add another half or camera angle to this game. The plays you already marked stay where they are."
44. INCONSISTENT. `AttachVideoModal.jsx:200` "Click or drag to upload video" vs `GameFootagePicker.jsx:22` "Tap to choose videos - pick as many as you want". Click vs Tap; "upload" vs "choose". Phone-first: "Tap to choose a video".
45. INCONSISTENT. `AttachVideoModal.jsx:200` "Drop video here" vs `GameFootagePicker.jsx:18` "Drop any game video here." vs `GameFootagePicker.jsx:21` "Drop footage to add to this game." vs `GameFootagePicker.jsx:23` "Drop everything here".
46. TONE. `FileUpload.jsx:65` "Select Video File" (Title Case, "File" jargon) vs `AttachVideoModal.jsx:242` sentence case "Add footage". Rewrite: "Choose game video".
47. JARGON. `FileUpload.jsx:70` "Supports MP4, MOV, and WebM formats" and `AttachVideoModal.jsx:201` "MP4, MOV, or WebM". Format list is jargon for non-technical parents; keep but reword: "Works with most phone and camera videos (MP4, MOV, WebM)".
48. JARGON. `FootageList.jsx:363` "Photos and helper files the camera makes - not game video." ("helper files"); `FootageList.jsx:318,326` radio answers "No - two parts of one game" / "Yes - two cameras at once". Question text unclear without context; "angles" (`:44`) vs "cameras" (`:326`). Rewrite: pick "cameras".
49. TONE. `FootageList.jsx:32` "We couldn't tell what order these go in - please check" and `FootageList.jsx:40` "We put them in order by their names - check this looks right": friendly; fine. But `FootageList.jsx:39` "These look like two parts of one recording - put in order by their names" (garbled: sounds like an instruction). Rewrite: "These look like two halves of one game, so we put them in order by name."
50. INCONSISTENT. `GameFootagePicker.jsx:31` "We didn't find any game videos in there. Look for MP4 or MOV files from your camera." ("in there", "files") fine but `GameFootagePicker.jsx:29` "Checking your videos..." ellipsis ASCII "..." vs `AttachVideoModal.jsx:98` "Preparing…" real ellipsis vs `ClaimGameView.jsx:139` "Loading…". Mixed "..." and "…".
51. TECHNICAL. `AttachVideoModal.jsx:114-115` `err?.message || 'Upload failed'` / "Failed to add video". Raw error message displayed. Rewrite: "We couldn't add that video. Please try again."
52. INCONSISTENT. `GameTile.jsx:397` "Upload didn't finish. Retry to keep your {n} marked play(s)." vs `GameTile.jsx:418` "Upload incomplete" vs `GameTile.jsx:398` "Upload didn't finish. Retry to resume, or discard." vs `GameTile.jsx:478` "Discard" / "Delete for good?" Mixed "Discard"/"Delete"/"for good". Rewrite: one verb: "Delete game" with confirm "Delete for good?" at both places.
53. INCONSISTENT. `GameTile.jsx:290` "Tap again to confirm" vs `DraftTile.jsx:556` "Click again to confirm". Same pattern, different verb, both on touch devices.
54. UNCLEAR. `GameTile.jsx:251` "Generated everything already? Skipping is fine. Plays stay playable." Context: Keep-only-plays sheet caption. "Generated" (made highlights) and "Skipping" are unclear. Rewrite: "Already made all your highlights? You can delete the rest of the video and still watch your marked plays."
55. UNCLEAR. `GameTile.jsx:246` "Extend storage" vs `ExpirationBadge.jsx:42` "Game expired — click to extend". "Extend" in one place, "Expires" in the other; unit not explained. Rewrite: "Keep game longer".
56. UNCLEAR. `ExpirationBadge.jsx:29` "Game video permanently deleted" -> "This game video is gone. Your marked plays are kept." (verify).
57. JARGON. `GameTile.jsx:338-339` "ReelBallers" placeholder + "No poster". "Poster" is video jargon; use "No preview".
58. JARGON. `GameTile.jsx:28-29` `GAME_CARD.BRILLIANT_COUNT` surfaces "brilliant" count; "Brilliant" is a rating word presumably from Annotate; not defined on the tile. (Constant; note surface.)
59. UNCLEAR. `GameDetailsFields.jsx:6-9` options "Unknown / Home / Away / Tournament" labelled with no field label shown in grep (ok), `GameDetailsFields.jsx:110` "Tournament Name" Title Case vs placeholder `:61` "e.g., Carlsbad SC" ("e.g.," punctuation style) vs `:122` "Select or type new tournament". Mixed Title/sentence case.
60. TONE. `GameDetailsModal.jsx:352` "Game details (optional)" / `:358` "Filled in from your video's file name. Check it's right." / `:359` "You can add an opponent and game date later." Good tone; note "file name" jargon.
61. TECHNICAL. `GameDetailsModal.jsx:172` "Couldn't save your sport. Please try again." (uses "save", contrary to no-"Saved" UI copy for confirmations; fine for errors). `EditGameModal.jsx:59` `err.message || 'Failed to update game'` raw message; `EditGameModal.jsx:34` throws `HTTP ${status}`, surfaced via toast. Rewrite: "We couldn't update the game. Please try again."
62. INCONSISTENT. `EditGameModal.jsx:93` "Edit Game Details" (Title Case) vs `GameDetailsModal.jsx:352` "Game details (optional)" (sentence case); toast `EditGameModal.jsx:56` "Game updated".
63. INCONSISTENT. `GameDetailsModal.jsx:225` toast "Credits purchased! Creating your game..." vs `LIBRARY_ACTIONS.UPLOADING_GAME`. "Creating your game" is wrong mental model (it uploads a video). Rewrite: "Credits added! Uploading your game..."
64. INCONSISTENT. `LinkClipToGameModal.jsx:117` "Untitled game" vs `ClaimGameView.jsx:158` "Shared game" fallbacks vs `GameTile` name. fine; note "Link clip to game" (constants CLIP_LINK) uses "clip" again.

### C. Auth / account / credits

65. TONE. `AuthGateModal.jsx:88` title "Create your first video" (it is a sign-in gate; the thing is a highlight) and `:96` "Sign in to get started. Your annotations are saved and waiting." "annotations" = marked plays in other places; also implies "saved" copy. Rewrite: "Sign in to see your highlights" / "Your marked plays are waiting for you."
66. JARGON. `AuthGateModal.jsx:111-112` "Google sign-in unavailable. An ad blocker or browser setting may be blocking it. Use email sign-in below instead." OK; but `AuthGateModal.jsx:65` console text is not user-visible.
67. TECHNICAL. `auth/OtpAuthForm.jsx:160` `Failed to send code (${res.status})`, `:210` `Verification failed (${res.status})`, `BuyCreditsModal.jsx:194` `Verification failed (${res.status})`, `:398` `Failed to create payment (${intentRes.status})`, `:426` `Checkout failed (${res.status})`. Status codes shown to users. Rewrite: "We couldn't send the code. Please try again."
68. INCONSISTENT. `auth/OtpAuthForm.jsx:168,217` "Network error — check your internet connection and try again." (em dash) vs `ConnectionStatus.jsx:76` "Cannot connect to backend server".
69. TONE. `auth/OtpAuthForm.jsx:270` "Send Code" / `:303` "Resend code" / `:312` "Use different email": Title vs sentence case; "Use different email" lacks "a". Rewrite: "Send code", "Send a new code", "Use a different email".
70. TONE. `auth/OtpAuthForm.jsx:246` "Email address", placeholder `:251` "your@email.com" fine.
71. JARGON. `ConnectionStatus.jsx:64,76,78,123` "Backend server is not running", "Cannot connect to backend server", "Backend server unavailable", "Server error: {status}", "Connection timeout - backend not responding". "Backend" and status codes are developer text shown to parents. Rewrite: "We can't reach ReelBallers right now. Check your internet and try again."
72. TONE. `ConnectionStatus.jsx:62,107` "Server is waking up, one moment..." ok but "Connecting to server..." -> "Connecting...".
73. INCONSISTENT. `AccountSettings.jsx` title "Account Settings" (Title Case), "Google Account", "Delete My Account", "Sign Out" (Title Case), "Not signed in", "Signed in with email code", "Do Not Sell or Share" (legal phrase, fine), "Your Privacy Rights". Mixed with sentence-case in "Use the Guidance switch ...". Pick one case.
74. UNCLEAR. `AccountSettings.jsx:122` title "Coming soon" on "Link Account"; `:124` "Link Account" button disabled. 
75. TONE. `AccountSettings.jsx:105` "Signed in with email code" -> "Signed in with email".
76. TECHNICAL. `AccountSettings.jsx:45` `throw new Error('Export failed')` (data export) - and "Export" here means downloading personal data, conflicting with the product's older use of "export" for making a video.
77. UNCLEAR. `AccountSettings.jsx:169` "Use the Guidance switch at the top of the app to turn helpful instructions on or off." Two names: "Guidance" and "helpful instructions" (aria-label `GuidanceToggle.jsx:57`). Pick "Guidance".
78. INCONSISTENT. `CreditHistoryModal.jsx:101` "Usage history" vs `:123` "No credit activity yet." vs `:159` "Showing your most recent credit activity." vs table column "Activity". Rename title to "Credit history" (file name already CreditHistoryModal).
79. INCONSISTENT. `CreditHistoryModal.jsx:31-36` "Welcome credits" vs "Signup bonus" for same grant types (quest_reward vs new_account_bonus); `:33` "Admin grant" and `:40` "Balance adjustment" are internal terms. Rewrite: "Bonus credits from ReelBallers".
80. INCONSISTENT. `CreditHistoryModal.jsx:21-25` "Video generation" vs `:22` "Generation refund": use "Highlight" instead of "Video generation".
81. TONE/TECHNICAL. `CreditHistoryModal.jsx:71` `Failed to load history (${res.status})` shown via setError.
82. TONE. `CreditBalance.jsx:83` title "{balance} credits — click to buy more" (em dash, "click"); `:57` "{n} credits added to your balance!" fine.
83. INCONSISTENT. `InsufficientCreditsModal.jsx:56` title "Insufficient Credits" (Title Case, formal) vs `:92` "Buy Credits" vs `BuyCreditsModal.jsx:489` "Buy Credits" vs "How credits work" (sentence case). Rewrite: "Not enough credits" / "Buy credits".
84. JARGON. `InsufficientCreditsModal.jsx:35` "This generation requires {n} credits for {len} of video ({CREDITS.PER_SECOND_RULE})." Rewrite: "This highlight needs {n} credits ({len} of video)."
85. JARGON. `BuyCreditsModal.jsx:129` "Player detection" listed under "Always free" - undefined feature name (and "AI" is never named). Also AI-capability copy rule: no autonomous-tracking claim; this phrase implies the app detects players. Rewrite: "Finding your player in the video" or remove.
86. INCONSISTENT. `BuyCreditsModal.jsx:130-131` "Downloads & sharing" and "Storing your generated highlights" vs `:128` `CREDITS.FREE_OVERLAY` (constant) vs `:123` "Storing a game". "generated highlights" vs "Creating a highlight" vs "highlights" mix. Rewrite: "Saving your finished highlights".
87. TONE. `BuyCreditsModal.jsx:284` "Payment failed, please send bug report." Comma splice and "bug report" for parents; no action given. Rewrite: "Payment didn't go through. Please try again or contact support."
88. TECHNICAL. `BuyCreditsModal.jsx:168,179,218,406,440` shows `submitError.message`, `confirmError.message` (raw Stripe errors) and `err.message`; `:229` 'Verification failed'. 
89. INCONSISTENT. `BuyCreditsModal.jsx:73-76` pack labels "Starter", "Popular", "Best Value" with badges "Most Popular", "Best Value" (the badge repeats the label for best_value).
90. TONE. `BuyCreditsModal.jsx:473` "Secure payment by Stripe." and `:607` "Credits never expire. Secure checkout by Stripe." (credits never expire repeated at `:134` in explainer).
91. HARDCODED. `BuyCreditsModal.jsx:136-139` heading "How long things are kept:" (hardcoded) with constants RETENTION.*; `:118` "Credits are spent on:" with hardcoded "Storing a game:" `:122` while CREDITS has PAID_HIGHLIGHT. Mixed constant and inline in one list.
92. UNCLEAR. `BuyCreditsModal.jsx:117` "Creating a highlight costs {PER_SECOND_RULE}" (rule text in constants) — fine, but CREDITS.PAID_RECREATE "re-create" adds another verb (see constants sweep).

### D. Sharing a game / ClaimGameView

93. JARGON. `ClaimGameView.jsx:225,228` "Include team annotations" / "Adds the shared team plays to your Team layer. The game is always added." "annotations", "Team layer" are internal. Rewrite: "Include the plays the team marked" / "You'll see the team's marked plays next to yours."
94. INCONSISTENT. `ClaimGameView.jsx:167,184` "Add this game to your account" vs `:172` "Sign up to add this game" vs `:245` "Add to my account" vs `ClaimGameView.jsx:126` "Could not import this game." ("import" vs "add"). Rewrite: always "add".
95. TONE. `ClaimGameView.jsx:131` "Something went wrong. Please try again." (generic), `:146-147` "This link is no longer active." / "This game link could not be found." (fine), `:195` "Add to which athlete?" (good, but "athlete" vs "profile" elsewhere), `:253` "Not now" vs `:152` "Close".
96. INCONSISTENT. "athlete" (`ClaimGameView.jsx:195`) vs "profile" (`IntroCardPicker.jsx:227`, `CollectionShareModal.jsx:136`, `ReelTile.jsx:456` "Move to profile…") vs "Athlete Name" (`introCardEditorConstants.js:60`). The profile object is called athlete in some places and profile in others (Manage Profiles modal is out of scope).

### E. Mode/screen names and in-editor controls

97. JARGON/INCONSISTENT. `Controls.jsx:69` "Play spotlight (loops)" vs `:162` "Fullscreen"; `Controls.jsx:86,130` "Step backward (one frame)" / "Step forward (one frame)" ("frame" here means video frame; "Frame" is also the mode verb) and `:120` "Restart (go to beginning)". Collision of "frame" (the mode) with "(one frame)". Rewrite: "Back a moment" / "Forward a moment", or "Back 1 frame" only for advanced users.
98. INCONSISTENT. `Controls.jsx:162` "Exit fullscreen (Esc)" and `CollectionPlayer.jsx:655` "Exit fullscreen" vs `:645` "Pause"/"Play". Fine; note "(Esc)" is keyboard only, phone users lack Esc.
99. JARGON. `CropControls.jsx:39,81,84` "keyframes" ("Clear all crop keyframes", "create keyframes", "animate smoothly between keyframes during export"). "Keyframe" is editor jargon, and "export" is again the old word. Rewrite: "Reset crop" / "Move or resize the box to follow your player" (be careful of AI-capability copy: the user frames, the app does not track) / "The crop will move smoothly between your marks when we make your highlight."
100. JARGON. `CropControls.jsx:17-21` "16:9 (Landscape)", "9:16 (Portrait)", "1:1 (Square)", "4:3 (Classic)", "Free"; `CropControls.jsx:29` "Crop Tool", `:60` "Aspect Ratio" (Title Case). `AspectRatioSelector.jsx:19` aria "Highlight aspect ratio, currently 9:16" - "Highlight" here is the finished video (consistent with highlight = finished video) but conflicts with "highlight" = marked moment in `DraftTile.jsx:634`. Check whether CropControls is still mounted (possibly dead UI).
101. TONE. `CropControls.jsx:81` "<strong>Tip:</strong> Move or resize the crop rectangle to create keyframes." "rectangle" -> "box".
102. INCONSISTENT. `ExportButtonView.jsx:127` comment "primary CTA is 'Generate Framing'" (a comment, but suggests the button label history) vs `FOCUS_PREVIEW.*`. Not user-visible; skip.
103. INCONSISTENT. `DraftTile.jsx:518,788` "Open in Spotlight" (hardcoded) vs `:785` `Open in ${MODE_NAMES.FRAMING}` (constant) in the same component. HARDCODED. Use `MODE_NAMES.OVERLAY` (or whatever the Spotlight mode is) for symmetry.
104. HARDCODED. `DraftTile.jsx:556,802` 'Click again to confirm' and `GameTile.jsx:290` 'Tap again to confirm' duplicate the same confirm pattern inline; `DraftTile.jsx:507` "Rename", `:528` "Download" inline while `:397-399` use `LIBRARY_ACTIONS.RENAME_CLIP` / `DELETE_CLIP` / `PUBLISH_CLIP`: constants say "clip" while inline text says "highlight" (e.g. `ReelTile.jsx:328` "Rename highlight"). HARDCODED divergence from constants `LIBRARY_ACTIONS.RENAME_CLIP` (check displayNames: constant name says CLIP; visible words may differ).
105. HARDCODED. `ReelTile.jsx:328-329` "Rename highlight" vs `DraftTile` `LIBRARY_ACTIONS.RENAME_CLIP`; `ReelTile.jsx:365-366,371,423,487` "Share" inline; `ReelTile.jsx:416,483` "Download", `:441,504` "Before / After" (unclear: what is before/after? Presumably compare original vs upscaled; "Before / After" is shown without explanation).
106. HARDCODED. `GameTile.jsx:235` 'Watch plays', `:238` 'Add video', `:239` 'Share game', `:246` 'Extend storage' inline next to `LIBRARY_ACTIONS.KEEP_ONLY_PLAYS` / `RESTORE_FULL_VIDEO` (line 241-242) in the same menu array. Mixed constants and inline in one list. Also "Delete game" `:290`.
107. HARDCODED. `GlobalExportIndicator.jsx:266,275` fallback 'Highlight generated' / "Couldn't generate highlight" vs `completeVocab.completed` constant; `GlobalExportIndicator.jsx:79` 'Less than a minute'; fallback strings duplicate `EXPORT_JOBS.*` copy and may diverge.
108. HARDCODED. `CollectionPlayer.jsx:579` title "Share", `:719` 'Still loading...', `:724,727` 'Sign in' / 'Retry', `:611` "Re-edit this highlight", `:627` "Re-rank this highlight" inline vs `LIBRARY_ACTIONS.PUBLISH_REEL` constant two lines above (`:562`) in the same toolbar.
109. HARDCODED. `CollectionHeader.jsx:115,129` "Play all", `:123` "Copy link" / "Copy link (coming soon)", `:134-144` "Coming soon" - inline; and "Soon" `:36`. "(coming soon)" shipped in UI as disabled items - confusing for parents ("Soon").
110. TONE. `CollectionHeader.jsx:172,185` "Downloading…" / "Preparing your download… this can take up to a minute" good plain language; keep.
111. UNCLEAR. `CollectionHeader.jsx:211` title "An intro plays before this collection" vs `ReelTile.jsx:282,293` "An intro plays before this highlight": collection vs highlight; `CollectionHeader.jsx:243` "Some highlights have no recorded duration" ("recorded duration" jargon).
112. INCONSISTENT. `CollectionsTab.jsx:138` "Failed to load highlights" (tab is "Finished"/collections, error says "highlights", plus "Failed to load" technical) + `:29` "By game / By tournament / By month" + `:296` aria "Group highlights by". Rewrite: "We couldn't load your highlights. Try again."
113. UNCLEAR. `collections/DurationBudgetSlider.jsx:20,29` "Max" and aria "Maximum highlight length": here "highlight" = a collection that plays as one video; label "Max" alone is unclear. Rewrite: "Up to {n} min".
114. UNCLEAR. `collections/LockedCollectionCard.jsx:35` "Why is this locked?" and `LockedReasonModal` copy ("Add about {x} more ... then ... plays as one video") fine; "unlock" language: `RatioUnlockGroup.jsx:9-10` "Add more highlights to unlock game highlights" repeated word "highlights" twice with two senses (clip vs collection). Rewrite: "Add more highlights to unlock your game collections."
115. TONE. `JustPublishedCard.jsx:136` "Just finished" vs `:78,79` "Dismiss" vs `:124` "Play" vs `:158,168` "Copy link", "Download": consistent; but the file name says Published, label says Finished (see #7).
116. JARGON. `BrandedEndCard.jsx:23` "Made With" (Title Case), `:49` "Make your own highlights at www.reelballers.com" — consistent with highlight = finished; fine. Missing the AI-upscale value claim; no issue.
117. UNCLEAR. `FocusCompletionRecovery.jsx:163` fallback "Your highlight" + `:179` "Dismiss"/`:167` "View" buttons: "View" vs "Watch" (`DraftTile.jsx:781` `RESULT_SURFACE.WATCH_HIGHLIGHT`). Inconsistent verbs for opening a finished video: View / Watch / Play / Preview (`DraftTile.jsx:888`).
118. INCONSISTENT. Open-finished verbs: "Watch plays" (`GameTile.jsx:235`), "Watch highlight" constant, "Watch marked plays" (`RESULT_SURFACE.WATCH_MARKED_PLAYS`), "View" (`FocusCompletionRecovery.jsx:167`), "Play" (`JustPublishedCard.jsx:124`, `CollectionHeader.jsx:115` "Play all"), "Preview" (`DraftTile.jsx:888`). Pick Watch.

### F. Guidance / coach / install

119. INCONSISTENT. "Guidance" (`GuidanceToggle.jsx:11`), "Helpful instructions" (`GuidanceToggle.jsx:57`, `AccountSettings.jsx:169`), "Turn off guidance" (`CompactGuide.jsx:45`, `InstructionCoach.jsx:44`), "coach" (code only), "Got it" (`InstructionCoach.jsx:64`, `LockedReasonModal.jsx:152`). One name: "Guidance".
120. TONE. `CompactGuide.jsx:23`, `GuidanceToggle.jsx:63`, `InstructionCoach.jsx:30` "Could not save guidance. Try again." -> "Couldn't change guidance. Try again." Note the contraction mismatch: "Could not" here vs "Couldn't" in `DraftReelPreview.jsx:321`, `GameDetailsModal.jsx:172`, `GlobalExportIndicator.jsx:275`; "Could not" also at `ClaimGameView.jsx:126`, `BuyCreditsModal.jsx:364`, `IntroCardEditorContainer.jsx:51,55,129`, `IntroCardPicker.jsx:152,182`. Mixed "Could not"/"Couldn't"/"Failed to"/"Cannot".
121. INCONSISTENT. Error phrasing across scope: "Failed to ..." (`AttachVideoModal.jsx:115`, `EditGameModal.jsx:59`, `CollectionsTab.jsx:138`, `CollectionShareModal.jsx:81,150`, `OtpAuthForm.jsx:160,169`, `CreditHistoryModal.jsx:71`), "Could not ..." (above), "Couldn't ..." (above), "... failed" ("Upload failed", "Copy failed", "Share failed", "Download failed", "Update failed", "Verification failed", "Checkout failed", "Payment failed"). Pick "We couldn't ..." everywhere.
122. UNCLEAR. `InstallButton.jsx:38` "Install App", `:48` "Install ReelBallers", `:72` "Add to Home Screen", `:82` "Install the App", `:77,85` quotes. "App" vs "ReelBallers"; fine but title/heading differ; Title Case.
123. TONE. `FloatingCoach.jsx:328` "Scroll down to continue" / "Scroll up to continue" fine.
124. TONE. `ImpersonationBanner.jsx:30` "Stop impersonating" (admin-only; skip).

### G. Misc style notes
125. Case: Title Case buttons ("Select Video File", "Send Code", "Buy Credits", "Delete My Account", "Sign Out", "Edit Game Details", "Manage Profiles"-out-of-scope, "Copy Link", "Delete Profile") vs sentence case ("Add footage", "Copy link", "Add to my account", "Delete game", "Use different email", "Resend code"). Pick sentence case.
126. Ellipsis: "..." (`FileUpload.jsx:60`, `GameFootagePicker.jsx:29`, `BuyCreditsModal.jsx:308`, `ConnectionStatus.jsx:62`, `ExportButtonView.jsx:172,181`, `CollectionPlayer.jsx:719`, `IntroCardRail.jsx:329`) vs "…" (`AttachVideoModal.jsx:98,242`, `ClaimGameView.jsx:139,245`, `CollectionHeader.jsx:172,185`, `ReelTile.jsx:456,518`).
127. Dashes as separators: ` - ` hyphen (`FootageList`, `GameFootagePicker.jsx:22`, `ConnectionStatus.jsx:74`), `--` (`ExportButtonView.jsx:291`, `CollectionShareModal.jsx:198`), `—` (see #30).
128. "e.g.," placeholders: `GameDetailsFields.jsx:61` "e.g., Carlsbad SC" and `IntroCardRail.jsx:231` "e.g. State Cup 2027" (comma mismatch).
129. Placeholder/format: `AccountSettings.jsx:186` placeholder 'Type "DELETE" to confirm' fine.
130. "Remove" aria vs "Delete" visible: `FootageList.jsx:240,272,469` aria "Remove {name}" removes from the upload list (does not delete) - fine, but the sentence at `:383` "remove them here and upload that game separately" is consistent.
131. Stripe: "Secure payment by Stripe." twice in same modal (`:473`, `:607`).
132. Admin/dev text found in user-facing files (ignore per scope): `ImpersonationBanner.jsx:30`, `CreditHistoryModal.jsx:33` "Admin grant" (user-visible in history table; internal term to parents).

---------------------------------------------------------------------
## 3. Suggested glossary (for the owner to decide; one word per concept)
- Marked moment: "play" (parent says "mark a play") until it becomes an edit; then it is a "clip" only if clip is truly different. Today the inline copy uses play/clip/highlight/draft for it.
- Finished video: "highlight". Collection: "collection" (not "mix", "reel", "content").
- AI step: say "making your highlight" (not "generation", "export", "polling", "framing job").
- Confirm pattern: "Tap again to confirm" everywhere.
- Errors: "We couldn't X. Please try again." with no status codes or raw messages.
- Share: "link" (not "share" as a noun, not "shared version").
- Case: sentence case; "…" real ellipsis; no em dashes or `--`.
