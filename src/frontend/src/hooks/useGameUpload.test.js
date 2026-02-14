/**
 * Tests for T80: useGameUpload Hook
 *
 * Tests for:
 * - Upload state management
 * - Progress tracking
 * - Deduplication detection
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGameUpload, UPLOAD_PHASE } from './useGameUpload';

// Mock the upload manager
vi.mock('../services/uploadManager', () => ({
  UPLOAD_PHASE: {
    IDLE: 'idle',
    HASHING: 'hashing',
    PREPARING: 'preparing',
    UPLOADING: 'uploading',
    FINALIZING: 'finalizing',
    COMPLETE: 'complete',
    ERROR: 'error',
  },
  uploadGame: vi.fn(),
  cancelUpload: vi.fn(),
  listDedupeGames: vi.fn(),
  deleteDedupeGame: vi.fn(),
  getDedupeGameUrl: vi.fn(),
}));

// Mock the games store
vi.mock('../stores', () => ({
  useGamesStore: vi.fn((selector) =>
    selector({
      invalidateGames: vi.fn(),
    })
  ),
}));

import {
  uploadGame,
  cancelUpload,
  listDedupeGames,
  deleteDedupeGame,
  getDedupeGameUrl,
} from '../services/uploadManager';

describe('useGameUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have idle phase initially', () => {
      const { result } = renderHook(() => useGameUpload());

      expect(result.current.phase).toBe('idle');
      expect(result.current.percent).toBe(0);
      expect(result.current.message).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.result).toBeNull();
    });

    it('should have computed state flags', () => {
      const { result } = renderHook(() => useGameUpload());

      expect(result.current.isUploading).toBe(false);
      expect(result.current.isComplete).toBe(false);
      expect(result.current.hasError).toBe(false);
      expect(result.current.wasDeduplicated).toBe(false);
    });

    it('should have empty dedupe games list', () => {
      const { result } = renderHook(() => useGameUpload());

      expect(result.current.dedupeGames).toEqual([]);
      expect(result.current.isLoadingGames).toBe(false);
    });
  });

  describe('upload', () => {
    it('should call uploadGame and update state on success', async () => {
      const mockResult = {
        status: 'uploaded',
        game_id: 123,
        blake3_hash: 'a'.repeat(64),
        deduplicated: false,
      };

      uploadGame.mockImplementation(async (file, onProgress) => {
        onProgress({ phase: 'hashing', percent: 50, message: 'Hashing...' });
        onProgress({ phase: 'complete', percent: 100, message: 'Done' });
        return mockResult;
      });

      const { result } = renderHook(() => useGameUpload());
      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

      let uploadResult;
      await act(async () => {
        uploadResult = await result.current.upload(mockFile);
      });

      expect(uploadGame).toHaveBeenCalledWith(mockFile, expect.any(Function));
      expect(uploadResult).toEqual(mockResult);
      expect(result.current.result).toEqual(mockResult);
      expect(result.current.phase).toBe('complete');
    });

    it('should detect deduplicated uploads', async () => {
      const mockResult = {
        status: 'linked',
        game_id: 456,
        deduplicated: true,
      };

      uploadGame.mockResolvedValue(mockResult);

      const { result } = renderHook(() => useGameUpload());
      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.upload(mockFile);
      });

      expect(result.current.wasDeduplicated).toBe(true);
    });

    it('should handle upload errors', async () => {
      uploadGame.mockImplementation(async (file, onProgress) => {
        onProgress({ phase: 'error', percent: 0, message: 'Upload failed' });
        throw new Error('Upload failed');
      });

      const { result } = renderHook(() => useGameUpload());
      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

      await act(async () => {
        try {
          await result.current.upload(mockFile);
        } catch (e) {
          // Expected
        }
      });

      expect(result.current.hasError).toBe(true);
      expect(result.current.error).toBe('Upload failed');
    });
  });

  describe('isUploading computed state', () => {
    it('should be true during hashing phase', async () => {
      uploadGame.mockImplementation(async (file, onProgress) => {
        onProgress({ phase: 'hashing', percent: 50, message: 'Hashing...' });
        // Don't resolve immediately
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { status: 'uploaded' };
      });

      const { result } = renderHook(() => useGameUpload());
      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

      // Start upload but don't wait
      act(() => {
        result.current.upload(mockFile);
      });

      // Give time for phase to update
      await waitFor(() => {
        expect(result.current.phase).toBe('hashing');
      });

      expect(result.current.isUploading).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', async () => {
      // Mock that properly calls onProgress with complete phase
      uploadGame.mockImplementation(async (file, onProgress) => {
        onProgress({ phase: 'hashing', percent: 100, message: 'Done hashing' });
        onProgress({ phase: 'complete', percent: 100, message: 'Upload complete' });
        return {
          status: 'uploaded',
          game_id: 123,
          deduplicated: false,
        };
      });

      const { result } = renderHook(() => useGameUpload());
      const mockFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

      // Upload first
      await act(async () => {
        await result.current.upload(mockFile);
      });

      expect(result.current.isComplete).toBe(true);

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.percent).toBe(0);
      expect(result.current.message).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.result).toBeNull();
    });
  });

  describe('fetchDedupeGames', () => {
    it('should fetch and store games list', async () => {
      const mockGames = [
        { id: 1, name: 'Game 1' },
        { id: 2, name: 'Game 2' },
      ];
      listDedupeGames.mockResolvedValue(mockGames);

      const { result } = renderHook(() => useGameUpload());

      let games;
      await act(async () => {
        games = await result.current.fetchDedupeGames();
      });

      expect(listDedupeGames).toHaveBeenCalled();
      expect(games).toEqual(mockGames);
      expect(result.current.dedupeGames).toEqual(mockGames);
    });

    it('should handle fetch errors', async () => {
      listDedupeGames.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useGameUpload());

      await act(async () => {
        await result.current.fetchDedupeGames();
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.dedupeGames).toEqual([]);
    });
  });

  describe('deleteGame', () => {
    it('should delete game and update list', async () => {
      deleteDedupeGame.mockResolvedValue({ status: 'deleted' });

      const { result } = renderHook(() => useGameUpload());

      // Set initial games
      listDedupeGames.mockResolvedValue([
        { id: 1, name: 'Game 1' },
        { id: 2, name: 'Game 2' },
      ]);

      await act(async () => {
        await result.current.fetchDedupeGames();
      });

      expect(result.current.dedupeGames).toHaveLength(2);

      // Delete game 1
      let success;
      await act(async () => {
        success = await result.current.deleteGame(1);
      });

      expect(success).toBe(true);
      expect(deleteDedupeGame).toHaveBeenCalledWith(1);
      expect(result.current.dedupeGames).toHaveLength(1);
      expect(result.current.dedupeGames[0].id).toBe(2);
    });

    it('should handle delete errors', async () => {
      deleteDedupeGame.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useGameUpload());

      let success;
      await act(async () => {
        success = await result.current.deleteGame(123);
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Delete failed');
    });
  });

  describe('getGameUrl', () => {
    it('should return presigned URL', async () => {
      getDedupeGameUrl.mockResolvedValue('https://example.com/signed-url');

      const { result } = renderHook(() => useGameUpload());

      let url;
      await act(async () => {
        url = await result.current.getGameUrl(123);
      });

      expect(getDedupeGameUrl).toHaveBeenCalledWith(123);
      expect(url).toBe('https://example.com/signed-url');
    });

    it('should handle URL fetch errors', async () => {
      getDedupeGameUrl.mockRejectedValue(new Error('URL fetch failed'));

      const { result } = renderHook(() => useGameUpload());

      let url;
      await act(async () => {
        url = await result.current.getGameUrl(999);
      });

      expect(url).toBeNull();
      expect(result.current.error).toBe('URL fetch failed');
    });
  });
});
