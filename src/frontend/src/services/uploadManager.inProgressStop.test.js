/**
 * T15140: the in_progress wait must be able to end without the other flow's help, and
 * a flow that failed must not make its own Retry wait on itself.
 *   - a cancel (AbortSignal) stops the wait and books no failure
 *   - a session whose percent stops moving fails the wait loudly, with Retry available
 *   - a percent that keeps moving keeps the wait alive however long it takes
 *   - a failed transfer or finalize releases the session's liveness stamp
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureVideoInR2 } from './uploadManager';

vi.mock('../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('../stores/gamesDataStore', () => ({
  useGamesDataStore: { getState: () => ({ invalidateGames: vi.fn() }) },
}));
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ isAnnotateMode: () => false, activeAnnotateGameId: null }),
  },
}));
vi.mock('../utils/shrinkCapability', () => ({ probeAndReport: vi.fn() }));

const STALL_MS = 20 * 60_000;
const HASH = 'c'.repeat(64);
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;
const jsonResp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const PRECOMPUTED = { blake3_hash: HASH, faststartInfo: { needsRelocation: false } };
const mockFile = () => new File(['test'], 'clip.mp4', { type: 'video/mp4' });
const inProgress = (percent = 40) => jsonResp(200, { status: 'in_progress', upload_session_id: 's1', progress_percent: percent });
const uploadRequired = () => jsonResp(200, {
  status: 'upload_required', upload_session_id: 's1', is_resume: false,
  parts: [{ part_number: 1, presigned_url: 'https://r2/put', start_byte: 0, end_byte: 3 }],
});
const callsTo = (path) => mockFetch.mock.calls.filter(([url]) => String(url).includes(path));
const settled = (p) => p.then(() => null, (e) => e);
// Assert the wait ended BEFORE awaiting it: a wait that never ends must fail on an
// assertion, not on the test timeout.
const track = (p) => {
  const state = { done: false };
  state.outcome = settled(p).then((e) => { state.done = true; return e; });
  return state;
};

describe('T15140 in_progress wait can end', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.XMLHttpRequest = class { constructor() { this.upload = {}; } open() {} send() {} };
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const answerInProgress = (percentFor = () => 40) => mockFetch.mockImplementation(async (url) => {
    if (String(url).includes('/prepare-upload')) return inProgress(percentFor());
    if (String(url).includes('/upload-status')) return inProgress(percentFor());
    return jsonResp(200, {});
  });

  it('a cancel stops the wait: no more polls, no second prepare, no failure booked', async () => {
    answerInProgress();
    const controller = new AbortController();
    const wait = track(ensureVideoInR2(mockFile(), () => {}, {
      kind: 'clip', precomputed: PRECOMPUTED, signal: controller.signal,
    }));
    await vi.advanceTimersByTimeAsync(12_000);
    const polls = callsTo('/upload-status').length;
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(wait.done).toBe(true);
    expect((await wait.outcome)?.name).toBe('AbortError');
    expect(callsTo('/upload-status')).toHaveLength(polls);
    expect(callsTo('/prepare-upload')).toHaveLength(1);
    expect(callsTo('/upload-failure-beacon')).toHaveLength(0);
  });

  it('a cancel that lands while a poll is in the air does not go on to prepare', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async (url) => {
      if (String(url).includes('/prepare-upload')) return inProgress();
      if (String(url).includes('/upload-status')) {
        controller.abort();
        return jsonResp(200, { status: 'idle' });
      }
      return jsonResp(200, {});
    });
    const wait = track(ensureVideoInR2(mockFile(), () => {}, {
      kind: 'clip', precomputed: PRECOMPUTED, signal: controller.signal,
    }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callsTo('/prepare-upload')).toHaveLength(1);
    expect(wait.done).toBe(true);
    expect((await wait.outcome)?.name).toBe('AbortError');
  });

  it('a percent that stops moving fails the wait loudly', async () => {
    answerInProgress();
    const wait = track(ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED }));
    await vi.advanceTimersByTimeAsync(STALL_MS + 10_000);

    expect(wait.done).toBe(true);
    const error = await wait.outcome;
    expect(error).toBeInstanceOf(Error);
    expect(error.name).not.toBe('AbortError');
    expect(error.refused).toBeFalsy();
    const beacons = callsTo('/upload-failure-beacon').map(([, init]) => JSON.parse(init.body));
    expect(beacons.map((b) => b.reason)).toEqual(['in_progress_wait_stalled']);
  });

  it('a slow upload whose percent keeps moving outlasts the deadline', async () => {
    let percent = 0;
    const tick = () => {
      percent += 0.1;  // a poll every 5 s, so this moves far inside the deadline
      return percent;
    };
    answerInProgress(tick);
    const wait = track(ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED }));
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(wait.done).toBe(false);

    mockFetch.mockImplementation(async (url) => (String(url).includes('/upload-status')
      ? jsonResp(200, { status: 'idle' })
      : jsonResp(200, { status: 'exists', blake3_hash: HASH, file_size: 4 })));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await wait.outcome).toBeNull();
  });
});

describe('T15140 a failed flow releases its session', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const released = () => callsTo('/upload-release').map(([, init]) => JSON.parse(init.body));

  it('after a finalize failure', async () => {
    globalThis.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.status = 200; }
      open() {}
      getResponseHeader() { return '"etag"'; }
      send() { setTimeout(() => this.onload && this.onload(), 0); }
    };
    mockFetch.mockImplementation(async (url) => {
      if (String(url).includes('/prepare-upload')) return uploadRequired();
      if (String(url).includes('/finalize-upload')) return jsonResp(500, { detail: 'boom' });
      return jsonResp(200, {});
    });
    await expect(ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED })).rejects.toThrow();
    expect(released()).toEqual([{ session_id: 's1' }]);
  });

  it('after the transfer exhausts its retries', async () => {
    vi.useFakeTimers();
    globalThis.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.status = 500; }
      open() {}
      getResponseHeader() { return null; }
      send() { setTimeout(() => this.onload && this.onload(), 0); }
    };
    mockFetch.mockImplementation(async (url) => (String(url).includes('/prepare-upload') ? uploadRequired() : jsonResp(200, {})));
    const outcome = settled(ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(released()).toEqual([{ session_id: 's1' }]);
    vi.useRealTimers();
  });
});
