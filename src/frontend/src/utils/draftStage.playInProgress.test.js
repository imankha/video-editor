import { describe, it, expect } from 'vitest';
import { isPlayInProgress } from './draftStage';

// T16530:C5 -- the server finishes a highlight (T16520) before the next session's
// archive sweep hides its project, so the drafts list still returns it. It must
// not appear under Plays as "In progress": it lives under Highlights only.
describe('isPlayInProgress (T16530:C5)', () => {
  it('T16530:C5 keeps a finished highlight out of Plays', () => {
    expect(isPlayInProgress({ is_auto_created: true, has_final_video: true, is_published: true })).toBe(false);
  });

  it('keeps a play still being made in Plays', () => {
    expect(isPlayInProgress({ is_auto_created: true, has_working_video: true, is_published: false })).toBe(true);
    expect(isPlayInProgress({ is_auto_created: true, has_final_video: true, is_published: false })).toBe(true);
  });
});
