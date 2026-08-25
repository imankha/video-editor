import { createContext, useContext } from 'react';

/**
 * CropContext - Provides crop-related state and functions to components
 * This eliminates prop drilling for crop state through the component tree
 */
const CropContext = createContext(null);

/**
 * Provider component that wraps the app and provides crop state
 */
export function CropProvider({ children, value }) {
  return (
    <CropContext.Provider value={value}>
      {children}
    </CropContext.Provider>
  );
}

/**
 * Hook to access crop context
 * Throws error if used outside of CropProvider
 */
export function useCropContext() {
  const context = useContext(CropContext);
  if (!context) {
    throw new Error('useCropContext must be used within CropProvider');
  }
  return context;
}

export default CropContext;
