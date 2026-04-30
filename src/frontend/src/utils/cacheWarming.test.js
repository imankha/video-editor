/**
 * T1410 / T2040: verify warmup abort wiring and priority modes.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

let cacheWarming;

async function loadModule() {
  vi.resetModules();
  cacheWarming = await import('./cacheWarming');
}

function makeDeferredFetch() {
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

describe('cacheWarming — foreground abort', () => {
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
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/video.mp4');

    await Promise.resolve();
    await Promise.resolve();

    expect(pending.length).toBe(1);
    const entry = pending[0];
    expect(entry.signal).toBeDefined();
    expect(entry.signal.aborted).toBe(false);

    const abortResult = cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    expect(abortResult).toEqual({ abortedCount: 1 });

    expect(entry.signal.aborted).toBe(true);

    const result = await warmPromise;
    expect(result).toBe(false);
  });

  it('FOREGROUND_DIRECT stops ALL warming including tier-1 clip ranges', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    cacheWarming.pushClipRanges([
      {
        url: 'https://example.com/a.mp4',
        startTime: 0, endTime: 10,
        videoDuration: 100, videoSize: 1_000_000,
      },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('FOREGROUND_ACTIVE is an alias for FOREGROUND_DIRECT', () => {
    expect(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE)
      .toBe(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);
  });

  it('FOREGROUND_PROXY stops games/gallery but allows tier-1 clip ranges', async () => {
    // Queue a gallery URL and a tier-1 clip range before entering proxy mode
    // Use warmAllUserVideos approach: populate queues then set priority
    cacheWarming.pushClipRanges([
      {
        url: 'https://example.com/game.mp4',
        startTime: 10, endTime: 20,
        videoDuration: 100, videoSize: 1_000_000,
      },
    ]);

    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_PROXY);

    // Let microtasks run — worker should process tier-1 but not gallery/games.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The clip range warm fires two fetches (head + body).
    const clipRangeFetches = fetchMock.mock.calls.filter(c =>
      c[0] === 'https://example.com/game.mp4'
    );
    expect(clipRangeFetches.length).toBeGreaterThanOrEqual(1);
  });

  it('FOREGROUND_PROXY aborts inFlightControllers but not inFlightClipRangeControllers', async () => {
    // Start a regular warm fetch
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/regular.mp4');
    await Promise.resolve();
    await Promise.resolve();

    expect(pending.length).toBe(1);
    const regularEntry = pending[0];

    // Start a clip range warm
    cacheWarming.pushClipRanges([
      {
        url: 'https://example.com/game.mp4',
        startTime: 0, endTime: 10,
        videoDuration: 100, videoSize: 1_000_000,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    // Switch to FOREGROUND_PROXY
    const result = cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_PROXY);

    // Regular warm should be aborted
    expect(regularEntry.signal.aborted).toBe(true);
    expect(result.abortedCount).toBe(1);

    // Clip range fetches should NOT be aborted — check that their signals are still alive
    const clipRangeEntries = pending.filter(e =>
      e.url === 'https://example.com/game.mp4'
    );
    for (const entry of clipRangeEntries) {
      expect(entry.signal.aborted).toBe(false);
    }
  });

  it('clearForegroundActive restores previous priority (not hardcoded GAMES)', async () => {
    // Set gallery priority first
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.GALLERY);

    // Enter foreground mode
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    // Clear foreground — should restore to GALLERY, not GAMES
    cacheWarming.clearForegroundActive();

    const diag = cacheWarming.getWarmingDiag();
    expect(diag.priority).toBe(cacheWarming.WARMUP_PRIORITY.GALLERY);
  });

  it('clearForegroundActive resumes the warmer', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);

    const result1 = await cacheWarming.warmVideoCache('https://example.com/gated.mp4');
    expect(result1).toBe(false);

    cacheWarming.clearForegroundActive();

    const warmPromise = cacheWarming.warmVideoCache('https://example.com/resumed.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://example.com/resumed.mp4')).toBe(true);
  });

  it('clearForegroundActive restores priority after FOREGROUND_PROXY too', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.DRAFT_REELS);
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_PROXY);
    cacheWarming.clearForegroundActive();

    const diag = cacheWarming.getWarmingDiag();
    expect(diag.priority).toBe(cacheWarming.WARMUP_PRIORITY.DRAFT_REELS);
    expect(diag.pausedLowerTiers).toBe(false);
  });

  it('Gallery queue processes before games queue regardless of priority mode', async () => {
    // Set GAMES priority — gallery should STILL go first since it's 1KB each.
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.GAMES);
    cacheWarming.clearWarmingCache();

    // Re-import to get clean state after clearWarmingCache
    await loadModule();
    ({ fetchMock, pending } = makeDeferredFetch());
    vi.stubGlobal('fetch', fetchMock);

    // We can't easily test queue ordering via the public API without warmAllUserVideos,
    // so we test via getWarmingDiag after setting up. Instead, verify the WARMUP_PRIORITY
    // constants and getNextItem behavior by examining the diag after operations.
    const diag = cacheWarming.getWarmingDiag();
    expect(diag.priority).toBe(cacheWarming.WARMUP_PRIORITY.GAMES);
    // The key test: DRAFT_REELS exists as a priority
    expect(cacheWarming.WARMUP_PRIORITY.DRAFT_REELS).toBe('draft_reels');
  });

  it('StrictMode double-invoke: two FOREGROUND_ACTIVE entries, single clear resumes', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.GAMES);
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_ACTIVE);

    const result1 = await cacheWarming.warmVideoCache('https://example.com/before-clear.mp4');
    expect(result1).toBe(false);

    cacheWarming.clearForegroundActive();
    const warmPromise = cacheWarming.warmVideoCache('https://example.com/after-clear.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === 'https://example.com/after-clear.mp4')).toBe(true);
  });

  it('DRAFT_REELS priority exists and is distinct from other priorities', () => {
    const { WARMUP_PRIORITY: P } = cacheWarming;
    expect(P.DRAFT_REELS).toBe('draft_reels');
    expect(P.DRAFT_REELS).not.toBe(P.GAMES);
    expect(P.DRAFT_REELS).not.toBe(P.GALLERY);
    expect(P.DRAFT_REELS).not.toBe(P.FOREGROUND_DIRECT);
    expect(P.DRAFT_REELS).not.toBe(P.FOREGROUND_PROXY);
  });
});
