// T9520 (Shared Vocabulary epic — naming groups N04-N35): the canonical
// Annotate-surface vocabulary, single source. One object model across every
// Annotate label: a GAME holds PLAYS (marked time ranges with rating/tags/notes);
// a PLAY can produce a CLIP (an editable video). Reels are multi-clip objects and
// live OFF this surface (Library), so "reel" never appears in Annotate copy — a
// play produces a CLIP, never a reel. Internal names (the `my_athlete` field,
// `autoProjectId`, EDITOR_MODES, routes, analytics events) are deliberately NOT
// renamed to match — deep links and greppability beat cosmetic consistency.
// Editor mode names stay "AI Focus" / "Spotlight" (epic override, not this file).
export const ANNOTATE = {
  MODE_DESCRIPTION: 'Mark plays',          // N04 — mode-switcher description
  MARK_PLAY: 'Mark play',                  // N05 — primary create CTA
  EDIT_PLAY: 'Edit play',                  // N05 — edit CTA
  // N05 helper: the default capture window is 9s before + 3s after the tap = 12s
  // (DEFAULT_CLIP_BEFORE + DEFAULT_CLIP_AFTER in AnnotateFullscreenOverlay).
  MARK_PLAY_HELPER: 'Captures the previous 12 seconds',
  MARKING_PLAY_TITLE: 'Marking a play',    // N05 — create-editor header title
  PLAYS_HEADING: 'Plays',                  // N06 — sidebar list heading
  // N07 — create-an-editable-clip toggle. Positive polarity both states (T9450):
  // ON produces a clip, OFF just saves the play. Never a "Don't …" double negative.
  CREATE_EDITABLE_CLIP: 'Create an editable clip',
  JUST_SAVE_PLAY: 'Just save this play',
  SAVE_PLAY: 'Save play',                  // N08 — save a play only
  SAVE_PLAY_AND_CLIP: 'Save play and create clip', // N08 — save + produce a clip
  UPDATE_PLAY: 'Update play',              // N08 — edit-mode save
  CREATE_CLIP: 'Create clip',              // N09 — manual create-clip action
  CLIP_CREATED: 'Clip created',            // N09 — created indicator
  DELETE_CLIP: 'Delete clip',              // N14 — delete a play that has a clip
  DELETE_PLAY: 'Delete play',              // N14 — delete a bare play marker
  RENAME_CLIP: 'Rename clip',              // N15 — rename action
  CLIP_NAME: 'Clip name',                  // N15 — name field
  PREVIEW_PLAYS: 'Preview plays',          // N26 — playback-all button (was "Playback Annotations")
  PREVIEW_CLIP: 'Preview clip',            // N26 — per-clip preview (unchanged)
  LAYER_LABEL: 'Play category',            // N28 — the control formerly "Clip layer"/"Layer"
  LAYER_MINE: 'My player',                 // N28 — was "My Athlete"
  LAYER_TEAM: 'Team',                      // N28 — unchanged
};

// T9560 (Shared Vocabulary epic, N34): the Annotate share controls, single source.
// The old copy ("Share Annotations" / "Shared w/ Tagged Teammates") both said
// "Annotations" (off the play/clip object model) and, worse, the "Shared …" state
// label read as a claim that sharing had already happened when it may not have.
// Split cleanly: SHARE_PLAYS is the ACTION (open the share flow); SETTINGS is the
// state-neutral label for managing an existing share (opens the same dialog without
// re-implying a fresh share). Never imply sharing that has not occurred.
export const SHARING = {
  SHARE_PLAYS: 'Share plays',       // the action — open the sharing flow
  SHARE_PLAYS_SHORT: 'Share',       // narrow-viewport action label
  SETTINGS: 'Sharing settings',     // state-neutral: manage/adjust an existing share
  SETTINGS_SHORT: 'Sharing',        // narrow-viewport state label
};

