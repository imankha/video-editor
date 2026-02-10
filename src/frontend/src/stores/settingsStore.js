import { create } from 'zustand';
import { API_BASE } from '../config';

/**
 * Settings Store - Persisted user preferences
 *
 * Settings are stored in SQLite and synced to R2 like all other user data.
 * This store loads settings from the backend on initialization and
 * saves changes back to the backend automatically.
 *
 * Structure:
 * - projectFilters: { statusFilter, aspectFilter, creationFilter }
 * - framing: { includeAudio, defaultAspectRatio, defaultTransition }
 * - overlay: { highlightEffectType }
 */

// Default settings (must match backend defaults)
const DEFAULT_SETTINGS = {
  projectFilters: {
    statusFilter: 'uncompleted',
    aspectFilter: 'all',
    creationFilter: 'all',
  },
  framing: {
    includeAudio: true,
    defaultAspectRatio: '9:16',
    defaultTransition: 'cut',
  },
  overlay: {
    highlightEffectType: 'dark_overlay',
  },
};

export const useSettingsStore = create((set, get) => ({
  // Settings state
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  isInitialized: false,
  error: null,

  // Load settings from backend
  loadSettings: async () => {
    // Only load once
    if (get().isInitialized) return get().settings;

    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      if (!response.ok) {
        throw new Error(`Failed to load settings: ${response.status}`);
      }
      const settings = await response.json();
      set({ settings, isLoading: false, isInitialized: true });
      return settings;
    } catch (error) {
      console.error('[SettingsStore] Failed to load settings:', error);
      set({ isLoading: false, isInitialized: true, error: error.message });
      return get().settings; // Return defaults on error
    }
  },

  // Save settings to backend (debounced in practice via React)
  saveSettings: async (updates) => {
    const currentSettings = get().settings;

    // Optimistically update local state
    const merged = deepMerge(currentSettings, updates);
    set({ settings: merged });

    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to save settings: ${response.status}`);
      }

      const savedSettings = await response.json();
      set({ settings: savedSettings });
      return savedSettings;
    } catch (error) {
      console.error('[SettingsStore] Failed to save settings:', error);
      // Revert on error
      set({ settings: currentSettings, error: error.message });
      throw error;
    }
  },

  // Project filter setters (convenience methods)
  setStatusFilter: (value) => {
    get().saveSettings({ projectFilters: { statusFilter: value } });
  },

  setAspectFilter: (value) => {
    get().saveSettings({ projectFilters: { aspectFilter: value } });
  },

  setCreationFilter: (value) => {
    get().saveSettings({ projectFilters: { creationFilter: value } });
  },

  // Framing setters
  setIncludeAudio: (value) => {
    get().saveSettings({ framing: { includeAudio: value } });
  },

  setDefaultAspectRatio: (value) => {
    get().saveSettings({ framing: { defaultAspectRatio: value } });
  },

  setDefaultTransition: (value) => {
    get().saveSettings({ framing: { defaultTransition: value } });
  },

  // Overlay setters
  setHighlightEffectType: (value) => {
    get().saveSettings({ overlay: { highlightEffectType: value } });
  },

  // Reset to defaults
  resetSettings: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to reset settings: ${response.status}`);
      }

      const settings = await response.json();
      set({ settings, error: null });
      return settings;
    } catch (error) {
      console.error('[SettingsStore] Failed to reset settings:', error);
      set({ error: error.message });
      throw error;
    }
  },
}));

// Deep merge helper
function deepMerge(base, updates) {
  const result = { ...base };
  for (const key of Object.keys(updates)) {
    if (updates[key] !== null && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
      result[key] = deepMerge(base[key] || {}, updates[key]);
    } else {
      result[key] = updates[key];
    }
  }
  return result;
}

// Selector hooks for specific settings
export const useProjectFilters = () => useSettingsStore(state => state.settings.projectFilters);
export const useFramingSettings = () => useSettingsStore(state => state.settings.framing);
export const useOverlaySettings = () => useSettingsStore(state => state.settings.overlay);
export const useSettingsLoading = () => useSettingsStore(state => state.isLoading);
export const useSettingsInitialized = () => useSettingsStore(state => state.isInitialized);
