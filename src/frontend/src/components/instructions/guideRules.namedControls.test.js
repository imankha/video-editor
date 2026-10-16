import { describe, it, expect } from 'vitest';
import { GUIDE_RULES } from './resolveGuide';
import { GUIDE_PULSE as P } from './guideTargets';

// T12800 layer 3: a sentence that names a control must point the card away from it. Every control
// phrase below maps to the rule's `pulse` or its `keepClear`, or carries a documented reason in
// NAMES_OFFSCREEN. Explicit table on purpose (greppable, no registry): a new sentence that tells the
// user to tap/drag/pick/open something and matches no row fails here until a row is added.
const CONTROL_PHRASES = [
  { name: 'Play', re: /\bTap Play\b/, pulse: [P.ANNOTATE_PLAY, P.PLAY], keepClear: ['annotate-controls'] },
  { name: 'Mark play', re: /\bMark play\b/, pulse: [P.MARK_PLAY] },
  { name: 'Make highlight', re: /\bTap Make highlight\b/, pulse: [P.CHOICE_NOW, P.HIGHLIGHT_SLOT] },
  { name: 'Edit play', re: /\bEdit play\b/, keepClear: ['annotate-primary-cta'] },
  { name: 'Drag the green ends', re: /\bDrag the green ends\b/, keepClear: ['scrub-start-handle', 'scrub-end-handle'] },
  { name: 'Pick how good', re: /\bPick how good\b/, keepClear: ['rating-input'] },
  { name: 'Rate the play', re: /\bRate the play\b/, keepClear: ['rating-input'] },
  { name: 'Add tags and notes', re: /\badd tags and notes\b/, keepClear: ['add-details-button'] },
  { name: 'Done', re: /\btap Done\b/, pulse: [P.PLAY_EDITOR_DONE] },
  { name: 'Share plays', re: /\bTap Share plays\b/, pulse: [P.SHARE_PLAYS] },
  { name: 'tap a play', re: /\btap a play\b/, pulse: [P.FIRST_PLAY] },
  { name: 'tap a clip', re: /\bTap a clip\b/, pulse: [P.FIRST_CLIP] },
  { name: 'Tap it/one', re: /\bTap (it|one)\b/, pulse: [P.PORTRAIT_SLOT, P.FIRST_FINISHED] },
  { name: 'Upload game', re: /\bTap Upload game\b/, pulse: [P.UPLOAD_SUBMIT, P.UPLOAD_GAME] },
  { name: 'Retry', re: /\bTap Retry\b/, pulse: [P.GAMES_RETRY, P.UPLOAD_RETRY, P.VIDEO_RETRY] },
  { name: 'Open it / your game', re: /\bOpen (it now|your game)\b/, pulse: [P.FIRST_GAME] },
  { name: 'Open Finished', re: /\bOpen Finished\b/, pulse: [P.TAB_PUBLISHED] },
  { name: 'open a game', re: /\bopen a game\b/i, pulse: [P.FIRST_GAME] },
  { name: 'Drag the box', re: /\bDrag the box\b/, pulse: [P.CROP_BOX] },
  { name: 'Preview', re: /\bTap Preview\b/, pulse: [P.PREVIEW, P.COCKPIT_PREVIEW] },
  { name: 'Generate highlight', re: /\bTap Generate highlight\b/, pulse: [P.EXPORT] },
  { name: 'Trim and slow motion', re: /\bopen Trim and slow motion\b/, pulse: [] },
  { name: 'Exit fullscreen', re: /\bExit fullscreen\b/, pulse: [P.EXIT_FULLSCREEN] },
  { name: 'Finish', re: /\btap Finish\b/i, pulse: [P.OVERLAY_FINISH, P.FOCUS_ADD_SPOTLIGHT] },
  { name: 'Get share link', re: /\bTap Get share link\b/, pulse: [P.GET_LINK] },
  { name: 'Download', re: /\bDownload to save\b/, pulse: [] },
  { name: 'Choose who can watch', re: /\bChoose who can watch\b/, pulse: [] },
  { name: 'Share', re: /\btap Share\b(?! plays)/, pulse: [P.SHARE_SUBMIT, P.SHARE_GAME_SUBMIT, P.COLLECTION_SHARE_SUBMIT, P.TEAMMATES_SHARE_SUBMIT, P.SHARE_PLAYBACK_SUBMIT] },
  { name: 'Tap your athlete', re: /\bTap your athlete\b/, pulse: [P.PICK_BOX] },
  { name: 'Add footage', re: /\bTap Add footage\b/, pulse: [P.ATTACH_SUBMIT] },
  { name: 'Continue', re: /\bTap Continue\b/, pulse: [P.CLIP_NOTICE_CONTINUE] },
  { name: 'Got it', re: /\bTap Got it\b/, pulse: [P.CLIP_TOO_LARGE_OK, P.EXPORT_TOO_LARGE_OK] },
  { name: 'Add Game', re: /\bTap Add Game\b/, pulse: [P.CLIP_SIZE_ADD_GAME] },
  { name: 'Save Changes', re: /\btap Save Changes\b/, pulse: [P.EDIT_GAME_SAVE] },
  { name: 'Sign In', re: /\bTap Sign In\b/, pulse: [P.SHARED_VIDEO_SIGN_IN] },
  { name: 'Pay', re: /\btap Pay\b/, pulse: [P.CREDITS_PAY] },
  { name: 'Buy Credits', re: /\bTap Buy Credits\b/, pulse: [P.INSUFFICIENT_BUY] },
  { name: 'OK', re: /\bTap OK\b/, pulse: [P.PAYMENT_RESULT_OK] },
  { name: 'Extend Storage', re: /\bTap Extend Storage\b/, pulse: [P.STORAGE_EXTEND] },
  { name: 'Create/Save', re: /\btap (Create|Save)\b(?! Changes)/, pulse: [P.PROFILE_SUBMIT] },
  { name: 'Move', re: /\bTap Move\b/, pulse: [P.MOVE_PROFILE_CONFIRM] },
  { name: 'Add Profile', re: /\btap \+ Add Profile\b/, pulse: [P.PROFILE_ADD] },
  { name: 'tap a profile', re: /\bTap a profile\b/, pulse: [] },
  { name: 'Pick who', re: /\bPick who\b/, pulse: [] },
  { name: 'Tap a/the (list item)', re: /\bTap (a credit pack|the game|the athlete profile)\b/, pulse: [] },
  { name: 'Click the timeline', re: /\bClick the timeline\b/, pulse: [P.TRIM_TRACK] },
  { name: 'Tap 0.5x / trash', re: /\bTap 0\.5x\b/, pulse: [P.TRIM_ADJUST] },
  { name: 'drag it back', re: /\bdrag it back\b/, pulse: [P.CROP_BOX] },
  { name: 'Back to full video', re: /\bTap Back to full video\b/, pulse: [] },
  { name: 'Preview again', re: /\bTap Preview again\b/, pulse: [] },
  { name: 'Pick your game video', re: /\bPick your game video\b/, pulse: [] },
  { name: 'Open a game (noPulse)', re: /\bOpen a game\b/, pulse: [] },
  { name: 'Open this clip again', re: /\bopen this clip again\b/, pulse: [] },
  { name: 'Tap (moment)', re: /\bstill needs a tap\b|\bneeds a tap\b/, pulse: [] },
  { name: 'Drag the circle', re: /\bDrag the circle\b/, pulse: [] },
  { name: 'Choose the video file', re: /\bChoose the video file\b/, pulse: [] },
  { name: 'drag its ends', re: /\bdrag its ends\b/, pulse: [] },
  { name: 'Tap Close/Done (dialog)', re: /\bTap (Close|Done)\b/, pulse: [] },
];