export const SECTION_NAMES = {
  // Single-clip auto-draft tab (Home). Tab id stays `projects` / URL
  // `/home/reels` (frozen for deep-link compat). T9530 (Shared Vocabulary epic,
  // N10, 2026-09-10) dropped the "In Progress" prefix — status is shown per item,
  // not baked into the object name — so the label is now just "Clips" (was
  // "In Progress Clips" T8555, "Clips" T8360, "Reel Drafts" before). This makes
  // the full label match SECTION_NAMES_SHORT.CLIPS universally.
  CLIPS: 'Clips',
  CLIPS_LOWER: 'clips',

  // Multi-clip assemblies (T8360). T8555 promoted this to its own top-level tab;
  // T9530 (N11) dropped the "In Progress" prefix so the label is now "Reels"
  // (was "In Progress Reels" T8555, "Highlights" before). In-progress-drafts
  // surface only -- published reels live under PUBLISHED.
  HIGHLIGHTS: 'Reels',
  HIGHLIGHTS_LOWER: 'reels',

  // Published reels tab (T8555) -- every published reel regardless of single-
  // or multi-clip origin (the old gallery/DownloadsPanel published list,
  // relocated to its own top-level tab).
  PUBLISHED: 'Published',

  // Published-reel NOUN used off the tab bar (Hide-from-Drafts hint, export
  // toasts, GalleryButton, quests). NOT a tab label -- deliberately keeps the
  // "Highlight Reel(s)" term (T8555 retired it only from the tab bar; T9530
  // renamed the per-card publish ACTION to Publish clip/Publish reel, see
  // LIBRARY_ACTIONS, but left this destination noun for cross-surface copy the
  // sibling children T9560/T9570 still own).
  LIBRARY: 'Highlight Reels',
};

// T9530 (Shared Vocabulary epic, N01-N03/N12-N15): the Library-surface object
// action vocabulary, single source. Object model: you UPLOAD a game or a clip
// (source ingest), ADD footage to an existing game, and CREATE a reel by
// assembling multiple clips. Per-card actions name their OWN object — a Clip
// (a single-clip auto-draft, project.is_auto_created === true) is deleted /
// renamed / published as a clip; a Reel (assembled multi-clip, is_auto_created
// === false) as a reel. The two clip strings reuse ANNOTATE's canonical values
// so a single datum never drifts across surfaces (one canonical location rule).
export const LIBRARY_ACTIONS = {
  UPLOAD_GAME: 'Upload game',              // N01 — was "Add Game"/"Add New Game"
  UPLOADING_GAME: 'Uploading game...',     // N01 — submit busy state
  ADD_FOOTAGE: 'Add footage to game',      // N03 — was "Add footage"/"Add footage to this game"
  CREATE_REEL: 'Create reel',              // N13 — was "Build New Reel"/"Create Reel from Clips"
  // N13 — assembly submit, shows the selected count; button is disabled at zero.
  CREATE_REEL_WITH_COUNT: (n) => `Create reel (${n} clip${n === 1 ? '' : 's'})`,
  DELETE_CLIP: ANNOTATE.DELETE_CLIP,       // N14 — 'Delete clip'
  DELETE_REEL: 'Delete reel',              // N14
  RENAME_CLIP: ANNOTATE.RENAME_CLIP,       // N15 — 'Rename clip'
  RENAME_REEL: 'Rename reel',              // N15
  PUBLISH_CLIP: 'Publish clip',            // N12
  PUBLISH_REEL: 'Publish reel',            // N12
};

// T8980: one-line short tab labels shown BELOW `sm`. T9530 (N10/N11) collapsed
// SECTION_NAMES onto these exact words at every breakpoint — the full labels no
// longer carry an "In Progress" prefix, so SECTION_NAMES and SECTION_NAMES_SHORT
// now render the SAME set (Games / Clips / Reels / Published). This constant is
// kept as the single source the EmptyTabGuide flow-strip step labels
// (emptyStates.js FLOW_STEPS) read from; "Published" sitting next to "Reels" is
// what reads the middle two as in-progress, so status lives per item, never in
// the tab name.
export const SECTION_NAMES_SHORT = {
  GAMES: 'Games',
  CLIPS: 'Clips',
  REELS: 'Reels',
  PUBLISHED: 'Published',
};

// T8380: direct clip upload on the Clips tab. A separate group from
// SECTION_NAMES (tab labels) -- this is the upload GESTURE plus its one-time
// consequence notice. T9530 (N02, 2026-09-10) renamed the CTA "Add Video" ->
// "Upload clip" (object-model verb: you UPLOAD a clip), and renamed the key
// ADD_VIDEO -> UPLOAD_CLIP to keep the constant greppable by its new label. The
// notice copy was user-approved 2026-09-05 (softened from an absolute "can't"
// claim; the "add to a Game instead" pointer was dropped for a terser notice).
// T9640: one-line game-vs-clip distinction shown BENEATH each upload entry on the
// populated Games/Clips tabs (the empty-state EmptyTabGuide already pairs its
// buttons with captions; these give the same plain-language distinction at the
// non-empty entry points, where the CTA otherwise stands alone). Parallel phrasing
// states the choice: a full game must have plays marked to yield clips; a short
// clip skips that and goes straight to Focus. No em dashes (project-wide rule);
// "Focus" is the current framing-mode name.
export const UPLOAD_ENTRY_HINT = {
  GAME: 'A full game needs plays marked before it becomes clips.',
  CLIP: 'A short clip skips straight to Focus, no game needed.',
};

