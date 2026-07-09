// Tutorial video assets, served from the public R2 assets bucket.
// Mirrors the editor's src/frontend/src/config/tutorialVideos.js — kept as a
// standalone copy because the landing site is a separate app with its own build.
// Never hard-code anything about the videos' content (length, chapters, etc.);
// the pipeline re-uploads to these same URLs on every re-record.

const ASSETS_BASE = import.meta.env.VITE_ASSETS_BASE || 'https://assets.reelballers.com';

export interface TutorialAsset {
  /** Short label shown in the playlist indicator (e.g. "1 / 2 · Framing"). */
  title: string;
  videoUrl: string;
  vttUrl: string;
  chaptersUrl: string;
}

function assetFor(base: string, title: string): TutorialAsset {
  return {
    title,
    videoUrl: `${ASSETS_BASE}/tutorials/${base}.mp4`,
    vttUrl: `${ASSETS_BASE}/tutorials/${base}.vtt`,
    chaptersUrl: `${ASSETS_BASE}/tutorials/${base}.chapters.vtt`,
  };
}

const TUTORIALS = {
  annotate: assetFor('annotate', 'Annotate'),
  framing: assetFor('framing', 'Framing'),
  overlay: assetFor('overlay', 'Highlights'),
  publish: assetFor('publish', 'Share'),
};

// Each landing section opens one of these playlists. The Elevate section plays
// the framing then overlay tutorials back-to-back (auto-advance in the player).
export const LEARN_PLAYLIST: TutorialAsset[] = [TUTORIALS.annotate];
export const ELEVATE_PLAYLIST: TutorialAsset[] = [TUTORIALS.framing, TUTORIALS.overlay];
export const CELEBRATE_PLAYLIST: TutorialAsset[] = [TUTORIALS.publish];

// Full end-to-end walkthrough, played back-to-back (hero "See how it works").
export const FULL_WALKTHROUGH: TutorialAsset[] = [
  TUTORIALS.annotate,
  TUTORIALS.framing,
  TUTORIALS.overlay,
  TUTORIALS.publish,
];
