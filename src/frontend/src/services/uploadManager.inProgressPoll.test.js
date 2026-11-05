/**
 * T15080: after prepare-upload answers `in_progress`, the waiting flow polls the
 * read-only GET /api/games/upload-status (no write lock, no attempted milestone,
 * no Postgres) and calls prepare-upload again only once the other flow goes idle.
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

const HASH = 'd'.repeat(64);
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;
const jsonResp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const PRECOMPUTED = { blake3_hash: HASH, faststartInfo: { needsRelocation: false } };
const mockFile = () => new File(['test'], 'clip.mp4', { type: 'video/mp4' });
const inProgress = (pct) => jsonResp(200, { status: 'in_progress', upload_session_id: 's1', progress_percent: pct });

describe('T15080 in_progress wait polls GET /upload-status', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.XMLHttpRequest = class { constructor() { this.upload = {}; } open() {} send() {} };
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('re-prepares exactly once, after the status poll reports idle', async () => {
    let prepares = 0;
    const statusCalls = [];
    mockFetch.mockImplementation(async (url, opts = {}) => {
      if (url.includes('/prepare-upload')) {
        prepares += 1;
        return prepares === 1 ? inProgress(10) : jsonResp(200, { status: 'exists', blake3_hash: HASH, file_size: 4 });
      }
      if (url.includes('/upload-status')) {
        statusCalls.push({ url, method: opts.method || 'GET' });
        return statusCalls.length < 3 ? inProgress(20 * statusCalls.length) : jsonResp(200, { status: 'idle' });
      }
      throw new Error(`unexpected ${url}`);
    });
    const percents = [];
    const p = ensureVideoInR2(mockFile(), (e) => percents.push(e.percent), { kind: 'clip', precomputed: PRECOMPUTED });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await p;

    expect(result).toMatchObject({ blake3_hash: HASH, uploaded: false });
    expect(prepares).toBe(2);
    expect(statusCalls).toHaveLength(3);
    for (const c of statusCalls) {
      expect(c.method).toBe('GET');
      const q = new URL(c.url, 'http://x').searchParams;
      expect(q.get('blake3_hash')).toBe(HASH);
      expect(q.get('kind')).toBe('clip');
      expect(q.get('file_size')).toBe('4');
    }
    expect(percents).toEqual(expect.arrayContaining([10, 20, 40]));
  });
});
