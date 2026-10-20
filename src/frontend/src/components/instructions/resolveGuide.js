import { GUIDE } from '../../config/displayNames';
import { GUIDE_PULSE } from './guideTargets';

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
 * annotate local: { isPlaying, playCount, editorOpen, choiceOpen, reviewing, expired, uploading, generating }.
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
// The watch step keeps only the picture and its transport bright; the timeline and other cards shade.
const ANNOTATE_PLAYER = [`${ANNOTATE_STAGE} video`, tid('annotate-controls')];
// The editor cuts the picture out of the shade so the user can judge the play's timing (`shadeClear`: the card may still sit over part of it, because the picture fills most of the screen and keeping the card off it too leaves no slot, which put the card on Done). Mobile fullscreen (data-full-bleed-video) is the whole screen, so no cutout there.
const EDITOR_VIDEO = `${ANNOTATE_STAGE}:not([data-full-bleed-video]) video`;
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
// T12760: every rule has exactly one of `pulse` (a GUIDE_PULSE value) or `noPulse` (why the sentence names no pressable control); guideRules.pulse.test.js enforces it.
const annotate = (name, anchor, { pulse = GUIDE_PULSE.PORTRAIT_SLOT, noPulse, avoid = [], keepClear = [], shadeClear = [], compact = false, message = GUIDE.annotate[name] } = {}) =>
  ({ message, anchor: { target: anchor, fallback: ANNOTATE_STAGE }, phase: name, pulse: noPulse ? null : pulse, noPulse, avoid, keepClear, shadeClear, compact });
const local = (f) => f.local ?? {};
const many = (n) => ({ ...GUIDE.annotate.hasPlaysMany, title: GUIDE.annotate.hasPlaysMany.title.replace('{n}', n) });
// `phase` defaults to the step number; the two trim rules (step null) name theirs, because data-phase and the coach re-measure key read it.
const focus = (text, target, step, pulse = null, keepClear = [], phase = step, noPulse) => ({
  message: { title: text, body: '' }, anchor: { target, fallback: FOCUS_STAGE }, step, pulse, noPulse, phase, keepClear,
});

const job = (f) => f.job?.status ?? 'none';
const jobRule = (id, screen, status, msg, target, fallback, tone, pulse = null, noPulse) =>
  ({ id, screen, when: (f) => job(f) === status, message: msg, anchor: { target, fallback }, tone, pulse, noPulse, avoid: [], step: null, phase: id });
const NO_PROGRESS = 'Progress: nothing to press.';
const READY_PANEL = tid('focus-publish-action-bar');
const OVERLAY_READY_PANEL = tid('overlay-publish-action-bar');
const EXPORT_BUTTON = tid('action-band');
const OVERLAY_STAGE = tid('overlay-video-stage');
const FINISHED_SHARE = tid('finished-share-action');
// The ready panels and the Finished viewer sit in a fullscreen player layer: the shade keeps the picture and every
// CTA bright, and the card goes beside the primary card (`side: 'beside'`). The picture is `shadeClear` (a preference):
// on a phone there is no free slot, and the card covering part of the picture beats covering a CTA.
const PLAYER_VIDEO = tid('collection-player-video');
const FOCUS_READY_PRIMARY = tid('focus-choice-primary');
const FOCUS_READY_CTAS = [FOCUS_READY_PRIMARY, tid('focus-choice-publish'), tid('focus-choice-edit-framing'), tid('focus-save-draft')];
const OVERLAY_READY_PRIMARY = tid('overlay-choice-primary');
const OVERLAY_READY_CTAS = [OVERLAY_READY_PRIMARY, tid('overlay-choice-reapply-overlay'), tid('overlay-choice-reapply-focus'), tid('overlay-save-draft')];
const readyPanel = (rule, ctas) => ({ ...rule, side: 'beside', keepClear: ctas, shadeClear: [PLAYER_VIDEO] });
const SHARE_MODAL_BODY = tid('share-modal-body');

// T12620: `pulse` names the ONE control the sentence tells the user to press (a GUIDE_PULSE value); null = no pulse.
const home = (msg, anchor, { id, tone = 'coach', avoid = [], keepClear = [], pulse = null, noPulse } = {}) => ({
  message: msg, anchor: { target: anchor, fallback: HOME_HEADING }, avoid, keepClear, tone, phase: id, pulse, noPulse,
});
// T12620: the cutout holds every control a sentence tells the user to press, not just its anchor.
const TAB_GAMES = tid('home-tab-games');
const TAB_PUBLISHED = tid('home-tab-published');
const CLIPS_GALLERY = tid('clips-gallery');
const UPLOAD_CLIP = tid('home-upload-clip');
const PUBLISHED_PANEL = tid('published-tab-panel');
const CLIPS_KEEP_CLEAR = [CLIPS_GALLERY, TAB_GAMES, UPLOAD_CLIP];
const PLAY_RATING = tid('rating-input');
const ADD_DETAILS = tid('add-details-button');
const HIGHLIGHT_SLOTS = tid('annotate-highlight-slots');
const EDIT_PLAY = tid('annotate-primary-cta');
const hp = (f) => f.progress ?? {};
const NAMES_FAR_DESTINATION = 'Names a destination two steps away (Games tab, then a game); T12620 decided these do not pulse.';
// T12790: dialog rules. Each dialog renders <Guide inline> at the top of its body, so the anchor is unused.
const M = GUIDE.modal;
const PICK_ONE = 'A list of equal choices; none is a default to pulse.';
const CHOOSE_FILE = 'The file picker fills the dialog; a pulse on a panel that size reads as an alert.';
const CLOSE_ONLY = 'The only button closes the dialog.';
// `ownGotIt`: the dialog's own button is labelled Got it, so the coach card must not add a second one.
const modalRule = (id, name, title, { when = () => true, pulse = null, noPulse, ownGotIt = false } = {}) => ({
  id: `modal.${id}`, screen: 'modal', when: (f) => f.local?.modal === name && when(f.local), message: { title, body: '' }, ...(ownGotIt ? { gotIt: false } : {}),
  anchor: { target: null, fallback: null }, tone: 'coach', pulse, noPulse, avoid: [], step: null, phase: `modal-${id}`,
});

