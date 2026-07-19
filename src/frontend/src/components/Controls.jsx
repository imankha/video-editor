import React from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize, Minimize, Repeat, PlayCircle } from 'lucide-react';
import { Button } from './shared/Button';
import { formatTime } from '../utils/timeFormat';

/**
 * Controls component - Playback controls (play/pause, time display, etc)
 *
 * Uses the shared Button component for consistent styling.
 * See STYLE_GUIDE.md for button variants and usage.
 *
 * `isLooping` and `secondaryPlay` are OPTIONAL (Overlay spotlight-loop, T5370).
 * When neither is passed the rendered output is byte-identical to before, so
 * Annotate/Framing are unaffected.
 *
 * @param {Object} props
 * @param {boolean} props.isPlaying - Whether video is playing
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total video duration
 * @param {Function} props.onTogglePlay - Toggle play/pause (primary action)
 * @param {Function} props.onStepForward - Step forward one frame
 * @param {Function} props.onStepBackward - Step backward one frame
 * @param {Function} props.onRestart - Restart video to beginning
 * @param {boolean} props.isFullscreen - Whether in fullscreen mode
 * @param {Function} props.onToggleFullscreen - Toggle fullscreen mode
 * @param {boolean} [props.isLooping] - Optional. When true, the primary Play/Pause
 *   gets a loop accent + glyph (signals "this loops the spotlight").
 * @param {{onClick:Function,title:string,active:boolean}} [props.secondaryPlay] -
 *   Optional. Renders a de-emphasized ghost "play full" button beside the primary.
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
  isLooping,
  secondaryPlay,
}) {
  // Primary Play/Pause. When looping, add a purple accent ring (byte-identical
  // className when not looping: exactly 'rounded-full').
  const primaryPlay = (
    <Button
      variant="primary"
      size="sm"
      icon={isPlaying ? Pause : Play}
      iconOnly
      onClick={onTogglePlay}
      title={isLooping && !isPlaying ? 'Play spotlight (loops)' : (isPlaying ? 'Pause' : 'Play')}
      className={`rounded-full${isLooping ? ' ring-2 ring-purple-400' : ''}`}
    />
  );
  return (
    <div className={`controls-container flex items-center justify-between px-2 lg:px-4 ${
      isFullscreen ? 'py-0.5 bg-gray-900/90' : 'py-1 lg:py-2 bg-gray-800 rounded-b-lg'
    }`}>
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

        {/* Play/Pause button (loop accent + glyph badge when isLooping) */}
        {isLooping ? (
          <span className="relative inline-flex">
            {primaryPlay}
            <Repeat
              size={10}
              className="absolute -top-1 -right-1 text-purple-200 bg-gray-800 rounded-full p-[1px] pointer-events-none"
            />
          </span>
        ) : primaryPlay}

        {/* Secondary "Play full" — de-emphasized ghost button (T5370) */}
        {secondaryPlay && (
          <Button
            variant="ghost"
            size="sm"
            icon={PlayCircle}
            iconOnly
            onClick={secondaryPlay.onClick}
            title={secondaryPlay.title}
            className={secondaryPlay.active ? 'text-purple-300' : ''}
          />
        )}

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
        {formatTime(currentTime)}
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
