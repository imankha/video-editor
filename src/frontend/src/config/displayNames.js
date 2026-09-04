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