/**
 * T12250: Home / Upload-modal facts. `tab` is 'games' | 'clips' | 'finished';
 * `modal` is null | 'choose' | 'submit'. Counts come from lists the Home screen
 * already holds (nothing stored): games, games with saved plays, in-flight
 * uploads, failed uploads, unfinished clip drafts, Finished highlights.
 */
export function homeFacts({ tab = 'games', modal = null, games = 0, gamesWithPlays = 0, uploading = 0, failed = 0, drafts = 0, finished = 0, gamesReviewing = 0, gamesUnreviewed = 0, gamesError = false } = {}) {
  return { screen: 'home', progress: { games, gamesWithPlays, uploading, failed, drafts, finished, gamesReviewing, gamesUnreviewed }, local: { tab, modal, gamesError } };
}

/** A game counts as reviewed once its furthest playhead (`viewed_duration` high-water mark) reaches this share of the video. */
export const REVIEWED_FRACTION = 0.9;
/** The coach only ever sends the user into a game they can open: an expired game's source video is gone. */
export const reviewableGames = (games) => games.filter(g => g.storage_status !== 'expired');
/**
 * Home review counts from the games list: `gamesUnreviewed` = under REVIEWED_FRACTION watched;
 * `gamesReviewing` = those the user has started (watched some, or marked a play).
 */
export function reviewCounts(games) {
  const unreviewed = reviewableGames(games).filter(g => !(g.video_duration > 0 && g.viewed_duration / g.video_duration >= REVIEWED_FRACTION));
  return {
    gamesUnreviewed: unreviewed.length,
    gamesReviewing: unreviewed.filter(g => g.viewed_duration > 0 || g.clip_count > 0).length,
  };
}

const PORTRAIT_PHASE = { overlay: 'spotlight', preview: 'preview', published: 'published' };
const isBrilliant = (f) => f.progress?.selectedPlay?.rating === 5;
const portraitIs = (f, phase) => isBrilliant(f) && f.progress.portrait && (PORTRAIT_PHASE[f.progress.portrait.action] ?? 'portrait') === phase;

