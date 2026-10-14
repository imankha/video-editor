import { GUIDE } from '../../config/displayNames';

/**
 * T12230 guide spine. Pure (no React): facts in, ONE guide out.
 *
 * facts = {
 *   screen: 'annotate' | 'focus' | 'overlay' | 'home' | 'finished' | 'share',
 *   job: { status: 'none'|'processing'|'finishing'|'failed'|'credits'|'ready' } (focus/overlay),
 *   progress: { selectedPlay: { rating } | null, portrait: { action } | null },
 *   local: { dragDone, hasPlayed, trimStage: 'off'|'split'|'adjust',
 *            hasPlayedThrough, previewing, hasPreviewPlayedThrough, ctaBusy,
 *            isPlaying, hasPlays },
 * }
 * annotate local: { isPlaying, playCount, editorOpen, choiceOpen, reviewing, expired, generating }.
 * Facts are built in render from existing state, never stored.
 *
 * Returns { id, message: {title, body}, anchor: {target, fallback}, avoid: [],
 * pulse, tone, step, phase } or null. First matching rule wins; within a screen
 * the order is: error, job in progress, modal, lowest incomplete step. Rule ids
 * follow T7620 naming (screen.kind.name).
 */
const tid = (id) => `[data-testid="${id}"]`;
const MARK_PLAY = tid('annotate-mark-play-button');
const PLAYS_LIST = tid('annotate-plays-list');
const PORTRAIT_SLOT = tid('annotate-highlight-slot-portrait');
const ANNOTATE_STAGE = tid('annotate-coach-stage');
const FOCUS_STAGE = tid('focus-video-stage');
const TRIM_SCOPE = tid('trim-guide-scope');
const PLAY_BUTTON = tid('play-button');
const PREVIEW_TOGGLE = tid('framing-preview-toggle');
const ACTION_BAND = tid('action-band');
const HOME_HEADING = tid('home-heading');
const UPLOAD_GAME = tid('home-upload-game');
const FIRST_GAME = tid('home-first-game');
const FAILED_GAME = tid('home-failed-game');
const UPLOAD_DROPZONE = tid('upload-dropzone');
const UPLOAD_SUBMIT = tid('upload-submit');

const PLAY_EDITOR_DONE = tid('play-editor-done');
const CHOICE_NOW = tid('highlight-choice-now');
const CHOICE_LATER = tid('highlight-choice-later');
const SHARE_PLAYS = tid('annotate-share-plays');
const annotate = (name, anchor, { pulse = 'portrait', avoid = [], keepClear = [], message = GUIDE.annotate[name] } = {}) =>
  ({ message, anchor: { target: anchor, fallback: ANNOTATE_STAGE }, phase: name, pulse, avoid, keepClear });
const local = (f) => f.local ?? {};
const many = (n) => ({ ...GUIDE.annotate.hasPlaysMany, title: GUIDE.annotate.hasPlaysMany.title.replace('{n}', n) });
const focus = (text, target, step, pulse = null, keepClear = []) => ({
  message: { title: text, body: '' }, anchor: { target, fallback: FOCUS_STAGE }, step, pulse, phase: step ?? pulse, keepClear,
});

const job = (f) => f.job?.status ?? 'none';
const jobRule = (id, screen, status, msg, target, fallback, tone, pulse = null) =>
  ({ id, screen, when: (f) => job(f) === status, message: msg, anchor: { target, fallback }, tone, pulse, avoid: [], step: null, phase: id });
const READY_PANEL = tid('focus-publish-action-bar');
const OVERLAY_READY_PANEL = tid('overlay-publish-action-bar');
const EXPORT_BUTTON = tid('action-band');
const OVERLAY_STAGE = tid('overlay-video-stage');
const FINISHED_SHARE = tid('finished-share-action');
const SHARE_MODAL_BODY = tid('share-modal-body');

