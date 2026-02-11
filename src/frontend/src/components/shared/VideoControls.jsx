import React from 'react';
import { Play, Pause, Volume2, VolumeX, Rewind, FastForward } from 'lucide-react';
import { Button } from './Button';
import { formatTime } from '../../utils/timeFormat';

/**
 * VideoControls - Shared playback controls for video players
 *
 * Used by both GalleryVideoPlayer (standalone) and can be used by editor modes.
 * Provides: play/pause, seek forward/backward, timeline scrubber, volume, time display.
 *
 * @param {Object} props
 * @param {boolean} props.isPlaying - Whether video is playing
 * @param {number} props.currentTime - Current playback time in seconds
 * @param {number} props.duration - Total duration in seconds
 * @param {number} props.volume - Volume level 0-1
 * @param {boolean} props.isMuted - Whether audio is muted
 * @param {Function} props.onTogglePlay - Toggle play/pause
 * @param {Function} props.onSeekForward - Seek forward (default 5s)
 * @param {Function} props.onSeekBackward - Seek backward (default 5s)
 * @param {Function} props.onSeek - Seek to specific time
 * @param {Function} props.onVolumeChange - Handle volume change
 * @param {Function} props.onToggleMute - Toggle mute
 * @param {boolean} props.showVolume - Whether to show volume controls (default true)
 * @param {boolean} props.visible - Whether controls are visible (for fade effect)
 */
export function VideoControls({
  isPlaying,
  currentTime,
  duration,
  volume = 1,
  isMuted = false,
  onTogglePlay,
  onSeekForward,
  onSeekBackward,
  onSeek,
  onVolumeChange,
  onToggleMute,
  showVolume = true,
  visible = true,
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleTimelineClick = (e) => {
    if (!onSeek || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    onSeek(newTime);
  };

  const handleVolumeInput = (e) => {
    if (!onVolumeChange) return;
    onVolumeChange(parseFloat(e.target.value));
  };

  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex flex-col transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Gradient Background */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

      {/* Timeline */}
      <div
        className="relative mx-4 mb-2 h-1.5 bg-gray-600 rounded-full cursor-pointer group z-10"
        onClick={handleTimelineClick}
      >
        <div
          className="absolute inset-y-0 left-0 bg-purple-500 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between px-4 pb-4 z-10">
        {/* Left Controls */}
        <div className="flex items-center gap-2">
          {/* Seek Backward */}
          <Button
            variant="ghost"
            size="sm"
            icon={Rewind}
            iconOnly
            onClick={() => onSeekBackward?.(5)}
            title="Seek backward 5s (←)"
            className="text-white hover:text-purple-400"
          />

          {/* Play/Pause */}
          <Button
            variant="primary"
            size="sm"
            icon={isPlaying ? Pause : Play}
            iconOnly
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="rounded-full"
          />

          {/* Seek Forward */}
          <Button
            variant="ghost"
            size="sm"
            icon={FastForward}
            iconOnly
            onClick={() => onSeekForward?.(5)}
            title="Seek forward 5s (→)"
            className="text-white hover:text-purple-400"
          />

          {/* Time Display */}
          <span className="text-white text-sm font-mono ml-2">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Right Controls - Volume */}
        {showVolume && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={isMuted || volume === 0 ? VolumeX : Volume2}
              iconOnly
              onClick={onToggleMute}
              title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              className="text-white hover:text-purple-400"
            />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeInput}
              className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoControls;