const NO_DRAG_PRESS = 'A drag on the stage, not a press; the stage is already the anchor.';
const pk = (f) => local(f).pick ?? null;
// T12340: `pulse: GUIDE_PULSE.PICK_BOX` marks the athlete boxes the user still has to click (a recommendation only).
const pickRule = (id, when, msg, target = OVERLAY_STAGE, tone = 'coach', pulse = null, noPulse) =>
  ({ id, screen: 'overlay', when: (f) => pk(f) && when(pk(f)), message: msg, anchor: { target, fallback: OVERLAY_STAGE }, tone, pulse, noPulse, avoid: [], step: null, phase: id });

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
  { id: 'annotate.expired', screen: 'annotate', when: (f) => local(f).expired, ...annotate('expired', ANNOTATE_STAGE, { noPulse: 'Nothing on this screen re-uploads the video.' }) },
  { id: 'annotate.choice', screen: 'annotate', when: (f) => local(f).choiceOpen, ...annotate('choice', CHOICE_NOW, { pulse: GUIDE_PULSE.CHOICE_NOW, avoid: [CHOICE_NOW, CHOICE_LATER] }) },
  { id: 'annotate.editor', screen: 'annotate', when: (f) => local(f).editorOpen,
    ...annotate('editor', PLAY_EDITOR_DONE, { pulse: GUIDE_PULSE.PLAY_EDITOR_DONE, avoid: [tid('scrub-start-handle'), tid('scrub-end-handle'), tid('scrub-track'), tid('delete-play-button')], shadeClear: [EDITOR_VIDEO], compact: true, keepClear: [tid('annotate-controls'), tid('scrub-start-handle'), tid('scrub-end-handle'), PLAY_RATING, ADD_DETAILS] }) },
  { id: 'annotate.review', screen: 'annotate', when: (f) => local(f).reviewing, ...annotate('review', SHARE_PLAYS, { pulse: GUIDE_PULSE.SHARE_PLAYS, shadeClear: [`${ANNOTATE_STAGE} video`] }) },
  // The game is still uploading: its source isn't stored, so no highlight can be made yet. These outrank every rule that steers toward one.
  { id: 'annotate.uploading.selected', screen: 'annotate', when: (f) => local(f).uploading && f.progress?.selectedPlay, ...annotate('uploadingSelected', HIGHLIGHT_SLOTS, { noPulse: 'The highlight slots are locked until the upload finishes; nothing to press.' }) },
  { id: 'annotate.uploading.has-plays', screen: 'annotate', when: (f) => local(f).uploading && local(f).playCount > 0, ...annotate('uploadingPlays', MARK_PLAY, { pulse: GUIDE_PULSE.MARK_PLAY, keepClear: [MARK_PLAY, ...ANNOTATE_PLAYER] }) },
  { id: 'annotate.selected.generating', screen: 'annotate', when: (f) => isBrilliant(f) && local(f).generating, ...annotate('generating', PORTRAIT_SLOT, { noPulse: 'Progress: nothing to press.' }) },
  { id: 'annotate.progress.brilliant', screen: 'annotate', when: (f) => isBrilliant(f) && !f.progress.portrait, ...annotate('brilliant', PORTRAIT_SLOT) },
  { id: 'annotate.progress.spotlight', screen: 'annotate', when: (f) => portraitIs(f, 'spotlight'), ...annotate('spotlight', PORTRAIT_SLOT) },
  { id: 'annotate.progress.preview', screen: 'annotate', when: (f) => portraitIs(f, 'preview'), ...annotate('preview', PORTRAIT_SLOT) },
  { id: 'annotate.progress.published', screen: 'annotate', when: (f) => portraitIs(f, 'published'), ...annotate('published', PORTRAIT_SLOT) },
  { id: 'annotate.progress.portrait', screen: 'annotate', when: (f) => portraitIs(f, 'portrait'), ...annotate('portrait', PORTRAIT_SLOT) },
  // A play below 5 stars is not a highlight candidate: say what it can do, not how to mark.
  { id: 'annotate.selected.none', screen: 'annotate', when: (f) => f.progress?.selectedPlay, ...annotate('selectedNone', HIGHLIGHT_SLOTS, { pulse: GUIDE_PULSE.HIGHLIGHT_SLOT, keepClear: [EDIT_PLAY] }) },
  { id: 'annotate.has-plays.many', screen: 'annotate', when: (f) => local(f).playCount > 1, ...annotate('hasPlaysMany', PLAYS_LIST, { pulse: GUIDE_PULSE.FIRST_PLAY, keepClear: [MARK_PLAY, ...ANNOTATE_PLAYER] }) },
  { id: 'annotate.has-plays.one', screen: 'annotate', when: (f) => local(f).playCount === 1, ...annotate('hasPlaysOne', PLAYS_LIST, { pulse: GUIDE_PULSE.FIRST_PLAY, keepClear: [MARK_PLAY, ...ANNOTATE_PLAYER] }) },
  { id: 'annotate.watch.playing', screen: 'annotate', when: (f) => local(f).isPlaying, ...annotate('watchPlaying', MARK_PLAY, { pulse: GUIDE_PULSE.MARK_PLAY, keepClear: ANNOTATE_PLAYER }) },
  { id: 'annotate.progress.watch', screen: 'annotate', when: () => true, ...annotate('watch', MARK_PLAY, { pulse: [GUIDE_PULSE.ANNOTATE_PLAY, GUIDE_PULSE.MARK_PLAY], keepClear: ANNOTATE_PLAYER }) },

  // T12250: Home tabs + Upload modal. Modal, then error, then lowest incomplete step.
  { id: 'upload.choose', screen: 'home', when: (f) => f.local.modal === 'choose', ...home(GUIDE.upload.choose, UPLOAD_DROPZONE, { id: 'upload-choose', noPulse: 'The dropzone fills the modal and the cutout already isolates it; a pulse on a panel that size reads as an alert.' }) },
  { id: 'upload.submit', screen: 'home', when: (f) => f.local.modal === 'submit', ...home(GUIDE.upload.submit, UPLOAD_SUBMIT, { id: 'upload-submit', pulse: GUIDE_PULSE.UPLOAD_SUBMIT }) },
  // T12790: the games list failed to load; the error panel's Retry is the only way forward.
  { id: 'home.games.error', screen: 'home', when: (f) => f.local.tab === 'games' && f.local.gamesError, ...home(GUIDE.home.gamesError, tid('home-games-retry'), { id: 'home-games-error', tone: 'strong', pulse: GUIDE_PULSE.GAMES_RETRY }) },
  { id: 'upload.failed', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).failed > 0, ...home(GUIDE.upload.failed, FAILED_GAME, { id: 'upload-failed', tone: 'strong', pulse: GUIDE_PULSE.UPLOAD_RETRY }) },
  { id: 'home.games.empty', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).games === 0 && hp(f).uploading === 0, ...home(GUIDE.home.gamesEmpty, UPLOAD_GAME, { id: 'home-games-empty', pulse: GUIDE_PULSE.UPLOAD_GAME }) },
  { id: 'home.games.uploading', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).uploading > 0, ...home(GUIDE.home.gamesUploading, FIRST_GAME, { id: 'home-games-uploading', avoid: [UPLOAD_GAME], pulse: GUIDE_PULSE.FIRST_GAME }) },
  // After the first finished highlight (before it, the plays rules below steer to making one): a started game
  // under 90% watched still has plays in it. Then, every game watched and every clip finished: congrats, an END
  // card (nothing follows until a new upload, so no Got it; X turns guidance off).
  { id: 'home.games.keep-reviewing', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).finished > 0 && hp(f).gamesReviewing > 0, ...home(GUIDE.home.gamesKeepReviewing, FIRST_GAME, { id: 'home-games-keep-reviewing', avoid: [UPLOAD_GAME], pulse: GUIDE_PULSE.FIRST_GAME }) },
  { id: 'home.games.all-done', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).finished > 0 && hp(f).gamesUnreviewed === 0 && hp(f).drafts === 0, end: true, ...home(GUIDE.home.gamesAllDone, UPLOAD_GAME, { id: 'home-games-all-done', pulse: GUIDE_PULSE.UPLOAD_GAME }) },
  { id: 'home.games.finished', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).finished > 0, ...home(GUIDE.home.gamesFinished, TAB_PUBLISHED, { id: 'home-games-finished', avoid: [UPLOAD_GAME], pulse: GUIDE_PULSE.TAB_PUBLISHED }) },
  { id: 'home.games.no-plays', screen: 'home', when: (f) => f.local.tab === 'games' && hp(f).gamesWithPlays === 0, ...home(GUIDE.home.gamesNoPlays, FIRST_GAME, { id: 'home-games-no-plays', avoid: [UPLOAD_GAME], pulse: GUIDE_PULSE.FIRST_GAME }) },
  { id: 'home.games.plays', screen: 'home', when: (f) => f.local.tab === 'games', ...home(GUIDE.home.gamesPlays, FIRST_GAME, { id: 'home-games-plays', avoid: [UPLOAD_GAME], pulse: GUIDE_PULSE.FIRST_GAME }) },
  { id: 'home.clips.unfinished', screen: 'home', when: (f) => f.local.tab === 'clips' && hp(f).drafts > 0, ...home(GUIDE.home.clipsUnfinished, HOME_HEADING, { id: 'home-clips-unfinished', pulse: GUIDE_PULSE.FIRST_CLIP, keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.clips.all-done', screen: 'home', when: (f) => f.local.tab === 'clips' && hp(f).finished > 0, ...home(GUIDE.home.clipsAllDone, HOME_HEADING, { id: 'home-clips-all-done', noPulse: NAMES_FAR_DESTINATION, keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.clips.empty', screen: 'home', when: (f) => f.local.tab === 'clips', ...home(GUIDE.home.clipsEmpty, HOME_HEADING, { id: 'home-clips-empty', noPulse: NAMES_FAR_DESTINATION, keepClear: CLIPS_KEEP_CLEAR }) },
  { id: 'home.finished.many', screen: 'home', when: (f) => f.local.tab === 'finished' && hp(f).finished > 1, ...home(GUIDE.home.finishedMany, HOME_HEADING, { id: 'home-finished-many', pulse: GUIDE_PULSE.FIRST_FINISHED, keepClear: [PUBLISHED_PANEL] }) },
  { id: 'home.finished.first', screen: 'home', when: (f) => f.local.tab === 'finished' && hp(f).finished > 0, ...home(GUIDE.home.finishedFirst, HOME_HEADING, { id: 'home-finished-first', pulse: GUIDE_PULSE.FIRST_FINISHED, keepClear: [PUBLISHED_PANEL] }) },
  { id: 'home.finished.empty', screen: 'home', when: (f) => f.local.tab === 'finished', ...home(GUIDE.home.finishedEmpty, HOME_HEADING, { id: 'home-finished-empty', noPulse: NAMES_FAR_DESTINATION, keepClear: [TAB_GAMES] }) },

  // T12790: a video that failed to load outranks everything: no step can be done without it.
  { id: 'focus.video-error.retry', screen: 'focus', when: (f) => f.local.videoError && f.local.canRetryVideo, ...focus(GUIDE.focus.videoErrorRetry, tid('focus-video-error'), null, GUIDE_PULSE.VIDEO_RETRY, [], 'video-error') },
  { id: 'focus.video-error', screen: 'focus', when: (f) => f.local.videoError, ...focus(GUIDE.focus.videoError, tid('focus-video-error'), null, null, [], 'video-error', 'Nothing on this screen reloads it; the way back is the breadcrumb.') },
  // T12790 review: in fullscreen the export CTA and ready panel are hidden; a job state that names them sends the user out.
  { id: 'focus.fullscreen.leave-job', screen: 'focus', when: (f) => f.local.fullscreen && ['credits', 'failed', 'ready'].includes(job(f)), ...focus(GUIDE.focus.leaveFullscreenJob, FOCUS_STAGE, null, GUIDE_PULSE.EXIT_FULLSCREEN, [], 'leave-fullscreen') },
  // T12270: export job state outranks every step (Focus facts carry job.status).
  jobRule('focus.credits', 'focus', 'credits', { title: GUIDE.focus.credits, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'strong', GUIDE_PULSE.EXPORT),
  jobRule('focus.failed', 'focus', 'failed', { title: GUIDE.focus.failed, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'strong', GUIDE_PULSE.EXPORT),
  jobRule('focus.progress.export', 'focus', 'processing', { title: GUIDE.focus.progressExport, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'progress', null, NO_PROGRESS),
  jobRule('focus.finishing', 'focus', 'finishing', { title: GUIDE.focus.finishing, body: '' }, EXPORT_BUTTON, FOCUS_STAGE, 'progress', null, NO_PROGRESS),
  readyPanel(jobRule('focus.ready', 'focus', 'ready', { title: GUIDE.focus.ready, body: '' }, FOCUS_READY_PRIMARY, READY_PANEL, 'coach', GUIDE_PULSE.FOCUS_ADD_SPOTLIGHT), FOCUS_READY_CTAS),
  // T12470: a draft whose framing is already rendered has nothing left to coach (the CTA is Back to Preview).
  // T12770: the landscape cockpit has no guide sentence, only the crop-box cue; it is gated by Guidance like every pulse.
  { id: 'focus.cockpit.drag', screen: 'focus', when: (f) => f.local.cockpit && !f.local.dragDone, ...focus(GUIDE.focus.drag, FOCUS_STAGE, 1, GUIDE_PULSE.CROP_BOX) },
  // T12790: the cockpit walks the same steps with its own controls (Preview rail button, compact CTA).
  { id: 'focus.cockpit.rendered', screen: 'focus', when: (f) => f.local.cockpit && f.local.rendered, silent: true, noPulse: 'Silent rule (T12470): no guide is shown.' },
  { id: 'focus.cockpit.watch-preview', screen: 'focus', when: (f) => f.local.cockpit && f.local.previewing, ...focus(GUIDE.focus.cockpitWatchPreview, FOCUS_STAGE, 4, null, [], 4, 'Watching; Preview again is optional.') },
  { id: 'focus.cockpit.busy', screen: 'focus', when: (f) => f.local.cockpit && f.local.ctaBusy, silent: true, noPulse: 'The CTA is itself busy (documented null, like portrait).' },
  { id: 'focus.cockpit.preview', screen: 'focus', when: (f) => f.local.cockpit && !f.local.hasPreviewed, ...focus(GUIDE.focus.cockpitPreview, FOCUS_STAGE, 4, GUIDE_PULSE.COCKPIT_PREVIEW) },
  { id: 'focus.cockpit.generate', screen: 'focus', when: (f) => f.local.cockpit, ...focus(GUIDE.focus.generate, FOCUS_STAGE, 5, GUIDE_PULSE.EXPORT) },
  { id: 'focus.rendered', screen: 'focus', when: (f) => f.local.rendered, silent: true, noPulse: 'Silent rule (T12470): no guide is shown.' },
  { id: 'focus.progress.drag', screen: 'focus', when: (f) => !f.local.dragDone, ...focus(GUIDE.focus.drag, FOCUS_STAGE, 1, GUIDE_PULSE.CROP_BOX) },
  { id: 'focus.progress.play', screen: 'focus', when: (f) => !f.local.hasPlayed, ...focus(GUIDE.focus.play, FOCUS_STAGE, 2, GUIDE_PULSE.PLAY, [FOCUS_STAGE, PLAY_BUTTON]), avoid: [PLAY_BUTTON] },
  { id: 'focus.progress.trimSplit', screen: 'focus', when: (f) => f.local.trimStage === 'split', ...focus(GUIDE.focus.trimSplit, TRIM_SCOPE, null, GUIDE_PULSE.TRIM_TRACK, [], 'split') },
  { id: 'focus.progress.trimAdjust', screen: 'focus', when: (f) => f.local.trimStage === 'adjust', ...focus(GUIDE.focus.trimAdjust, TRIM_SCOPE, null, GUIDE_PULSE.TRIM_ADJUST, [], 'adjust') },
  { id: 'focus.progress.keep', screen: 'focus', when: (f) => !f.local.hasPlayedThrough && !f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.keep, FOCUS_STAGE, 3, GUIDE_PULSE.CROP_BOX) },
  // T12790: fullscreen has no Preview toggle or action band; send the user back out once the stage steps are done.
  { id: 'focus.fullscreen.leave', screen: 'focus', when: (f) => f.local.fullscreen, ...focus(GUIDE.focus.leaveFullscreen, FOCUS_STAGE, null, GUIDE_PULSE.EXIT_FULLSCREEN, [], 'leave-fullscreen') },
  { id: 'focus.progress.watchPreview', screen: 'focus', when: (f) => f.local.previewing && !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.watchPreview, PREVIEW_TOGGLE, 4, null, [FOCUS_STAGE], 4, 'Watching; Back to full video is optional.') },
  { id: 'focus.progress.preview', screen: 'focus', when: (f) => !f.local.hasPreviewPlayedThrough, ...focus(GUIDE.focus.preview, PREVIEW_TOGGLE, 4, GUIDE_PULSE.PREVIEW) },
  // While the Preview/Generate button is itself busy the guide is silent (documented null).
  { id: 'focus.progress.generate.advanced', screen: 'focus', when: (f) => !f.local.ctaBusy && job(f) === 'none' && (hp(f).finishedCount ?? 0) > 1, ...focus(GUIDE.focus.generateAdvanced, ACTION_BAND, 5, GUIDE_PULSE.EXPORT) },
  { id: 'focus.progress.generate', screen: 'focus', when: (f) => !f.local.ctaBusy && job(f) === 'none', ...focus(GUIDE.focus.generate, ACTION_BAND, 5, GUIDE_PULSE.EXPORT) },
  jobRule('overlay.failed', 'overlay', 'failed', { title: GUIDE.overlay.failed, body: '' }, EXPORT_BUTTON, OVERLAY_STAGE, 'error', GUIDE_PULSE.EXPORT),
  jobRule('overlay.progress', 'overlay', 'processing', { title: GUIDE.overlay.progress, body: '' }, EXPORT_BUTTON, OVERLAY_STAGE, 'progress', null, NO_PROGRESS),
  readyPanel(jobRule('overlay.ready', 'overlay', 'ready', { title: GUIDE.overlay.ready, body: '' }, OVERLAY_READY_PRIMARY, OVERLAY_READY_PANEL, 'coach', GUIDE_PULSE.OVERLAY_FINISH), OVERLAY_READY_CTAS),
  // T12290: finished viewer (silent once a link exists: the link card is the instruction) and share modal.
  { id: 'finished.viewer', screen: 'finished', when: (f) => !local(f).shared, message: { title: GUIDE.finished.viewer, body: '' }, anchor: { target: FINISHED_SHARE, fallback: FINISHED_SHARE }, tone: 'coach', pulse: GUIDE_PULSE.GET_LINK, avoid: [], keepClear: [FINISHED_SHARE], shadeClear: [PLAYER_VIDEO], side: 'beside', step: null, phase: 'finished-viewer' },
  // End of the first-highlight walk: the link exists, so offer to turn the guide off.
  { id: 'finished.done', screen: 'finished', when: () => true, end: true, message: { title: GUIDE.finished.done, body: '' }, cta: GUIDE.finished.doneCta, anchor: { target: FINISHED_SHARE, fallback: FINISHED_SHARE }, tone: 'coach', pulse: null, noPulse: 'The action is the coach\'s own Turn off guidance button.', avoid: [], keepClear: [FINISHED_SHARE], shadeClear: [PLAYER_VIDEO], side: 'beside', step: null, phase: 'finished-done' },
  { id: 'share.modal', screen: 'share', when: () => true, message: { title: GUIDE.share.modal, body: '' }, anchor: { target: SHARE_MODAL_BODY, fallback: SHARE_MODAL_BODY }, tone: 'coach', pulse: GUIDE_PULSE.SHARE_SUBMIT, avoid: [], step: null, phase: 'share-modal' },
  // T12280: spotlight pick walk (facts.local.pick = {phase, step, total, assigned, boxed, noBoxes}).
  pickRule('overlay.pick.done', (p) => p.phase === 'done', GUIDE.overlay.pick.done, EXPORT_BUTTON, 'strong', GUIDE_PULSE.EXPORT),
  pickRule('overlay.pick.away', (p) => p.phase === 'away', GUIDE.overlay.pick.away, OVERLAY_STAGE, 'coach', null, 'The action is the coach\'s own Go to moment button.'),
  pickRule('overlay.pick.none', (p) => p.noBoxes, GUIDE.overlay.pick.none, OVERLAY_STAGE, 'coach', null, NO_DRAG_PRESS),
  pickRule('overlay.pick.not-outlined', (p) => p.phase === 'parked' && p.boxed === false, GUIDE.overlay.pick.notOutlined, OVERLAY_STAGE, 'coach', null, NO_DRAG_PRESS),
  pickRule('overlay.pick.next', (p) => p.phase === 'confirm', GUIDE.overlay.pick.next, OVERLAY_STAGE, 'coach', null, 'Transient confirmation: nothing to press.'),
  pickRule('overlay.pick.first', (p) => p.phase === 'parked' && p.assigned === 0, GUIDE.overlay.pick.first, OVERLAY_STAGE, 'coach', GUIDE_PULSE.PICK_BOX),
  pickRule('overlay.pick.at-marker', (p) => p.phase === 'parked', GUIDE.overlay.pick.atMarker, OVERLAY_STAGE, 'coach', GUIDE_PULSE.PICK_BOX),
  // T12790: dialogs. facts = { screen: 'modal', local: { modal: '<name>', ...state } }; mounted inline at the top of the dialog body.
  modalRule('attach-video.submit', 'attach-video', M.attachVideoSubmit, { when: (l) => l.hasFile, pulse: GUIDE_PULSE.ATTACH_SUBMIT }),
  modalRule('attach-video.choose', 'attach-video', M.attachVideoChoose, { noPulse: CHOOSE_FILE }),
  modalRule('clip-upload-notice', 'clip-upload-notice', M.clipUploadNotice, { pulse: GUIDE_PULSE.CLIP_NOTICE_CONTINUE }),
  modalRule('clip-upload-too-large', 'clip-upload-too-large', M.clipUploadTooLarge, { pulse: GUIDE_PULSE.CLIP_TOO_LARGE_OK, ownGotIt: true }),
  modalRule('clip-size-limit', 'clip-size-limit', M.clipSizeLimit, { pulse: GUIDE_PULSE.CLIP_SIZE_ADD_GAME }),
  modalRule('edit-game', 'edit-game', M.editGame, { pulse: GUIDE_PULSE.EDIT_GAME_SAVE }),
  modalRule('link-clip.empty', 'link-clip', M.linkClipEmpty, { when: (l) => l.empty, noPulse: 'Nothing to pick; the way forward is outside this dialog.' }),
  modalRule('link-clip', 'link-clip', M.linkClip, { noPulse: PICK_ONE }),
  modalRule('share-game', 'share-game', M.shareGame, { pulse: GUIDE_PULSE.SHARE_GAME_SUBMIT }),
  modalRule('collection-share.done', 'collection-share', M.collectionShareDone, { when: (l) => l.done, noPulse: CLOSE_ONLY }),
  modalRule('collection-share', 'collection-share', M.collectionShare, { pulse: GUIDE_PULSE.COLLECTION_SHARE_SUBMIT }),
  modalRule('teammates.done', 'teammates', M.teammatesDone, { when: (l) => l.allShared, noPulse: CLOSE_ONLY }),
  modalRule('teammates', 'teammates', M.teammates, { pulse: GUIDE_PULSE.TEAMMATES_SHARE_SUBMIT }),
  modalRule('share-playback.error', 'share-playback', M.sharePlaybackError, { when: (l) => l.error, noPulse: CLOSE_ONLY }),
  modalRule('share-playback', 'share-playback', M.sharePlayback, { pulse: GUIDE_PULSE.SHARE_PLAYBACK_SUBMIT }),
  modalRule('shared-video.sign-in', 'shared-video', M.sharedVideoSignIn, { when: (l) => l.state === 'sign-in', pulse: GUIDE_PULSE.SHARED_VIDEO_SIGN_IN }),
  modalRule('shared-video.error', 'shared-video', M.sharedVideoError, { when: (l) => l.state === 'error', noPulse: 'Nothing here fixes a dead link.' }),
  modalRule('shared-video', 'shared-video', M.sharedVideo, { when: (l) => l.state === 'ready', noPulse: 'Play belongs to the video player, which shows its own button.' }),
  modalRule('buy-credits.pay', 'buy-credits', M.buyCreditsPay, { when: (l) => l.step === 'pay', pulse: GUIDE_PULSE.CREDITS_PAY }),
  modalRule('buy-credits.pick', 'buy-credits', M.buyCreditsPick, { noPulse: PICK_ONE }),
  modalRule('insufficient-credits', 'insufficient-credits', M.insufficientCredits, { pulse: GUIDE_PULSE.INSUFFICIENT_BUY }),
  modalRule('credit-history', 'credit-history', M.creditHistory, { noPulse: 'Read-only list.' }),
  modalRule('payment-result.success', 'payment-result', M.paymentSuccess, { when: (l) => l.success, pulse: GUIDE_PULSE.PAYMENT_RESULT_OK }),
  modalRule('payment-result.failed', 'payment-result', M.paymentFailed, { pulse: GUIDE_PULSE.PAYMENT_RESULT_OK }),
  modalRule('storage-extension', 'storage-extension', M.storageExtension, { pulse: GUIDE_PULSE.STORAGE_EXTEND }),
  modalRule('export-too-large', 'export-too-large', M.exportTooLarge, { pulse: GUIDE_PULSE.EXPORT_TOO_LARGE_OK, ownGotIt: true }),
  modalRule('tutorial-video', 'tutorial-video', M.tutorialVideo, { noPulse: 'Watching; closing is optional.' }),
  modalRule('profiles.add', 'profiles', M.profileAdd, { when: (l) => l.mode === 'add', pulse: GUIDE_PULSE.PROFILE_SUBMIT }),
  modalRule('profiles.edit', 'profiles', M.profileEdit, { when: (l) => l.mode === 'edit', pulse: GUIDE_PULSE.PROFILE_SUBMIT }),
  modalRule('profiles.list', 'profiles', M.profilesList, { pulse: GUIDE_PULSE.PROFILE_ADD }),
  modalRule('move-profile.confirm', 'move-profile', M.moveProfileConfirm, { when: (l) => l.confirming, pulse: GUIDE_PULSE.MOVE_PROFILE_CONFIRM }),
  modalRule('move-profile.pick', 'move-profile', M.moveProfilePick, { noPulse: PICK_ONE }),
  { id: 'overlay.text', screen: 'overlay', when: (f) => local(f).textOpen, message: { title: GUIDE.overlay.text, body: '' }, anchor: { target: OVERLAY_STAGE, fallback: OVERLAY_STAGE }, tone: 'coach', pulse: null, noPulse: 'Typing and a timeline drag, not a press.', avoid: [], step: null, phase: 'overlay-text' },
];

const fillPick = (msg, p) => {
  const sub = (t) => t.replace('{n}', p.total).replace('{k}', p.step);
  return { title: sub(msg.title), body: sub(msg.body) };
};

export function resolveGuide(facts) {
  const rule = GUIDE_RULES.find((r) => r.screen === facts?.screen && r.when(facts));
  if (!rule || rule.silent) return null;
  // `end`: nothing follows this card in the current state, so it has no Got it (only X, which turns guidance off).
  const { id, anchor, cta = null, step = null, pulse = null, phase, avoid = [], keepClear = [], shadeClear = [], compact = false, tone = 'coach', end = false, side } = rule;
  const gotIt = rule.gotIt ?? !end;
  let message = id === 'annotate.has-plays.many' ? many(facts.local.playCount) : rule.message;
  if (id === 'home.finished.many') message = { ...GUIDE.home.finishedMany, title: GUIDE.home.finishedMany.title.replace('{n}', hp(facts).finished) };
  if (id.startsWith('overlay.pick.')) message = fillPick(message, facts.local.pick);
  return { id, message, cta, anchor, avoid, keepClear, shadeClear, compact, pulse, tone, step, phase, end, gotIt, side };
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
  { name: 'annotate: uploading, 5-star play selected', expectId: 'annotate.uploading.selected', facts: { screen: 'annotate', progress: play(5), local: { uploading: true, playCount: 2 } } },
  { name: 'annotate: uploading, plays marked', expectId: 'annotate.uploading.has-plays', facts: { screen: 'annotate', progress: play(null), local: { uploading: true, playCount: 2 } } },
  { name: 'annotate: highlight generating', expectId: 'annotate.selected.generating', facts: { screen: 'annotate', progress: play(5, { action: 'framing' }), local: { generating: true } } },
  { name: 'annotate: 5-star, no portrait', expectId: 'annotate.progress.brilliant', facts: { screen: 'annotate', progress: play(5), local: {} } },
  { name: 'annotate: 5-star, portrait in framing', expectId: 'annotate.progress.portrait', facts: { screen: 'annotate', progress: play(5, { action: 'framing' }), local: {} } },
  { name: 'annotate: 5-star, portrait at spotlight', expectId: 'annotate.progress.spotlight', facts: { screen: 'annotate', progress: play(5, { action: 'overlay' }), local: {} } },
  { name: 'annotate: 5-star, portrait at preview', expectId: 'annotate.progress.preview', facts: { screen: 'annotate', progress: play(5, { action: 'preview' }), local: {} } },
  { name: 'annotate: 5-star, portrait published', expectId: 'annotate.progress.published', facts: { screen: 'annotate', progress: play(5, { action: 'published' }), local: {} } },
  { name: 'focus cockpit: no focus point yet', expectId: 'focus.cockpit.drag', facts: { screen: 'focus', local: { cockpit: true, dragDone: false } } },
  { name: 'focus cockpit: framed, not previewed', expectId: 'focus.cockpit.preview', facts: { screen: 'focus', local: { cockpit: true, dragDone: true } } },
  { name: 'focus cockpit: previewing', expectId: 'focus.cockpit.watch-preview', facts: { screen: 'focus', local: { cockpit: true, dragDone: true, previewing: true } } },
  { name: 'focus cockpit: previewed', expectId: 'focus.cockpit.generate', facts: { screen: 'focus', local: { cockpit: true, dragDone: true, hasPreviewed: true } } },
  { name: 'focus cockpit: rendered (documented null)', expectId: null, facts: { screen: 'focus', local: { cockpit: true, dragDone: true, rendered: true } } },
  { name: 'focus cockpit: CTA busy (documented null)', expectId: null, facts: { screen: 'focus', local: { cockpit: true, dragDone: true, hasPreviewed: true, ctaBusy: true } } },
  { name: 'focus cockpit: export processing', expectId: 'focus.progress.export', facts: { screen: 'focus', job: { status: 'processing' }, local: { cockpit: true, dragDone: true } } },
  { name: 'focus: video failed to load, retry offered', expectId: 'focus.video-error.retry', facts: { screen: 'focus', job: { status: 'processing' }, local: fl({ videoError: true, canRetryVideo: true }) } },
  { name: 'focus: video failed to load', expectId: 'focus.video-error', facts: { screen: 'focus', local: fl({ videoError: true }) } },
  { name: 'focus: fullscreen, stage steps done', expectId: 'focus.fullscreen.leave', facts: { screen: 'focus', local: fl({ fullscreen: true, hasPreviewPlayedThrough: false }) } },
  { name: 'focus: fullscreen, export failed', expectId: 'focus.fullscreen.leave-job', facts: { screen: 'focus', job: { status: 'failed' }, local: fl({ fullscreen: true }) } },
  { name: 'focus: fullscreen, export processing', expectId: 'focus.progress.export', facts: { screen: 'focus', job: { status: 'processing' }, local: fl({ fullscreen: true }) } },
  { name: 'focus cockpit: opening the render (documented null)', expectId: null, facts: { screen: 'focus', local: { cockpit: true, dragDone: true, ctaBusy: true } } },
  { name: 'focus cockpit: video failed to load', expectId: 'focus.video-error.retry', facts: { screen: 'focus', local: { cockpit: true, videoError: true, canRetryVideo: true } } },
  { name: 'focus: fullscreen, still dragging', expectId: 'focus.progress.drag', facts: { screen: 'focus', local: fl({ fullscreen: true, dragDone: false }) } },
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
    ['games failed to load', { gamesError: true }, 'home.games.error'],
    ['clips while games failed to load', { tab: 'clips', gamesError: true }, 'home.clips.empty'],
    ['games: none', {}, 'home.games.empty'],
    ['games: uploading', { games: 1, uploading: 1 }, 'home.games.uploading'],
    ['games: no plays', { games: 1 }, 'home.games.no-plays'],
    ['games: plays', { games: 1, gamesWithPlays: 1 }, 'home.games.plays'],
    ['games: finished exists, clip unfinished', { games: 1, gamesWithPlays: 1, finished: 1, drafts: 1 }, 'home.games.finished'],
    ['games: finished, game not fully watched', { games: 1, gamesWithPlays: 1, finished: 1, gamesReviewing: 1, gamesUnreviewed: 1 }, 'home.games.keep-reviewing'],
    ['games: all watched, all clips finished', { games: 1, gamesWithPlays: 1, finished: 1 }, 'home.games.all-done'],
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
  ...[
    ['attach-video', {}, 'modal.attach-video.choose'], ['attach-video', { hasFile: true }, 'modal.attach-video.submit'],
    ['clip-upload-notice', {}, 'modal.clip-upload-notice'], ['clip-upload-too-large', {}, 'modal.clip-upload-too-large'],
    ['clip-size-limit', {}, 'modal.clip-size-limit'], ['edit-game', {}, 'modal.edit-game'],
    ['link-clip', {}, 'modal.link-clip'], ['link-clip', { empty: true }, 'modal.link-clip.empty'],
    ['share-game', {}, 'modal.share-game'], ['collection-share', {}, 'modal.collection-share'], ['collection-share', { done: true }, 'modal.collection-share.done'],
    ['teammates', {}, 'modal.teammates'], ['teammates', { allShared: true }, 'modal.teammates.done'],
    ['share-playback', {}, 'modal.share-playback'], ['share-playback', { error: true }, 'modal.share-playback.error'],
    ['shared-video', { state: 'ready' }, 'modal.shared-video'], ['shared-video', { state: 'sign-in' }, 'modal.shared-video.sign-in'],
    ['shared-video', { state: 'error' }, 'modal.shared-video.error'], ['shared-video', { state: 'loading' }, null],
    ['buy-credits', {}, 'modal.buy-credits.pick'], ['buy-credits', { step: 'pay' }, 'modal.buy-credits.pay'],
    ['insufficient-credits', {}, 'modal.insufficient-credits'], ['credit-history', {}, 'modal.credit-history'],
    ['payment-result', { success: true }, 'modal.payment-result.success'], ['payment-result', {}, 'modal.payment-result.failed'],
    ['storage-extension', {}, 'modal.storage-extension'], ['export-too-large', {}, 'modal.export-too-large'], ['tutorial-video', {}, 'modal.tutorial-video'],
    ['profiles', { mode: 'list' }, 'modal.profiles.list'], ['profiles', { mode: 'add' }, 'modal.profiles.add'], ['profiles', { mode: 'edit' }, 'modal.profiles.edit'],
    ['move-profile', {}, 'modal.move-profile.pick'], ['move-profile', { confirming: true }, 'modal.move-profile.confirm'],
  ].map(([modal, over, expectId]) => ({ name: `dialog: ${modal} ${JSON.stringify(over)}`, expectId, facts: { screen: 'modal', local: { modal, ...over } } })),
  { name: 'unknown screen (documented null)', expectId: null, facts: { screen: 'nowhere', local: {} } },
];
