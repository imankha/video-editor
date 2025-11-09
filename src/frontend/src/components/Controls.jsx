import React from 'react';
import { formatTime } from '../utils/timeFormat';

/**
 * Controls component - Playback controls (play/pause, time display, etc)
 * @param {Object} props
 * @param {boolean} props.isPlaying - Whether video is playing
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total video duration
 * @param {Function} props.onTogglePlay - Toggle play/pause
 * @param {Function} props.onStepForward - Step forward one frame
 * @param {Function} props.onStepBackward - Step backward one frame
 * @param {Function} props.onRestart - Restart video to beginning
 */
export function Controls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onRestart,
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
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
            />
          </svg>
        </button>

        {/* Play/Pause button */}
        <button
          onClick={onTogglePlay}
          className="p-3 bg-blue-600 hover:bg-blue-700 rounded-full transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg
              className="w-6 h-6 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg
              className="w-6 h-6 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Restart button */}
        <button
          onClick={onRestart}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Restart (go to beginning)"
        >
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
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
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
            />
          </svg>
        </button>
      </div>

      {/* Time display */}
      <div className="text-white font-mono text-sm">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}