export const CLIP_UPLOAD = {
  UPLOAD_CLIP: 'Upload clip',
  NOTICE_TITLE: 'Heads up: these clips won’t be linked to a game',
  NOTICE_BODY:
    'Uploading here adds videos straight to your clips, ready to Focus and publish. '
    + 'Because they don’t come from a game in Annotate, they won’t be part of a '
    + 'game you can build more highlights from.',
  NOTICE_CONTINUE: 'Continue',
  NOTICE_CANCEL: 'Cancel',
};

// T9430: honest upload-state vocabulary shown next to the local preview. The four
// states map from the real uploadManager phase machine (see utils/uploadPresentation
// .js), NOT engineering copy ("Computing hash" / "15%"). A visible local preview must
// never read as "saved online": LOCAL_PREVIEW_NOTICE labels it not-yet-persisted until
// the server acknowledges (COMPLETE, only after activate_game returns). N37's progress
// vocabulary ("Preparing video / Uploading / Rendering") is owned by T9540; these are
// this task's state labels, kept independent of that rename. Single source (T8555/T8380).
export const UPLOAD_STATE = {
  PREPARING: 'Preparing',
  UPLOADING: 'Uploading',
  SAVED: 'Saved',
  FAILED: 'Upload failed',
  LOCAL_PREVIEW_NOTICE: 'Local preview - not saved online yet',
  RETRY_UPLOAD: 'Retry upload',
};

// T9540 (Shared Vocabulary epic, N19-N21/N37): render-action / job / progress /
// completion vocabulary, single source. Keyed on the export `type` ('framing' |
// 'overlay') the store + WS payload already carry, so the button, the job list, the
// toast and the completion message never disagree about the stage (one object, one
// stage). Mode names ("AI Focus" / "Spotlight") are deliberately NOT here -- a mode
// names a PLACE you edit, a job names a THING YOU DO. The post-export action-bar
// labels (FOCUS_PUBLISH / OVERLAY_PUBLISH below) are T9590 territory, untouched here.
//
// Focus stage NOUN is "AI Focus" (the mode was renamed Framing -> AI Focus, T9320);
// the render VERB is "Generate", deliberately NOT "Apply": "Apply AI Focus" (T9330) is
// a DIFFERENT gesture that NAVIGATES INTO the mode, so reusing it here would confuse
// entering the mode with paying to render inside it. Completion is exactly "AI Focus ready".
export const EXPORT_JOBS = {
  framing: {
    action: 'Generate AI Focus',              // N19 — render CTA, was "Export Focused Video"
    inProgress: 'Generating AI Focus...',     // N19 — progress/job label, was "Creating reel..."
    completed: 'AI Focus ready',              // N21 — names the stage that finished, was "Export Complete"
    jobNoun: 'AI Focus',                       // job-list row noun, was "Framing Export"
  },
  overlay: {
    action: 'Export clip with effects',       // N20 — render CTA, was "Add Spotlight"
    inProgress: 'Exporting clip...',          // N20
    completed: 'Clip ready',                  // N21
    jobNoun: 'Effects',                        // job-list row noun, was "Overlay Export"
    // Q1 (approved): the effects render charges ZERO credits (backend-confirmed: no
    // reserve_credits in overlay.py). Surface that honestly instead of staying silent.
    costNote: 'No credits · effects are free',
  },
};

// N37 — export PROGRESS vocabulary. Honest user copy that replaces engineering strings
// ("Detecting players", "frame 150/180", "Processing frames..."). Mapped from the backend
// `phase` (see utils/exportProgressPresentation.js); counters stay as OPTIONAL detail.
export const EXPORT_PROGRESS = {
  PREPARING: 'Preparing video',                // init/queued/validating/downloading
  UPLOADING: 'Uploading',                      // upload
  RENDERING: 'Rendering',                      // processing/modal_processing/rendering/upscaling
  FINDING_PLAYERS: 'Finding players for spotlight', // detecting_players
};

