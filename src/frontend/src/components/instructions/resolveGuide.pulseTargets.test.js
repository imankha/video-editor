import { describe, it, expect } from 'vitest';
import { GUIDE_STATES, resolveGuide } from './resolveGuide';
import { GUIDE_PULSE as P } from './guideTargets';

// T12730 comparison: the control each guide pulsed BEFORE the GUIDE_PULSE constants, reviewed by
// hand from the per-screen code (Annotate/Home/Overlay compared pulse strings; Focus derived the
// control from the step number). Every rule not listed pulsed nothing.
const TODAYS_TARGETS = {
  'annotate.progress.brilliant': P.PORTRAIT_SLOT,
  'annotate.progress.spotlight': P.PORTRAIT_SLOT,
  'annotate.progress.preview': P.PORTRAIT_SLOT,
  'annotate.progress.published': P.PORTRAIT_SLOT,
  'annotate.progress.portrait': P.PORTRAIT_SLOT,
  'annotate.watch.playing': P.MARK_PLAY,
  'annotate.progress.watch': P.MARK_PLAY,
  'home.games.empty': P.UPLOAD_GAME,
  'home.games.uploading': P.FIRST_GAME,
  'home.games.no-plays': P.FIRST_GAME,
  'home.games.plays': P.FIRST_GAME,
  'home.games.finished': P.TAB_PUBLISHED,
  'focus.progress.drag': P.CROP_BOX, // step 1
  'focus.cockpit.drag': P.CROP_BOX, // T12770: landscape cockpit
  'focus.progress.play': P.PLAY, // step 2
  'focus.progress.keep': P.CROP_BOX, // step 3
  'focus.progress.preview': P.PREVIEW, // step 4
  'focus.progress.generate': P.EXPORT, // step 5
  'focus.progress.generate.advanced': P.EXPORT, // step 5
  'focus.credits': P.EXPORT, // pulse === 'credits'
  'focus.progress.trimSplit': P.TRIM_TRACK,
  'focus.progress.trimAdjust': P.TRIM_ADJUST,
  'overlay.pick.first': P.PICK_BOX,
  'overlay.pick.at-marker': P.PICK_BOX,
  // T12760: the gaps filled (design Q4 rows marked add).
  'annotate.choice': P.CHOICE_NOW,
  'annotate.editor': P.PLAY_EDITOR_DONE,
  'annotate.review': P.SHARE_PLAYS,
  'annotate.selected.none': P.HIGHLIGHT_SLOT,
  'annotate.has-plays.many': P.FIRST_PLAY,
  'annotate.has-plays.one': P.FIRST_PLAY,
  'upload.submit': P.UPLOAD_SUBMIT,
  'upload.failed': P.UPLOAD_RETRY,
  'home.clips.unfinished': P.FIRST_CLIP,
  'home.finished.first': P.FIRST_FINISHED,
  'home.finished.many': P.FIRST_FINISHED,
  'focus.failed': P.EXPORT,
  'focus.ready': P.FOCUS_ADD_SPOTLIGHT,
  'overlay.failed': P.EXPORT,
  'overlay.ready': P.OVERLAY_FINISH,
  'overlay.pick.done': P.EXPORT,
  'finished.viewer': P.GET_LINK,
  'share.modal': P.SHARE_SUBMIT,
  'home.games.error': P.GAMES_RETRY, // T12790
};

describe('T12730 GUIDE_STATES pulse targets equal today\'s targets', () => {
  for (const s of GUIDE_STATES) {
    it(s.name, () => {
      const g = resolveGuide(s.facts);
      expect(g?.pulse ?? null).toBe(TODAYS_TARGETS[s.expectId] ?? null);
    });
  }

  it('the two trim rules keep their explicit phases (data-phase / coach re-measure key)', () => {
    const phase = (id) => resolveGuide(GUIDE_STATES.find((s) => s.expectId === id).facts).phase;
    expect(phase('focus.progress.trimSplit')).toBe('split');
    expect(phase('focus.progress.trimAdjust')).toBe('adjust');
  });
});
