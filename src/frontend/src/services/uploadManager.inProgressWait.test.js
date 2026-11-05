/**
 * T15040: prepare-upload answers `in_progress` when another flow is uploading the
 * same file right now. The client must NOT upload parts; it shows "Already
 * uploading..." and re-asks prepare until the other flow lands the file (`exists`)
 * or dies (`upload_required`, resume for real).
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

const HASH = 'c'.repeat(64);
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;
const jsonResp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const PRECOMPUTED = { blake3_hash: HASH, faststartInfo: { needsRelocation: false } };
const mockFile = () => new File(['test'], 'clip.mp4', { type: 'video/mp4' });
const inProgress = () => jsonResp(200, { status: 'in_progress', upload_session_id: 's1', progress_percent: 40 });

describe('T15040 in_progress wait', () => {
  let putSpy;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    putSpy = vi.fn();
    globalThis.XMLHttpRequest = class { constructor() { this.upload = {}; putSpy(); } open() {} send() {} };
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('polls prepare while in_progress and resolves uploaded:false once the other flow lands the file', async () => {
    let prepares = 0;
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) {
        prepares += 1;
        return prepares < 3 ? inProgress() : jsonResp(200, { status: 'exists', blake3_hash: HASH, file_size: 4 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const messages = [];
    const p = ensureVideoInR2(mockFile(), (e) => messages.push(e.message), { kind: 'clip', precomputed: PRECOMPUTED });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await p;

    expect(prepares).toBe(3);
    expect(result).toMatchObject({ blake3_hash: HASH, uploaded: false });
    expect(putSpy).not.toHaveBeenCalled();
    expect(messages.some((m) => /Already uploading/i.test(m || ''))).toBe(true);
  });

  it('a session that goes quiet answers upload_required and this flow uploads for real', async () => {
    let prepares = 0;
    globalThis.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.status = 200; }
      open() {}
      getResponseHeader() { return '"etag"'; }
      send() { setTimeout(() => this.onload && this.onload(), 0); }
    };
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) {
        prepares += 1;
        return prepares < 2 ? inProgress() : jsonResp(200, {
          status: 'upload_required', upload_session_id: 's1', is_resume: true,
          parts: [{ part_number: 1, presigned_url: 'https://r2/put', start_byte: 0, end_byte: 3 }],
        });
      }
      if (url.includes('/finalize-upload')) return jsonResp(200, { blake3_hash: HASH, file_size: 4 });
      return jsonResp(200, {});
    });
    const p = ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await p;
    expect(result.uploaded).toBe(true);
    expect(prepares).toBe(2);
  });
});
