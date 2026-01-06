/**
 * useGames Hook
 *
 * Manages games state and API interactions.
 * Games store annotated game footage for later project creation.
 * Annotations are stored in separate JSON files (not in the database).
 */

import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../config';

export function useGames() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track pending save to debounce rapid changes
  const saveTimeoutRef = useRef(null);

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
      setGames(data.games || []);
      return data.games || [];
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
   * @param {string} name - Game name
   * @param {Object} videoMetadata - Optional video metadata for instant loading
   * @param {number} videoMetadata.duration - Video duration in seconds
   * @param {number} videoMetadata.width - Video width in pixels
   * @param {number} videoMetadata.height - Video height in pixels
   * @param {number} videoMetadata.size - Video file size in bytes
   */
  const createGame = useCallback(async (name, videoMetadata = null) => {
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

      // Refresh games list (don't await - do in background)
      fetchGames();

      return data.game;
    } catch (err) {
      console.error('[useGames] Failed to create game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames]);

  /**
   * Upload video to an existing game.
   * This is called after createGame to upload the video in the background.
   * Uses streaming upload for large files.
   */
  const uploadGameVideo = useCallback(async (gameId, videoFile) => {
    console.log('[useGames] Starting video upload for game', gameId);

    try {
      const formData = new FormData();
      formData.append('video', videoFile);

      const response = await fetch(`${API_BASE}/api/games/${gameId}/video`, {
        method: 'PUT',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to upload video: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useGames] Video uploaded for game', gameId, '- size:', data.size_mb, 'MB');

      // Refresh games list (in background)
      fetchGames();

      return data;
    } catch (err) {
      console.error('[useGames] Failed to upload video:', err);
      setError(err.message);
      throw err;
    }
  }, [fetchGames]);

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

      // Refresh games list
      await fetchGames();

      return true;
    } catch (err) {
      console.error('[useGames] Failed to update game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames]);

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

      // Refresh games list
      await fetchGames();

      return true;
    } catch (err) {
      console.error('[useGames] Failed to delete game:', err);
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchGames, selectedGame]);

  /**
   * Get the video URL for a game
   */
  const getGameVideoUrl = useCallback((gameId) => {
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

  return {
    // State
    games,
    selectedGame,
    isLoading,
    error,
    hasGames: games.length > 0,

    // Actions
    fetchGames,
    createGame,
    uploadGameVideo,
    getGame,
    updateGame,
    deleteGame,
    saveAnnotations,
    saveAnnotationsDebounced,
    getGameVideoUrl,
    selectGame,
    clearSelection,
  };
}

export default useGames;
