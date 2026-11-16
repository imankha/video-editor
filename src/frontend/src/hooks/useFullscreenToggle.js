import { useState, useCallback, useEffect } from 'react';

/**
 * useFullscreenToggle - fullscreen state for Frame and Spotlight (T4570)
 *
 * Owns isFullscreen, the toggle for the fullscreen button, and Escape to exit.
 */
export function useFullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  return { isFullscreen, toggleFullscreen };
}

export default useFullscreenToggle;
