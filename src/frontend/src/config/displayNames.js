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

// T8390: Focus's post-export publish-exit action bar (FocusPublishActionBar).
// Labels renamed 2026-09-08 (product owner): "Publish" -> "Publish Now" and
// "Add Spotlight" -> "Add Spotlight Now" so the two "now" choices read as a
// matched pair against "Add Spotlight Later". REFOCUS_CAPTION is new (below).
export const FOCUS_PUBLISH = {
  PUBLISH_LABEL: 'Publish Now',
  PUBLISH_CAPTION: 'Puts it in Highlight Reels so you can share it, as is without a spotlight.',
  ADD_SPOTLIGHT_LABEL: 'Add Spotlight Now',
  ADD_SPOTLIGHT_LATER_LABEL: 'Add Spotlight Later',
  SPOTLIGHT_CAPTION: 'A spotlight is a glowing highlight that follows your athlete.',
  // 2026-09-08 round 5: split out of the old single string 'Refocus (reframe
  // and export again, uses credits)' into a title + caption pair, matching
  // the other three cards' structure (title Button + caption <p>) exactly —
  // product owner explicitly asked for the parenthetical to become a real
  // caption line, not button text.
  REFOCUS_LABEL: 'Refocus',
  REFOCUS_CAPTION: 'Reframe and export again, uses credits.',
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

// T9110: Overlay's post-export publish-exit action bar (OverlayPublishActionBar).
// Mirrors FOCUS_PUBLISH (see above) for the Overlay completion screen. Four
// equal-weight choices, no hierarchy (same product decision as T8390 round 2).
// The two "reapply" choices send the user back into an edit mode; "Publish
// Later" defers. REAPPLY_FOCUS_CAPTION carries the same honest cost warning as
// Focus's REFOCUS_CAPTION (a Focus re-frame forces a fresh paid overlay
// re-export afterward), verbatim so the two read as one system.
export const OVERLAY_PUBLISH = {
  PUBLISH_LABEL: 'Publish Now',
  PUBLISH_CAPTION: 'Puts it in Highlight Reels so you can share it.',
  REAPPLY_OVERLAY_LABEL: 'Reapply Spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and redo the spotlight on your reel.',
  REAPPLY_FOCUS_LABEL: 'Reapply AI Focus',
  REAPPLY_FOCUS_CAPTION: 'Reframe and export again, uses credits.',
  PUBLISH_LATER_LABEL: 'Publish Later',
  PUBLISH_LATER_CAPTION: 'Save it as a draft and publish whenever you\'re ready.',
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
