import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play } from 'lucide-react';
import { VideoLoadingOverlay } from './shared/VideoLoadingOverlay';
import { VideoControls } from './shared/VideoControls';
import { useStandaloneVideo } from '../hooks/useStandaloneVideo';

/**
 * StandaloneVideoPlayer - Self-contained video player with built-in controls
 *
 * Uses shared components for consistent UX:
 * - VideoLoadingOverlay (same as editor)
 * - VideoControls (same styling)
 * - useStandaloneVideo (internal state management)
 *
 * Features:
 * - Play/pause, seek, volume controls
 * - Keyboard shortcuts (Space, arrows, M, Escape)
 * - Auto-hide controls during playback
 * - Big play button overlay
 *
 * @param {Object} props
 * @param {string} props.src - Video source URL
 * @param {boolean} props.autoPlay - Whether to auto-play on mount
 * @param {Function} props.onClose - Callback when Escape is pressed
 */
export function StandaloneVideoPlayer({ src, autoPlay = true, onClose }) {
  const containerRef = useRef(null);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeoutRef = useRef(null);

  // Use shared video state hook
  const {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    isLoading,
    loadingProgress,
    loadingElapsedSeconds,
    togglePlay,
    seek,
    seekForward,
    seekBackward,
    setVolume,
    toggleMute,
    handlers,
  } = useStandaloneVideo({ autoPlay });

  // Auto-hide controls after inactivity
  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    setShowControls(true);
    if (isPlaying) {
      hideControlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target?.tagName?.toLowerCase() === 'input' ||
          e.target?.tagName?.toLowerCase() === 'textarea') {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          scheduleHideControls();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBackward(5);
          scheduleHideControls();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekForward(5);
          scheduleHideControls();
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          scheduleHideControls();
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekForward, seekBackward, toggleMute, onClose, scheduleHideControls]);

  // Mouse movement to show controls
  const handleMouseMove = useCallback(() => {
    scheduleHideControls();
  }, [scheduleHideControls]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black flex items-center justify-center"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        className="w-full h-full object-contain"
        style={{ maxHeight: '100%', maxWidth: '100%' }}
        onClick={togglePlay}
        {...handlers}
      >
        Your browser does not support the video tag.
      </video>

      {/* Loading Indicator - detailed when we have progress, simple otherwise */}
      {isLoading && (
        <VideoLoadingOverlay
          simple={loadingProgress === null}
          progress={loadingProgress}
          elapsedSeconds={loadingElapsedSeconds}
          message="Loading video..."
        />
      )}

      {/* Shared Video Controls */}
      <VideoControls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        onTogglePlay={togglePlay}
        onSeekForward={seekForward}
        onSeekBackward={seekBackward}
        onSeek={seek}
        onVolumeChange={setVolume}
        onToggleMute={toggleMute}
        visible={showControls}
      />

      {/* Big Play Button (when paused and loaded) */}
      {!isPlaying && !isLoading && showControls && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
        >
          <div className="w-16 h-16 rounded-full bg-purple-600/80 flex items-center justify-center hover:bg-purple-600 transition-colors">
            <Play size={32} className="text-white ml-1" />
          </div>
        </div>
      )}
    </div>
  );
}

// Also export as GalleryVideoPlayer for backwards compatibility
export const GalleryVideoPlayer = StandaloneVideoPlayer;

export default StandaloneVideoPlayer;
