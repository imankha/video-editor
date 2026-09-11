export const SECTION_NAMES = {
  // In-progress single-clip auto-draft tab (Home). Tab id stays `projects` /
  // URL `/home/reels` (frozen for deep-link compat); the LABEL is
  // "In Progress Clips" as of T8555 (was "Clips" T8360, "Reel Drafts" before).
  CLIPS: 'In Progress Clips',
  CLIPS_LOWER: 'clips',

  // In-progress multi-clip assemblies (T8360). T8555 promoted this to its own
  // top-level tab labeled "In Progress Reels" (was "Highlights"); this is the
  // in-progress-drafts surface only -- published reels live under PUBLISHED.
  HIGHLIGHTS: 'In Progress Reels',
  HIGHLIGHTS_LOWER: 'in progress reels',

  // Published reels tab (T8555) -- every published reel regardless of single-
  // or multi-clip origin (the old gallery/DownloadsPanel published list,
  // relocated to its own top-level tab).
  PUBLISHED: 'Published',

  // Published-reel NOUN used off the tab bar (DraftTile publish button, export
  // toasts, GalleryButton, quests). NOT a tab label -- deliberately keeps the
  // "Highlight Reel(s)" term (T8555 retired it only from the tab bar).
  LIBRARY: 'Highlight Reels',
};

// T8980: one-line short tab labels shown BELOW `sm`. The two-word SECTION_NAMES
// ("In Progress Clips/Reels") don't fit a ~70px column at 320px, and their
// shared "In Progress" prefix carries no distinguishing information. Full
// SECTION_NAMES labels still show at `sm`+ (responsive shortening, not a
// rename). "Published" sitting next to "Reels" is what reads the middle two as
// in-progress. These are ALSO the EmptyTabGuide flow-strip step labels
// (emptyStates.js FLOW_STEPS) -- same words, single source.
export const SECTION_NAMES_SHORT = {
  GAMES: 'Games',
  CLIPS: 'Clips',
  REELS: 'Reels',
  PUBLISHED: 'Published',
};

// T8380: direct clip upload ("Add Video") on the In Progress Clips tab. A
// separate group from SECTION_NAMES (tab labels) -- this is the upload GESTURE
// plus its one-time consequence notice. "New Clip" (T8130) stays reserved; the
// user chose "Add Video" for this direct-upload entry point. The notice copy was
// user-approved 2026-09-05 (softened from an absolute "can't" claim; the "add to
// a Game instead" pointer was dropped for a terser notice).
export const CLIP_UPLOAD = {
  ADD_VIDEO: 'Add Video',
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