// T8390 / re-hierarchized T9590: Focus's post-export publish-exit action bar
// (FocusPublishActionBar). T9590 (2026-09-10) DELIBERATELY REVERSES T8390's flat
// four-equal-weight layout (and the 2026-09-08 "Publish Now"/"Add Spotlight Now"
// pairing that supported it) into a three-level hierarchy + a quiet Save-draft --
// product owner decision, recorded with the conflict at filing:
//   PRIMARY   Add spotlight             (dominant; opens the Spotlight editor, no export)
//   SECONDARY Publish without spotlight (publishes the framed reel as-is)
//   TERTIARY  Edit framing              (back into AI Focus; the paid re-export path)
//   QUIET     Save draft                (defer; replaces the old "Add Spotlight Later",
//                                        whose spotlight-framed destination is gone)
// Captions state each destination + the honest cost/audience BEFORE the click
// (T9590 acceptance). PUBLISH_CAPTION's audience wording is verified against the
// real endpoints (downloads.py publish -> lands the reel in Highlight Reels;
// shares.py -> a share link is public, "anyone with the link" -- matches the
// post-publish toast). T9670 owns the confirmed publish-audience contract and is
// not done yet, so RE-VERIFY this wording once T9670 lands. EDIT_FRAMING_CAPTION
// keeps the honest "uses credits" re-export warning.
export const FOCUS_PUBLISH = {
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  SPOTLIGHT_CAPTION: 'A spotlight is a glowing highlight that follows your athlete.',
  PUBLISH_LABEL: 'Publish without spotlight',
  PUBLISH_CAPTION: 'Adds it to your Highlight Reels as is -- anyone with the link can watch it.',
  EDIT_FRAMING_LABEL: 'Edit framing',
  EDIT_FRAMING_CAPTION: 'Reframe and export again, uses credits.',
  SAVE_DRAFT_LABEL: 'Save draft',
  SAVE_DRAFT_CAPTION: 'Keep it in your drafts and finish it whenever you want.',
};

// T8390: "Add Spotlight Later" toast copy, routed by is_auto_created (T8360 split).
export const FOCUS_PUBLISH_LATER_TOAST = {
  SINGLE_CLIP: {
    title: 'Saved to Clips',
    message: 'Clips are single plays. Highlight Reels join several clips into one video. '
      + 'Yours is still a draft, so add a spotlight or publish it from here whenever you want.',
  },
  MULTI_CLIP: {
    title: 'Saved to Highlight Reels, under Highlights',
    message: 'Highlight Reels join several clips into one video. Single plays stay in Clips. '
      + 'Yours is still a draft, so add a spotlight or publish it from here whenever you want.',
  },
};

// 2026-09-08: "Add Spotlight Now" confirmation toast (product owner: every
// FocusPublishActionBar choice should confirm what happened + what's next,
// same as the existing Add Spotlight Later toast above). Short, since the
// user isn't leaving the flow -- they land straight in Overlay right after.
export const FOCUS_ADD_SPOTLIGHT_TOAST = {
  title: 'Framing saved',
  message: 'Now add a spotlight to your reel -- you can still publish it whenever you\'re ready.',
};

// T9110 / re-hierarchized T9590: Overlay's post-export publish-exit action bar
// (OverlayPublishActionBar). T9590 re-hierarchizes IN LOCKSTEP with FOCUS_PUBLISH
// above (REVERSES T9110's flat four-equal-weight mirror). On THIS screen the
// spotlight is already applied, so the promoted forward action is Publish (Focus
// promotes "Add spotlight" instead -- the hierarchy tracks pipeline position, not
// a fixed action):
//   PRIMARY   Publish           (dominant; the reel is finished)
//   SECONDARY Reapply spotlight (back into Spotlight editing)
//   TERTIARY  Reapply AI Focus  (reframe; the paid re-export path)
//   QUIET     Save draft        (defer; replaces the old "Publish Later")
// PUBLISH_CAPTION states the audience BEFORE the tap (verified against
// downloads.py publish + shares.py, matching the post-publish "anyone with the
// link" toast; re-verify once T9670 lands). REAPPLY_FOCUS_CAPTION keeps the honest
// "uses credits" warning, verbatim with Focus's so the two read as one system.
export const OVERLAY_PUBLISH = {
  PUBLISH_LABEL: 'Publish',
  PUBLISH_CAPTION: 'Adds it to your Highlight Reels -- anyone with the link can watch it.',
  REAPPLY_OVERLAY_LABEL: 'Reapply spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and redo the spotlight on your reel.',
  REAPPLY_FOCUS_LABEL: 'Reapply AI Focus',
  REAPPLY_FOCUS_CAPTION: 'Reframe and export again, uses credits.',
  SAVE_DRAFT_LABEL: 'Save draft',
  SAVE_DRAFT_CAPTION: 'Save it as a draft and publish whenever you\'re ready.',
};

