import { describe, it, expect } from 'vitest';
import { CLIP_UPLOAD, GUIDE, SHARING, CREDITS, LIBRARY_ACTIONS } from './displayNames';

// T14560: copy must name controls that exist, say what is actually shared,
// and pluralize credits in one place.
describe('T14560 contradictory copy', () => {
  it('T14560:C1 over-cap copy points at the real "Upload game" control', () => {
    const all = [
      CLIP_UPLOAD.sizeLimitBody(500),
      CLIP_UPLOAD.SIZE_LIMIT_ADD_GAME,
      CLIP_UPLOAD.refusalMessage('duration_exceeds_cap', { durationMinutes: 5 }),
      CLIP_UPLOAD.refusalMessage('duration_exceeds_cap'),
      GUIDE.modal.clipSizeLimit,
    ].join(' | ');
    expect(all).not.toMatch(/Add Game/);
    expect(CLIP_UPLOAD.SIZE_LIMIT_ADD_GAME).toBe(`${LIBRARY_ACTIONS.UPLOAD_GAME} instead`);
    expect(GUIDE.modal.clipSizeLimit).toContain(`Tap ${LIBRARY_ACTIONS.UPLOAD_GAME} instead`);
  });

  it('T14560:C2 overlay ready does not promise a link from Finish', () => {
    expect(GUIDE.overlay.ready).toBe('Looks good? Tap Finish, then Share to get a link.');
  });

  it('T14560:C3 share button says what is shared', () => {
    expect(SHARING.SHARE_PLAYS).toBe('Share game');
    expect(GUIDE.annotate.review.title).toBe(
      'Your plays, back to back. Tap Share game to send the game and your plays to family or coaches.',
    );
  });

  it('T14560:C6 credits pluralize in one helper', () => {
    expect(CREDITS.count(1)).toBe('1 credit');
    expect(CREDITS.count(0)).toBe('0 credits');
    expect(CREDITS.count(25)).toBe('25 credits');
    expect(CREDITS.added(1)).toBe('1 credit added to your balance!');
    expect(CREDITS.added(5)).toBe('5 credits added to your balance!');
    expect(CREDITS.REFUNDED).not.toMatch(/Your credit has/);
  });
});
