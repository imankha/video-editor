import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, ArrowLeft, Maximize, Minimize } from 'lucide-react';
import { Button } from '../../../components/shared/Button';

// Speed options for annotation playback
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * SpeedControl — YouTube-style playback speed selector.
 */
function SpeedControl({ speed, onSpeedChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

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
 * PlaybackControls — Custom controls for annotation playback mode.
 *
 * Features:
 * - Draggable progress bar with frame-by-frame preview during scrub
 * - Play/pause, virtual time display
 * - Speed control dropdown
 * - Fullscreen toggle
 * - "Back to Annotating" button
 */
export function PlaybackControls({
  isPlaying,
  virtualTime,
  totalVirtualDuration,
  segments,
  activeClipId,
  onTogglePlay,
  onSeek,
  onStartScrub,
  onEndScrub,
  onExitPlayback,
  playbackRate,
  onPlaybackRateChange,
  isFullscreen = false,
  onToggleFullscreen,
}) {
  const progress = totalVirtualDuration > 0 ? (virtualTime / totalVirtualDuration) * 100 : 0;
  const progressBarRef = useRef(null);
  const isDraggingRef = useRef(false);

  /**
   * Convert a mouse/touch clientX to a virtual time position.
   */
  const clientXToVirtualTime = useCallback((clientX) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return fraction * totalVirtualDuration;
  }, [totalVirtualDuration]);

  /**
   * Start dragging on mousedown.
   */
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    onStartScrub?.();
    const vt = clientXToVirtualTime(e.clientX);
    onSeek(vt);
  }, [clientXToVirtualTime, onSeek, onStartScrub]);

  /**
   * Global mousemove while dragging — seek to show each frame.
   */
  useEffect(() => {
    if (!isDraggingRef.current) return;

    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const vt = clientXToVirtualTime(e.clientX);
      onSeek(vt);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        onEndScrub?.();
      }
    };

    // We attach on every render while drag state could be active
    // This is a lightweight approach — the listeners only exist briefly
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  });

  // Also attach listeners on mousedown (immediately, not waiting for next render)
  const handleMouseDownWithListeners = useCallback((e) => {
    handleMouseDown(e);

    const handleMouseMove = (e2) => {
      if (!isDraggingRef.current) return;
      const vt = clientXToVirtualTime(e2.clientX);
      onSeek(vt);
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      onEndScrub?.();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseDown, clientXToVirtualTime, onSeek, onEndScrub]);

  const formatVirtualTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col gap-2 py-2 px-2 sm:px-4 ${
      isFullscreen ? 'bg-gray-900/90' : 'bg-gray-800 rounded-b-lg'
    }`}>
      {/* Progress bar — supports click and drag */}
      <div
        ref={progressBarRef}
        className="relative w-full h-3 bg-gray-700 rounded-full cursor-pointer group"
        onMouseDown={handleMouseDownWithListeners}
      >
        {/* Segment markers — show boundaries between clips */}
        {segments && segments.length > 1 && segments.map((seg, i) => {
          if (i === 0) return null;
          const markerPos = (seg.virtualStart / totalVirtualDuration) * 100;
          return (
            <div
              key={seg.clipId}
              className="absolute top-0 bottom-0 w-px bg-gray-500 z-10"
              style={{ left: `${markerPos}%` }}
            />
          );
        })}

        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-green-500 rounded-full transition-[width] duration-75"
          style={{ width: `${progress}%` }}
        />

        {/* Playhead thumb — always visible during drag, hover otherwise */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-20"
          style={{ left: `calc(${progress}% - 7px)` }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        {/* Left: Back to Annotating */}
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowLeft}
          onClick={onExitPlayback}
          title="Back to Annotating"
          className="text-gray-300 hover:text-white"
        >
          <span className="hidden sm:inline">Back to Annotating</span>
        </Button>

        {/* Center: Play/Pause + Time */}
        <div className="flex items-center gap-3">
          <Button
            variant="success"
            size="sm"
            icon={isPlaying ? Pause : Play}
            iconOnly
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className="rounded-full"
          />
          <span className="text-white font-mono text-xs">
            {formatVirtualTime(virtualTime)}
            <span className="text-gray-400"> / {formatVirtualTime(totalVirtualDuration)}</span>
          </span>
        </div>

        {/* Right: Speed + Fullscreen */}
        <div className="flex items-center gap-2">
          <SpeedControl speed={playbackRate} onSpeedChange={onPlaybackRateChange} />
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
    </div>
  );
}

export default PlaybackControls;
