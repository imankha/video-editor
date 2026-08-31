import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let useGamesDataStore;

async function loadModule() {
  vi.resetModules();
  const mod = await import('./gamesDataStore');
  useGamesDataStore = mod.useGamesDataStore;
}

function makeDeferredFetch() {
  const pending = [];
  const fetchMock = vi.fn((url, init = {}) => {
    return new Promise((resolve, reject) => {
      pending.push({ url, resolve, reject });
    });
  });
  return { fetchMock, pending };
}

function resolveWithGame(entry, gameId = 1) {
  entry.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: gameId, name: 'Test Game', videos: [] }),
  });
}

describe('gamesDataStore — getGame() in-flight dedup', () => {
  let fetchMock;
  let pending;

  beforeEach(async () => {
    await loadModule();
    ({ fetchMock, pending } = makeDeferredFetch());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns cached in-flight promise for same gameId', async () => {
    const p1 = useGamesDataStore.getState().getGame(7);
    const p2 = useGamesDataStore.getState().getGame(7);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveWithGame(pending[0], 7);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1.id).toBe(7);
  });

  it('fires fresh request after previous completes', async () => {
    const p1 = useGamesDataStore.getState().getGame(7);
    resolveWithGame(pending[0], 7);
    await p1;

    useGamesDataStore.getState().getGame(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deduplicates per gameId independently', async () => {
    useGamesDataStore.getState().getGame(7);
    useGamesDataStore.getState().getGame(8);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    useGamesDataStore.getState().getGame(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears inflight on error', async () => {
    const p1 = useGamesDataStore.getState().getGame(7);
    pending[0].reject(new Error('network error'));
    await expect(p1).rejects.toThrow('network error');

    useGamesDataStore.getState().getGame(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers all receive the error', async () => {
    const p1 = useGamesDataStore.getState().getGame(7);
    const p2 = useGamesDataStore.getState().getGame(7);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending[0].reject(new Error('server error'));

    await expect(p1).rejects.toThrow('server error');
    await expect(p2).rejects.toThrow('server error');
  });

  it('reset() clears in-flight promises', async () => {
    useGamesDataStore.getState().getGame(7);

    useGamesDataStore.getState().reset();

    useGamesDataStore.getState().getGame(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('gamesDataStore — finishAnnotation 404 reporting (T8180, reverses T7500)', () => {
  beforeEach(async () => {
    await loadModule();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('REPORTS a 404 ({ notFound: true }, warn not error) — ghost session, no longer swallowed', async () => {
    // T7500 used to swallow this silently (returned undefined, debug log). T8180
    // reverses that: a 404 means the user was annotating a deleted game, and the
    // caller must be able to surface a toast + exit. So finishAnnotation returns a
    // { notFound: true } signal and warns (not errors, not silent).
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Game not found' }) })
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await useGamesDataStore.getState().finishAnnotation(4, 120);

    expect(result).toEqual({ notFound: true });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('still logs an error for a genuine non-404 failure', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await useGamesDataStore.getState().finishAnnotation(4, 120);

    expect(errorSpy).toHaveBeenCalled();
  });
});
