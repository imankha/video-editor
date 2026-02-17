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

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
const originalURL = global.URL;

describe('uploadManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.Worker = MockWorker;
    global.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock-url');
    };
  });

  afterEach(() => {
    global.URL = originalURL;
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
      expect(UPLOAD_STATUS.ALREADY_OWNED).toBe('already_owned');
      expect(UPLOAD_STATUS.LINKED).toBe('linked');
      expect(UPLOAD_STATUS.UPLOAD_REQUIRED).toBe('upload_required');
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
        expect.stringContaining('/api/games/dedupe/123/url')
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
        expect.stringContaining('/api/games/dedupe')
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
    it('should handle already_owned status', async () => {
      // Mock prepare-upload returning already_owned
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'already_owned',
          game_id: 123,
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

    it('should handle linked status', async () => {
      // Mock prepare-upload returning linked
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'linked',
          game_id: 456,
          message: 'Game already exists, linked to your account',
        }),
      });

      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });
      const progressUpdates = [];

      const result = await uploadGame(mockFile, (progress) => {
        progressUpdates.push(progress);
      });

      expect(result.status).toBe('linked');
      expect(result.game_id).toBe(456);
      expect(result.deduplicated).toBe(true);
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
});
