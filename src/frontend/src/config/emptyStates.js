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

import { ANNOTATE, MODE_NAMES } from './displayNames';

// T10280 (2026-09-17): one guidance structure for all four home tabs. Every tab,
// empty or populated, shows the SAME centered headline + body block (rendered by
// `TabGuideHeader` in EmptyTabGuide.jsx: `text-lg font-semibold` headline +
// `text-sm text-gray-400` body). The old FlowStrip (Games . Clips . Reels .
// Published diagram) and its FLOW_STEPS/STEP_COLORS were deleted -- the user found
// the strip redundant with the tab bar directly above it. Copy below is the
// user's own words (2026-09-17 staging), spelling normalized: headline is the
// first sentence, body is the rest. "Framing" is the mode noun (MODE_NAMES.FRAMING),
// never a literal. No em dashes anywhere (project-wide rule).
//
// `body` is now allowed to be multiple sentences (reverses T9390's Decision 2
// one-line cut) -- the user asked for the fuller header + description that Reels
// and Published already had.
//
// Count-interpolated action captions stay functions so the noun pluralizes with
// the count ("1 clip" / "2 clips"); every function branch only renders when its
// count is > 0.
export const EMPTY_TAB_GUIDE = {
  games: {
    headline: 'Review game footage for highlights and learning opportunities.',
    body:
      'Mark plays from game video you want to review with your athlete. ' +
      'Create clips you want to use in highlights.',
    addGameCaption: 'From your phone or computer, 2 credits.',
    // Footer kept ONLY on Games: it carries the "a game is not a hard
    // prerequisite either" message -- have a clip already, skip ahead to Clips.
    footerPrefix: 'Have a clip already? ',
    footerLink: 'Skip ahead on Clips.',
  },
  clips: {
    headline: 'Focus the action on your athlete.',
    body:
      `Clips you marked can be framed. ${MODE_NAMES.FRAMING} focuses the camera on your ` +
      'player and lets you trim and add slo-mo to key moments. A short clip can also ' +
      `skip straight to ${MODE_NAMES.FRAMING}, no game needed.`,
    openGameText: `Open a game and tap ${ANNOTATE.MARK_PLAY}.`, // games > 0 (the Go to Games path)
    uploadText: 'Already have a video?', // games > 0 (the Add Video path)
    // games = 0: Add Video is the ONLY path (Decision 3 removed the cross-tab
    // Add Game create action). This caption tells the user a game is not a
    // prerequisite here, instead of tempting them into a foreign-tab create flow.
    noGameCaption: 'No game needed.',
  },
  reels: {
    headline: 'Build a highlight reel.',
    body: 'You can also combine clips together to make a full highlight reel.',
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
    headline: 'View your completed work.',
    body:
      'Download or share links with family, coaches, and recruiters. If you install ' +
      'the app on your phone you can even post to social directly.',
    // Published is gated on hasClips too (Decision 3), so games are guaranteed
    // here -- the old zero-everything "Add a game to get started" branch was
    // deleted as dead code; this is the fall-through for "has a clip, nothing
    // published yet". T10280 dropped the "N clips in progress" draftsText + the
    // "Open Clips" button -- the headline/body plus this fallback is enough.
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
    body: `Tap ${ANNOTATE.MARK_PLAY} on each moment worth keeping.`,
    cta: 'Open game',
  },
  clips: {
    headline: 'Give each clip a Framing pass',
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
