/**
 * Games Data Store
 *
 * Zustand store for games state management. Holds the games list, selected game,
 * and all game CRUD/upload operations. Replaces both the old useGames hook
 * (local useState) and gamesStore (version counter only).
 *
 * Migrated from useGames hook to enable profile-switch reactivity —
 * _resetDataStores() can clear and re-fetch this store when the active
 * profile changes.
 *
 * Games are stored globally (shared across profiles via T80 deduplication),
 * but the games *list* is per-profile (each profile's DB has its own games table).
 */

import { create } from 'zustand';
import { API_BASE } from '../config';
import { uploadGame as uploadGameService } from '../services/uploadManager';

// Module-level refs for debounced save and fetch cancellation
let _saveTimeout = null;
let _fetchController = null;

export const useGamesDataStore = create((set, get) => ({
  games: [],
  selectedGame: null,
  isLoading: false,
  error: null,

  // Version counter — incremented when games list should be refreshed.
  // Components watching this know to refetch (legacy compatibility).
  gamesVersion: 0,

  /**
   * Increment version to signal that games list has changed.
   * Also triggers a fetchGames() to keep the store in sync.
   */
  invalidateGames: () => {
    set(state => ({ gamesVersion: state.gamesVersion + 1 }));
    get().fetchGames();
  },

  /**
   * Fetch all games from the server.
   * Cancels any in-flight fetch to prevent stale data from a previous
   * profile overwriting the current one (race condition on rapid switch).
   */
  fetchGames: async () => {
    if (_fetchController) _fetchController.abort();
    _fetchController = new AbortController();
    const { signal } = _fetchController;

    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_BASE}/api/games`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch games: ${response.status}`);
      }
      const data = await response.json();
      const gamesList = data.games || [];
      set({ games: gamesList, isLoading: false });
      return gamesList;
    } catch (err) {
      if (err.name === 'AbortError') return get().games;
      console.error('[gamesDataStore] Failed to fetch games:', err);
      set({ error: err.message, isLoading: false });
      return [];
    }
  },

  /**
   * Create a new game (without video).
   */
  createGame: async (name, videoMetadata = null, gameDetails = null) => {
    set({ isLoading: true, error: null });
    try {
      const formData = new FormData();
      formData.append('name', name);

      if (videoMetadata) {
        if (videoMetadata.duration != null) formData.append('video_duration', videoMetadata.duration);
        if (videoMetadata.width != null) formData.append('video_width', videoMetadata.width);
        if (videoMetadata.height != null) formData.append('video_height', videoMetadata.height);
        if (videoMetadata.size != null) formData.append('video_size', videoMetadata.size);
      }

      if (gameDetails) {
        if (gameDetails.opponentName) formData.append('opponent_name', gameDetails.opponentName);
        if (gameDetails.gameDate) formData.append('game_date', gameDetails.gameDate);
        if (gameDetails.gameType) formData.append('game_type', gameDetails.gameType);
        if (gameDetails.tournamentName) formData.append('tournament_name', gameDetails.tournamentName);
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

      get().invalidateGames();
      set({ isLoading: false });
      return data.game;
    } catch (err) {
      console.error('[gamesDataStore] Failed to create game:', err);
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  /**
   * Upload a game video with deduplication support.
   */
  uploadGameVideo: async (videoFile, gameDetails = null, videoMetadata = null, onProgress = null) => {
    try {
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
        if (onProgress) onProgress(progress);
      }, options);

      get().invalidateGames();
      return result;
    } catch (err) {
      console.error('[gamesDataStore] Upload failed:', err);
      set({ error: err.message });
      throw err;
    }
  },

  /**
   * Get full game details including annotations
   */
  getGame: async (gameId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status}`);
      }
      const data = await response.json();
      set({ selectedGame: data, isLoading: false });
      return data;
    } catch (err) {
      console.error('[gamesDataStore] Failed to fetch game:', err);
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  /**
   * Update game name
   */
  updateGame: async (gameId, updates) => {
    set({ isLoading: true, error: null });
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

      get().invalidateGames();
      set({ isLoading: false });
      return true;
    } catch (err) {
      console.error('[gamesDataStore] Failed to update game:', err);
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  /**
   * Save annotations to file
   */
  saveAnnotations: async (gameId, annotations) => {
    if (!gameId) {
      console.warn('[gamesDataStore] Cannot save annotations: no gameId');
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotations),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to save annotations: ${response.status}`);
      }

      return true;
    } catch (err) {
      console.error('[gamesDataStore] Failed to save annotations:', err);
      set({ error: err.message });
      return false;
    }
  },

  /**
   * Save annotations with debounce (500ms after last change)
   */
  saveAnnotationsDebounced: (gameId, annotations) => {
    if (_saveTimeout) {
      clearTimeout(_saveTimeout);
    }
    _saveTimeout = setTimeout(() => {
      get().saveAnnotations(gameId, annotations);
      _saveTimeout = null;
    }, 500);
  },

  /**
   * Delete a game
   */
  deleteGame: async (gameId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete game: ${response.status}`);
      }

      if (get().selectedGame?.id === gameId) {
        set({ selectedGame: null });
      }

      get().invalidateGames();
      set({ isLoading: false });
      return true;
    } catch (err) {
      console.error('[gamesDataStore] Failed to delete game:', err);
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  /**
   * Get the video URL for a game
   */
  getGameVideoUrl: (gameId, game = null) => {
    if (game?.video_url) return game.video_url;
    return `${API_BASE}/api/games/${gameId}/video`;
  },

  /**
   * Finish annotation for a game — persists view progress
   */
  finishAnnotation: async (gameId, viewedDuration = 0) => {
    if (!gameId) return;
    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}/finish-annotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewed_duration: viewedDuration }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[gamesDataStore] finish-annotation failed:', errorData);
        return;
      }

      const result = await response.json();
      // Refresh games list so GameCard shows updated view progress
      if (viewedDuration > 0) {
        get().fetchGames();
      }
      return result;
    } catch (err) {
      console.error('[gamesDataStore] finish-annotation error:', err);
    }
  },

  selectGame: (game) => set({ selectedGame: game }),
  clearSelection: () => set({ selectedGame: null }),

  /**
   * Reset store — called on profile switch.
   */
  reset: () => {
    if (_fetchController) { _fetchController.abort(); _fetchController = null; }
    if (_saveTimeout) { clearTimeout(_saveTimeout); _saveTimeout = null; }
    set({
      games: [],
      selectedGame: null,
      isLoading: false,
      error: null,
      gamesVersion: 0,
    });
  },
}));

// Selector hooks
export const useGames = () => useGamesDataStore(state => state.games);
export const useSelectedGame = () => useGamesDataStore(state => state.selectedGame);
export const useGamesLoading = () => useGamesDataStore(state => state.isLoading);
