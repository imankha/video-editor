import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play } from 'lucide-react';
import { VideoLoadingOverlay } from './shared/VideoLoadingOverlay';
import { VideoControls } from './shared/VideoControls';
import { useStandaloneVideo } from '../hooks/useStandaloneVideo';

/**
 * MediaPlayer - Video player with built-in controls
 *
 * Plays video with:
 * - Play/pause, seek forward/backward, volume controls
 * - Timeline scrubber
 * - Keyboard shortcuts (Space, arrows, M, Escape)
 * - Auto-hide controls during playback
 * - Loading indicator with progress
 *
 * Uses shared components: VideoLoadingOverlay, VideoControls
 *
 * @param {Object} props
 * @param {string} props.src - Video source URL
 * @param {boolean} props.autoPlay - Whether to auto-play on mount
 * @param {Function} props.onClose - Callback when Escape is pressed
 */
export function MediaPlayer({ src, autoPlay = true, onClose }) {
  const containerRef = useRef(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideControlsTimeoutRef = useRef(null);
  const isTouchRef = useRef(false);

  // Use shared video state hook
  const {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    hasAudio,
    isLoading,
    togglePlay,
    seek,
    seekForward,
    seekBackward,
    setVolume,
    toggleMute,
    handlers,
  } = useStandaloneVideo({ autoPlay });

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

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
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          scheduleHideControls();
          break;
        case 'Home':
          e.preventDefault();
          seek(0);
          scheduleHideControls();
          break;
        case 'Escape':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            onClose?.();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekForward, seekBackward, toggleMute, toggleFullscreen, onClose, scheduleHideControls]);

  // Mouse movement to show controls
  const handleMouseMove = useCallback(() => {
    scheduleHideControls();
  }, [scheduleHideControls]);

  const handleContainerClick = useCallback(() => {
    if (isTouchRef.current) {
      isTouchRef.current = false;
      if (showControls) {
        setShowControls(false);
        if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
      } else {
        scheduleHideControls();
      }
      return;
    }
    togglePlay();
  }, [togglePlay, showControls, scheduleHideControls]);

  // Auto-hide controls when playing (handles mobile where no mouse move fires)
  useEffect(() => {
    if (!isPlaying) return;
    const id = setTimeout(() => setShowControls(false), 2000);
    return () => clearTimeout(id);
  }, [isPlaying]);

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
      onClick={handleContainerClick}
      onTouchStart={() => { isTouchRef.current = true; }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        className="w-full h-full object-contain"
        style={{ maxHeight: '100%', maxWidth: '100%', pointerEvents: 'none' }}
        {...handlers}
      >
        Your browser does not support the video tag.
      </video>

      {/* Loading spinner — simple mode only (no grey backdrop) */}
      {isLoading && <VideoLoadingOverlay simple />}

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
        showVolume={hasAudio}
        visible={showControls}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* Big Play Button (when paused and loaded) */}
      {!isPlaying && !isLoading && showControls && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20"
          onTouchStart={(e) => e.stopPropagation()}
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

export default MediaPlayer;
