import { describe, it, expect } from 'vitest';
import { resolveGuide } from './resolveGuide';
import { homeFacts } from './catalog';

/**
 * T17190:C2 -- a sharpen that just finished while the parent is on Home: the coach names
 * Go to Highlights and lights it up, instead of "Every play is finished. Open a game..."
 * (home.clips.all-done), which pointed at Games, away from the highlight.
 */
describe('T17190:C2 Home coach after a sharpen finishes', () => {
  it('names and pulses Go to Highlights while the ready highlight is showing', () => {
    const g = resolveGuide(homeFacts({ tab: 'clips', finished: 1, drafts: 0, highlightReady: true }));
    expect(g.id).toBe('home.clips.ready');
    expect(g.message.title).toBe('Your highlight is ready. Tap Go to Highlights to watch or share it.');
    expect(g.pulse).toBe('home-go-to-highlights');
    expect(g.keepClear).toContain('[data-testid="home-go-to-highlights"]');
  });

  it('keeps the all-done card when no sharpen just finished', () => {
    expect(resolveGuide(homeFacts({ tab: 'clips', finished: 1 })).id).toBe('home.clips.all-done');
  });
});
