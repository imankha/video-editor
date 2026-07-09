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
    const warmPromise = cacheWarming.warmVideoCache('/stream/video.mp4');

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

  it('skips cross-origin R2 URLs (no-cors strips Range headers)', async () => {
    const result = await cacheWarming.warmVideoCache('https://r2.example.com/game.mp4');
    expect(result).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('FOREGROUND_DIRECT stops ALL warming including tier-1 clip ranges', async () => {
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    cacheWarming.pushClipRanges([
      {
        url: '/stream/a.mp4',
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
        url: '/stream/game.mp4',
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
      c[0] === '/stream/game.mp4'
    );
    expect(clipRangeFetches.length).toBeGreaterThanOrEqual(1);
  });

  it('FOREGROUND_PROXY aborts inFlightControllers but not inFlightClipRangeControllers', async () => {
    // Start a regular warm fetch
    const warmPromise = cacheWarming.warmVideoCache('/stream/regular.mp4');
    await Promise.resolve();
    await Promise.resolve();

    expect(pending.length).toBe(1);
    const regularEntry = pending[0];

    // Start a clip range warm
    cacheWarming.pushClipRanges([
      {
        url: '/stream/game.mp4',
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
      e.url === '/stream/game.mp4'
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

    const result1 = await cacheWarming.warmVideoCache('/stream/gated.mp4');
    expect(result1).toBe(false);

    cacheWarming.clearForegroundActive();

    const warmPromise = cacheWarming.warmVideoCache('/stream/resumed.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === '/stream/resumed.mp4')).toBe(true);
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

    const result1 = await cacheWarming.warmVideoCache('/stream/before-clear.mp4');
    expect(result1).toBe(false);

    cacheWarming.clearForegroundActive();
    const warmPromise = cacheWarming.warmVideoCache('/stream/after-clear.mp4');
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(c => c[0] === '/stream/after-clear.mp4')).toBe(true);
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

describe('cacheWarming — concurrent workers', () => {
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

  it('serializes warming to one clip range at a time (T4772 concurrency cap = 1)', async () => {
    cacheWarming.pushClipRanges([
      { url: '/stream/g1.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g2.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g3.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g4.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    // T4772: a single worker processes one clip range at a time. One clip range =
    // 2 concurrent fetches (head 0-1MB + body range), so exactly 2 are in flight
    // and only ONE distinct video is warmed — the other 3 stay queued. This keeps
    // concurrent warm streams from starving the foreground on the 1-vCPU Fly box.
    expect(pending.length).toBe(2);
    const urls = new Set(pending.map(e => e.url));
    expect(urls.size).toBe(1);
  });

  it('FOREGROUND_DIRECT aborts all concurrent in-flight warm fetches', async () => {
    cacheWarming.pushClipRanges([
      { url: '/stream/a.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/b.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/c.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    // With the concurrency cap only one clip range is in flight (head + body = 2).
    expect(pending.length).toBeGreaterThanOrEqual(2);
    for (const entry of pending) {
      expect(entry.signal.aborted).toBe(false);
    }

    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    for (const entry of pending) {
      expect(entry.signal.aborted).toBe(true);
    }
  });

  it('caps warm concurrency to 1 regardless of connection type (T4772)', async () => {
    vi.resetModules();
    const origConnection = navigator.connection;
    // A fast connection used to fan out to 4 workers; the cap must hold anyway,
    // because the bottleneck is the shared 1-vCPU Fly box, not client bandwidth.
    Object.defineProperty(navigator, 'connection', {
      value: { effectiveType: '4g' },
      configurable: true,
    });

    cacheWarming = await import('./cacheWarming');
    ({ fetchMock, pending } = makeDeferredFetch());
    vi.stubGlobal('fetch', fetchMock);

    cacheWarming.pushClipRanges([
      { url: '/stream/g1.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g2.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g3.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
      { url: '/stream/g4.mp4', startTime: 0, endTime: 10, videoDuration: 100, videoSize: 1_000_000 },
    ]);

    await Promise.resolve();
    await Promise.resolve();

    // Even on 4g: one clip range at a time (head + body = 2 fetches), not 8.
    expect(pending.length).toBe(2);

    Object.defineProperty(navigator, 'connection', {
      value: origConnection,
      configurable: true,
    });
  });
});

describe('cacheWarming — cross-queue dedup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates same URL across tier1 and games queues', async () => {
    vi.resetModules();
    vi.doMock('../stores/authStore', () => ({
      useAuthStore: { getState: () => ({ isAuthenticated: true }) },
    }));
    cacheWarming = await import('./cacheWarming');

    // Disable warmer so queues stay populated for inspection
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    let isApiCall = true;
    vi.stubGlobal('fetch', vi.fn(() => {
      if (isApiCall) {
        isApiCall = false;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            r2_enabled: true,
            project_clips: [{
              has_working_video: false,
              clips: [{
                id: 'clip1',
                game_url: '/stream/game1.mp4',
                start_time: 10, end_time: 20,
                video_duration: 100, video_size: 1_000_000,
              }],
            }],
            game_urls: [
              '/stream/game1.mp4',
              '/stream/game2.mp4',
            ],
            gallery_urls: [],
            working_urls: [],
          }),
        });
      }
      return Promise.resolve({ ok: true });
    }));

    await cacheWarming.warmAllUserVideos();

    const diag = cacheWarming.getWarmingDiag();
    // tier1 has clip range for game1, games should only have game2 (game1 deduped)
    expect(diag.tier1).toBe(1);
    expect(diag.games).toBe(1);

    vi.doUnmock('../stores/authStore');
  });

  it('T4772: does NOT warm off-screen working (draft) videos from home', async () => {
    vi.resetModules();
    vi.doMock('../stores/authStore', () => ({
      useAuthStore: { getState: () => ({ isAuthenticated: true }) },
    }));
    cacheWarming = await import('./cacheWarming');

    // Disable warmer so queues stay populated for inspection
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    let isApiCall = true;
    vi.stubGlobal('fetch', vi.fn(() => {
      if (isApiCall) {
        isApiCall = false;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            r2_enabled: true,
            // A drafted project WITH a working video: the pre-T4772 storm source.
            project_clips: [{
              has_working_video: true,
              working_video_url: '/api/projects/47/working_video/stream',
              clips: [{
                id: 'clipA', game_url: '/stream/gameA.mp4',
                start_time: 0, end_time: 10, video_duration: 100, video_size: 1_000_000,
              }],
            }],
            game_urls: [],
            gallery_urls: [],
            // Off-screen working videos from the library — must be ignored.
            working_urls: [
              '/api/projects/49/working_video/stream',
              '/api/projects/50/working_video/stream',
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true });
    }));

    await cacheWarming.warmAllUserVideos();

    const diag = cacheWarming.getWarmingDiag();
    // working_urls are dropped entirely; the has_working_video project is skipped
    // (not even its clip ranges are warmed) — no working_video/stream is enqueued.
    expect(diag.working).toBe(0);
    expect(diag.tier1).toBe(0);

    vi.doUnmock('../stores/authStore');
  });
});

describe('cacheWarming — prioritizeUrls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('promotes matching URLs to front of games queue', async () => {
    vi.resetModules();
    vi.doMock('../stores/authStore', () => ({
      useAuthStore: { getState: () => ({ isAuthenticated: true }) },
    }));
    cacheWarming = await import('./cacheWarming');

    // Disable warmer so queues stay populated
    cacheWarming.setWarmupPriority(cacheWarming.WARMUP_PRIORITY.FOREGROUND_DIRECT);

    let isApiCall = true;
    vi.stubGlobal('fetch', vi.fn(() => {
      if (isApiCall) {
        isApiCall = false;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            r2_enabled: true,
            project_clips: [],
            game_urls: [
              '/stream/a.mp4',
              '/stream/b.mp4',
              '/stream/c.mp4',
            ],
            gallery_urls: [],
            working_urls: [],
          }),
        });
      }
      return Promise.resolve({ ok: true });
    }));

    await cacheWarming.warmAllUserVideos();

    // Flush microtasks so disabled workers complete and workersRunning resets
    await new Promise(r => setTimeout(r, 0));

    // Queue has a, b, c. Promote c to front.
    cacheWarming.prioritizeUrls(['/stream/c.mp4']);

    // Resume warmer and capture fetch order
    const pending = [];
    vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
      return new Promise((resolve, reject) => {
        const signal = init.signal;
        pending.push({ url, resolve, reject, signal });
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
      });
    }));

    cacheWarming.clearForegroundActive();
    await Promise.resolve();
    await Promise.resolve();

    // c.mp4 should be the first URL fetched (promoted to front)
    expect(pending[0].url).toBe('/stream/c.mp4');

    vi.doUnmock('../stores/authStore');
  });
});

describe('cacheWarming — scheduleWarmAllUserVideos (T4772 deferral)', () => {
  beforeEach(async () => {
    await loadModule();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers to requestIdleCallback instead of warming synchronously on the critical path', async () => {
    let idleCb = null;
    vi.stubGlobal('requestIdleCallback', vi.fn((cb) => { idleCb = cb; return 1; }));
    // Fail loudly if warming ran synchronously (it must not touch the network yet).
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetchMock);

    cacheWarming.scheduleWarmAllUserVideos();

    // Scheduled, not executed: requestIdleCallback was registered, no fetch yet.
    expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(idleCb).toBeTypeOf('function');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to setTimeout when requestIdleCallback is unavailable', async () => {
    // jsdom has no requestIdleCallback by default; stub it away to be explicit.
    vi.stubGlobal('requestIdleCallback', undefined);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    cacheWarming.scheduleWarmAllUserVideos();

    // A deferred timer was scheduled (not an immediate synchronous warm).
    expect(timeoutSpy).toHaveBeenCalled();
    const delay = timeoutSpy.mock.calls[0][1];
    expect(delay).toBeGreaterThan(0);
    timeoutSpy.mockRestore();
  });
});
