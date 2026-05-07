import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameUpload } from './useGameUpload';

vi.mock('../services/uploadManager', () => ({
  listDedupeGames: vi.fn(),
  deleteDedupeGame: vi.fn(),
  getDedupeGameUrl: vi.fn(),
  listPendingUploads: vi.fn(),
}));

vi.mock('../stores/gamesDataStore', () => ({
  useGamesDataStore: vi.fn((selector) =>
    selector({
      invalidateGames: vi.fn(),
    })
  ),
}));

import {
  listDedupeGames,
  deleteDedupeGame,
  getDedupeGameUrl,
} from '../services/uploadManager';

describe('useGameUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty lists initially', () => {
      const { result } = renderHook(() => useGameUpload());

      expect(result.current.pendingUploads).toEqual([]);
      expect(result.current.dedupeGames).toEqual([]);
      expect(result.current.isLoadingGames).toBe(false);
      expect(result.current.error).toBeNull();
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

      listDedupeGames.mockResolvedValue([
        { id: 1, name: 'Game 1' },
        { id: 2, name: 'Game 2' },
      ]);

      await act(async () => {
        await result.current.fetchDedupeGames();
      });

      expect(result.current.dedupeGames).toHaveLength(2);

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
