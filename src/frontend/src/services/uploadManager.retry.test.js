/**
 * T9420: the diagnosed cause of "upload fails at ~15% (Failed to fetch), succeeds
 * on retry" is a transient bare-fetch() REJECT on the idempotent front-half API
 * legs (POST /api/games = createGame, POST /api/games/prepare-upload). A rejected
 * fetch() is a TypeError whose Chromium message is literally "Failed to fetch".
 *
 * `apiFetchWithNetworkRetry` converts that manual-retry recovery into a silent
 * auto-retry, and closes the observability gap by beaconing each pre-response
 * reject (the old beacon only fired inside the `!res.ok` branch, so a connection
 * reset left zero server evidence).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetchWithNetworkRetry } from './uploadManager';

const MAIN_URL = 'http://x/api/games/prepare-upload';

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function failedToFetch() {
  return new TypeError('Failed to fetch');
}

describe('T9420 apiFetchWithNetworkRetry', () => {
  let mockFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Route beacon posts to a no-op OK so they never disturb the sequenced main queue.
  function routeMain(mainImpl) {
    let call = 0;
    mockFetch.mockImplementation((url) => {
      if (String(url).includes('upload-failure-beacon')) return Promise.resolve(okResponse());
      return mainImpl(call++);
    });
  }

  it('retries a rejected fetch() and returns the response that eventually succeeds', async () => {
    routeMain((n) => (n === 0 ? Promise.reject(failedToFetch()) : Promise.resolve(okResponse({ ok: 1 }))));

    const p = apiFetchWithNetworkRetry(MAIN_URL, { method: 'POST' }, { phase: 'preparing', beacon: {} });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    const mainCalls = mockFetch.mock.calls.filter(([u]) => !String(u).includes('beacon'));
    expect(mainCalls.length).toBe(2); // first reject + successful retry
  });

  it('beacons reason "fetch_rejected" with the phase on a reject', async () => {
    routeMain((n) => (n === 0 ? Promise.reject(failedToFetch()) : Promise.resolve(okResponse())));

    const p = apiFetchWithNetworkRetry(MAIN_URL, { method: 'POST' }, { phase: 'preparing', beacon: { file_size: 42 } });
    await vi.runAllTimersAsync();
    await p;

    const beaconCall = mockFetch.mock.calls.find(([u]) => String(u).includes('beacon'));
    expect(beaconCall).toBeTruthy();
    const payload = JSON.parse(beaconCall[1].body);
    expect(payload.reason).toBe('fetch_rejected');
    expect(payload.phase).toBe('preparing');
    expect(payload.file_size).toBe(42);
  });

  it('does NOT retry an HTTP error response (ok:false) - returns it on the first call', async () => {
    routeMain(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) }));

    const p = apiFetchWithNetworkRetry(MAIN_URL, { method: 'POST' }, { phase: 'preparing', beacon: {} });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    const mainCalls = mockFetch.mock.calls.filter(([u]) => !String(u).includes('beacon'));
    expect(mainCalls.length).toBe(1); // an HTTP error is the caller's to handle, never retried here
  });

  it('gives up and rethrows the reject after exhausting retries (a genuinely-down backend still fails)', async () => {
    routeMain(() => Promise.reject(failedToFetch()));

    const p = apiFetchWithNetworkRetry(MAIN_URL, { method: 'POST' }, { phase: 'creating', beacon: {} });
    const assertion = expect(p).rejects.toThrow(/Failed to fetch/);
    await vi.runAllTimersAsync();
    await assertion;

    const mainCalls = mockFetch.mock.calls.filter(([u]) => !String(u).includes('beacon'));
    expect(mainCalls.length).toBe(3); // 1 initial + 2 retries, bounded
  });
});
