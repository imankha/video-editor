import { Play, Pause, ArrowLeft } from 'lucide-react';
import { Button } from '../../../components/shared/Button';
import { formatTime } from '../../../utils/timeFormat';

/**
 * PlaybackControls — Custom controls for annotation playback mode.
 *
 * Shows: play/pause, virtual time display, progress bar with segment markers,
 * and a "Back to Annotating" button.
 */
export function PlaybackControls({
  isPlaying,
  virtualTime,
  totalVirtualDuration,
  segments,
  activeClipId,
  onTogglePlay,
  onSeek,
  onExitPlayback,
  isFullscreen = false,
}) {
  const progress = totalVirtualDuration > 0 ? (virtualTime / totalVirtualDuration) * 100 : 0;

  /**
   * Handle click/drag on progress bar to seek.
   */
  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, x / rect.width));
    onSeek(fraction * totalVirtualDuration);
  };

  /**
   * Format virtual time for display (MM:SS).
   */
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
      {/* Progress bar */}
      <div
        className="relative w-full h-3 bg-gray-700 rounded-full cursor-pointer group"
        onClick={handleProgressClick}
      >
        {/* Segment markers — show boundaries between clips */}
        {segments && segments.length > 1 && segments.map((seg, i) => {
          if (i === 0) return null; // No marker at the very start
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

        {/* Hover indicator */}
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

        {/* Right: Speed indicator */}
        <div className="text-xs text-gray-400 font-mono">
          0.5x
        </div>
      </div>
    </div>
  );
}

export default PlaybackControls;
