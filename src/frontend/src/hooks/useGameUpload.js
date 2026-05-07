import { useState, useCallback } from 'react';
import {
  listDedupeGames,
  deleteDedupeGame,
  getDedupeGameUrl,
  listPendingUploads,
} from '../services/uploadManager';
import { useGamesDataStore } from '../stores/gamesDataStore';

export function useGameUpload() {
  const [error, setError] = useState(null);
  const [dedupeGames, setDedupeGames] = useState([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [pendingUploads, setPendingUploads] = useState([]);

  const invalidateGames = useGamesDataStore((state) => state.invalidateGames);

  const fetchDedupeGames = useCallback(async () => {
    setIsLoadingGames(true);
    try {
      const games = await listDedupeGames();
      setDedupeGames(games);
      return games;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setIsLoadingGames(false);
    }
  }, []);

  const fetchPendingUploads = useCallback(async () => {
    try {
      const uploads = await listPendingUploads();
      setPendingUploads(uploads);
      return uploads;
    } catch (err) {
      console.warn('Failed to fetch pending uploads:', err);
      return [];
    }
  }, []);

  const deleteGame = useCallback(
    async (gameId) => {
      try {
        await deleteDedupeGame(gameId);
        setDedupeGames((prev) => prev.filter((g) => g.id !== gameId));
        invalidateGames();
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    [invalidateGames]
  );

  const getGameUrl = useCallback(async (gameId) => {
    try {
      return await getDedupeGameUrl(gameId);
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  return {
    error,
    dedupeGames,
    isLoadingGames,
    pendingUploads,
    fetchDedupeGames,
    fetchPendingUploads,
    deleteGame,
    getGameUrl,
  };
}

export default useGameUpload;
