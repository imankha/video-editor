import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide, homeFacts, reviewCounts } from './resolveGuide';
import { GUIDE_PULSE } from './guideTargets';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const game = (viewed, duration = 100, clips = 0) => ({ viewed_duration: viewed, video_duration: duration, clip_count: clips });

describe('reviewCounts: furthest playhead (viewed_duration) vs video length', () => {
  it('a game with a finished clip but under 90% watched is still being reviewed', () => {
    expect(reviewCounts([game(40, 100, 2)])).toEqual({ gamesReviewing: 1, gamesUnreviewed: 1 });
  });
  it('an untouched game is unreviewed but not in progress', () => {
    expect(reviewCounts([game(0, 100, 0)])).toEqual({ gamesReviewing: 0, gamesUnreviewed: 1 });
  });
  it('90% watched counts as reviewed', () => {
    expect(reviewCounts([game(90, 100, 2)])).toEqual({ gamesReviewing: 0, gamesUnreviewed: 0 });
  });
});

describe('Home games tab: keep reviewing, then congrats', () => {
  it('finished a clip but the game is not fully reviewed: steer back into the game', () => {
    const g = resolveGuide(homeFacts({ games: 1, gamesWithPlays: 1, finished: 1, gamesReviewing: 1, gamesUnreviewed: 1 }));
    expect(g.id).toBe('home.games.keep-reviewing');
    expect(g.pulse).toBe(GUIDE_PULSE.FIRST_GAME);
    expect(g.end).toBe(false);
  });
  it('every game reviewed and no unfinished clips: congrats + upload more, as an end card', () => {
    const g = resolveGuide(homeFacts({ games: 1, gamesWithPlays: 1, finished: 1, drafts: 0, gamesReviewing: 0, gamesUnreviewed: 0 }));
    expect(g.id).toBe('home.games.all-done');
    expect(g.pulse).toBe(GUIDE_PULSE.UPLOAD_GAME);
    expect(g.end).toBe(true);
  });
  it('reviewed but a clip is unfinished: not the congrats card', () => {
    const g = resolveGuide(homeFacts({ games: 1, gamesWithPlays: 1, finished: 1, drafts: 1, gamesUnreviewed: 0 }));
    expect(g.id).not.toBe('home.games.all-done');
  });
  it('the Finished viewer turn-off card is an end card too', () => {
    expect(resolveGuide({ screen: 'finished', local: { shared: true } }).end).toBe(true);
  });
});

describe('Annotate "Keep going" (has plays) keeps the player usable', () => {
  // Home's keep-reviewing card sends the user back into the game, where the first thing they need is Play.
  it.each([1, 3])('%i play(s) marked: video and transport are cut out of the shade', (playCount) => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: null }, local: { playCount } });
    expect(g.id).toMatch(/^annotate\.has-plays\./);
    expect(g.keepClear).toEqual(expect.arrayContaining(['[data-testid="annotate-controls"]', '[data-testid="annotate-coach-stage"] video']));
  });
});

describe('end cards have no Got it', () => {
  afterEach(() => { cleanup(); useGuideFocusStore.getState().resetAcks(); });
  const endGuide = () => resolveGuide(homeFacts({ games: 1, gamesWithPlays: 1, finished: 1, gamesUnreviewed: 0 }));

  it('floating end card: X only, and Esc does not dismiss it', async () => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
    render(<Guide guide={endGuide()} />); await flush();
    expect(screen.getByText(/Congrats/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn off guidance' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' }); await flush();
    expect(screen.getByText(/Congrats/)).toBeTruthy();
  });
  it('inline end card: no Got it', async () => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
    render(<Guide inline guide={endGuide()} />); await flush();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });
});
