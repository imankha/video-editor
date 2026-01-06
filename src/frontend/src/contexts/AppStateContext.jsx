import { createContext, useContext } from 'react';

/**
 * AppStateContext - Provides cross-mode shared state to components
 *
 * This eliminates prop drilling for:
 * - Editor mode (editorMode, setEditorMode)
 * - Selected project (selectedProjectId, selectedProject)
 * - Export progress (exportingProject, globalExportProgress)
 * - Downloads count (downloadsCount, refreshDownloadsCount)
 */
const AppStateContext = createContext(null);

/**
 * Provider component that wraps the app and provides app-level state
 */
export function AppStateProvider({ children, value }) {
  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

/**
 * Hook to access app state context
 * Throws error if used outside of AppStateProvider
 */
export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}

export default AppStateContext;