// T12620: `pulse` names the ONE control the sentence tells the user to press ('first-game' | 'tab-published'); null = no pulse.
const home = (msg, anchor, { id, tone = 'coach', avoid = [], keepClear = [], pulse = null } = {}) => ({
  message: msg, anchor: { target: anchor, fallback: HOME_HEADING }, avoid, keepClear, tone, phase: id, pulse,
});
// T12620: the cutout holds every control a sentence tells the user to press, not just its anchor.
const TAB_GAMES = tid('home-tab-games');
const TAB_PUBLISHED = tid('home-tab-published');
const CLIPS_GALLERY = tid('clips-gallery');
const UPLOAD_CLIP = tid('home-upload-clip');
const PUBLISHED_PANEL = tid('published-tab-panel');
const CLIPS_KEEP_CLEAR = [CLIPS_GALLERY, TAB_GAMES, UPLOAD_CLIP];
const PLAY_RATING = tid('rating-input');
const HIGHLIGHT_SLOTS = tid('annotate-highlight-slots');
const EDIT_PLAY = tid('annotate-primary-cta');
const hp = (f) => f.progress ?? {};

/**
 * T12250: Home / Upload-modal facts. `tab` is 'games' | 'clips' | 'finished';
 * `modal` is null | 'choose' | 'submit'. Counts come from lists the Home screen
 * already holds (nothing stored): games, games with saved plays, in-flight
 * uploads, failed uploads, unfinished clip drafts, Finished highlights.
 */
export function homeFacts({ tab = 'games', modal = null, games = 0, gamesWithPlays = 0, uploading = 0, failed = 0, drafts = 0, finished = 0 } = {}) {
  return { screen: 'home', progress: { games, gamesWithPlays, uploading, failed, drafts, finished }, local: { tab, modal } };
}

const PORTRAIT_PHASE = { overlay: 'spotlight', preview: 'preview', published: 'published' };
const isBrilliant = (f) => f.progress?.selectedPlay?.rating === 5;
const portraitIs = (f, phase) => isBrilliant(f) && f.progress.portrait && (PORTRAIT_PHASE[f.progress.portrait.action] ?? 'portrait') === phase;

const pk = (f) => local(f).pick ?? null;
// T12340: `pulse: 'pick-box'` marks the athlete boxes the user still has to click (a recommendation only).
const pickRule = (id, when, msg, target = OVERLAY_STAGE, tone = 'coach', pulse = null) =>
  ({ id, screen: 'overlay', when: (f) => pk(f) && when(pk(f)), message: msg, anchor: { target, fallback: OVERLAY_STAGE }, tone, pulse, avoid: [], step: null, phase: id });

/**
 * T12350: the ONE classifier for the spotlight pick walk. The pick guide component and the
 * athlete-box pulse both call this, so the state a user is shown and the state the boxes
 * react to cannot disagree. Returns null when no walk is active (phase null).
 */
export function resolvePickGuide({ phase, step = null, total = 0, assigned = 0, boxed = true, noBoxes = false } = {}) {
  if (!phase) return null;
  return resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { pick: { phase, step, total, assigned, boxed, noBoxes } } });
}

