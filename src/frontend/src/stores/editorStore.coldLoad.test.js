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

// T14970: a cold load of a canonical editor URL hydrates from the path.
describe('editorStore cold load of a canonical URL', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    delete window.__popstateHandler;
  });

  it('opens the game in the path and keeps the URL', { timeout: 30000 }, async () => {
    window.history.pushState({}, '', '/annotate/g/42');
    const nav = await import('../utils/pendingNavigation');
    const { useEditorStore, EDITOR_MODES } = await import('./editorStore');
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.ANNOTATE);
    expect(nav.peekPendingGame()).toEqual({ gameId: 42, seekTime: null, sourceClipId: null });
    expect(window.location.pathname).toBe('/annotate/g/42');
    expect(useEditorStore.getState().takeUrlOpenGame(42)).toBe(true);
  });

  it('carries ?t= into the seek breadcrumb and keeps it in the URL', async () => {
    window.history.pushState({}, '', '/annotate/g/42?t=90');
    const nav = await import('../utils/pendingNavigation');
    await import('./editorStore');
    expect(nav.peekPendingGame()?.seekTime).toBe(90);
    expect(window.location.pathname + window.location.search).toBe('/annotate/g/42?t=90');
  });

  it('the URL wins over a breadcrumb for a different game, and that breadcrumb is cleared', async () => {
    window.history.pushState({}, '', '/annotate/g/42');
    const nav = await import('../utils/pendingNavigation');
    nav.setPendingGame(7, 30, 9);
    await import('./editorStore');
    expect(nav.peekPendingGame()).toEqual({ gameId: 42, seekTime: null, sourceClipId: null });
  });

  it('a breadcrumb for the same game keeps its seek and play across a chunk reload', async () => {
    window.history.pushState({}, '', '/annotate/g/42');
    const nav = await import('../utils/pendingNavigation');
    nav.setPendingGame(42, 30, 9);
    await import('./editorStore');
    expect(nav.peekPendingGame()).toEqual({ gameId: 42, seekTime: 30, sourceClipId: 9 });
  });

  it.each([
    ['/focus/p/7', 'framing'],
    ['/overlay/p/7', 'overlay'],
  ])('%s sets the pending project with its mode and keeps the URL', async (path, mode) => {
    window.history.pushState({}, '', path);
    const nav = await import('../utils/pendingNavigation');
    const { useEditorStore } = await import('./editorStore');
    expect(useEditorStore.getState().editorMode).toBe(mode);
    expect(nav.hasPendingProject()).toBe(true);
    expect(nav.consumePendingProject()).toEqual({ projectId: 7, mode });
    expect(window.location.pathname).toBe(path);
  });

  it('the URL wins over a pending project for a different play', async () => {
    window.history.pushState({}, '', '/overlay/p/7');
    const nav = await import('../utils/pendingNavigation');
    nav.setPendingProject(3, { mode: 'framing' });
    await import('./editorStore');
    expect(nav.consumePendingProject()).toEqual({ projectId: 7, mode: 'overlay' });
  });

  it('bare /focus stays bare with nothing pending, and legacy /framing still lands on /focus', async () => {
    window.history.pushState({}, '', '/framing');
    const nav = await import('../utils/pendingNavigation');
    const { useEditorStore, EDITOR_MODES } = await import('./editorStore');
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.FRAMING);
    expect(window.location.pathname).toBe('/focus');
    expect(nav.hasPendingProject()).toBe(false);
  });

  it.each([
    ['/focus/p/abc', 'project'],
    ['/overlay/p/abc', 'project'],
    ['/annotate/g/abc', 'game'],
    ['/focus/p/99999999999999999999', 'project'],
  ])('%s lands on the Games tab and asks for the unknown-id notice', async (path, kind) => {
    window.history.pushState({}, '', path);
    const { useEditorStore, EDITOR_MODES } = await import('./editorStore');
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
    expect(window.location.pathname).toBe('/home/games');
    expect(useEditorStore.getState().urlLandingNotice).toEqual({ kind, unavailable: false });
  });

  it('keeps the profile and seek time in the URL', async () => {
    window.history.pushState({}, '', '/annotate/g/42?profile=aaaaaaaa&t=90');
    const nav = await import('../utils/pendingNavigation');
    await import('./editorStore');
    expect(window.location.search).toBe('?profile=aaaaaaaa&t=90');
    expect(nav.peekPendingGame()?.seekTime).toBe(90);
  });

  it.each([
    ['/annotate/g/42?profile=NOT-AN-ID', 'game'],
    ['/focus/p/7?profile=', 'project'],
  ])('%s names no usable profile, so nothing opens', async (url, kind) => {
    window.history.pushState({}, '', url);
    const nav = await import('../utils/pendingNavigation');
    const { useEditorStore } = await import('./editorStore');
    expect(window.location.pathname + window.location.search).toBe('/home/games');
    expect(nav.hasPendingGame()).toBe(false);
    expect(nav.hasPendingProject()).toBe(false);
    expect(useEditorStore.getState().urlLandingNotice).toEqual({ kind, unavailable: false });
  });

  it('the T7670 email link keeps ?game= and ?profile= until App reads them', async () => {
    window.history.pushState({}, '', '/?game=42&profile=aaaaaaaa');
    await import('./editorStore');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('game')).toBe('42');
    expect(params.get('profile')).toBe('aaaaaaaa');
  });

  // T15220: App reads these after module load. Literal names, so a param dropped from
  // the shared list fails here rather than agreeing with itself.
  it.each([
    'ref', 'sport', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'lref',
    'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'sclid', 'ScCid', 'epik', 'rdt_cid',
    'payment', 'session_id',
  ])('keeps ?%s until App reads it', async (name) => {
    window.history.pushState({}, '', `/?${name}=abc`);
    await import('./editorStore');
    expect(window.location.pathname).toBe('/home');
    expect(new URLSearchParams(window.location.search).get(name)).toBe('abc');
  });

  it('strips an unrelated param that arrives with the ones App reads', async () => {
    window.history.pushState({}, '', '/?utm_source=x&foo=1&payment=success&session_id=cs_1');
    await import('./editorStore');
    const params = new URLSearchParams(window.location.search);
    expect([...params.keys()].sort()).toEqual(['payment', 'session_id', 'utm_source']);
  });

  it('keeps an arrival param on a canonical URL alongside its own query', async () => {
    window.history.pushState({}, '', '/annotate/g/42?t=90&utm_source=x');
    await import('./editorStore');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('t')).toBe('90');
    expect(params.get('utm_source')).toBe('x');
  });

  it.each([
    ['/annotate/g/11?profile=XYZ', 'game'],
    ['/annotate/g/11?profile=', 'game'],
    ['/focus/p/7?profile=XYZ', 'project'],
    ['/overlay/p/7?profile=', 'project'],
  ])('%s lands on the Games tab, not in the editor', async (path, kind) => {
    window.history.pushState({}, '', path);
    const { useEditorStore } = await import('./editorStore');
    expect(useEditorStore.getState().editorMode).toBe('project-manager');
    expect(window.location.pathname).toBe('/home/games');
    expect(useEditorStore.getState().urlLandingNotice).toMatchObject({ kind });
  });

  it.each([
    ['/annotate/g/abc', 'setPendingGame'],
    ['/focus/p/abc', 'setPendingProject'],
  ])('%s clears a stale breadcrumb a PRIOR navigation left behind (%s)', async (path, setter) => {
    window.history.pushState({}, '', path);
    const nav = await import('../utils/pendingNavigation');
    if (setter === 'setPendingGame') {
      nav.setPendingGame(99);
    } else {
      nav.setPendingProject(99, { mode: 'framing' });
    }
    await import('./editorStore');
    expect(window.location.pathname).toBe('/home/games');
    expect(nav.hasPendingGame()).toBe(false);
    expect(nav.hasPendingProject()).toBe(false);
  });

  it('an unknown route that names no object stays noticeless', async () => {
    window.history.pushState({}, '', '/focus/p/');
    const { useEditorStore } = await import('./editorStore');
    expect(window.location.pathname).toBe('/home');
    expect(useEditorStore.getState().urlLandingNotice).toBeNull();
  });

  it('public routes are left alone', async () => {
    window.history.pushState({}, '', '/shared/collection/abc');
    await import('./editorStore');
    expect(window.location.pathname).toBe('/shared/collection/abc');
  });
});
