/**
 * useGames Hook
 *
 * Manages games state and API interactions.
 * Games store annotated game footage for later project creation.
 * Annotations are stored in separate JSON files (not in the database).
 *
 * T80: Uses deduplicated uploads via BLAKE3 hashing.
 * Large files (4GB+) use multipart upload to R2.
 * Games are stored globally at games/{hash}.mp4 for deduplication.
 */

import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../config';
import { useGamesStore } from '../stores';
import { uploadGame as uploadGameService, UPLOAD_PHASE } from '../services/uploadManager';

// Re-export UPLOAD_PHASE for consumers
export { UPLOAD_PHASE };

export function useGames() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track pending save to debounce rapid changes
  const saveTimeoutRef = useRef(null);

  // Global games version for cross-component coordination
  const gamesVersion = useGamesStore((state) => state.gamesVersion);
  const invalidateGames = useGamesStore((state) => state.invalidateGames);

  /**
   * Fetch all games from the server
   */
  const fetchGames = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/games`);
      if (!response.ok) {
        throw new Error(`Failed to fetch games: ${response.status}`);
      }
      const data = await response.json();
      const gamesList = data.games || [];
      setGames(gamesList);
      return gamesList;
    } catch (err) {
      console.error('[useGames] Failed to fetch games:', err);
      setError(err.message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new game (without video).
   * The game is created immediately with an empty annotations file.
   * Video can be uploaded later via uploadGameVideo.
   * This allows instant game creation for immediate annotation saving.
   *
   * @param {string} name - Game name (fallback if no game details provided)
   * @param {Object} videoMetadata - Optional video metadata for instant loading
   * @param {number} videoMetadata.duration - Video duration in seconds
   * @param {number} videoMetadata.width - Video width in pixels
   * @param {number} videoMetadata.height - Video height in pixels
   * @param {number} videoMetadata.size - Video file size in bytes
   * @param {Object} gameDetails - Optional game details for display name generation
   * @param {string} gameDetails.opponentName - Opponent team name
   * @param {string} gameDetails.gameDate - Game date (ISO format: YYYY-MM-DD)
   * @param {string} gameDetails.gameType - 'home', 'away', or 'tournament'
   * @param {string} gameDetails.tournamentName - Tournament name (if gameType is 'tournament')
   */
  const createGame = useCallback(async (name, videoMetadata = null, gameDetails = null) => {
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', name);

      // Include video metadata if provided (for instant loading later)
      if (videoMetadata) {
        if (videoMetadata.duration != null) {
          formData.append('video_duration', videoMetadata.duration);
        }
        if (videoMetadata.width != null) {
          formData.append('video_width', videoMetadata.width);
        }
        if (videoMetadata.height != null) {
          formData.append('video_height', videoMetadata.height);
        }
        if (videoMetadata.size != null) {
          formData.append('video_size', videoMetadata.size);
        }
      }

      // Include game details if provided (for display name generation)
      if (gameDetails) {
        if (gameDetails.opponentName) {
          formData.append('opponent_name', gameDetails.opponentName);
        }
        if (gameDetails.gameDate) {
          formData.append('game_date', gameDetails.gameDate);
        }
        if (gameDetails.gameType) {
          formData.append('game_type', gameDetails.gameType);
        }
        if (gameDetails.tournamentName) {
          formData.append('tournament_name', gameDetails.tournamentName);
        }
      }

      const response = await fetch(`${API_BASE}/api/games`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to create game: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useGames] Created game:', data.game);

      // Notify other components and refresh games list
      invalidateGames();
      fetchGames();

      return data.game;
    } catch (err) {
      console.error('[useGames] Failed to create game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames, invalidateGames]);

  /**
   * Upload a game video with deduplication support.
   *
   * This is the unified upload flow that:
   * 1. Computes BLAKE3 hash of the file
   * 2. Checks if file already exists globally (deduplication)
   * 3. If new, uploads via multipart to R2
   * 4. Returns game_id, name, and video_url
   *
   * Progress callback receives: { phase, percent, message }
   * Phases: 'hashing', 'preparing', 'uploading', 'finalizing', 'complete', 'error'
   *
   * @param {File} videoFile - Video file to upload
   * @param {Object} gameDetails - Optional game details for display name
   * @param {string} gameDetails.opponentName - Opponent team name
   * @param {string} gameDetails.gameDate - Game date (YYYY-MM-DD)
   * @param {string} gameDetails.gameType - 'home', 'away', or 'tournament'
   * @param {string} gameDetails.tournamentName - Tournament name
   * @param {Object} videoMetadata - Optional video metadata
   * @param {number} videoMetadata.duration - Video duration in seconds
   * @param {number} videoMetadata.width - Video width in pixels
   * @param {number} videoMetadata.height - Video height in pixels
   * @param {function} onProgress - Progress callback: ({ phase, percent, message }) => void
   * @returns {Promise<Object>} - Result with game_id, name, video_url, deduplicated flag
   */
  const uploadGameVideo = useCallback(async (videoFile, gameDetails = null, videoMetadata = null, onProgress = null) => {
    const fileSizeMB = (videoFile.size / (1024 * 1024)).toFixed(1);
    console.log('[useGames] Starting upload - size:', fileSizeMB, 'MB');

    try {
      // Build options for uploadGameService
      const options = {};

      if (gameDetails) {
        options.opponentName = gameDetails.opponentName;
        options.gameDate = gameDetails.gameDate;
        options.gameType = gameDetails.gameType;
        options.tournamentName = gameDetails.tournamentName;
      }

      if (videoMetadata) {
        options.videoDuration = videoMetadata.duration;
        options.videoWidth = videoMetadata.width;
        options.videoHeight = videoMetadata.height;
      }

      const result = await uploadGameService(videoFile, (progress) => {
        if (onProgress) {
          onProgress(progress);
        }
      }, options);

      console.log('[useGames] Upload complete:', {
        game_id: result.game_id,
        name: result.name,
        deduplicated: result.deduplicated
      });

      if (result.deduplicated) {
        console.log('[useGames] DEDUPLICATION: Saved bandwidth! File already existed on server.');
      }

      // Notify other components
      invalidateGames();

      return result;
    } catch (err) {
      console.error('[useGames] Upload failed:', err);
      setError(err.message);
      throw err;
    }
  }, [invalidateGames]);

  /**
   * Get full game details including annotations from file
   */
  const getGame = useCallback(async (gameId) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status}`);
      }
      const data = await response.json();
      setSelectedGame(data);
      return data;
    } catch (err) {
      console.error('[useGames] Failed to fetch game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Update game name only (not annotations - use saveAnnotations for that)
   */
  const updateGame = useCallback(async (gameId, updates) => {
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (updates.name !== undefined) {
        formData.append('name', updates.name);
      }

      const response = await fetch(`${API_BASE}/api/games/${gameId}`, {
        method: 'PUT',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to update game: ${response.status}`);
      }

      console.log('[useGames] Updated game:', gameId);

      // Notify other components and refresh games list
      invalidateGames();
      await fetchGames();

      return true;
    } catch (err) {
      console.error('[useGames] Failed to update game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames, invalidateGames]);

  /**
   * Save annotations to file (separate from game update)
   * This is the main way annotations are persisted.
   */
  const saveAnnotations = useCallback(async (gameId, annotations) => {
    if (!gameId) {
      console.warn('[useGames] Cannot save annotations: no gameId');
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}/annotations`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(annotations),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to save annotations: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useGames] Saved annotations for game', gameId, '- clip count:', data.clip_count);

      return true;
    } catch (err) {
      console.error('[useGames] Failed to save annotations:', err);
      setError(err.message);
      return false;
    }
  }, []);

  /**
   * Save annotations with debounce (for auto-save on change)
   * Waits 500ms after last change before saving
   */
  const saveAnnotationsDebounced = useCallback((gameId, annotations) => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule new save
    saveTimeoutRef.current = setTimeout(() => {
      saveAnnotations(gameId, annotations);
      saveTimeoutRef.current = null;
    }, 500);
  }, [saveAnnotations]);

  /**
   * Delete a game
   */
  const deleteGame = useCallback(async (gameId) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete game: ${response.status}`);
      }

      console.log('[useGames] Deleted game:', gameId);

      // Clear selected game if it was deleted
      if (selectedGame?.id === gameId) {
        setSelectedGame(null);
      }

      // Notify other components and refresh games list
      invalidateGames();
      await fetchGames();

      return true;
    } catch (err) {
      console.error('[useGames] Failed to delete game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames, invalidateGames, selectedGame]);

  /**
   * Get the video URL for a game
   * Uses presigned R2 URL if available (from game.video_url), otherwise falls back to local proxy
   * @param {number|string} gameId - Game ID
   * @param {Object} game - Optional game object that may contain video_url from API
   */
  const getGameVideoUrl = useCallback((gameId, game = null) => {
    // If game object has presigned URL, use it (direct R2 access)
    if (game?.video_url) {
      return game.video_url;
    }
    // Fallback to local proxy endpoint
    return `${API_BASE}/api/games/${gameId}/video`;
  }, []);

  /**
   * Select a game
   */
  const selectGame = useCallback((game) => {
    setSelectedGame(game);
  }, []);

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    setSelectedGame(null);
  }, []);

  /**
   * Finish annotation for a game
   * Triggers extraction of all unextracted clips that belong to projects
   * @param {number} gameId - Game ID
   */
  const finishAnnotation = useCallback(async (gameId) => {
    if (!gameId) return;

    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}/finish-annotation`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[useGames] finish-annotation failed:', errorData);
        return;
      }

      const result = await response.json();
      console.log('[useGames] finish-annotation result:', result);
      return result;
    } catch (err) {
      console.error('[useGames] finish-annotation error:', err);
    }
  }, []);

  return {
    // State
    games,
    selectedGame,
    isLoading,
    error,
    hasGames: games.length > 0,

    // Actions
    fetchGames,
    createGame, // Deprecated: Use uploadGameVideo which creates the game
    uploadGameVideo, // T80: Unified upload with deduplication
    getGame,
    updateGame,
    deleteGame,
    saveAnnotations,
    saveAnnotationsDebounced,
    getGameVideoUrl,
    selectGame,
    clearSelection,
    finishAnnotation,
  };
}

export default useGames;
