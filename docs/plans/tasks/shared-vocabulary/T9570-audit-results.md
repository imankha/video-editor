# T9570 — Cross-surface naming audit results

**Task:** T9570 (closes the [Shared Vocabulary epic](EPIC.md))
**Date:** 2026-09-11
**Method:** Reconstructed the 47-group report (N01–N47) from the six sibling task files'
rename tables (there is no separate report file in this repo — the task files ARE the source),
then grepped the shipped frontend for **every observed variant** (not just the replacement) to
find stragglers the feature tasks missed. Verified constants in the three single-source files
(`displayNames.js`, `emptyStates.js`, `questDefinitions.jsx`) and their consumers.

**Scope note:** this is an audit. The five sibling children (T9520/T9530/T9540/T9550/T9560) are
all merged to master; their tables were verified against landed code, not assumed from the task
files. Accessible names (`aria-label`/`title`) were audited alongside visible text.

## Summary

| Outcome | Count | Groups |
|---------|-------|--------|
| **Applied** | 36 | N01–N15, N17, N19–N21, N26–N35, N37–N40, N45, N46, N47 |
| **Overridden** (epic) | 3 | N16, N18, N22 |
| **Deferred → T9590 (WIP)** | 4 | N23, N24, N25, N44 |
| **N/A this epic** (owned elsewhere) | 4 | N36 (T9480), N41 (T9580), N42/N43 (T9590) |

- **4 small stragglers fixed directly** on this branch (each a single stray string / stale
  accessible name at a *second render site* a feature task missed): N02/N03, N26, N28, N09-object.
- **1 new task filed (T9575)** for the larger, behavior-describing work: the onboarding **quest
  walkthrough** copy (`questDefinitions.jsx` STEP_TITLES/STEP_DESCRIPTIONS) still carries pre-epic
  vocabulary, plus the `QuestPanel` success-path "quest" toast and the FE/BE `STEP_TITLES` sync
  point that T9560 explicitly deferred. This is a coherent narrative surface that describes real
  flow behavior, so it is filed rather than silently rewritten here.

## The 47 groups