export const GUIDE_RULES = [
  // T12260: modal/error states first, then the editor, then the selected play's steps, then the game.
  { id: 'annotate.expired', screen: 'annotate', when: (f) => local(f).expired, ...annotate('expired', ANNOTATE_STAGE, { pulse: null }) },
  { id: 'annotate.choice', screen: 'annotate', when: (f) => local(f).choiceOpen, ...annotate('choice', CHOICE_NOW, { pulse: null, avoid: [CHOICE_NOW, CHOICE_LATER] }) },
  { id: 'annotate.editor', screen: 'annotate', when: (f) => local(f).editorOpen,
    ...annotate('editor', PLAY_EDITOR_DONE, { pulse: null, avoid: [tid('scrub-start-handle'), tid('scrub-end-handle'), tid('scrub-track'), tid('delete-play-button')], keepClear: [tid('scrub-start-handle'), tid('scrub-end-handle'), PLAY_RATING] }) },
  { id: 'annotate.review', screen: 'annotate', when: (f) => local(f).reviewing, ...annotate('review', SHARE_PLAYS, { pulse: null }) },
  { id: 'annotate.selected.generating', screen: 'annotate', when: (f) => isBrilliant(f) && local(f).generating, ...annotate('generating', PORTRAIT_SLOT, { pulse: null }) },
  { id: 'annotate.progress.brilliant', screen: 'annotate', when: (f) => isBrilliant(f) && !f.progress.portrait, ...annotate('brilliant', PORTRAIT_SLOT) },
  { id: 'annotate.progress.spotlight', screen: 'annotate', when: (f) => portraitIs(f, 'spotlight'), ...annotate('spotlight', PORTRAIT_SLOT) },
  { id: 'annotate.progress.preview', screen: 'annotate', when: (f) => portraitIs(f, 'preview'), ...annotate('preview', PORTRAIT_SLOT) },
  { id: 'annotate.progress.published', screen: 'annotate', when: (f) => portraitIs(f, 'published'), ...annotate('published', PORTRAIT_SLOT) },
  { id: 'annotate.progress.portrait', screen: 'annotate', when: (f) => portraitIs(f, 'portrait'), ...annotate('portrait', PORTRAIT_SLOT) },
  // A play below 5 stars is not a highlight candidate: say what it can do, not how to mark.
  { id: 'annotate.selected.none', screen: 'annotate', when: (f) => f.progress?.selectedPlay, ...annotate('selectedNone', HIGHLIGHT_SLOTS, { pulse: null, keepClear: [EDIT_PLAY] }) },
  { id: 'annotate.has-plays.many', screen: 'annotate', when: (f) => local(f).playCount > 1, ...annotate('hasPlaysMany', PLAYS_LIST, { pulse: null, keepClear: [MARK_PLAY] }) },
  { id: 'annotate.has-plays.one', screen: 'annotate', when: (f) => local(f).playCount === 1, ...annotate('hasPlaysOne', PLAYS_LIST, { pulse: null, keepClear: [MARK_PLAY] }) },
  { id: 'annotate.watch.playing', screen: 'annotate', when: (f) => local(f).isPlaying, ...annotate('watchPlaying', MARK_PLAY, { pulse: 'mark-play', keepClear: [ANNOTATE_STAGE] }) },
  { id: 'annotate.progress.watch', screen: 'annotate', when: () => true, ...annotate('watch', MARK_PLAY, { pulse: 'mark-play', keepClear: [ANNOTATE_STAGE] }) },

  // T12250: Home tabs + Upload modal. Modal, then error, then lowest incomplete step.
  { id: 'upload.choose', screen: 'home', when: (f) => f.local.modal === 'choose', ...home(GUIDE.upload.choose, UPLOAD_DROPZONE, { id: 'upload-choose' }) },
  { id: 'upload.submit', screen: 'home', when: (f) => f.local.modal === 'submit', ...home(GUIDE.upload.submit, UPLOAD_SUBMIT, { id: 'upload-submit' }) },
  { id: 'upload.failed', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).failed > 0, ...home(GUIDE.upload.failed, FAILED_GAME, { id: 'upload-failed', tone: 'strong' }) },
  { id: 'home.games.empty', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).games === 0 && hp(f).uploading === 0, ...home(GUIDE.home.gamesEmpty, UPLOAD_GAME, { id: 'home-games-empty' }) },
  { id: 'home.games.uploading', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).uploading > 0, ...home(GUIDE.home.gamesUploading, FIRST_GAME, { id: 'home-games-uploading', avoid: [UPLOAD_GAME], pulse: 'first-game' }) },
  { id: 'home.games.finished', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).finished > 0, ...home(GUIDE.home.gamesFinished, TAB_PUBLISHED, { id: 'home-games-finished', avoid: [UPLOAD_GAME], pulse: 'tab-published' }) },
  { id: 'home.games.no-plays', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).gamesWithPlays === 0, ...home(GUIDE.home.gamesNoPlays, FIRST_GAME, { id: 'home-games-no-plays', avoid: [UPLOAD_GAME], pulse: 'first-game' }) },
  { id: 'home.games.plays', screen: 'home', when: (f) => f.local.tab === 'games', ...home(GUIDE.home.gamesPlays, FIRST_GAME, { id: 'home-games-plays', avoid: [UPLOAD_GAME], pulse: 'first-game' }) },
  { id: 'home.clips.unfinished', screen: 'home', when: (f) => f.local.tab === 'clips' && hp(f).drafts > 0, ...home(GUIDE.home.clipsUnfinished, HOME_HEADING, { id: 'home-clips-unfinished', keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.clips.all-done', screen: 'home', when: (f) => f.local.tab === 'clips' && hp(f).finished > 0, ...home(GUIDE.home.clipsAllDone, HOME_HEADING, { id: 'home-clips-all-done', keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.clips.empty', screen: 'home', when: (f) => f.local.tab === 'clips', ...home(GUIDE.home.clipsEmpty, HOME_HEADING, { id: 'home-clips-empty', keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.finished.many', screen: 'home', when: (f) => f.local.tab === 'finished' && hp(f).finished > 1, ...home(GUIDE.home.finishedMany, HOME_HEADING, { id: 'home-finished-many', keepClear: [PUBLISHED_PANEL] }) },
  { id: 'home.finished.first', screen: 'home', when: (f) => f.local.tab === 'finished' && hp(f).finished > 0, ...home(GUIDE.home.finishedFirst, HOME_HEADING, { id: 'home-finished-first', keepClear: [PUBLISHED_PANEL] }) },
  { id: 'home.finished.empty', screen: 'home', when: (f) => f.local.tab === 'finished', ...home(GUIDE.home.finishedEmpty, HOME_HEADING, { id: 'home-finished-empty', keepClear: [TAB_GAMES] }) },

  // T12270: export job state outranks every step (Focus facts carry job.status).
  jobRule('focus.credits', 'focus', 'credits', { title: GUIDE.focus.credits, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'strong', 'credits'),
  jobRule('focus.failed', 'focus', 'failed', { title: GUIDE.focus.failed, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'strong'),
  jobRule('focus.progress.export', 'focus', 'processing', { title: GUIDE.focus.progressExport, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'progress'),
  jobRule('focus.finishing', 'focus', 'finishing', { title: GUIDE.focus.finishing, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'progress'),
  jobRule('focus.ready', 'focus', 'ready', { title: GUIDE.focus.ready, body: '' }, READY_PANEL, FOCUS_STAGE, 'coach'),
  // T12470: a draft whose framing is already rendered has nothing left to coach (the CTA is Back to Preview).
  { id: 'focus.rendered', screen: 'focus', when: (f) => f.local.rendered, silent: true },
  { id: 'focus.progress.drag', screen: 'focus', when: (f) => !f.local.dragDone, ...focus(GUIDE.focus.drag, FOCUS_STAGE, 1) },
  { id: 'focus.progress.play', screen: 'focus', when: (f) => !f.local.hasPlayed, ...focus(GUIDE.focus.play, FOCUS_STAGE, 2, null, [FOCUS_STAGE, PLAY_BUTTON]), avoid: [PLAY_BUTTON] },
  { id: 'focus.progress.trimSplit', screen: 'focus', when: (f) => f.local.trimStage === 'split', ...focus(GUIDE.focus.trimSplit, TRIM_SCOPE, null, 'split') },
  { id: 'focus.progress.trimAdjust', screen: 'focus', when: (f) => f.local.trimStage === 'adjust', ...focus(GUIDE.focus.trimAdjust, TRIM_SCOPE, null, 'adjust') },
  { id: 'focus.progress.keep', screen: 'focus', when: (f) => !f.local.hasPlayedThrough && !f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.keep, FOCUS_STAGE, 3) },
  { id: 'focus.progress.watchPreview', screen: 'focus', when: (f) => f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.watchPreview, PREVIEW_TOGGLE, 4, null, [FOCUS_STAGE]) },
  { id: 'focus.progress.preview', screen: 'focus', when: (f) => !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.preview, PREVIEW_TOGGLE, 4) },
  // While the Preview/Generate button is itself busy the guide is silent (documented null).
  { id: 'focus.progress.generate.advanced', screen: 'focus', when: (f) => !f.local.ctaBusy && job(f) === 'none' && (hp(f).finishedCount ?? 0) > 1, ...focus(GUIDE.focus.generateAdvanced, ACTION_BAND, 5) },
  { id: 'focus.progress.generate', screen: 'focus', when: (f) => !f.local.ctaBusy && job(f) === 'none', ...focus(GUIDE.focus.generate, ACTION_BAND, 5) },
  jobRule('overlay.failed', 'overlay', 'failed', { title: GUIDE.overlay.failed, body: '' }, EXPORT_BUTTON, OVERLAY_STAGE, 'error'),
  jobRule('overlay.progress', 'overlay', 'processing', { title: GUIDE.overlay.progress, body: '' }, EXPORT_BUTTON, OVERLAY_STAGE, 'progress'),
  jobRule('overlay.ready', 'overlay', 'ready', { title: GUIDE.overlay.ready, body: '' }, OVERLAY_READY_PANEL, OVERLAY_STAGE, 'coach'),
  // T12290: finished viewer (silent once a link exists: the link card is the instruction) and share modal.
  { id: 'finished.viewer', screen: 'finished', when: (f) => !local(f).shared, message: { title: GUIDE.finished.viewer, body: '' }, anchor: { target: FINISHED_SHARE, fallback: FINISHED_SHARE }, tone: 'coach', pulse: null, avoid: [], step: null, phase: 'finished-viewer' },
  // End of the first-highlight walk: the link exists, so offer to turn the guide off.
  { id: 'finished.done', screen: 'finished', when: () => true, message: { title: GUIDE.finished.done, body: '' }, cta: GUIDE.finished.doneCta, anchor: { target: FINISHED_SHARE, fallback: FINISHED_SHARE }, tone: 'coach', pulse: null, avoid: [], step: null, phase: 'finished-done' },
  { id: 'share.modal', screen: 'share', when: () => true, message: { title: GUIDE.share.modal, body: '' }, anchor: { target: SHARE_MODAL_BODY, fallback: SHARE_MODAL_BODY }, tone: 'coach', pulse: null, avoid: [], step: null, phase: 'share-modal' },
  // T12280: spotlight pick walk (facts.local.pick = {phase, step, total, assigned, boxed, noBoxes}).
  pickRule('overlay.pick.done', (p) => p.phase === 'done', GUIDE.overlay.pick.done, EXPORT_BUTTON, 'strong'),
  pickRule('overlay.pick.away', (p) => p.phase === 'away', GUIDE.overlay.pick.away),
  pickRule('overlay.pick.none', (p) => p.noBoxes, GUIDE.overlay.pick.none),
  pickRule('overlay.pick.not-outlined', (p) => p.phase === 'parked' && p.boxed === false, GUIDE.overlay.pick.notOutlined),
  pickRule('overlay.pick.next', (p) => p.phase === 'confirm', GUIDE.overlay.pick.next),
  pickRule('overlay.pick.first', (p) => p.phase === 'parked' && p.assigned === 0, GUIDE.overlay.pick.first, OVERLAY_STAGE, 'coach', 'pick-box'),
  pickRule('overlay.pick.at-marker', (p) => p.phase === 'parked', GUIDE.overlay.pick.atMarker, OVERLAY_STAGE, 'coach', 'pick-box'),
  { id: 'overlay.text', screen: 'overlay', when: (f) => local(f).textOpen, message: { title: GUIDE.overlay.text, body: '' }, anchor: { target: OVERLAY_STAGE, fallback: OVERLAY_STAGE }, tone: 'coach', pulse: null, avoid: [], step: null, phase: 'overlay-text' },
];

const fillPick = (msg, p) => {
  const sub = (t) => t.replace('{n}', p.total).replace('{k}', p.step);
  return { title: sub(msg.title), body: sub(msg.body) };
};

export function resolveGuide(facts) {
  const rule = GUIDE_RULES.find((r) => r.screen === facts?.screen && r.when(facts));
  if (!rule || rule.silent) return null;
  const { id, anchor, cta = null, step = null, pulse = null, phase, avoid = [], keepClear = [], tone = 'coach' } = rule;
  let message = id === 'annotate.has-plays.many' ? many(facts.local.playCount) : rule.message;
  if (id === 'home.finished.many') message = { ...GUIDE.home.finishedMany, title: GUIDE.home.finishedMany.title.replace('{n}', hp(facts).finished) };
  if (id.startsWith('overlay.pick.')) message = fillPick(message, facts.local.pick);
  return { id, message, cta, anchor, avoid, keepClear, pulse, tone, step, phase };
}

const play = (rating, portrait = null) => ({ selectedPlay: rating == null ? null : { rating }, portrait });
const fl = (over) => ({
  dragDone: true, hasPlayed: true, trimStage: 'off', hasPlayedThrough: true,
  previewing: false, hasPreviewPlayedThrough: true, ctaBusy: false, ...over,
});

/** Enumerable fixture facts, one per reachable state, with the rule each must resolve to. */
export const GUIDE_STATES = [
  { name: 'annotate: nothing selected', expectId: 'annotate.progress.watch', facts: { screen: 'annotate', progress: play(null), local: {} } },
  { name: 'annotate: watching', expectId: 'annotate.watch.playing', facts: { screen: 'annotate', progress: play(null), local: { isPlaying: true } } },
  { name: 'annotate: one play marked', expectId: 'annotate.has-plays.one', facts: { screen: 'annotate', progress: play(null), local: { playCount: 1 } } },
  { name: 'annotate: several plays marked', expectId: 'annotate.has-plays.many', facts: { screen: 'annotate', progress: play(null), local: { playCount: 4 } } },
  { name: 'annotate: 3-star play selected', expectId: 'annotate.selected.none', facts: { screen: 'annotate', progress: play(3), local: { playCount: 1 } } },
  { name: 'annotate: play editor open', expectId: 'annotate.editor', facts: { screen: 'annotate', progress: play(3), local: { editorOpen: true } } },
  { name: 'annotate: Done choice card', expectId: 'annotate.choice', facts: { screen: 'annotate', progress: play(5), local: { editorOpen: true, choiceOpen: true } } },
  { name: 'annotate: review plays', expectId: 'annotate.review', facts: { screen: 'annotate', progress: play(null), local: { reviewing: true, playCount: 2 } } },
  { name: 'annotate: source expired', expectId: 'annotate.expired', facts: { screen: 'annotate', progress: play(null), local: { expired: true } } },
  { name: 'annotate: highlight generating', expectId: 'annotate.selected.generating', facts: { screen: 'annotate', progress: play(5, { action: 'framing' }), local: { generating: true } } },
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
  { name: 'focus: framing already rendered (documented null, T12470)', expectId: null, facts: { screen: 'focus', local: fl({ rendered: true, dragDone: false }) } },
  { name: 'focus: Preview/Generate button busy (documented null)', expectId: null, facts: { screen: 'focus', local: fl({ ctaBusy: true }) } },
  { name: 'focus: ready to generate, 2+ finished', expectId: 'focus.progress.generate.advanced', facts: { screen: 'focus', progress: { finishedCount: 2 }, local: fl() } },
  { name: 'focus: export processing', expectId: 'focus.progress.export', facts: { screen: 'focus', job: { status: 'processing' }, local: fl() } },
  { name: 'focus: export complete, opening preview (finishing)', expectId: 'focus.finishing', facts: { screen: 'focus', job: { status: 'finishing' }, local: fl() } },
  { name: 'focus: export error', expectId: 'focus.failed', facts: { screen: 'focus', job: { status: 'failed' }, local: fl() } },
  { name: 'focus: needs credits', expectId: 'focus.credits', facts: { screen: 'focus', job: { status: 'credits' }, local: fl() } },
  { name: 'focus: ready panel', expectId: 'focus.ready', facts: { screen: 'focus', job: { status: 'ready' }, local: fl() } },
  { name: 'pick: first moment', expectId: 'overlay.pick.first', facts: { screen: 'overlay', local: { pick: { phase: 'parked', step: 1, total: 4, assigned: 0, boxed: true } } } },
  { name: 'pick: just tapped', expectId: 'overlay.pick.next', facts: { screen: 'overlay', local: { pick: { phase: 'confirm', step: 1, total: 4, assigned: 1, boxed: true } } } },
  { name: 'pick: away, back at the marker', expectId: 'overlay.pick.at-marker', facts: { screen: 'overlay', local: { pick: { phase: 'parked', step: 2, total: 4, assigned: 1, boxed: true, atMarker: true } } } },
  { name: 'pick: scrubbed away', expectId: 'overlay.pick.away', facts: { screen: 'overlay', local: { pick: { phase: 'away', step: 2, total: 4, assigned: 1, boxed: true } } } },
  { name: 'pick: athlete not outlined', expectId: 'overlay.pick.not-outlined', facts: { screen: 'overlay', local: { pick: { phase: 'parked', step: 2, total: 4, assigned: 1, boxed: false } } } },
  { name: 'pick: nothing detected', expectId: 'overlay.pick.none', facts: { screen: 'overlay', local: { pick: { phase: 'parked', step: 1, total: 4, assigned: 0, boxed: false, noBoxes: true } } } },
  { name: 'pick: done', expectId: 'overlay.pick.done', facts: { screen: 'overlay', local: { pick: { phase: 'done', step: null, total: 4, assigned: 4 } } } },
  { name: 'overlay: text overlay open', expectId: 'overlay.text', facts: { screen: 'overlay', local: { textOpen: true } } },
  { name: 'overlay: spotlight processing', expectId: 'overlay.progress', facts: { screen: 'overlay', job: { status: 'processing' }, local: {} } },
  { name: 'overlay: spotlight error', expectId: 'overlay.failed', facts: { screen: 'overlay', job: { status: 'failed' }, local: {} } },
  { name: 'overlay: ready panel', expectId: 'overlay.ready', facts: { screen: 'overlay', job: { status: 'ready' }, local: {} } },
  ...[
    ['upload modal, no file', { modal: 'choose' }, 'upload.choose'],
    ['upload modal, file picked', { modal: 'submit' }, 'upload.submit'],
    ['upload failed', { games: 1, failed: 1 }, 'upload.failed'],
    ['games: none', {}, 'home.games.empty'],
    ['games: uploading', { games: 1, uploading: 1 }, 'home.games.uploading'],
    ['games: no plays', { games: 1 }, 'home.games.no-plays'],
    ['games: plays', { games: 1, gamesWithPlays: 1 }, 'home.games.plays'],
    ['games: finished exists', { games: 1, gamesWithPlays: 1, finished: 1 }, 'home.games.finished'],
    ['clips: none', { tab: 'clips' }, 'home.clips.empty'],
    ['clips: unfinished', { tab: 'clips', drafts: 2 }, 'home.clips.unfinished'],
    ['clips: all done', { tab: 'clips', finished: 1 }, 'home.clips.all-done'],
    ['finished: first', { tab: 'finished', finished: 1 }, 'home.finished.first'],
    ['finished: two or more', { tab: 'finished', finished: 2 }, 'home.finished.many'],
    ['finished: empty', { tab: 'finished' }, 'home.finished.empty'],
  ].map(([name, over, expectId]) => ({ name: `home: ${name}`, expectId, facts: homeFacts(over) })),
  { name: 'finished viewer: not shared', expectId: 'finished.viewer', facts: { screen: 'finished', local: { shared: false } } },
  { name: 'finished viewer: shared (turn-off message)', expectId: 'finished.done', facts: { screen: 'finished', local: { shared: true } } },
  { name: 'share modal', expectId: 'share.modal', facts: { screen: 'share', local: {} } },
  { name: 'unknown screen (documented null)', expectId: null, facts: { screen: 'nowhere', local: {} } },
];