// T9110: "Reapply Focus" confirmation toast. Mirrors FOCUS_ADD_SPOTLIGHT_TOAST's
// reasoning (product owner, 2026-09-08): a choice that moves the user into
// ANOTHER edit mode has no other confirmation their prior work was saved, so it
// gets a toast. Honest that the spotlight carries over the Focus re-export
// (highlight carry-forward, T4350/T4355) and that a fresh export follows.
export const OVERLAY_REAPPLY_FOCUS_TOAST = {
  title: 'Spotlight saved',
  message: 'Reframe your clip in AI Focus, then export again -- your spotlight carries over to the new reel.',
};

// T9550 (Shared Vocabulary epic, N16-N32): the editor-stage IN-PANEL vocabulary,
// single source. These name the CONTROLS you tune once inside AI Focus / Spotlight
// -- the focus point, the styling sliders, the cover image. Deliberately NOT here:
// the mode NAMES ("AI Focus" / "Spotlight", editorStore SCREENS -- epic override,
// unchanged) and the render-action strings (EXPORT_JOBS, T9540) -- a mode names a
// PLACE you edit, a job names a THING YOU DO, and this block names the controls in
// between. One noun per primitive so T9610/T9620's instructional copy reuses these
// exact words. "player" is the canonical subject noun (matches ANNOTATE.LAYER_MINE
// 'My player', T9520 -- do not reintroduce "athlete" here). "keyframe" is
// intentionally absent as a primary label: it survives only as advanced help in
// component tooltips (FocusTimeline), per the task's "demote, don't ban" rule.
export const EDITOR_PANELS = {
  // N17 -- the crop primitive is a "focus point"; its timeline track is the
  // "Framing timeline". "crop keyframe" stays only in advanced help/tooltips.
  FOCUS_POINT: 'Focus point',
  FRAMING_TIMELINE: 'Framing timeline',
  // N29 -- spotlight styling. "Highlight Color" mixed brand + generic for one thing:
  // the spotlight. The shape options say WHERE the spotlight sits vs the player.
  SPOTLIGHT_COLOR: 'Spotlight color',
  SPOTLIGHT_AROUND_PLAYER: 'Around player', // was "Body" / "Body ellipse"
  SPOTLIGHT_UNDER_PLAYER: 'Under player',   // was "Ground" / "Ground spotlight"
  // N30 -- styling sliders in plain words; the component keeps the live px/% readout.
  OUTLINE_THICKNESS: 'Outline thickness',   // was "Stroke Width"
  SPOTLIGHT_FILL: 'Spotlight fill',         // was "Fill"
  DIM_BACKGROUND: 'Dim background',          // was "Outside Dim"
  // N31 -- the share still is a "Cover image"; the timeline marker CHOOSES its frame.
  COVER_IMAGE: 'Cover image',                // was "Thumbnail"
  CHOOSE_COVER_FRAME: 'Choose cover frame',  // was "Thumbnail marker"
  COVER_IMAGE_HELPER: 'The still people see before playing.',
  // T9620 (UX-10) -- the spotlight editor leads with PICKING YOUR PLAYER, not the
  // styling controls. These name that primary task (stated on screen, never a
  // tooltip) and gate the styling copy behind it. The word "player" keeps the
  // detection COUNTS unmistakable as counts, not jersey identities.
  SELECT_PLAYER_TITLE: 'Pick your player',
  SELECT_PLAYER_CLICK: 'Click your player to add a spotlight',
  SELECT_PLAYER_TAP: 'Tap your player to add a spotlight',
  SELECT_PLAYER_FIND: 'Tap a green marker on the timeline to find your player',
  SELECT_PLAYER_STYLING_HINT: 'Spotlight color, shape, and dimming appear once you pick a player.',
};