| Group | Status | Evidence (file:line) | Notes |
|-------|--------|----------------------|-------|
| N01 Add Game → **Upload game** | applied | `config/displayNames.js:93` `LIBRARY_ACTIONS.UPLOAD_GAME`; consumed in `ProjectManager.jsx`, `GameDetailsModal.jsx` | remaining "Add Game" hits are comments/analytics ids (kept, per standing rule). Quest step title "Add Your First Game" → filed T9575 |
| N02 Add Video → **Upload clip** | applied | `config/displayNames.js:130` `CLIP_UPLOAD.UPLOAD_CLIP`; `ProjectManager.jsx` direct-clip-upload row | — |
| N03 Add footage → **Add footage to game** | applied | `modes/annotate/AddFootageButton.jsx:26-28` (label/title/heading) | **straggler FIXED:** `AttachVideoModal.jsx:219` submit read "Add Video"/"Adding Video…" while its trigger reads "Add footage to game" — a missed second render site; now "Add footage"/"Adding footage…" |
| N04 Annotate → **Mark plays** | applied | `config/displayNames.js:11` `ANNOTATE.MODE_DESCRIPTION`; `shared/ModeSwitcher.jsx:52` | — |
| N05 Add Play → **Mark play** | applied | `config/displayNames.js:12` `ANNOTATE.MARK_PLAY`; `modes/AnnotateModeView.jsx:1035`, `annotate/components/AnnotateFullscreenOverlay.jsx:487` | **straggler FIXED:** `ClipSelectorSidebar.jsx:406` "Add Play" (reel-builder add-clip button) → "Add clip". Quest "Find an Amazing Play"/"Add Play" → filed T9575. `emptyStates.js` "Add Play" — see N38 note (binding T9390 copy) |
| N06 annotations/CLIPS → **Plays** | applied | `config/displayNames.js:31` `ANNOTATE.PLAYS_HEADING` | — |
| N07 Don't Clip Play → **Create an editable clip** (positive) | applied | `config/displayNames.js:19-22` `CREATE_EDITABLE_CLIP`/`JUST_SAVE_PLAY` (positive both states, T9450) | — |
| N08 Save/Save Your Reel → **Save play** | applied | `config/displayNames.js:23-25` `SAVE_PLAY`/`SAVE_PLAY_AND_CLIP`/`UPDATE_PLAY` | quest "Save Your Reel"/"Save" → filed T9575 |
| N09 Create Reel/Reel Created → **Create clip/Clip created** | applied | `config/displayNames.js:26-27` `CREATE_CLIP`/`CLIP_CREATED` | quest "Create Reel"/single-clip "reel" narrative → filed T9575 |
| N10 In Progress Clips → **Clips** | applied | `config/displayNames.js:53-60` `SECTION_NAMES.CLIPS`; no visible "In Progress" labels remain | reverses part of T8555 (recorded) |
| N11 In Progress Reels → **Reels** | applied | `config/displayNames.js:67` `SECTION_NAMES.HIGHLIGHTS='Reels'` | — |
| N12 Published/Publish to Highlight Reels → **Publish clip/reel** | applied | `config/displayNames.js:103-104` `PUBLISH_CLIP`/`PUBLISH_REEL` | `SECTION_NAMES.LIBRARY='Highlight Reels'` kept deliberately as the destination NOUN off the tab bar (documented) |
| N13 Build New Reel → **Create reel (N clips)** | applied | `config/displayNames.js:96-98` `CREATE_REEL`/`CREATE_REEL_WITH_COUNT` (disabled at zero) | — |
| N14 Delete reel (in Clips menu) → **Delete clip** | applied | `components/DraftTile.jsx:284` (object-conditional); `ANNOTATE.DELETE_CLIP` reused | **AC spot-check PASS:** a Clips menu never says "Delete reel"; `ReelTile.jsx:324` "Delete/Rename reel" is correct for reel objects |
| N15 Rename reel → **Rename clip/reel** (object-matched) | applied | `config/displayNames.js:101-102` `RENAME_CLIP`/`RENAME_REEL` | — |
| N16 Focus → **AI Focus** | **overridden** | epic override (T9320); panel subtitle added `EDITOR_PANELS` | mode name stays "AI Focus" |
| N17 crop keyframes → **Focus point / Framing timeline** | applied | `config/displayNames.js:280-281` `FOCUS_POINT`/`FRAMING_TIMELINE`; keyframe demoted to advanced help | — |
| N18 Overlay → **Spotlight** | **overridden** | epic override (T9320) | mode name stays "Spotlight" |
| N19 Export Focused Video → **Generate AI Focus** | applied | `config/displayNames.js:168-174` `EXPORT_JOBS.framing`; `ExportButtonView.jsx`, `GlobalExportIndicator.jsx` | — |
| N20 Add Overlay → **Export clip with effects** | applied | `config/displayNames.js:176-183` `EXPORT_JOBS.overlay` | — |
| N21 Export Complete → **AI Focus ready / Clip ready** | applied | `config/displayNames.js:172,178` `completed` | **AC spot-check PASS:** completion names the finished stage |
| N22 four-state status remodel | **overridden** | epic override; T8470 Draft/Shared stands (`draftStage.js`) | remodel lives in T9600 |
| N23 Publish Now → **Publish clip/reel** | **deferred → T9590 (WIP)** | `config/displayNames.js:200-203` `FOCUS_PUBLISH.PUBLISH_LABEL` still 'Publish Now' | T9540's table listed N23 but its landed scope left the post-export action bar to T9590 (documented at `displayNames.js:161-162`). Not applied yet |
| N24 Publish Later/Saved to Clips → **Save draft** | **deferred → T9590 (WIP)** | `config/displayNames.js:204,217` still 'Add Spotlight Later'/'Saved to Clips' | same as N23 — action-bar copy owned by T9590 |
| N25 Reapply Overlay/Focus → **Edit effects/framing** | **deferred → T9590 (WIP)** | `config/displayNames.js:211,248-251` 'Refocus'/'Reapply Spotlight'/'Reapply AI Focus' | same as N23 |
| N26 Playback Annotations/Play full clip → **Preview plays/Preview clip/Play clip** | applied | `config/displayNames.js:32-33` `PREVIEW_PLAYS`/`PREVIEW_CLIP`; `AnnotateModeView.jsx:295` | **straggler FIXED:** `OverlayModeView.jsx:481` `title:'Play full clip'` → 'Play clip' (accessible name) |
| N27 athlete/child → **player/My player** | applied | `config/displayNames.js` `EDITOR_PANELS`, `ANNOTATE.LAYER_MINE`; editor uses "player" | note: `ClaimGameView.jsx` signup prose still says "athlete" (N27 permits athlete/child in parent-facing prose; low-priority, not blocking) |
| N28 My Athlete → **My player** | applied | `config/displayNames.js:35` `ANNOTATE.LAYER_MINE='My player'` | **straggler FIXED:** `GameClipSelectorModal.jsx:599` filter label "My Athlete" → "My player" (now reuses `ANNOTATE.LAYER_MINE`). Quest "My Athlete" → filed T9575 |
| N29 Highlight Color/Body/Ground → **Spotlight color/Around player/Under player** | applied | `config/displayNames.js:284-286`; `settings/OverlaySpotlightPanel.jsx:37,87-90` | quest "Highlight Color"/"Body or Ground" → filed T9575 |
| N30 Stroke Width/Fill/Outside Dim → **Outline thickness/Spotlight fill/Dim background** | applied | `config/displayNames.js:288-290`; `OverlaySpotlightPanel.jsx:109,123,141` with px/% readouts | — |
| N31 Thumbnail → **Cover image / Choose cover frame** | applied | `config/displayNames.js:292-294`; `overlay/ThumbnailPanel.jsx:40-42`; `OverlayModeView.jsx:741` | — |
| N32 9:16/16:9 → **Portrait (9:16)/Landscape (16:9)** | applied | `constants/aspectRatios.js:41-53` `ratioLabelWithRatio`; `AspectRatioSelector.jsx:50` word+ratio | minor: `CropControls.jsx:17-18` has its own "16:9 (Landscape)" labels (descriptive, but not via the shared helper) — cosmetic dup, not a naming defect |
| N33 By Phase/By Game → **By status/By game** | applied | `components/ProjectManager.jsx:1928` `label:'By status'` | — |
| N34 Share Annotations/Shared → **Share plays/Sharing settings** | applied | `config/displayNames.js:46-51` `SHARING`; `SharePlaybackDialog.jsx` | action vs state split |
| N35 star mapping → **"4 stars · Good"** | applied | `components/shared/clipConstants.js:78,94` `getRatingDisplay` (one documented mapping) | — |
| N36 mixed time formats | **N/A (owned by T9480)** | referenced in T9550 only | T9480 owns the time-format rule; not this epic |
| N37 Computing hash/Detecting players/frame X/Y → **Preparing/Uploading/Rendering/Finding players** | applied | `config/displayNames.js:189-194` `EXPORT_PROGRESS`; `utils/exportProgressPresentation.js`, `utils/uploadPresentation.js` map the engineering strings before display | minor: `overlay/overlays/PlayerDetectionOverlay.jsx:106` "Detecting players…" is the in-editor detection overlay (a separate surface from export progress) — low-priority note |
| N38 Get Started/Help 5/5 → **Getting started** | applied | `components/QuestPanel.jsx:90` "Getting started"; `emptyStates.js` guide copy | `emptyStates.js` "Add Play"/"Focus pass" is T9390-binding APPROVED copy ("do not paraphrase"); it names the flow, not the exact control — left as-is per that lock, flagged in T9575 for a coordinated pass if desired |
| N39 quests/"Quest not complete" → **Getting started/Step not complete** | applied (failure path) | backend `quests.py` "Step not complete"; failure path fixed | **straggler → T9575:** `QuestPanel.jsx:261-262` SUCCESS toast still reads "Quest complete!" / "more quests await!" (only place the user still meets "quest" on the success path; also contains an em-dash, a project-wide no-no) — T9560 residual #1 |
| N40 watch_annotate_tutorial/Watch Your Clips Back → **Preview your plays** | applied | `config/questDefinitions.jsx:140,173` reuses `ANNOTATE.PREVIEW_PLAYS`; internal id in expandable detail | — |
| N41 → **Frame this clip / Keep marking plays** | **N/A (owned by T9580, TODO)** | `docs/plans/tasks/T9580-*.md` | persistent first-clip CTA; not this epic |
| N42 post-Focus choices | **N/A (owned by T9590, WIP)** | `docs/plans/tasks/T9590-*.md` | choice hierarchy; not this epic |
| N43 "Later" names a destination | **N/A (owned by T9590, WIP)** | `docs/plans/tasks/T9590-*.md` | — |
| N44 Refocus/Reapply Focus → **Edit framing** | **deferred → T9590 (WIP)** | `config/displayNames.js:211,250` 'Refocus'/'Reapply AI Focus' still present | action-bar copy; T9590 owns it (see N23) |
| N45 Failed to send report → **Report not sent/Retry report** | applied | `components/ReportProblemButton.jsx` "Report not sent"/"Retry report" (T9400; verified by T9560 handoff) | **AC spot-check PASS** |
| N46 numbered 1-4 destinations → **unnumbered** | applied | `config/emptyStates.js:27-32` `FLOW_STEPS` (no numbers) | — |
| N47 fullscreen legacy labels → **shared action vocabulary** | applied | shipped by T9500 (full parity pass); `AnnotateFullscreenOverlay.jsx` reuses `ANNOTATE.*` | **AC spot-check PASS** (verified via shared constants; not re-implemented, per T9560 handoff) |

