/**
 * T10270: classes 1 and 2 previously threw with NOTHING recorded -- no server
 * request had happened yet (class 1: hash timeout / faststart analyze throw /
 * an unrecognized prepare-upload status) or the server had already responded
 * but the client gave up without telling anyone (class 2: can_afford===false
 * after a successful prepare, which left an open R2 multipart + pending_uploads
 * row for the reaper to mislabel `user_abandoned` later).
 *
 * These tests drive `ensureVideoInR2` directly (skips createGame/hashAndAnalyze's
 * own worker plumbing where possible) and assert the beacon POST body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureVideoInR2, UPLOAD_STATUS } from './uploadManager';

vi.mock('../utils/shrinkCapability', () => ({ probeAndReport: vi.fn() }));
vi.mock('../utils/uiTelemetry', () => ({ recordUiImpression: vi.fn() }));
vi.mock('../stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ isAnnotateMode: () => false, activeAnnotateGameId: null }) },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function beaconPayloads() {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes('upload-failure-beacon'))
    .map(([, opts]) => JSON.parse(opts.body));
}

function mockFile(name = 'test.mp4', size = 1024) {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

describe('T10270 class 1: pre-prepare client death beacons', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockImplementation(() => Promise.resolve(okResponse({})));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('beacons hash_timeout (stage=hashing, server_responded=false) when hashAndAnalyze times out', async () => {
    vi.useFakeTimers();
    // A Worker that never calls back -- hashAndAnalyze's own HASH_TIMEOUT_MS
    // ceiling (120s) fires first.
    class HangingWorker {
      postMessage() {}
      terminate() {}
    }
    globalThis.Worker = HangingWorker;
    globalThis.URL = class { static createObjectURL = vi.fn(() => 'blob:mock'); };

    const file = mockFile();
    const p = ensureVideoInR2(file, () => {}, {});
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(125_000);
    await assertion;

    const payloads = beaconPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      phase: 'hashing',
      reason: 'hash_timeout',
      original_filename: 'test.mp4',
      server_responded: false,
    });
  });

  it('beacons analyze_failed (stage=hashing, server_responded=false) when faststart analysis throws', async () => {
    vi.resetModules();
    vi.doMock('../utils/mp4Faststart', () => ({
      analyzeMp4Faststart: vi.fn().mockRejectedValue(new Error('corrupt moov atom')),
      getReorderedSlice: vi.fn(),
    }));
    const { ensureVideoInR2: ensureVideoInR2Remocked } = await import('./uploadManager');

    const file = mockFile();
    await expect(ensureVideoInR2Remocked(file, () => {}, {})).rejects.toThrow('corrupt moov atom');

    const payloads = beaconPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      phase: 'hashing',
      reason: 'analyze_failed',
      original_filename: 'test.mp4',
      server_responded: false,
    });
    vi.doUnmock('../utils/mp4Faststart');
  });

  it('beacons unexpected_status (stage=preparing, server_responded=true) on an unrecognized prepare response', async () => {
    globalThis.Worker = class {
      postMessage(data) {
        setTimeout(() => this.onmessage?.({
          data: { type: 'complete', hash: 'a'.repeat(64), fileName: data.file?.name, fileSize: data.file?.size },
        }), 0);
      }
      terminate() {}
    };
    globalThis.URL = class { static createObjectURL = vi.fn(() => 'blob:mock'); };

    mockFetch.mockImplementation((url) => {
      if (String(url).includes('upload-failure-beacon')) return Promise.resolve(okResponse({}));
      if (String(url).includes('prepare-upload')) {
        return Promise.resolve(okResponse({
          status: 'some_future_status', can_afford: true, upload_cost: 1, balance: 10,
        }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const file = mockFile();
    await expect(ensureVideoInR2(file, () => {}, {})).rejects.toThrow(/Unexpected status/);

    const payloads = beaconPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      phase: 'preparing',
      reason: 'unexpected_status',
      server_responded: true,
    });
  });
});

describe('T10270 class 2: can_afford===false cancels the session honestly (Q4)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.Worker = class {
      postMessage(data) {
        setTimeout(() => this.onmessage?.({
          data: { type: 'complete', hash: 'b'.repeat(64), fileName: data.file?.name, fileSize: data.file?.size },
        }), 0);
      }
      terminate() {}
    };
    globalThis.URL = class { static createObjectURL = vi.fn(() => 'blob:mock'); };
  });

  it('beacons insufficient_credits AND calls DELETE /api/games/upload/{session_id}', async () => {
    mockFetch.mockImplementation((url, opts = {}) => {
      const u = String(url);
      if (u.includes('upload-failure-beacon')) return Promise.resolve(okResponse({}));
      if (u.includes('prepare-upload')) {
        return Promise.resolve(okResponse({
          status: UPLOAD_STATUS.UPLOAD_REQUIRED,
          upload_session_id: 'sess-broke-123',
          parts: [],
          is_resume: false,
          can_afford: false,
          upload_cost: 50,
          balance: 3,
        }));
      }
      if (opts.method === 'DELETE' && u.includes('/api/games/upload/sess-broke-123')) {
        return Promise.resolve(okResponse({ status: 'cancelled' }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const file = mockFile();
    const err = await ensureVideoInR2(file, () => {}, {}).catch((e) => e);
    expect(err.insufficientCredits).toBe(true);

    // The cancel call is fire-and-forget (not awaited by ensureVideoInR2) --
    // flush microtasks so it lands before asserting.
    await Promise.resolve();
    await Promise.resolve();

    const deleteCalls = mockFetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('/api/games/upload/sess-broke-123');

    const payloads = beaconPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      phase: 'preparing',
      reason: 'insufficient_credits',
      server_responded: false,
    });
  });

  it('does NOT call DELETE when the EXISTS dedup path carries no upload_session_id', async () => {
    mockFetch.mockImplementation((url) => {
      const u = String(url);
      if (u.includes('upload-failure-beacon')) return Promise.resolve(okResponse({}));
      if (u.includes('prepare-upload')) {
        return Promise.resolve(okResponse({
          status: UPLOAD_STATUS.EXISTS,
          blake3_hash: 'b'.repeat(64),
          file_size: 1024,
          can_afford: false,
          upload_cost: 50,
          balance: 3,
        }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const file = mockFile();
    const err = await ensureVideoInR2(file, () => {}, {}).catch((e) => e);
    expect(err.insufficientCredits).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    const deleteCalls = mockFetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });
});
