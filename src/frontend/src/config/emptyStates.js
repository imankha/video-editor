// T8980/T9390: copy for the shared EmptyTabGuide rendered by all four home tabs.
// Copy is APPROVED (T9390 binding spec, 2026-09-09) and binding -- do not
// paraphrase. No em dashes anywhere (project-wide rule). Vocabulary is T8130's
// approved nouns (Plays, Clips, Reels) + displayNames.js (SECTION_NAMES,
// CLIP_UPLOAD); no new vocabulary is introduced here.
//
// T9390 (Decision 2) cut every empty-variant tab to a headline + ONE short line
// (footer kept only on Games). Decision 1 demoted Reels to an unnumbered
// "optional" pill in the flow strip. Decision 3 removed the cross-tab "Add Game"
// action from Clips (zero games shows Add Video alone) and gates Reels/Published
// at the tab bar, which let the Reels "no clips" branch and the Published
// "nothing" branch be deleted as dead code (see EmptyTabGuide.jsx).

import { SECTION_NAMES_SHORT } from './displayNames';

// The four home tabs in flow order. `key` is the EmptyTabGuide semantic id (also
// the flow-strip step id and the STEP_COLORS key in EmptyTabGuide.jsx); `label`
// is the short one-line step name (SECTION_NAMES_SHORT -- the same words the
// sub-`sm` tab bar uses, single source); `navId` is the setActiveTab id that
// switches to that tab (the frozen tab ids, note `clips` -> `projects` from
// T8555's deep-link compat freeze). T9390: Reels carries `optional: true` -- it
// is a single publish for a full game/season, not a required step between Clips
// and Published, so the strip renders it as a detour pill. T9530 (N46) removed
// step numbering entirely: the four destinations render as unnumbered peers, so
// no step gets a number in code or on screen (the `optional` flag now only drives
// Reels' dashed-pill styling, not a number-skip).
export const FLOW_STEPS = [
  { key: 'games', label: SECTION_NAMES_SHORT.GAMES, navId: 'games' },
  { key: 'clips', label: SECTION_NAMES_SHORT.CLIPS, navId: 'projects' },
  { key: 'reels', label: SECTION_NAMES_SHORT.REELS, navId: 'inProgressReels', optional: true },
  { key: 'published', label: SECTION_NAMES_SHORT.PUBLISHED, navId: 'published' },
];

// Per-tab copy (empty variant). `body` is now a single short line (Decision 2).
// Count-interpolated captions are functions so the noun pluralizes with the
// count ("1 clip" / "2 clips"), matching the existing CollectionsTab pattern;
// every function branch only renders when its count is > 0.
export const EMPTY_TAB_GUIDE = {
  games: {
    headline: 'Start with a game',
    body: 'Upload a recording, then tap Add Play on the moments worth keeping.',
    addGameCaption: 'From your phone or computer, 2 credits.',
    // Footer kept ONLY on Games (Decision 2): it carries the "a game is not a
    // hard prerequisite either" message -- the Games->Clips edge of the same
    // "not everything here is mandatory" point Decision 1 makes for Clips->Reels.
    footerPrefix: 'Have a clip already? ',
    footerLink: 'Skip ahead on Clips.',
  },
  clips: {
    headline: 'Cut a clip, or upload one',
    body: 'Clips get a Focus pass, then publish alone or into a reel.',
    openGameText: 'Open a game and tap Add Play.', // games > 0 (the Go to Games path)
    uploadText: 'Already have a video?', // games > 0 (the Add Video path)
    // games = 0: Add Video is the ONLY path (Decision 3 removed the cross-tab
    // Add Game create action). This caption tells the user a game is not a
    // prerequisite here, instead of tempting them into a foreign-tab create flow.
    noGameCaption: 'No game needed.',
  },
  reels: {
    headline: 'Combine clips into one reel',
    body: 'Order your clips and export once, or publish a single clip on its own.',
    // Build New Reel is gated by hasClips at the TAB BAR now (Decision 3), so the
    // empty Reels guide only renders when a clip exists -- the button is always
    // enabled here and the old "no clips" branch was deleted as dead code.
    // clipCount is clipDrafts-only (the In Progress Clips badge number); it can be
    // 0 while hasClips is true (an account with only game clips), so drop the
    // number in that case rather than print a contradictory "0 clips".
    hasClipsCaption: (n) =>
      n > 0 ? `You have ${n} clip${n === 1 ? '' : 's'} ready to use.` : 'You have clips ready to use.',
  },
  published: {
    headline: 'Share what you publish',
    body: 'Every reel or clip gets a link for coaches, family and recruiters.',
    draftsText: (n) =>
      `You have ${n} clip${n === 1 ? '' : 's'} in progress.`,
    // Published is gated on hasClips too (Decision 3), so games are guaranteed
    // here -- the old zero-everything "Add a game to get started" branch was
    // deleted as dead code; this is the fall-through for "has a clip, nothing
    // published yet".
    noClipsGamesText: 'Cut your first clip to get started.',
  },
};

// T8990/T9390: copy for the PARTIAL state -- the compact, tile-shaped variant of
// EmptyTabGuide that keeps coaching a tab until its first row is full (one game,
// or a carousel row the tiles have not yet filled). Copy is LOCKED and binding --
// do not paraphrase. No em dashes anywhere (project-wide rule). Where the empty
// copy is written for absence, this is written for the NEXT step: what to do with
// the thing you just made. T9390 (Decision 2) trimmed each body to one short line
// and dropped every footer (the "step N of M" framing they restated is gone once
// Reels isn't numbered). `cta` is present only where a gesture beyond "the tile is
// the action" is wanted (Games "Open game"); the other three tabs already carry
// their action above the row (Add Video / Build New Reel), so the partial guide
// there is copy-only.
export const PARTIAL_TAB_GUIDE = {
  games: {
    headline: 'Cut your first play',
    body: 'Tap Add Play on each moment worth keeping.',
    cta: 'Open game',
  },
  clips: {
    headline: 'Give each clip a Focus pass',
    body: 'Add an optional Spotlight, then publish it alone or into a reel.',
  },
  reels: {
    headline: 'Finish and export',
    body: 'Put your plays in order and export once to publish.',
  },
  published: {
    // Headline must READ as guidance, never as a control label (T8990 review): the
    // old "Share it" scanned as the real Share button. Name the affordances in the
    // BODY (they point at real controls), not the headline.
    headline: 'Ready for coaches and family',
    body: 'Use Share or Copy Link on any card.',
  },
};
