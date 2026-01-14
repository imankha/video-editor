import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize, Minimize, Plus } from 'lucide-react';
import { Button } from '../../../components/shared/Button';
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
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        title="Playback speed"
        className="font-mono"
      >
        {speed}x
      </Button>
      {isOpen && (
        <div className="absolute bottom-full mb-1 right-0 bg-gray-800 border border-gray-600 rounded-lg shadow-lg py-1 z-50">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                onSpeedChange(s);
                setIsOpen(false);
              }}
              className={`
                w-full px-4 py-1.5 text-sm text-left font-mono transition-colors
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
 * AnnotateControls - Extended controls for Annotate mode
 *
 * Features:
 * - Play/pause, step forward/backward, restart
 * - Time display
 * - Playback speed control (YouTube style)
 * - Add Clip button (non-fullscreen only)
 * - Fullscreen toggle button
 */
export function AnnotateControls({
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
  onAddClip,
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
          variant="success"
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
          title="Restart"
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
      <div className="flex items-center gap-2">
        {/* Add Clip button - only show when not in fullscreen */}
        {!isFullscreen && onAddClip && (
          <Button
            variant="success"
            size="sm"
            icon={Plus}
            onClick={onAddClip}
            title="Add clip ending at current time"
          >
            Add Clip
          </Button>
        )}

        {/* Speed control */}
        <SpeedControl speed={playbackSpeed} onSpeedChange={onSpeedChange} />

        {/* Fullscreen button */}
        <Button
          variant="ghost"
          size="sm"
          icon={isFullscreen ? Minimize : Maximize}
          iconOnly
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        />
      </div>
    </div>
  );
}

export default AnnotateControls;
