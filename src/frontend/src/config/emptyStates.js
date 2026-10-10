// T8980/T9390: copy for the shared EmptyTabGuide rendered by all four home tabs.
// Copy was APPROVED (T9390 binding spec, 2026-09-09) and binding -- do not
// paraphrase. No em dashes anywhere (project-wide rule). Vocabulary is T8130's
// approved nouns (Plays, Clips, Reels) + displayNames.js (SECTION_NAMES,
// CLIP_UPLOAD); no new vocabulary is introduced here.
//
// T9860 (Shared Vocabulary epic, copy and concept sweep, 2026-09-14) supersedes
// specific words in this file as a VOCABULARY CORRECTION mandated by a later
// decision, not a paraphrase of the T9390 spec: "tap/Tap Add Play" was stale
// (T9520 renamed the control to ANNOTATE.MARK_PLAY, this file was missed) and
// "Focus pass" follows the mode noun rename to MODE_NAMES.FRAMING. The rest of the
// T9390 spec is still binding.
//
// T9390 (Decision 2) cut every empty-variant tab to a headline + ONE short line
// (footer kept only on Games). Decision 1 demoted Reels to an unnumbered
// "optional" pill in the flow strip. Decision 3 removed the cross-tab "Add Game"
// action from Clips (zero games shows Add Video alone) and gates Reels/Published
// at the tab bar, which let the Reels "no clips" branch and the Published
// "nothing" branch be deleted as dead code (see EmptyTabGuide.jsx).

import { ANNOTATE } from './displayNames';

// T10280 (2026-09-17): one guidance structure for all four home tabs. Every tab,
// empty or populated, shows the SAME centered headline (rendered by
// `TabGuideHeader` in EmptyTabGuide.jsx: `text-lg font-semibold`). The Games tab
// adds a floating coach line under it: coachNoGames when the account has no games
// (points at the upload button), coachWithGames otherwise. The per-tab `body`
// paragraph was removed when 4e4a18c1b stopped rendering it, so this config holds
// only copy that is actually shown. The old FlowStrip diagram was deleted
// (redundant with the tab bar). No em dashes anywhere (project-wide rule).
//
// Count-interpolated action captions stay functions so the noun pluralizes with
// the count ("1 clip" / "2 clips"); every function branch only renders when its
// count is > 0.
export const EMPTY_TAB_GUIDE = {
  games: {
    headline: 'Review game footage',
    addGameCaption: null,
    // Footer kept ONLY on Games: it carries the "a game is not a hard
    // prerequisite either" message -- have a highlight already, skip ahead to Clips.
    footerPrefix: 'Have a highlight already? ',
    footerLink: 'Skip ahead on Clips.',
  },
  clips: {
    headline: 'Highlights in progress',
    body: "Plays you've started turning into highlights wait here until you finish them.",
    // T12220: zero drafts but a finished highlight exists -> point at Finished.
    finishedMessage: 'Nothing in progress. Your highlight is in Finished.',
    markMorePlays: 'Mark more plays',
    goToFinished: 'Go to Finished',
    openGameText: `Open a game and tap ${ANNOTATE.MARK_PLAY}.`, // games > 0 (the Go to Games path)
    uploadText: 'Already have a video?', // games > 0 (the Add Video path)
    // games = 0: Add Video is the ONLY path (Decision 3 removed the cross-tab
    // Add Game create action). This caption tells the user a game is not a
    // prerequisite here, instead of tempting them into a foreign-tab create flow.
    noGameCaption: 'No game needed.',
  },
  // T11230 removed the `reels` empty-tab copy with the In Progress Reels tab and
  // the Create-reel builder.
  published: {
    headline: 'View your completed work.',
    // T10310 (2026-09-18 user request): dropped the "Cut your first clip to get
    // started." line + Go to Games button -- the headline/body alone is the
    // empty state now, no fallback action.
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
    body: `Tap ${ANNOTATE.MARK_PLAY} on each moment worth keeping.`,
    cta: 'Open game',
  },
  clips: {
    headline: 'Give each highlight a Framing pass',
    // T11230: reworded off "publish it alone or into a reel" -- the Reels building
    // surfaces (Create reel / assemble clips) are gone; a highlight publishes on its own.
    body: 'Add an optional Spotlight, then finish it whenever you are ready.',
  },
  published: {
    // Headline must READ as guidance, never as a control label (T8990 review): the
    // old "Share it" scanned as the real Share button. Name the affordances in the
    // BODY (they point at real controls), not the headline.
    headline: 'Ready for coaches and family',
    body: 'Use Share or Copy Link on any card.',
  },
};
