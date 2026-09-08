// T8980: copy for the shared EmptyTabGuide rendered by all four home tabs when
// empty. Copy is APPROVED (2026-09-07) and binding -- do not paraphrase. No em
// dashes anywhere (project-wide rule). Vocabulary is T8130's approved nouns
// (Plays, Clips, Highlight Reels) + displayNames.js (SECTION_NAMES, CLIP_UPLOAD);
// no new vocabulary is introduced here.

import { SECTION_NAMES_SHORT } from './displayNames';

// The four home tabs in flow order. `key` is the EmptyTabGuide semantic id (also
// the flow-strip step id and the STEP_COLORS key in EmptyTabGuide.jsx); `label`
// is the short one-line step name (SECTION_NAMES_SHORT -- the same words the
// sub-`sm` tab bar uses, single source); `navId` is the setActiveTab id that
// switches to that tab (the frozen tab ids, note `clips` -> `projects` from
// T8555's deep-link compat freeze).
export const FLOW_STEPS = [
  { key: 'games', label: SECTION_NAMES_SHORT.GAMES, navId: 'games' },
  { key: 'clips', label: SECTION_NAMES_SHORT.CLIPS, navId: 'projects' },
  { key: 'reels', label: SECTION_NAMES_SHORT.REELS, navId: 'inProgressReels' },
  { key: 'published', label: SECTION_NAMES_SHORT.PUBLISHED, navId: 'published' },
];

// Per-tab copy. Count-interpolated captions are functions so the noun pluralizes
// with the count ("1 clip" / "2 clips"), matching the existing CollectionsTab
// pattern; every function branch only renders when its count is > 0.
export const EMPTY_TAB_GUIDE = {
  games: {
    headline: 'Every highlight starts with a game',
    body:
      'Upload a full game recording, then open it and tap Add Play at each '
      + 'moment worth keeping. Those plays become your clips, and clips become '
      + 'the reels you share.',
    addGameCaption: 'Video from your phone or computer. 2 credits, stored for 30 days.',
    footerPrefix: 'Already have a short clip? ',
    footerLink: 'Add it directly on In Progress Clips',
  },
  clips: {
    headline: 'Clips are the plays you cut from a game',
    body:
      'Each clip gets a Focus pass to follow your athlete and an optional '
      + 'Spotlight. Then publish it on its own, or build several into a reel.',
    openGameText: 'Open a game and tap Add Play.', // games > 0
    addGameText: 'Add a game and tap Add Play.', // games = 0
    uploadText: 'Upload a short video you already have.',
    footer: 'Published clips show up on the Published tab.',
  },
  reels: {
    headline: 'Reels stitch several clips into one highlight video',
    body:
      'Pick the plays you want, put them in order, and export once. A single '
      + 'clip can be published on its own; a reel is for a full game or a season.',
    noClipsReason: 'You need at least one clip first',
    cutClipButton: 'Cut a clip from a game',
    hasClipsCaption: (n) => `You have ${n} clip${n === 1 ? '' : 's'} ready to use.`,
    footer: 'Finished reels move to Published when you share them.',
  },
  published: {
    headline: 'Published reels are ready to share',
    body:
      'When a clip or reel is finished, Publish moves it here, grouped by game, '
      + 'with a link you can send to coaches, family and recruiters.',
    draftsText: (n) =>
      `You have ${n} clip${n === 1 ? '' : 's'} in progress. Publish one to see it here.`,
    noClipsGamesText: 'Cut your first clip from a game to get started.',
    nothingText: 'Add a game to get started.',
    footer: 'Every published reel gets its own link. Share it from the player or the card.',
  },
};
