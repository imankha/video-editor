import React, { useState, useRef, useEffect } from 'react';
import { Maximize, Minimize, Star } from 'lucide-react';
import { formatTime } from '../../../utils/timeFormat';

// YouTube-style speed options
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * SpeedControl - YouTube-style playback speed selector
 */
function SpeedControl({ speed, onSpeedChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 text-sm font-mono text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        title="Playback speed"
      >
        {speed}x
      </button>
      {isOpen && (
        <div className="absolute bottom-full mb-1 right-0 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 z-50">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                onSpeedChange(s);
                setIsOpen(false);
              }}
              className={`
                w-full px-4 py-1 text-sm text-left font-mono transition-colors
                ${s === speed ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-700'}
              `}
            >
              {s}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ClipifyControls - Extended controls for Clipify mode
 *
 * Features:
 * - Play/pause, step forward/backward, restart
 * - Time display
 * - Playback speed control (YouTube style)
 * - Fullscreen toggle button
 */
export function ClipifyControls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onRestart,
  playbackSpeed = 1,
  onSpeedChange,
  isFullscreen,
  onToggleFullscreen,
}) {
  return (
    <div className="controls-container flex items-center justify-between py-4 px-6 bg-gray-800 rounded-lg">
      {/* Playback controls */}
      <div className="flex items-center space-x-4">
        {/* Step backward */}
        <button
          onClick={onStepBackward}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Step backward (one frame)"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
            />
          </svg>
        </button>

        {/* Play/Pause button */}
        <button
          onClick={onTogglePlay}
          className="p-3 bg-green-600 hover:bg-green-700 rounded-full transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Restart button */}
        <button
          onClick={onRestart}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Restart"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* Step forward */}
        <button
          onClick={onStepForward}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Step forward (one frame)"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
            />
          </svg>
        </button>
      </div>

      {/* Time display */}
      <div className="text-white font-mono text-sm">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      {/* Right side controls */}
      <div className="flex items-center space-x-3">
        {/* Speed control */}
        <SpeedControl speed={playbackSpeed} onSpeedChange={onSpeedChange} />

        {/* Fullscreen button */}
        <button
          onClick={onToggleFullscreen}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <Minimize className="w-5 h-5 text-white" />
          ) : (
            <Maximize className="w-5 h-5 text-white" />
          )}
        </button>
      </div>
    </div>
  );
}

export default ClipifyControls;
