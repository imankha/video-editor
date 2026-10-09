import { GUIDE } from '../../config/displayNames';

/**
 * T12230 guide spine. Pure (no React): facts in, ONE guide out.
 *
 * facts = {
 *   screen: 'annotate' | 'focus',
 *   progress: { selectedPlay: { rating } | null, portrait: { action } | null },
 *   local: { dragDone, hasPlayed, trimStage: 'off'|'split'|'adjust',
 *            hasPlayedThrough, previewing, hasPreviewPlayedThrough, ctaBusy,
 *            isPlaying, hasPlays },
 * }
 * Facts are built in render from existing state, never stored.
 *
 * Returns { id, message: {title, body}, anchor: {target, fallback}, avoid: [],
 * pulse, tone, step, phase } or null. First matching rule wins; within a screen
 * the order is: error, job in progress, modal, lowest incomplete step. Rule ids
 * follow T7620 naming (screen.kind.name).
 */
const tid = (id) => `[data-testid="${id}"]`;
const MARK_PLAY = tid('annotate-mark-play-button');
const PORTRAIT_SLOT = tid('annotate-highlight-slot-portrait');
const ANNOTATE_STAGE = tid('annotate-coach-stage');
const FOCUS_STAGE = tid('focus-video-stage');
const TRIM_SCOPE = tid('trim-guide-scope');
const PREVIEW_TOGGLE = tid('framing-preview-toggle');
const ACTION_BAND = tid('action-band');

const annotate = (name, anchor) => ({ message: GUIDE.annotate[name], anchor: { target: anchor, fallback: ANNOTATE_STAGE }, phase: name, pulse: name === 'watch' ? 'mark-play' : 'portrait' });
const focus = (text, target, step, pulse = null) => ({
  message: { title: text, body: '' }, anchor: { target, fallback: FOCUS_STAGE }, step, pulse, phase: step ?? pulse,
});

const PORTRAIT_PHASE = { overlay: 'spotlight', preview: 'preview', published: 'published' };
const isBrilliant = (f) => f.progress?.selectedPlay?.rating === 5;
const portraitIs = (f, phase) => isBrilliant(f) && f.progress.portrait && (PORTRAIT_PHASE[f.progress.portrait.action] ?? 'portrait') === phase;

export const GUIDE_RULES = [
  { id: 'annotate.progress.brilliant', screen: 'annotate', when: (f) => isBrilliant(f) && !f.progress.portrait, ...annotate('brilliant', PORTRAIT_SLOT) },
  { id: 'annotate.progress.spotlight', screen: 'annotate', when: (f) => portraitIs(f, 'spotlight'), ...annotate('spotlight', PORTRAIT_SLOT) },
  { id: 'annotate.progress.preview', screen: 'annotate', when: (f) => portraitIs(f, 'preview'), ...annotate('preview', PORTRAIT_SLOT) },
  { id: 'annotate.progress.published', screen: 'annotate', when: (f) => portraitIs(f, 'published'), ...annotate('published', PORTRAIT_SLOT) },
  { id: 'annotate.progress.portrait', screen: 'annotate', when: (f) => portraitIs(f, 'portrait'), ...annotate('portrait', PORTRAIT_SLOT) },
  // A play below 5 stars (or no play selected) teaches marking.
  { id: 'annotate.progress.watch', screen: 'annotate', when: () => true, ...annotate('watch', MARK_PLAY) },

  { id: 'focus.progress.drag', screen: 'focus', when: (f) => !f.local.dragDone, ...focus(GUIDE.focus.drag, FOCUS_STAGE, 1) },
  { id: 'focus.progress.play', screen: 'focus', when: (f) => !f.local.hasPlayed, ...focus(GUIDE.focus.play, FOCUS_STAGE, 2) },
  { id: 'focus.progress.trimSplit', screen: 'focus', when: (f) => f.local.trimStage === 'split', ...focus(GUIDE.focus.trimSplit, TRIM_SCOPE, null, 'split') },
  { id: 'focus.progress.trimAdjust', screen: 'focus', when: (f) => f.local.trimStage === 'adjust', ...focus(GUIDE.focus.trimAdjust, TRIM_SCOPE, null, 'adjust') },
  { id: 'focus.progress.keep', screen: 'focus', when: (f) => !f.local.hasPlayedThrough && !f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.keep, FOCUS_STAGE, 3) },
  { id: 'focus.progress.watchPreview', screen: 'focus', when: (f) => f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.watchPreview, PREVIEW_TOGGLE, 4) },
  { id: 'focus.progress.preview', screen: 'focus', when: (f) => !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.preview, PREVIEW_TOGGLE, 4) },
  // While the Preview/Generate button is itself busy the guide is silent (documented null).
  { id: 'focus.progress.generate', screen: 'focus', when: (f) => !f.local.ctaBusy, ...focus(GUIDE.focus.generate, ACTION_BAND, 5) },
];

