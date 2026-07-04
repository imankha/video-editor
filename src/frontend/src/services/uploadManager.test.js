/**
 * Tests for T80: Upload Manager Service
 *
 * Tests for:
 * - Upload phase constants
 * - Upload status constants
 * - File upload orchestration (mocked)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UPLOAD_PHASE,
  UPLOAD_STATUS,
  hashFile,
  uploadGame,
  cancelUpload,
  getDedupeGameUrl,
  deleteDedupeGame,
  listDedupeGames,
} from './uploadManager';

// Mock stores that uploadGame triggers via dynamic import
vi.mock('../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('../stores/gamesDataStore', () => ({
  useGamesDataStore: { getState: () => ({ invalidateGames: vi.fn() }) },
}));

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock Worker
class MockWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(data) {
    // Simulate immediate hash completion
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({
          data: {
            type: 'complete',
            hash: 'a'.repeat(64),
            fileName: data.file?.name || 'test.mp4',
            fileSize: data.file?.size || 1024,
          },
        });
      }
    }, 0);
  }

  terminate() {}
}

// Mock URL.createObjectURL for Worker
const originalURL = globalThis.URL;

describe('uploadManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.Worker = MockWorker;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock-url');
    };
  });

  afterEach(() => {
    globalThis.URL = originalURL;
  });

  describe('UPLOAD_PHASE constants', () => {
    it('should have all required phases', () => {
      expect(UPLOAD_PHASE.IDLE).toBe('idle');
      expect(UPLOAD_PHASE.HASHING).toBe('hashing');
      expect(UPLOAD_PHASE.PREPARING).toBe('preparing');
      expect(UPLOAD_PHASE.UPLOADING).toBe('uploading');
      expect(UPLOAD_PHASE.FINALIZING).toBe('finalizing');
      expect(UPLOAD_PHASE.COMPLETE).toBe('complete');
      expect(UPLOAD_PHASE.ERROR).toBe('error');
    });
  });

  describe('UPLOAD_STATUS constants', () => {
    it('should have all required statuses', () => {
      expect(UPLOAD_STATUS.EXISTS).toBe('exists');
      expect(UPLOAD_STATUS.UPLOAD_REQUIRED).toBe('upload_required');
      expect(UPLOAD_STATUS.ALREADY_OWNED).toBe('already_owned');
      expect(UPLOAD_STATUS.CREATED).toBe('created');
    });
  });

  describe('getDedupeGameUrl', () => {
    it('should fetch and return presigned URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://example.com/signed-url' }),
      });

      const url = await getDedupeGameUrl(123);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/dedupe/123/url'),
        expect.objectContaining({ credentials: 'include' })
      );
      expect(url).toBe('https://example.com/signed-url');
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Game not found' }),
      });

      await expect(getDedupeGameUrl(999)).rejects.toThrow('Game not found');
    });
  });

  describe('deleteDedupeGame', () => {
    it('should delete game and return result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'deleted' }),
      });

      const result = await deleteDedupeGame(123);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/dedupe/123'),
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result.status).toBe('deleted');
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Game not found' }),
      });

      await expect(deleteDedupeGame(999)).rejects.toThrow('Game not found');
    });
  });

  describe('listDedupeGames', () => {
    it('should fetch and return games list', async () => {
      const mockGames = [
        { id: 1, name: 'Game 1', blake3_hash: 'a'.repeat(64) },
        { id: 2, name: 'Game 2', blake3_hash: 'b'.repeat(64) },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ games: mockGames }),
      });

      const games = await listDedupeGames();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/dedupe'),
        expect.objectContaining({ credentials: 'include' })
      );
      expect(games).toEqual(mockGames);
    });

    it('should throw on error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Server error' }),
      });

      await expect(listDedupeGames()).rejects.toThrow('Server error');
    });
  });

  describe('cancelUpload', () => {
    it('should cancel upload and return result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'cancelled' }),
      });

      const result = await cancelUpload('sess_123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/upload/sess_123'),
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result.status).toBe('cancelled');
    });
  });

  describe('uploadGame integration', () => {
    it('should handle dedup (video exists in R2, game already owned)', async () => {
      // T1180: Hash runs first (no fetch), then POST /api/games creates the
      // game atomically with the video reference. Then prepare-upload.
      // No separate attach step.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'already_owned',
          game_id: 123,
          name: 'Test Game',
          video_url: 'https://example.com/video.mp4',
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'exists',
          blake3_hash: 'a'.repeat(64),
          file_size: 1024,
        }),
      });

      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      const progressUpdates = [];

      const result = await uploadGame(mockFile, (progress) => {
        progressUpdates.push(progress);
      });

      expect(result.status).toBe('already_owned');
      expect(result.game_id).toBe(123);
      expect(result.deduplicated).toBe(true);

      // Should have hashing and complete phases
      expect(progressUpdates.some((p) => p.phase === 'hashing')).toBe(true);
      expect(progressUpdates.some((p) => p.phase === 'complete')).toBe(true);
    });

    it('should handle dedup (video exists in R2, new game created)', async () => {
      // Flow: hash → createGame (status:'created') → ensureVideoInR2 → prepare-upload
      // (status:'exists', skip upload) → activateGame → complete.
      // Mock 1: POST /api/games → game created as pending
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'created',
          game_id: 456,
          name: 'New Game',
          video_url: 'https://example.com/video.mp4',
        }),
      });
      // Mock 2: POST /api/games/prepare-upload → video already in R2, skip upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'exists',
          blake3_hash: 'a'.repeat(64),
          file_size: 1024,
        }),
      });
      // Mock 3: POST /api/games/456/activate → game activated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ game_id: 456, status: 'ready' }),
      });

      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      const progressUpdates = [];

      const result = await uploadGame(mockFile, (progress) => {
        progressUpdates.push(progress);
      });

      expect(result.game_id).toBe(456);
      expect(result.deduplicated).toBe(true); // Video was already in R2

      expect(progressUpdates.some((p) => p.phase === 'hashing')).toBe(true);
      expect(progressUpdates.some((p) => p.phase === 'complete')).toBe(true);
    });

    it('should handle prepare-upload error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: 'Invalid hash' }),
      });

      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      const progressUpdates = [];

      await expect(
        uploadGame(mockFile, (progress) => {
          progressUpdates.push(progress);
        })
      ).rejects.toThrow('Invalid hash');

      // Should have error phase
      expect(progressUpdates.some((p) => p.phase === 'error')).toBe(true);
    });
  });
});

// T4100: upload-pipeline polish — resume-state surfacing, finalize messaging,
// honest dedup progress. These exercise the multipart (upload_required) path, so
// they need an XMLHttpRequest mock (part PUTs) plus URL-routed fetch (the fetch
// order isn't strictly sequential — the batch part-save is fire-and-forget).
describe('uploadManager — T4100 pipeline polish', () => {
  const jsonResp = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  // A part PUT that immediately succeeds with an ETag.
  class MockXHR {
    constructor() {
      this.upload = {};
      this.status = 200;
    }
    open() {}
    getResponseHeader(name) {
      return name === 'ETag' ? '"mock-etag"' : null;
    }
    send() {
      setTimeout(() => {
        if (this.upload.onprogress) {
          this.upload.onprogress({ lengthComputable: true, loaded: 4, total: 4 });
        }
        this.status = 200;
        if (this.onload) this.onload();
      }, 0);
    }
  }

  // Route the multipart upload flow. Callers override `parts` and `finalize`
  // responses to simulate the specific failure under test.
  const routeUpload = ({ gameId = 555, partsResp, finalizeResp }) => {
    mockFetch.mockImplementation(async (url, opts = {}) => {
      const method = opts.method || 'GET';
      if (url.includes('/prepare-upload')) {
        return jsonResp(200, {
          status: 'upload_required',
          upload_session_id: 'sess_x',
          parts: [{ part_number: 1, presigned_url: 'https://r2/put', start_byte: 0, end_byte: 3 }],
        });
      }
      if (url.includes('/finalize-upload')) return finalizeResp;
      if (url.includes('/activate')) return jsonResp(200, { game_id: gameId, status: 'ready' });
      if (url.includes('/parts')) return partsResp;
      if (/\/api\/games$/.test(url) && method === 'POST') {
        return jsonResp(200, { status: 'created', game_id: gameId, name: 'Game' });
      }
      if (method === 'DELETE') return jsonResp(200, { status: 'deleted' });
      return jsonResp(200, {});
    });
  };

  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.Worker = MockWorker;
    globalThis.XMLHttpRequest = MockXHR;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock-url');
    };
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.URL = originalURL;
  });

  const mockFile = () => new File(['test'], 'test.mp4', { type: 'video/mp4' });

  it('surfaces a resume-state save failure loudly (fix 1) without failing the upload', async () => {
    // PATCH parts returns 500 (HTTP error — previously swallowed because apiFetch
    // does not reject on non-ok). Upload still succeeds; failure is surfaced.
    routeUpload({
      partsResp: jsonResp(500, {}),
      finalizeResp: jsonResp(200, { blake3_hash: 'a'.repeat(64), file_size: 4 }),
    });

    const result = await uploadGame(mockFile(), () => {});
    expect(result.game_id).toBe(555);

    await vi.waitFor(() => {
      const surfaced = errorSpy.mock.calls.some((c) =>
        String(c[0]).includes('RESUME-STATE SAVE FAILED')
      );
      expect(surfaced).toBe(true);
    });
  });

  it('gives an actionable finalize error and logs diagnostics when detail is absent (fix 2)', async () => {
    routeUpload({
      partsResp: jsonResp(200, {}),
      finalizeResp: jsonResp(500, {}), // no .detail
    });

    await expect(uploadGame(mockFile(), () => {})).rejects.toThrow(/try uploading again/i);

    const diagnosed = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes('finalize-upload FAILED')
    );
    expect(diagnosed).toBe(true);
  });

  it('prefers the backend detail message on finalize failure when present (fix 2)', async () => {
    routeUpload({
      partsResp: jsonResp(200, {}),
      finalizeResp: jsonResp(409, { detail: 'Part 2 checksum mismatch' }),
    });

    await expect(uploadGame(mockFile(), () => {})).rejects.toThrow('Part 2 checksum mismatch');
  });
});

describe('uploadManager — dedup honest progress (T4100 fix 3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.Worker = MockWorker;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock-url');
    };
  });

  afterEach(() => {
    globalThis.URL = originalURL;
  });

  it('shows honest "already uploaded" messaging with no fake staged progress', async () => {
    // createGame -> already_owned (dedup shortcut in uploadGame).
    mockFetch.mockResolvedValueOnce(
      { ok: true, json: async () => ({ status: 'already_owned', game_id: 321, name: 'Owned', video_url: 'u' }) }
    );

    const progressUpdates = [];
    const result = await uploadGame(new File(['test'], 'test.mp4', { type: 'video/mp4' }), (p) => {
      progressUpdates.push(p);
    });

    expect(result.deduplicated).toBe(true);
    // Honest message reached the progress stream.
    expect(progressUpdates.some((p) => /already uploaded/i.test(p.message || ''))).toBe(true);
    // No fabricated 30%/70% "Uploading..." steps.
    expect(progressUpdates.some((p) => p.phase === 'uploading' && (p.percent === 30 || p.percent === 70))).toBe(false);
    // Still completes.
    expect(progressUpdates.some((p) => p.phase === 'complete')).toBe(true);
  });

  it('shows honest messaging on the R2-exists dedup path (new game created)', async () => {
    // createGame -> created, prepare-upload -> exists (ensureVideoInR2 dedup), activate.
    mockFetch.mockResolvedValueOnce(
      { ok: true, json: async () => ({ status: 'created', game_id: 654, name: 'New', video_url: 'u' }) }
    );
    mockFetch.mockResolvedValueOnce(
      { ok: true, json: async () => ({ status: 'exists', blake3_hash: 'a'.repeat(64), file_size: 4 }) }
    );
    mockFetch.mockResolvedValueOnce(
      { ok: true, json: async () => ({ game_id: 654, status: 'ready' }) }
    );

    const progressUpdates = [];
    await uploadGame(new File(['test'], 'test.mp4', { type: 'video/mp4' }), (p) => {
      progressUpdates.push(p);
    });

    expect(progressUpdates.some((p) => /already uploaded/i.test(p.message || ''))).toBe(true);
    expect(progressUpdates.some((p) => p.phase === 'uploading' && (p.percent === 30 || p.percent === 70))).toBe(false);
  });
});

describe('hashFile', () => {
  it('should hash file and return 64-char hex string', async () => {
    const mockFile = new File(['test content for hashing'], 'test.mp4', {
      type: 'video/mp4',
    });
    const progressUpdates = [];

    const hash = await hashFile(mockFile, (percent) => {
      progressUpdates.push(percent);
    });

    // Should return a valid 64-char hex hash
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Should have progress updates (5 samples = 5 updates at 20%, 40%, 60%, 80%, 100%)
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
  });

  it('should produce same hash for same file content', async () => {
    const content = 'same content';
    const file1 = new File([content], 'file1.mp4', { type: 'video/mp4' });
    const file2 = new File([content], 'file2.mp4', { type: 'video/mp4' });

    const hash1 = await hashFile(file1, () => {});
    const hash2 = await hashFile(file2, () => {});

    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different file content', async () => {
    // Use clearly different content with different sizes to ensure distinct hashes
    const file1 = new File(['first file with some content'], 'test.mp4', {
      type: 'video/mp4',
    });
    const file2 = new File(
      ['second file with completely different content here'],
      'test.mp4',
      { type: 'video/mp4' }
    );

    const hash1 = await hashFile(file1, () => {});
    const hash2 = await hashFile(file2, () => {});

    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash for same content but different sizes', async () => {
    // Two files with same sample content but different sizes
    // (important for collision resistance)
    const file1 = new File(['A'], 'test.mp4', { type: 'video/mp4' });
    const file2 = new File(['AA'], 'test.mp4', { type: 'video/mp4' });

    const hash1 = await hashFile(file1, () => {});
    const hash2 = await hashFile(file2, () => {});

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty file', async () => {
    const emptyFile = new File([], 'empty.mp4', { type: 'video/mp4' });

    const hash = await hashFile(emptyFile, () => {});

    // Should still return a valid hash (of the file size = 0)
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // bug26p: an aborted signal (e.g. the hash timeout fired) must reject loudly
  // instead of silently completing — so a stalled hash can't masquerade as success.
  it('should reject when the abort signal is already set', async () => {
    const file = new File(['some content'], 'test.mp4', { type: 'video/mp4' });
    await expect(hashFile(file, () => {}, { aborted: true })).rejects.toThrow(/abort|timed out/i);
  });
});
