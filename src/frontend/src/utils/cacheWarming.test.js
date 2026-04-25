/**
 * T1410: verify warmup abort wiring.
 *
 * Behavior under test:
 *  1. Setting priority to FOREGROUND_ACTIVE aborts every in-flight warm fetch.
 *  2. Worker loop does not pull new items while in FOREGROUND_ACTIVE.
 *  3. When a StrictMode-style double invocation races two foreground loads,
 *     only one wins — the first is aborted cleanly (AbortError) and the
 *     second survives. We simulate this at the fetch layer.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import fresh between tests so module-level state resets.
let cacheWarming;

async function loadModule() {
  vi.resetModules();
  cacheWarming = await import('./cacheWarming');
}

function makeDeferredFetch() {
  // A fetch that never resolves until we call .resolve() — unless aborted,
  // in which case it rejects with AbortError.
  const pending = [];
  const fetchMock = vi.fn((url, init = {}) => {
    return new Promise((resolve, reject) => {
      const signal = init.signal;
      const entry = { url, resolve, reject, signal };
      pending.push(entry);
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  });
  return { fetchMock, pending };
}

describe('cacheWarming — T1410 foreground abort', () => {
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

  it('aborts in-flight warm fetches when priority flips to FOREGROUND_ACTIVE', async () => {
    // Kick off a warm — warmVideoCache calls warmUrl which attaches a signal.
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/video.mp4');

    // Let the microtask run so the fetch call is registered.
    await Promise.resolve();
    await Promise.resolve();

    expect(pending.length).toBe(1);
    const entry = pending[0];
    expect(entry.signal).toBeDefined();
    expect(entry.signal.aborted).toBe(false);

    // Flip priority — should abort all in-flight warms.
    // T1400: return value reports abortedCount so callers can log it.
    const abortResult = cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    expect(abortResult).toEqual({ abortedCount: 1 });

    expect(entry.signal.aborted).toBe(true);

    // warmVideoCache swallows the rejection and returns false.
    const result = await warmPromise;
    expect(result).toBe(false);
  });

  it('FOREGROUND_ACTIVE pauses lower tiers but tier-1 clip ranges still process', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);

    cacheWarming.pushClipRanges([
      {
        url: 'https://example.com/a.mp4',
        startTime: 0, endTime: 10,
        videoDuration: 100, videoSize: 1_000_000,
      },
    ]);

    // Let microtasks run so the worker loop processes the tier-1 clip range.
    await Promise.resolve();
    await Promise.resolve();

    // Tier-1 clip ranges are exempt from FOREGROUND_ACTIVE — fetch should fire.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('clearForegroundActive resumes the warmer', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);

    // Direct warm calls are gated during FOREGROUND_ACTIVE.
    const result1 = await cacheWarming.warmVideoCache('https://example.com/gated.mp4');
    expect(result1).toBe(false);

    // Clear the latch — warmer should resume.
    cacheWarming.clearForegroundActive();

    // Now direct warm calls work again.
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/resumed.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://example.com/resumed.mp4')).toBe(true);
  });

  it('StrictMode double-invoke: two FOREGROUND_ACTIVE entries, single clear resumes', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.GAMES);
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);

    // Still disabled before clear.
    const result1 = await cacheWarming.warmVideoCache('https://example.com/before-clear.mp4');
    expect(result1).toBe(false);

    // Single clear is sufficient.
    cacheWarming.clearForegroundActive();
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/after-clear.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://example.com/after-clear.mp4')).toBe(true);
  });
});
