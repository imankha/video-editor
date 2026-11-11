import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: 'https://reel-ballers-api-staging.fly.dev' }));

import apiFetch from './apiFetch';
import {
  recordHealthCheck,
  __resetColdBackendTrackerForTest,
} from './coldBackendTracker';

// T16060: apiFetch is the one choke point ~100 call sites share. A request
// that fails or is slow while staging's backend is cold should carry a note
// explaining why; the same failure on a warm backend should not.
describe('T16060: apiFetch cold-backend note', () => {
  let warnSpy;

  beforeEach(() => {
    __resetColdBackendTrackerForTest();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('T16060:C1 notes a failed request while the backend is in its cold window', async () => {
    recordHealthCheck({ isFirstCheck: true, ok: false, elapsedMs: 10000 });
    recordHealthCheck({ isFirstCheck: false, ok: true, elapsedMs: 50 });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiFetch('/api/projects/1')).rejects.toThrow('Failed to fetch');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('COLD BACKEND'));
  });

  it('T16060:C2 does not note the same failure on a warm backend', async () => {
    recordHealthCheck({ isFirstCheck: true, ok: true, elapsedMs: 100 });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiFetch('/api/projects/1')).rejects.toThrow('Failed to fetch');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('T16060: still returns the real response when ok, cold window or not', async () => {
    recordHealthCheck({ isFirstCheck: true, ok: false, elapsedMs: 10000 });
    recordHealthCheck({ isFirstCheck: false, ok: true, elapsedMs: 50 });

    const okResponse = { ok: true, status: 200 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse));

    const response = await apiFetch('/api/projects/1');
    expect(response).toBe(okResponse);
  });
});

describe('T16060:C3 apiFetch never notes on the production backend', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is silent even after a detected cold start', async () => {
    vi.doMock('../config', () => ({ API_BASE: 'https://reel-ballers-api.fly.dev' }));
    const { recordHealthCheck: record, __resetColdBackendTrackerForTest: reset } =
      await import('./coldBackendTracker');
    const prodApiFetch = (await import('./apiFetch')).default;
    reset();
    record({ isFirstCheck: true, ok: false, elapsedMs: 10000 });
    record({ isFirstCheck: false, ok: true, elapsedMs: 50 });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(prodApiFetch('/api/projects/1')).rejects.toThrow('Failed to fetch');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