## Seam verification (primary action → toast → destination heading → tutorial)

- **Mark a play → create clip:** CTA `ANNOTATE.MARK_PLAY` / `SAVE_PLAY_AND_CLIP` → `CLIP_CREATED`
  → lands in **Clips** tab (`SECTION_NAMES.CLIPS`). Consistent. (Quest tutorial still narrates the
  old "Save Your Reel/Create Reel" — filed T9575.)
- **Generate AI Focus:** button `EXPORT_JOBS.framing.action` → progress `Generating AI Focus…`
  → completion `AI Focus ready`. One object, one stage. Consistent.
- **Export with effects:** button `EXPORT_JOBS.overlay.action` → `Exporting clip…` → `Clip ready`;
  cost note honest (zero credits). Consistent.
- **Publish:** per-card `PUBLISH_CLIP`/`PUBLISH_REEL` object-matched; single-clip publish does not
  require Reels (UX-14 satisfied). **Post-export action-bar publish labels (Publish Now / Later /
  Refocus) are the T9590 seam and still read the old copy** — flagged above (N23/N24/N25/N44).

## Stragglers fixed on this branch (4)

1. `AttachVideoModal.jsx:219` — submit "Add Video"/"Adding Video…" → "Add footage"/"Adding footage…" (N03; matched to its `AddFootageButton` trigger). Test updated.
2. `GameClipSelectorModal.jsx:599` — reel-builder filter "My Athlete" → "My player" (N28; now reuses `ANNOTATE.LAYER_MINE`). Test updated.
3. `OverlayModeView.jsx:481` — `title:"Play full clip"` accessible name → "Play clip" (N26).
4. `ClipSelectorSidebar.jsx:406` — reel-builder add button "Add Play" → "Add clip" (adds a clip to a reel, not a play; N09 object model).

## Filed as a new task

- **T9575 — Onboarding quest-walkthrough vocabulary sweep.** The `questDefinitions.jsx` STEP_TITLES
  / STEP_DESCRIPTIONS narrative still uses pre-epic vocabulary ("Add Your First Game", "Find an
  Amazing Play"/"Add Play", "Save Your Reel"/"Save", "Create Reel"/single-clip "reel", "My Athlete",
  "Pick Your Highlight Color", "Body or Ground", "Add the Spotlight"), the `QuestPanel` success toast
  still says "Quest complete!"/"more quests await!" (the last success-path "quest" word; T9560
  residual #1), and the backend `quest_config.STEP_TITLES["move_to_my_reels"]` hardcodes "Move to
  Highlight Reels" where the FE derives it from `SECTION_NAMES.LIBRARY` (T9560 residual #2 — a
  FE/BE sync point). This is behavior-describing narrative copy (it must match the guided flow), so
  it is one coherent task, not a silent string swap in an audit.

## QA note

The audit itself needs no live-drive beyond what grep/read proves. The four straggler fixes are
isolated string/accessible-name changes covered by unit tests (see below); no flow behavior changed,
so no manual live-drive was performed for them (stated explicitly rather than skipped silently).
