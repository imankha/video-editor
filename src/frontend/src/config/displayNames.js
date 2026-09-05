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

// T8390: Focus's post-export publish-exit action bar (FocusPublishActionBar).
export const FOCUS_PUBLISH = {
  PUBLISH_LABEL: 'Publish',
  PUBLISH_CAPTION: 'Puts it in Highlight Reels so you can share it.',
  ADD_SPOTLIGHT_LABEL: 'Add Spotlight',
  ADD_SPOTLIGHT_LATER_LABEL: 'Add Spotlight Later',
  SPOTLIGHT_CAPTION: 'A spotlight is a glowing highlight that follows your athlete.',
  REFOCUS_LABEL: 'Refocus (reframe and export again, uses credits)',
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
