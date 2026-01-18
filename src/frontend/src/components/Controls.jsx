import React from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize, Minimize } from 'lucide-react';
import { Button } from './shared/Button';
import { formatTime } from '../utils/timeFormat';

/**
 * Controls component - Playback controls (play/pause, time display, etc)
 *
 * Uses the shared Button component for consistent styling.
 * See STYLE_GUIDE.md for button variants and usage.
 *
 * @param {Object} props
 * @param {boolean} props.isPlaying - Whether video is playing
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total video duration
 * @param {Function} props.onTogglePlay - Toggle play/pause
 * @param {Function} props.onStepForward - Step forward one frame
 * @param {Function} props.onStepBackward - Step backward one frame
 * @param {Function} props.onRestart - Restart video to beginning
 * @param {boolean} props.isFullscreen - Whether in fullscreen mode
 * @param {Function} props.onToggleFullscreen - Toggle fullscreen mode
 */
export function Controls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onRestart,
  isFullscreen,
  onToggleFullscreen,
}) {
  return (
    <div className="controls-container flex items-center justify-between py-2 px-4 bg-gray-800 rounded-b-lg">
      {/* Playback controls */}
      <div className="flex items-center gap-1">
        {/* Step backward */}
        <Button
          variant="ghost"
          size="sm"
          icon={SkipBack}
          iconOnly
          onClick={onStepBackward}
          title="Step backward (one frame)"
        />

        {/* Play/Pause button */}
        <Button
          variant="primary"
          size="sm"
          icon={isPlaying ? Pause : Play}
          iconOnly
          onClick={onTogglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
          className="rounded-full"
        />

        {/* Restart button */}
        <Button
          variant="ghost"
          size="sm"
          icon={RotateCcw}
          iconOnly
          onClick={onRestart}
          title="Restart (go to beginning)"
        />

        {/* Step forward */}
        <Button
          variant="ghost"
          size="sm"
          icon={SkipForward}
          iconOnly
          onClick={onStepForward}
          title="Step forward (one frame)"
        />
      </div>

      {/* Time display */}
      <div className="text-white font-mono text-xs">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      {/* Right side controls */}
      {onToggleFullscreen && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={isFullscreen ? Minimize : Maximize}
            iconOnly
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          />
        </div>
      )}
    </div>
  );
}
