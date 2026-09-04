export const SECTION_NAMES = {
  // Single-clip auto-draft surface (Home tab). Was DRAFTS = 'Reel Drafts' (T8360).
  CLIPS: 'Clips',
  CLIPS_LOWER: 'clips',

  // In-progress multi-clip assemblies, shown on the Highlight Reels surface (T8360).
  HIGHLIGHTS: 'Highlights',
  HIGHLIGHTS_LOWER: 'highlights',

  // Published multi-clip reels (DownloadsPanel header). Unchanged.
  LIBRARY: 'Highlight Reels',
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
