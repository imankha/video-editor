import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Rewind, FastForward, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { formatTime } from '../utils/timeFormat';

/**
 * GalleryVideoPlayer - Custom video player for Gallery preview modal
 *
 * Provides:
 * - Custom play/pause controls
 * - Seek forward/backward (5 seconds)
 * - Volume control with mute toggle
 * - Timeline scrubber
 * - Keyboard shortcuts (Space, Left/Right arrows)
 *
 * @param {Object} props
 * @param {string} props.src - Video source URL
 * @param {boolean} props.autoPlay - Whether to auto-play on mount
 * @param {Function} props.onClose - Optional callback when Escape is pressed
 */
export function GalleryVideoPlayer({ src, autoPlay = true, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeoutRef = useRef(null);

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

  // Toggle play/pause
  const togglePlay = useCallback(async () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      try {
        await videoRef.current.play();
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Video play error:', error);
        }
      }
    }
  }, [isPlaying]);

  // Seek forward by seconds
  const seekForward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    const newTime = Math.min(videoRef.current.currentTime + seconds, duration);
    videoRef.current.currentTime = newTime;
  }, [duration]);

  // Seek backward by seconds
  const seekBackward = useCallback((seconds = 5) => {
    if (!videoRef.current) return;
    const newTime = Math.max(videoRef.current.currentTime - seconds, 0);
    videoRef.current.currentTime = newTime;
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Handle volume change
  const handleVolumeChange = useCallback((e) => {
    const newVolume = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    }
  }, []);

  // Handle timeline seek
  const handleTimelineSeek = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  }, [duration]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't handle if typing in an input
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

  // Video event handlers
  const handlePlay = () => {
    console.log('[GalleryVideoPlayer] Video playing');
    setIsPlaying(true);
  };
  const handlePause = () => {
    console.log('[GalleryVideoPlayer] Video paused');
    setIsPlaying(false);
  };
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      console.log('[GalleryVideoPlayer] Loaded metadata, duration:', videoRef.current.duration);
      setDuration(videoRef.current.duration);
    }
  };
  const handleCanPlay = () => {
    console.log('[GalleryVideoPlayer] Can play');
    setIsLoading(false);
  };
  const handleWaiting = () => {
    setIsLoading(true);
  };
  const handlePlaying = () => {
    setIsLoading(false);
  };
  const handleError = (e) => {
    console.error('[GalleryVideoPlayer] Video error:', e.target?.error);
    setIsLoading(false);
  };
  const handleLoadStart = () => {
    console.log('[GalleryVideoPlayer] Load started, src:', src?.substring(0, 60));
    setIsLoading(true);
  };

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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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
        onLoadStart={handleLoadStart}
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onWaiting={handleWaiting}
        onPlaying={handlePlaying}
        onError={handleError}
        onClick={togglePlay}
      >
        Your browser does not support the video tag.
      </video>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader size={48} className="text-purple-500 animate-spin" />
        </div>
      )}

      {/* Controls Overlay */}
      <div
        className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: showControls ? 'auto' : 'none' }}
      >
        {/* Gradient Background */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

        {/* Timeline */}
        <div
          className="relative mx-4 mb-2 h-1.5 bg-gray-600 rounded-full cursor-pointer group"
          onClick={handleTimelineSeek}
        >
          <div
            className="absolute inset-y-0 left-0 bg-purple-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        {/* Controls Bar */}
        <div className="flex items-center justify-between px-4 pb-4">
          {/* Left Controls */}
          <div className="flex items-center gap-2">
            {/* Seek Backward */}
            <Button
              variant="ghost"
              size="sm"
              icon={Rewind}
              iconOnly
              onClick={() => seekBackward(5)}
              title="Seek backward 5s (←)"
              className="text-white hover:text-purple-400"
            />

            {/* Play/Pause */}
            <Button
              variant="primary"
              size="sm"
              icon={isPlaying ? Pause : Play}
              iconOnly
              onClick={togglePlay}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              className="rounded-full"
            />

            {/* Seek Forward */}
            <Button
              variant="ghost"
              size="sm"
              icon={FastForward}
              iconOnly
              onClick={() => seekForward(5)}
              title="Seek forward 5s (→)"
              className="text-white hover:text-purple-400"
            />

            {/* Time Display */}
            <span className="text-white text-sm font-mono ml-2">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            {/* Volume */}
            <Button
              variant="ghost"
              size="sm"
              icon={isMuted || volume === 0 ? VolumeX : Volume2}
              iconOnly
              onClick={toggleMute}
              title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              className="text-white hover:text-purple-400"
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Big Play Button (when paused and loaded) - centered, doesn't cover controls */}
      {!isPlaying && !isLoading && showControls && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
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

export default GalleryVideoPlayer;
