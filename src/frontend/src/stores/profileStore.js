import { create } from 'zustand';
import { API_BASE } from '../config';
import { reinstallProfileHeader } from '../utils/sessionInit';

/**
 * Profile Store - Multi-athlete profile management
 *
 * Manages the list of profiles, current profile selection,
 * and profile CRUD operations. On profile switch, resets all
 * data stores and re-fetches from the new profile's database.
 */

export const useProfileStore = create((set, get) => ({
  profiles: [],
  currentProfileId: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  fetchProfiles: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/profiles`);
      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.status}`);
      }

      const data = await response.json();
      const current = data.profiles.find(p => p.isCurrent);

      set({
        profiles: data.profiles,
        currentProfileId: current?.id || null,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      console.error('[ProfileStore] Failed to fetch profiles:', error);
      set({ isLoading: false, isInitialized: true, error: error.message });
    }
  },

  switchProfile: async (profileId) => {
    const { currentProfileId } = get();
    if (profileId === currentProfileId) return;

    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/profiles/current`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to switch profile: ${response.status}`);
      }

      // Update the X-Profile-ID header for all future requests
      reinstallProfileHeader(profileId);

      // Update local state
      set(state => ({
        currentProfileId: profileId,
        profiles: state.profiles.map(p => ({
          ...p,
          isCurrent: p.id === profileId,
        })),
        isLoading: false,
      }));

      // Reset all data stores — they hold data from the old profile
      _resetDataStores();

      // Navigate to project manager
      const { useEditorStore, EDITOR_MODES } = await import('./index');
      useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
    } catch (error) {
      console.error('[ProfileStore] Failed to switch profile:', error);
      set({ isLoading: false, error: error.message });
    }
  },

  createProfile: async (name, color) => {
    set({ error: null });

    try {
      const response = await fetch(`${API_BASE}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create profile: ${response.status}`);
      }

      const newProfile = await response.json();

      // Refetch profiles to get updated list, then switch to the new one
      await get().fetchProfiles();
      await get().switchProfile(newProfile.id);

      return newProfile;
    } catch (error) {
      console.error('[ProfileStore] Failed to create profile:', error);
      set({ error: error.message });
      throw error;
    }
  },

  updateProfile: async (profileId, updates) => {
    set({ error: null });

    try {
      const response = await fetch(`${API_BASE}/api/profiles/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.status}`);
      }

      // Refetch to get updated list
      await get().fetchProfiles();
    } catch (error) {
      console.error('[ProfileStore] Failed to update profile:', error);
      set({ error: error.message });
      throw error;
    }
  },

  deleteProfile: async (profileId) => {
    set({ error: null });

    try {
      const response = await fetch(`${API_BASE}/api/profiles/${profileId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete profile: ${response.status}`);
      }

      const wasCurrentProfile = profileId === get().currentProfileId;

      // Refetch profiles
      await get().fetchProfiles();

      // If we deleted the current profile, the backend auto-switched.
      // We need to update our header and reset stores.
      if (wasCurrentProfile) {
        const newCurrent = get().profiles.find(p => p.isCurrent);
        if (newCurrent) {
          reinstallProfileHeader(newCurrent.id);
          set({ currentProfileId: newCurrent.id });
          _resetDataStores();
        }
      }
    } catch (error) {
      console.error('[ProfileStore] Failed to delete profile:', error);
      set({ error: error.message });
      throw error;
    }
  },

  // Computed helpers
  hasMultipleProfiles: () => get().profiles.length >= 2,
  currentProfile: () => get().profiles.find(p => p.id === get().currentProfileId) || null,

  clearError: () => set({ error: null }),
}));

/**
 * Reset all data stores after a profile switch, then re-fetch.
 *
 * Three phases:
 * 1. Disconnect — close WebSocket connections (they're tied to old profile's exports)
 * 2. Clear — all stores reset to empty state (UI immediately shows empty)
 * 3. Fetch — stores that hold list data re-fetch from the new profile's DB
 */
async function _resetDataStores() {
  // Dynamic import to avoid circular dependency
  const stores = await import('./index');

  // Phase 1: Close WebSocket connections from old profile's exports
  const { default: exportWebSocketManager } = await import('../services/ExportWebSocketManager');
  exportWebSocketManager.disconnectAll();

  // Phase 2: Clear all profile-scoped data (cancels in-flight fetches via AbortController)
  stores.useProjectsStore.getState().reset();
  stores.useGamesDataStore.getState().reset();
  stores.useProjectDataStore.getState().reset();
  stores.useFramingStore.getState().reset();
  stores.useOverlayStore.getState().reset();
  stores.useVideoStore.getState().reset();
  stores.useNavigationStore.getState().reset();
  stores.useExportStore.getState().reset();
  stores.useUploadStore.getState().reset();
  stores.useGalleryStore.getState().reset();
  stores.useSettingsStore.getState().reset();

  // Phase 3: Re-fetch data for the new profile
  stores.useProjectsStore.getState().fetchProjects();
  stores.useGamesDataStore.getState().fetchGames();
}

// Selector hooks
export const useCurrentProfile = () => useProfileStore(state =>
  state.profiles.find(p => p.id === state.currentProfileId) || null
);
export const useHasMultipleProfiles = () => useProfileStore(state => state.profiles.length >= 2);
export const useProfilesLoading = () => useProfileStore(state => state.isLoading);
