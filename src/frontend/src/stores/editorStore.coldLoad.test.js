import { describe, it, expect, beforeEach, vi } from 'vitest';

// T12880: cold load of /annotate reopens the game the tab was on.
describe('editorStore cold load of /annotate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('re-seeds the pending game from the resume slot', { timeout: 30000 }, async () => {
    window.history.pushState({}, '', '/annotate');
    const nav = await import('../utils/pendingNavigation');
    nav.setPendingGame(42);
    nav.consumePendingGame(); // first load consumed the breadcrumb
    await import('./editorStore');
    expect(nav.consumePendingGame()?.gameId).toBe(42);
  });

  it('does not seed when the cold load is not /annotate', async () => {
    window.history.pushState({}, '', '/home/games');
    const nav = await import('../utils/pendingNavigation');
    nav.setPendingGame(42);
    nav.consumePendingGame();
    await import('./editorStore');
    expect(nav.hasPendingGame()).toBe(false);
  });
});
