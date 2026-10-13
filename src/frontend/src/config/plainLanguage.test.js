import { describe, it, expect } from 'vitest';
import { GUIDE, EXPORT_JOBS, RESULT_PUBLISH, EDITOR_PANELS } from './displayNames';
import { PARTIAL_TAB_GUIDE, EMPTY_TAB_GUIDE } from './emptyStates';
import { getDraftStageLabel, DRAFT_STAGE_LABELS, DRAFT_STAGE } from '../utils/draftStage';

// T12550: guide wording equals button wording (one word per thing); no claim the app follows.
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

describe('T12550 plain language', () => {
  it('names the buttons exactly as they are labeled', () => {
    expect(GUIDE.overlay.pick.done.body).toContain(EXPORT_JOBS.overlay.action);
    expect(GUIDE.focus.generate).toContain(EXPORT_JOBS.framing.action);
    expect(GUIDE.finished.viewer).toContain(RESULT_PUBLISH.PUBLISH_GET_LINK);
  });

  it('the spotlight guide promises a tap on each moment, never following', () => {
    const body = GUIDE.overlay.pick.first.body;
    expect(body).not.toMatch(/stays on them/);
    expect(body).toMatch(/lands on them/);
    expect(EDITOR_PANELS.PICK_GUIDE_WHY(4)).toContain('4 moments');
    expect(EDITOR_PANELS.PICK_GUIDE_WHY(4)).not.toContain('{n}');
  });

  it('no guide copy claims automatic following or tracking', () => {
    const all = [GUIDE, EDITOR_PANELS.PICK_GUIDE_WHY(4)].flatMap(strings).join(' | ');
    expect(all).not.toMatch(/\b(follows?|tracks?|tracking|automatically)\b/i);
  });

  it('Clips statuses say what is next, not a jargon stage', () => {
    expect(DRAFT_STAGE_LABELS[DRAFT_STAGE.NOT_STARTED]).toBe('Not started');
    expect(getDraftStageLabel({})).not.toMatch(/not framed yet/i);
    expect(DRAFT_STAGE_LABELS[DRAFT_STAGE.IN_OVERLAY]).toBe('In progress');
  });

  it('the empty Clips state does not talk about a Framing pass', () => {
    const txt = strings([EMPTY_TAB_GUIDE.clips, PARTIAL_TAB_GUIDE.clips]).join(' ');
    expect(txt).not.toMatch(/Framing pass/);
    expect(txt).toMatch(/Add a spotlight if you want, or finish it any time\./);
  });
});
