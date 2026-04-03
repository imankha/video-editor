import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, Maximize, Minimize, Volume2, VolumeX, ArrowLeft } from 'lucide-react';
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
 * PlaybackControls — Controls for annotation playback mode.
 *
 * Matches AnnotateControls layout:
 *   Left:   [Play/Pause] [Restart]
 *   Center: Time display
 *   Right:  [Back] [Volume] [Speed] [Fullscreen]
 *
 * Progress bar with drag-to-scrub sits above the controls row.
 */
export function PlaybackControls({
  isPlaying,
  virtualTime,
  totalVirtualDuration,
  segments,
  activeClipId,
  activeClipName,
  currentSegment,
  onTogglePlay,
  onRestart,
  onSeek,
  onSeekWithinSegment,
  onStartScrub,
  onEndScrub,
  onExitPlayback,
  playbackRate,
  onPlaybackRateChange,
  isFullscreen = false,
  onToggleFullscreen,
  videoARef,
  videoBRef,
}) {
  const progress = totalVirtualDuration > 0 ? (virtualTime / totalVirtualDuration) * 100 : 0;
  const progressBarRef = useRef(null);
  const isDraggingRef = useRef(false);

  // Volume state
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    [videoARef?.current, videoBRef?.current].forEach(v => {
      if (v) { v.volume = newVolume; v.muted = newVolume === 0; }
    });
  };

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    [videoARef?.current, videoBRef?.current].forEach(v => {
      if (v) v.muted = newMuted;
    });
  };

  // --- Main timeline drag-to-scrub ---

  const clientXToVirtualTime = useCallback((clientX) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return fraction * totalVirtualDuration;
  }, [totalVirtualDuration]);

  const handleTimelineMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    onStartScrub?.();
    onSeek(clientXToVirtualTime(e.clientX));

    const handleMouseMove = (e2) => {
      if (!isDraggingRef.current) return;
      onSeek(clientXToVirtualTime(e2.clientX));
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      onEndScrub?.();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [clientXToVirtualTime, onSeek, onStartScrub, onEndScrub]);

  const formatVirtualTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col gap-1 ${
      isFullscreen ? 'bg-gray-900/90' : ''
    }`}>
      {/* Progress bar — supports click and drag */}
      <div
        ref={progressBarRef}
        className="relative w-full h-6 bg-gray-800 rounded-lg cursor-pointer"
        onMouseDown={handleTimelineMouseDown}
      >
        {/* Segment markers */}
        {segments && segments.length > 1 && segments.map((seg, i) => {
          if (i === 0) return null;
          const markerPos = (seg.virtualStart / totalVirtualDuration) * 100;
          return (
            <div
              key={seg.clipId}
              className="absolute top-0 bottom-0 w-px bg-gray-600 z-10"
              style={{ left: `${markerPos}%` }}
            />
          );
        })}

        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-blue-600 rounded-l-lg pointer-events-none"
          style={{ width: `${progress}%` }}
        />

        {/* Playhead line */}
        <div
          className="absolute top-0 w-1 h-full bg-white shadow-lg pointer-events-none z-20"
          style={{ left: `calc(${progress}% - 2px)` }}
        />
      </div>


      {/* Controls row — matches AnnotateControls layout */}
      <div className={`controls-container flex flex-wrap items-center justify-between gap-y-1 py-2 px-2 sm:px-4 ${
        isFullscreen ? 'bg-gray-900/90' : 'bg-gray-800 rounded-b-lg'
      }`}>
        {/* Left: Back + Playback transport */}
        <div className="flex items-center gap-1">
          {/* Back to Annotating */}
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            iconOnly
            onClick={onExitPlayback}
            title="Back to Annotating"
            className="sm:hidden"
          />
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={onExitPlayback}
            title="Back to Annotating"
            className="hidden sm:flex text-gray-300 hover:text-white"
          >
            Back
          </Button>

          {/* Play/Pause */}
          <Button
            variant="success"
            size="sm"
            icon={isPlaying ? Pause : Play}
            iconOnly
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className="rounded-full"
          />

          {/* Restart */}
          <Button
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            iconOnly
            onClick={onRestart}
            title="Restart"
          />
        </div>

        {/* Center: Time display */}
        <div className="text-white font-mono text-xs">
          {formatVirtualTime(virtualTime)}<span className="hidden sm:inline"> / {formatVirtualTime(totalVirtualDuration)}</span>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          {/* Volume control */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={isMuted || volume === 0 ? VolumeX : Volume2}
              iconOnly
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
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
          <SpeedControl speed={playbackRate} onSpeedChange={onPlaybackRateChange} />

          {/* Fullscreen */}
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
