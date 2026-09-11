import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind, RotateCcw, Maximize, Minimize, Plus, Pencil, Volume2, VolumeX } from 'lucide-react';
import { Button } from '../../../components/shared/Button';
import { formatTime } from '../../../utils/timeFormat';
import { ANNOTATE } from '../../../config/displayNames';

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
 * - Add Play button (fullscreen only — non-fullscreen uses AnnotateModeView's primary CTA)
 * - Fullscreen toggle button
 */
export function AnnotateControls({
  isPlaying,
  currentTime,
  duration,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onSeekBackward,
  onRestart,
  playbackSpeed = 1,
  onSpeedChange,
  isFullscreen,
  onToggleFullscreen,
  onAddClip,
  isEditMode = false,
  videoController,
  // T8760 item 10: while a clip is open for editing, the readout shows
  // clip-relative time (elapsed / clip-duration) instead of the absolute
  // game-time. `{ start, end }` when editing a clip, else null (unchanged).
  clipEditBounds = null,
  // T8960 item 9: true while the desktop strip Add/Edit Play editor is open. The
  // step-frame / back-5s / restart transport buttons are hidden then, so the
  // ONLY playback control is play/pause (T8760 single-play-control invariant)
  // and the playhead can't be nudged out of the clip's green span. Gated by the
  // caller on the desktop strip only, so fullscreen/mobile transports are
  // unchanged. `clipEditBounds` alone can't drive this — it's null in create
  // (Add Play) mode, where the buttons must also be hidden.
  editorOpen = false,
}) {
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    videoController?.setVolume(newVolume);
    videoController?.setMuted(newVolume === 0);
  };

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoController?.setMuted(newMuted);
  };
  return (
    <div className={`controls-container flex flex-wrap items-center justify-between gap-y-1 px-2 lg:px-4 ${
      isFullscreen ? 'py-0.5 bg-gray-900/90' : 'py-2 bg-gray-800 rounded-b-lg'
    }`}>
      {/* Playback controls — T8960 item 9: while the strip editor is open the
          step/seek/restart buttons are hidden so the playhead can't leave the
          clip span; only play/pause remains. */}
      <div className="flex items-center gap-1">
        {/* Back 5 seconds */}
        {!editorOpen && (
          <Button
            variant="ghost"
            size="sm"
            icon={Rewind}
            iconOnly
            onClick={() => onSeekBackward?.(5)}
            title="Back 5 seconds"
          />
        )}

        {/* Step backward */}
        {!editorOpen && (
          <Button
            variant="ghost"
            size="sm"
            icon={SkipBack}
            iconOnly
            onClick={onStepBackward}
            title="Step backward (one frame)"
          />
        )}

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
        {!editorOpen && (
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            iconOnly
            onClick={onRestart}
            title="Restart"
          />
        )}

        {/* Step forward */}
        {!editorOpen && (
          <Button
            variant="ghost"
            size="sm"
            icon={SkipForward}
            iconOnly
            onClick={onStepForward}
            title="Step forward (one frame)"
          />
        )}
      </div>

      {/* Time display — T8760 item 10: clip-relative while editing a clip
          (the absolute game clock isn't relevant to the clip), absolute
          otherwise. */}
      {clipEditBounds ? (
        (() => {
          const clipLength = Math.max(0, clipEditBounds.end - clipEditBounds.start);
          const elapsed = Math.max(0, Math.min(currentTime - clipEditBounds.start, clipLength));
          return (
            <div className="text-white font-mono text-xs" data-testid="clip-relative-time">
              {elapsed.toFixed(1)}s<span> / {clipLength.toFixed(1)}s</span>
            </div>
          );
        })()
      ) : (
        <div className="text-white font-mono text-xs">
          {formatTime(currentTime)}<span className="hidden sm:inline"> / {formatTime(duration)}</span>
        </div>
      )}

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        {/* Add/Edit Clip button visibility: fullscreen only. Non-fullscreen is covered by
            AnnotateModeView's primary full-width CTA (Add) and the sidebar (Edit) — this
            toolbar button would just duplicate them. In fullscreen, the CTA doesn't render,
            so this is the only way to add/edit a play (clicking pauses video and opens
            overlay). Hidden when overlay is open (onAddClip will be undefined). */}
        {onAddClip && isFullscreen && (
          <Button
            variant={isEditMode ? 'warning' : 'success'}
            size="sm"
            icon={isEditMode ? Pencil : Plus}
            onClick={onAddClip}
            title={isEditMode ? 'Edit selected play (A)' : 'Mark play ending at current time (A)'}
            className="hidden sm:flex"
          >
            {isEditMode ? ANNOTATE.EDIT_PLAY : ANNOTATE.MARK_PLAY}
          </Button>
        )}
        {/* Mobile: icon-only Add/Edit Clip (fullscreen only, see above) */}
        {onAddClip && isFullscreen && (
          <Button
            variant={isEditMode ? 'warning' : 'success'}
            size="sm"
            icon={isEditMode ? Pencil : Plus}
            iconOnly
            onClick={onAddClip}
            title={isEditMode ? 'Edit selected play (A)' : 'Mark play ending at current time (A)'}
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
            className="hidden sm:block w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer
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