export function resolveGuide(facts) {
  const rule = GUIDE_RULES.find((r) => r.screen === facts?.screen && r.when(facts));
  if (!rule) return null;
  const { id, message, anchor, step = null, pulse = null, phase } = rule;
  return { id, message, anchor, avoid: [], pulse, tone: 'coach', step, phase };
}

const play = (rating, portrait = null) => ({ selectedPlay: rating == null ? null : { rating }, portrait });
const fl = (over) => ({
  dragDone: true, hasPlayed: true, trimStage: 'off', hasPlayedThrough: true,
  previewing: false, hasPreviewPlayedThrough: true, ctaBusy: false, ...over,
});

/** Enumerable fixture facts, one per reachable state, with the rule each must resolve to. */
export const GUIDE_STATES = [
  { name: 'annotate: nothing selected', expectId: 'annotate.progress.watch', facts: { screen: 'annotate', progress: play(null), local: {} } },
  { name: 'annotate: 3-star play', expectId: 'annotate.progress.watch', facts: { screen: 'annotate', progress: play(3), local: {} } },
  { name: 'annotate: 5-star, no portrait', expectId: 'annotate.progress.brilliant', facts: { screen: 'annotate', progress: play(5), local: {} } },
  { name: 'annotate: 5-star, portrait in framing', expectId: 'annotate.progress.portrait', facts: { screen: 'annotate', progress: play(5, { action: 'framing' }), local: {} } },
  { name: 'annotate: 5-star, portrait at spotlight', expectId: 'annotate.progress.spotlight', facts: { screen: 'annotate', progress: play(5, { action: 'overlay' }), local: {} } },
  { name: 'annotate: 5-star, portrait at preview', expectId: 'annotate.progress.preview', facts: { screen: 'annotate', progress: play(5, { action: 'preview' }), local: {} } },
  { name: 'annotate: 5-star, portrait published', expectId: 'annotate.progress.published', facts: { screen: 'annotate', progress: play(5, { action: 'published' }), local: {} } },
  { name: 'focus: no drag yet', expectId: 'focus.progress.drag', facts: { screen: 'focus', local: fl({ dragDone: false, hasPlayed: false, hasPlayedThrough: false, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: dragged, not played', expectId: 'focus.progress.play', facts: { screen: 'focus', local: fl({ hasPlayed: false, hasPlayedThrough: false, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: trim split', expectId: 'focus.progress.trimSplit', facts: { screen: 'focus', local: fl({ trimStage: 'split', hasPlayedThrough: false, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: trim adjust', expectId: 'focus.progress.trimAdjust', facts: { screen: 'focus', local: fl({ trimStage: 'adjust', hasPlayedThrough: false, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: keep box on athlete', expectId: 'focus.progress.keep', facts: { screen: 'focus', local: fl({ hasPlayedThrough: false, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: ready to preview', expectId: 'focus.progress.preview', facts: { screen: 'focus', local: fl({ hasPreviewPlayedThrough: false }) } },
  { name: 'focus: previewing', expectId: 'focus.progress.watchPreview', facts: { screen: 'focus', local: fl({ previewing: true, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: ready to generate', expectId: 'focus.progress.generate', facts: { screen: 'focus', local: fl() } },
  { name: 'focus: Preview/Generate button busy (documented null)', expectId: null, facts: { screen: 'focus', local: fl({ ctaBusy: true }) } },
  { name: 'unknown screen (documented null)', expectId: null, facts: { screen: 'nowhere', local: {} } },
];
