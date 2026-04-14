/**
 * T1460: route decision for video loading (direct-warm / proxy / forced direct).
 */
import { describe, it, expect, vi } from 'vitest';
import { chooseLoadRoute, ROUTE } from './videoLoadRoute';

const PROXY_URL = 'https://api/clips/projects/1/clips/5/stream';
const GAME_URL = 'https://r2.example/games/abc.mp4?sig=xyz';

function warmer(ranges) {
  return vi.fn(() => ranges == null ? null : { clipRanges: ranges, urlWarmed: false, tailWarmed: false, warmedAt: Date.now() });
}

describe('T1460 chooseLoadRoute', () => {
  it('returns PASSTHROUGH when gameUrl is null (non-game clip)', () => {
    const r = chooseLoadRoute({
      url: 'blob:xyz',
      gameUrl: null,
      clipOffset: null,
      clipDuration: null,
      forceDirect: false,
      getWarmedStateFn: warmer(null),
    });
    expect(r.route).toBe(ROUTE.PASSTHROUGH);
    expect(r.loadUrl).toBe('blob:xyz');
    expect(r.warmLookupUrl).toBe('blob:xyz');
  });

  it('PROXY when warmer has never seen the URL', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: false,
      getWarmedStateFn: warmer(null),
    });
    expect(r.route).toBe(ROUTE.PROXY);
    expect(r.loadUrl).toBe(PROXY_URL);
    expect(r.warmLookupUrl).toBe(GAME_URL);
    expect(r.rangeCovered).toBe(false);
  });

  it('PROXY when warmer has URL but no covering range', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: false,
      getWarmedStateFn: warmer([{ startTime: 500, endTime: 520 }]),
    });
    expect(r.route).toBe(ROUTE.PROXY);
    expect(r.rangeCovered).toBe(false);
  });

  it('DIRECT_WARM when covering range is recorded', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: false,
      getWarmedStateFn: warmer([{ startTime: 95, endTime: 115 }]),
    });
    expect(r.route).toBe(ROUTE.DIRECT_WARM);
    expect(r.loadUrl).toBe(GAME_URL);
    expect(r.warmLookupUrl).toBe(GAME_URL);
    expect(r.rangeCovered).toBe(true);
  });

  it('DIRECT_FORCED when forceDirect=true and not warm', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: true,
      getWarmedStateFn: warmer(null),
    });
    expect(r.route).toBe(ROUTE.DIRECT_FORCED);
    expect(r.loadUrl).toBe(GAME_URL);
  });

  it('DIRECT_WARM takes precedence over forceDirect (still direct, labeled warm)', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: true,
      getWarmedStateFn: warmer([{ startTime: 95, endTime: 115 }]),
    });
    expect(r.route).toBe(ROUTE.DIRECT_WARM);
  });

  it('warm_status log uses gameUrl even when PROXY is chosen (the bug this fixes)', () => {
    const r = chooseLoadRoute({
      url: PROXY_URL,
      gameUrl: GAME_URL,
      clipOffset: 100, clipDuration: 10,
      forceDirect: false,
      getWarmedStateFn: warmer(null),
    });
    expect(r.warmLookupUrl).toBe(GAME_URL);
    expect(r.loadUrl).toBe(PROXY_URL);
  });
});
