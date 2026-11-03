# F: gap-fill pass (new material only)

Coverage stats: the two candidate lists hold 380 lines (266 components, 114 modes/screens). About 85 distinct visible strings survived after dropping code comments, class names and props; about 62 were already in B/C/D (checked by grep on a phrase from each). 23 were not recorded and appear below. The 10 high-traffic files were read via a comment-stripped string extraction (all literals, JSX text, title/label/aria/description attrs), not a literal line-by-line read of every code line. Paths are relative to src/frontend/src.

## (a) New findings

| # | Verbatim | file:line | Cat | Why | Suggested rewrite |
|---|---|---|---|---|---|
| F1 | "Highlight boundaries changed since this video's Focus export. Overlay edits will apply to the old crop." + button "Re-run Focus" | modes/OverlayModeView.jsx:961,967 | INCONSISTENT / JARGON | Uses retired "Focus" (header verb is Frame, mode noun Framing) and "Overlay" (step is Spotlight), "export" (elsewhere "Generate"), "Highlight boundaries" (means the play's start/end), "crop". The button is the only live "Re-run" wording. | "You changed this play's start or end after framing. Your spotlight edits still use the old framing." Button: "Redo Framing" |
| F2 | "Made with the old multi-highlight builder. You can still finish, download and share these, but they can no longer be re-edited in Focus." | components/ProjectManager.jsx:2476-2477 | INCONSISTENT / JARGON | "Focus" retired; "multi-highlight builder" is internal history; "highlight" here means a clip. | "These were made with an older version. You can still finish, download and share them, but you can't edit them in Framing anymore." |
| F3 | "1 play changed since this highlight was made - re-generate to update it" / "{n} plays changed since this highlight was made - re-generate to update them" | components/DraftTile.jsx:678-681 | TONE/STYLE / INCONSISTENT | Hyphen used as a dash; "re-generate" is a fourth word for the redo action (Generate / Export / Re-created / Rebuild); the aria-label drops the instruction. | "1 play changed since this highlight was made. Generate again to update it." |
| F4 | "This is the original combined recap from before Team and {athlete} recaps existed — it plays every rated clip together. Per-clip skipping and the player filter aren't available for this game." | components/RecapPlayerModal.jsx:456-458 | UNCLEAR / TONE/STYLE | Release-history explanation, em dash, "rated clip" (clip vs play), "player filter" undefined. | "This is an older combined recap that plays every rated play together. Skipping plays and filtering by player aren't available for this game." |
| F5 | "This game's video is no longer available." and "This game's video is no longer available{ (storage expired)}. The annotation details are still listed." | components/RecapPlayerModal.jsx:479, 604-606 | INCONSISTENT / JARGON | Two different wordings for the same state in one file; "annotation details" is a third word for plays; "storage expired" appears only in one. | Both: "This game's video has expired, but your marked plays are still listed." |
| F6 | "Added {n} highlight(s) ({c} credit(s))" | components/ProjectManager.jsx:1263 | INCONSISTENT | The Add Video (direct clip upload) flow calls the new item a "highlight"; the same item is a "clip"/"play" on Annotate and a "Clip" in the Clips tab. Also "credit" while SECTION/pricing copy says credits elsewhere (ok). | "Added {n} clip(s)" or match tab name "Added {n} to Clips" |
| F7 | "This game is no longer in {ownerLabel}." | components/ProjectManager.jsx:1554 | UNCLEAR | Reads as a location error; the user does not know whose game was moved or why. | "{ownerLabel} removed this game, so it is no longer shared with you." (confirm actual cause) |
| F8 | "The selected file \"X\" has a different name than the original \"Y\".\n\nIf this is the same video file (just renamed), click OK to continue.\nIf this is a different file, click Cancel and select the correct file." (window.confirm) | screens/ProjectsScreen.jsx:367-369 | TONE/STYLE | "click OK/Cancel" on a phone-first product (Tap), native confirm dialog, long. | Use the app's ConfirmationDialog: "This file has a different name than the one you started with. Is it the same video?" [Yes, continue] [Pick another] |
| F9 | "This upload requires {n} credit(s) for 30 days of storage." | screens/ProjectsScreen.jsx:473 | JARGON | "requires" is stiff; "storage" vs "Extend storage" elsewhere is consistent but "30 days" is hard-coded text (HARDCODED duration). | "Adding this game costs {n} credit(s) and keeps it for 30 days." |
| F10 | "Add a spotlight on the timeline to tune its color, shape, and dimming here." | components/settings/OverlaySpotlightPanel.jsx:325 | UNCLEAR | "tune ... dimming" is technical; "on the timeline" not a place a parent has located. | "Add a spotlight to change its color, shape and how much the rest of the video is dimmed." |
| F11 | "Highlight started - find it on the Clips tab" / "Create highlight" button / "Create a draft highlight from this moment" / "This highlight is already a draft" | components/RecapPlayerModal.jsx:266,507-513,682 | INCONSISTENT | One object named "highlight", "draft highlight", "draft" and "moment" in four adjacent strings; "Clips tab" while the verb/noun is highlight. | Pick one: "Clip started. Find it in Clips." button "Make highlight" |
| F12 | "Upload didn't finish. Retry to keep your {n} marked play(s)." / "Upload didn't finish. Retry to resume, or discard." | components/GameTile.jsx:397-398 | INCONSISTENT | Good plain copy, but the same state is "Upload incomplete" (badge), "Upload didn’t finish." (ProjectManager.jsx:1861, curly apostrophe) and "Upload failed" elsewhere. Mixed straight (') and curly (’) apostrophes within the same flow. | Standardize on "Upload didn't finish" and one apostrophe style |
| F13 | "Delete for good?" / aria "Confirm discard of {game} - this permanently deletes it and its highlights" | components/GameTile.jsx:478,474 | INCONSISTENT | Button says "Discard", confirm says "Delete for good?"; the other tile uses "Tap again to confirm" (GameTile.jsx:290) and DraftTile "Click again to confirm" (DraftTile.jsx:802). Three confirm phrasings, Click vs Tap. | One pattern: "Tap again to confirm" (all surfaces) |
| F14 | "Click again to confirm" | components/DraftTile.jsx:802 | TONE/STYLE | "Click" vs "Tap again to confirm" on GameTile.jsx:290 (same gesture, same app). | "Tap again to confirm" |
| F15 | "Hide from Drafts (stays under Finished)" tooltip / menu "Hide from Drafts" | components/DraftTile.jsx:534,791 | INCONSISTENT | "Drafts" is a noun no tab uses (tabs are Games / Clips / Finished); the tile list is the "Clips" tab. | "Move to Finished" or "Hide from Clips" |
| F16 | "Tag your athlete’s plays" / "This game is on your Team layer — open Mark Plays to tag your own athlete." | components/ProjectManager.jsx:1477-1478 | JARGON / TONE/STYLE | "Team layer" is an internal concept (layers); em dash. | "Tag your athlete's plays" / "This is a team game. Open Mark Plays to tag your own athlete." |
| F17 | "Anyone with the share link can see this card." and "No {label} on this profile yet. Add it." | components/introcards/IntroCardRail.jsx:72-74,189 | UNCLEAR | "card" vs "Athlete Intro Card" vs "Intro" naming; "Add it" is a bare button with no object; "share link" vs "link" elsewhere. | "Anyone with the link can see this intro card." / "Add {label}" |
| F18 | "Each teammate gets a link to claim these highlights. The link can be forwarded - anyone who opens it can claim the highlights, so it is not locked to the email address you enter." | components/ShareWithTeammatesModal.jsx:234-236 | TONE/STYLE | Hyphen as dash; "claim" is a rare verb for parents ("get"); "highlights" here are marked plays/clips. | "Each teammate gets a link to add these to their account. Anyone with the link can use it, so it isn't tied to the email you enter." |
| F19 | "All tagged teammates have been shared with" | components/ShareWithTeammatesModal.jsx:330 | UNCLEAR | Dangling preposition, no sentence end. | "You've shared with all tagged teammates." |
| F20 | "Anyone you've already shared the link with will lose access. People you added above keep their access. You can create a new link later, but it will be a different URL." | components/ShareGameModal.jsx:166-169 | JARGON | "URL" for a link everywhere else; otherwise fine. | "...but it will be a different link." |
| F21 | "Once you've generated everything you need from a game, it's fine to let it expire. Your annotations stay playable after it's gone." | components/StorageExpiryBanner.jsx:44-45 | INCONSISTENT | "generated" and "annotations" (vs plays/marked plays); GameTile.jsx:251 says "Generated everything already? Skipping is fine. Plays stay playable." Same message, two wordings. | Use GameTile wording in both |
| F22 | "Extend by:" | components/StorageExtensionModal.jsx:149 | UNCLEAR | No unit in the label (slider shows credits/days elsewhere). | "Add storage time" |
| F23 | "Signing you in..." | components/SignInScreen.jsx:83 | TONE/STYLE | Three-dot ASCII ellipsis vs "…" (Downloading… in ReelTile.jsx:139); mixed ellipsis styles app-wide. | Pick one character |

Smaller notes (visible, not recorded elsewhere):
- Tooltip / aria strings never recorded: "Fullscreen video", "Expand video to fullscreen" (FocusModeView.jsx:893-894, OverlayModeView.jsx:802-803), "Open settings" (FocusModeView.jsx:1052), "Open spotlight settings" (OverlayModeView.jsx:1309), "Play highlight" (OverlayModeView.jsx:625), "Reset to the start" (:637), "Switch to Pan/Zoom mode" / "Switch to Crop mode" (FocusModeView.jsx:1012), "More actions" (DraftTile.jsx:817, GameTile.jsx:512, ReelTile.jsx:385). "Crop" appears in the Frame mode where a parent would say "frame"; "Play highlight" in Spotlight plays the whole thing (use "Play full video").
- "Adjust the timing, rating, and tags for this play." (AnnotateModeView.jsx:1367) is fine; tooltip "Source video expired — cannot mark plays" (:1368) has an em dash and "source" jargon (already noted jargon; em dash is new).
- ClipListItem.jsx:46 aria text: "{n} tag(s): ... — has a note" (em dash joiner, "has a note").
- "Video source unavailable" (RecapPlayerModal.jsx:508) and "Untitled Game" (:793) not recorded; "source" jargon again, and "Game" capitalized mid-phrase.
- FootageList.jsx:383 "If some of these are a different game, remove them here and upload that game separately." fine; answers "No - two parts of one game" / "Yes - two cameras at once" (:318,326) use hyphen as dash and invert yes/no logic vs. the question (check question wording at :305-310).
- AttachVideoModal.jsx:153-154 "Attach another half or angle. It appends to this game's timeline in Annotate — your existing clips stay exactly where they are." Em dash, "Annotate" (mode is now Mark Plays), "timeline", "appends". Rewrite: "Add another half or camera angle. Your marked plays stay where they are."
- HeroIntroModal.jsx:28 "...between two — the one that plays first and the one that plays next." (ranking) confusing; "&mdash;" in shipped copy.
- ConsentGate.jsx:35 / ProfileIntroSection.jsx:208: "likeness", "publicly visible" legal tone (already flagged as legal copy elsewhere, not re-listed).
- IntroExposureNotice.jsx:12 em dash: "This card includes a photo — it will be publicly visible..."
- ManageProfilesModal.jsx:399 "Use profiles to keep your videos and highlights organized by athlete, team, sport, or season." fine; "videos" vs "games".
- AuthGateModal.jsx:96 / SharedAnnotationView: "Your annotations are saved and waiting." uses "annotations".

## (b) New term variants per concept

| Concept | Variant (verbatim) | file:line |
|---|---|---|
| marked moment | "play changed since this highlight was made" | components/DraftTile.jsx:681 |
| marked moment | "rated clip" (recap) | components/RecapPlayerModal.jsx:457 |
| marked moment | "annotation details are still listed" | components/RecapPlayerModal.jsx:606 |
| marked moment | "Your annotations are saved and waiting." | components/AuthGateModal.jsx:96 |
| marked moment | "this moment" ("Create a draft highlight from this moment") | components/RecapPlayerModal.jsx:510 |
| marked moment | "existing clips" (Attach video) | components/AttachVideoModal.jsx:154 |
| finished video | "this video's Focus export" | modes/OverlayModeView.jsx:961 |
| finished video | "Highlight started", "draft highlight", "already a draft" | components/RecapPlayerModal.jsx:266,510 |
| finished video | "Legacy highlights" (aria) / "old multi-highlight builder" | components/ProjectManager.jsx:2480,2476 |
| game video | "This game's video is no longer available" / "Video source unavailable" | components/RecapPlayerModal.jsx:479,508 |
| collection | none new in these files | |
| modes/steps | "Focus export", "Re-run Focus", "re-edited in Focus" | OverlayModeView.jsx:961,967; ProjectManager.jsx:2477 |
| modes/steps | "Overlay edits" (user text) | OverlayModeView.jsx:961 |
| modes/steps | "timeline in Annotate" | AttachVideoModal.jsx:153 |
| modes/steps | "open Mark Plays" | ProjectManager.jsx:1478 |
| crop | "Switch to Crop mode", "Switch to Pan/Zoom mode", "old crop" | FocusModeView.jsx:1012; OverlayModeView.jsx:961 |
| spotlight circle | "Play highlight" (button in Spotlight), "Tap the spotlight to adjust" | OverlayModeView.jsx:625,564 |
| spotlight circle | "tune its color, shape, and dimming" | OverlaySpotlightPanel.jsx:325 |
| text | none new | |
| credits | "{n} credit(s) for 30 days of storage" / "(N credit(s))" suffix | ProjectsScreen.jsx:473; ProjectManager.jsx:1262 |
| upload | "Upload didn't finish" / "Upload didn’t finish." / "Upload incomplete" / "Retry to resume, or discard" | GameTile.jsx:397,418; ProjectManager.jsx:1861 |
| upload | "Signing you in..." (n/a upload, auth) | SignInScreen.jsx:83 |
| share | "claim these highlights", "shared with" (dangling), "share link", "link"/"URL" | ShareWithTeammatesModal.jsx:234,330; ShareGameModal.jsx:169; IntroCardRail.jsx:189 |
| athlete/player | "Tag your athlete’s plays", "your own athlete", "player filter", "likeness" | ProjectManager.jsx:1477; RecapPlayerModal.jsx:458; ConsentGate.jsx |
| team | "Team layer" | ProjectManager.jsx:1478 |
| guidance | none new | |
| status words | "Delete for good?", "Click again to confirm", "Tap again to confirm", "Discard", "Hide from Drafts", "Source expired" (chip) | GameTile.jsx:290,478; DraftTile.jsx:702,802,791 |
| status words | "Preparing…" / "Downloading…" (U+2026) vs "Downloading..." (ASCII) | ReelTile.jsx:139-140; CollectionPlayer.jsx:595 |
| style | em dashes in live copy: AttachVideoModal.jsx:154, ProjectManager.jsx:1478, RecapPlayerModal.jsx:457, IntroExposureNotice.jsx:12, AnnotateModeView.jsx:1368, ClipListItem.jsx:46 | |
| style | hyphen-as-dash in live copy: DraftTile.jsx:678-681, FootageList.jsx:318,326, ShareWithTeammatesModal.jsx:235, RecapPlayerModal.jsx:266 | |