// `${ruleId}:${phrase name}` -> why the sentence names a control the card does not have to keep clear.
const IN_DIALOG = 'Dialog rule: the control lives inside the dialog body, drawn by the inline guide, never the floating coach.';
const NAMES_OFFSCREEN = {
  'home.finished.many:open a game': 'Names a destination two steps away (Games tab, then a game); T12620 decided these do not pulse.',
  'home.finished.first:Tap it/one': 'The pulse is the first finished tile, which is what "it" names.',
  'finished.viewer:Download': 'Secondary action beside Get share link, inside the anchor (finished-share-action) the card never covers.',
  'share.modal:Choose who can watch': 'The audience chooser is inside the anchor (share modal body) the card never covers.',
  'focus.progress.generate.advanced:Trim and slow motion': 'Trim sits in the action band; the docked card stays in the strip above that band.',
  'modal.link-clip:Tap a/the (list item)': IN_DIALOG,
  'modal.teammates:Pick who': IN_DIALOG,
  'modal.profiles.list:tap a profile': IN_DIALOG,
  'modal.buy-credits.pick:Tap a/the (list item)': IN_DIALOG,
  'modal.move-profile.pick:Tap a/the (list item)': IN_DIALOG,
  'modal.collection-share.done:Tap Close/Done (dialog)': IN_DIALOG,
  'modal.teammates.done:Tap Close/Done (dialog)': IN_DIALOG,
  'modal.share-playback.error:Tap Close/Done (dialog)': IN_DIALOG,
};

const VERBS = /\b(tap|click|drag|pick|choose|exit)\b|\bopen (it|a|your|this)\b/i;
const titleOf = rule => rule.message?.title ?? '';
const testidsOf = selectors => (selectors ?? []).map(s => /data-testid="([^"]+)"/.exec(s)?.[1]).filter(Boolean);
const rules = GUIDE_RULES.filter(r => titleOf(r) && !r.silent);

describe('a guide sentence names only controls its rule pulses or keeps clear', () => {
  it.each(rules.map(r => [r.id, r]))('%s', (_id, rule) => {
    const title = titleOf(rule);
    const matched = CONTROL_PHRASES.filter(c => c.re.test(title));
    if (VERBS.test(title)) expect(matched.length, `rule ${rule.id} tells the user to act ("${title}") but matches no CONTROL_PHRASES row`).toBeGreaterThan(0);
    const pulses = [rule.pulse ?? []].flat();
    const clear = testidsOf(rule.keepClear);
    const unmapped = matched.filter(c => {
      if (NAMES_OFFSCREEN[`${rule.id}:${c.name}`]) return false;
      if (rule.noPulse) return false; // documented by noPulse itself
      return !(c.pulse ?? []).some(p => pulses.includes(p)) && !(c.keepClear ?? []).some(k => clear.includes(k));
    });
    expect(unmapped.map(c => c.name), `rule ${rule.id} ("${title}") names controls that are neither pulsed nor kept clear`).toEqual([]);
  });

  it('every NAMES_OFFSCREEN entry still matches a live rule and phrase (no stale reasons)', () => {
    const live = new Set(rules.flatMap(r => CONTROL_PHRASES.filter(c => c.re.test(titleOf(r))).map(c => `${r.id}:${c.name}`)));
    expect(Object.keys(NAMES_OFFSCREEN).filter(k => !live.has(k))).toEqual([]);
  });
});
