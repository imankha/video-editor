/**
 * Games Store
 *
 * Minimal Zustand store for cross-component games state coordination.
 * Solves the issue where useGames() creates separate state instances
 * in different components (e.g., AnnotateContainer vs ProjectsScreen).
 *
 * When a game is modified (upload, create, delete), the version is
 * incremented. Components watching gamesVersion will know to refetch.
 */

import { create } from 'zustand';

export const useGamesStore = create((set, get) => ({
  // Version counter - increments whenever games list should be refreshed
  gamesVersion: 0,

  // Increment version to signal that games list has changed
  invalidateGames: () => {
    set((state) => ({ gamesVersion: state.gamesVersion + 1 }));
    console.log('[gamesStore] Games invalidated, version:', get().gamesVersion);
  },
}));

export default useGamesStore;
