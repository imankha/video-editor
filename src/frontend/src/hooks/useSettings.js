/**
 * useSettings Hook
 *
 * Manages application settings stored in localStorage.
 * Settings include project creation rules for annotation export.
 */

import { useState, useCallback, useEffect } from 'react';

const SETTINGS_KEY = 'reel_ballers_settings';

// Default settings
const DEFAULT_SETTINGS = {
  // Project creation rules
  projectCreation: {
    // Minimum rating for clips to be saved to library (1-5)
    minRatingForLibrary: 4,

    // Game project settings (all clips meeting minRating)
    createGameProject: true,
    gameProjectAspectRatio: '16:9',

    // Individual clip projects (for highest rated clips)
    createClipProjects: true,
    clipProjectMinRating: 5,  // Only create individual projects for 5-star clips
    clipProjectAspectRatio: '9:16',
  },
};

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new settings added over time
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          projectCreation: {
            ...DEFAULT_SETTINGS.projectCreation,
            ...parsed.projectCreation,
          },
        };
      }
    } catch (e) {
      console.warn('[useSettings] Failed to parse stored settings:', e);
    }
    return DEFAULT_SETTINGS;
  });

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[useSettings] Failed to save settings:', e);
    }
  }, [settings]);

  /**
   * Update a specific section of settings
   */
  const updateSettings = useCallback((section, updates) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        ...updates,
      },
    }));
  }, []);

  /**
   * Update project creation settings
   */
  const updateProjectCreationSettings = useCallback((updates) => {
    updateSettings('projectCreation', updates);
  }, [updateSettings]);

  /**
   * Reset settings to defaults
   */
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  /**
   * Get project creation settings for export API
   */
  const getProjectCreationSettings = useCallback(() => {
    return settings.projectCreation;
  }, [settings.projectCreation]);

  return {
    settings,
    projectCreationSettings: settings.projectCreation,
    updateProjectCreationSettings,
    getProjectCreationSettings,
    resetSettings,
  };
}

export default useSettings;
