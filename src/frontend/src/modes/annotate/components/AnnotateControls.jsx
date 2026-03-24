import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize, Minimize, Plus, Pencil, Volume2, VolumeX } from 'lucide-react';
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
 * - Add Clip button (visible when not in fullscreen, or when paused in fullscreen)
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
  isEditMode = false,
  videoRef,
}) {
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (videoRef?.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
    }
  };

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (videoRef?.current) {
      videoRef.current.muted = newMuted;
    }
  };
  return (
    <div className={`controls-container flex flex-wrap items-center justify-between gap-y-1 py-2 px-2 sm:px-4 ${
      isFullscreen ? 'bg-gray-900/90' : 'bg-gray-800 rounded-b-lg'
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
        {formatTime(currentTime)}<span className="hidden sm:inline"> / {formatTime(duration)}</span>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        {/* Add/Edit Clip button visibility:
            Non-fullscreen: show only when no clip selected (NONE) — sidebar handles editing
            Fullscreen: "Edit Clip" when SELECTED (always), "Add Clip" when NONE (paused only)
            Hidden when overlay is open (onAddClip will be undefined) */}
        {onAddClip && (
          isFullscreen
            ? (isEditMode || !isPlaying) // FS: Edit always, Add only when paused
            : !isEditMode               // Non-FS: only show Add (not Edit)
        ) && (
          <Button
            variant={isEditMode ? 'warning' : 'success'}
            size="sm"
            icon={isEditMode ? Pencil : Plus}
            onClick={onAddClip}
            title={isEditMode ? 'Edit selected clip (A)' : 'Add clip ending at current time (A)'}
            className="hidden sm:flex"
          >
            {isEditMode ? 'Edit Clip' : 'Add Clip'}
          </Button>
        )}
        {/* Mobile: icon-only Add/Edit Clip */}
        {onAddClip && (
          isFullscreen
            ? (isEditMode || !isPlaying)
            : !isEditMode
        ) && (
          <Button
            variant={isEditMode ? 'warning' : 'success'}
            size="sm"
            icon={isEditMode ? Pencil : Plus}
            iconOnly
            onClick={onAddClip}
            title={isEditMode ? 'Edit selected clip (A)' : 'Add clip ending at current time (A)'}
            className="flex sm:hidden"
          />
        )}

        {/* Volume control */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={isMuted || volume === 0 ? VolumeX : Volume2}
            iconOnly
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>

        {/* Speed control */}
        <SpeedControl speed={playbackSpeed} onSpeedChange={onSpeedChange} />

        {/* Fullscreen button - hidden when fullscreen wouldn't increase video size */}
        {onToggleFullscreen && (
          <Button
            variant="ghost"
            size="sm"
            icon={isFullscreen ? Minimize : Maximize}
            iconOnly
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          />
        )}
      </div>
    </div>
  );
}

export default AnnotateControls;
