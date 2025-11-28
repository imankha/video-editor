import { createContext, useContext } from 'react';

/**
 * HighlightContext - Provides highlight-related state and functions to components
 * This eliminates prop drilling for highlight state through the component tree
 */
const HighlightContext = createContext(null);

/**
 * Provider component that wraps the app and provides highlight state
 */
export function HighlightProvider({ children, value }) {
  return (
    <HighlightContext.Provider value={value}>
      {children}
    </HighlightContext.Provider>
  );
}

/**
 * Hook to access highlight context
 * Throws error if used outside of HighlightProvider
 */
export function useHighlightContext() {
  const context = useContext(HighlightContext);
  if (!context) {
    throw new Error('useHighlightContext must be used within HighlightProvider');
  }
  return context;
}

export default HighlightContext;
