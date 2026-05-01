import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react';
import { formatTimeCompact } from '../../utils/timeFormat';

const IS_COARSE = window.matchMedia?.('(pointer: coarse)').matches;

/**
 * VideoControls - YouTube-style playback controls
 *
 * Layout matches YouTube: scrub bar on top, then play | volume | time ... fullscreen
 * Scrub bar: thin line expands on hover, drag to seek, hover time tooltip, round handle.
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
  isFullscreen = false,
  onToggleFullscreen,
}) {
  const videoProgress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const timelineRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeTimeoutRef = useRef(null);

  // During drag, show drag position immediately; otherwise use video's currentTime
  const progress = isDragging ? dragPercent : videoProgress;

  const getPercentFromEvent = useCallback((e) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }, []);

  const seekToPercent = useCallback((percent) => {
    if (!onSeek || duration === 0) return;
    onSeek((percent / 100) * duration);
  }, [onSeek, duration]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const percent = getPercentFromEvent(e);
    setIsDragging(true);
    setDragPercent(percent);
    seekToPercent(percent);
  }, [getPercentFromEvent, seekToPercent]);

  const handleTimelineMouseMove = useCallback((e) => {
    setHoverPercent(getPercentFromEvent(e));
  }, [getPercentFromEvent]);

  const handleTouchStart = useCallback((e) => {
    e.stopPropagation();
    const percent = getPercentFromEvent(e);
    setIsDragging(true);
    setDragPercent(percent);
    seekToPercent(percent);
  }, [getPercentFromEvent, seekToPercent]);

  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalMove = (e) => {
      if (e.touches) e.preventDefault();
      const percent = getPercentFromEvent(e);
      setDragPercent(percent);
      seekToPercent(percent);
      setHoverPercent(percent);
    };
    const handleGlobalUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('touchend', handleGlobalUp);
    window.addEventListener('touchcancel', handleGlobalUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalUp);
      window.removeEventListener('touchcancel', handleGlobalUp);
    };
  }, [isDragging, getPercentFromEvent, seekToPercent]);

  const handleVolumeInput = (e) => {
    if (!onVolumeChange) return;
    onVolumeChange(parseFloat(e.target.value));
  };

  const handleVolumeEnter = () => {
    clearTimeout(volumeTimeoutRef.current);
    setShowVolumeSlider(true);
  };

  const handleVolumeLeave = () => {
    volumeTimeoutRef.current = setTimeout(() => setShowVolumeSlider(false), 300);
  };

  const hoverTime = duration > 0 ? formatTimeCompact((hoverPercent / 100) * duration) : '0:00';
  const active = isHovering || isDragging;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex flex-col transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {/* Scrub bar */}
      <div
        ref={timelineRef}
        className="relative w-full cursor-pointer z-10"
        style={{ paddingTop: IS_COARSE ? 20 : 8, paddingBottom: IS_COARSE ? 14 : 8 }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseMove={handleTimelineMouseMove}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Track container */}
        <div
          className="relative w-full transition-all duration-150 bg-white/25 rounded-full"
          style={{ height: IS_COARSE ? 6 : (active ? 5 : 3) }}
        >
          {/* Hover fill */}
          {active && !isDragging && (
            <div
              className="absolute inset-y-0 left-0 bg-white/20 rounded-full"
              style={{ width: `${hoverPercent}%` }}
            />
          )}

          {/* Progress */}
          <div
            className="absolute inset-y-0 left-0 bg-purple-500"
            style={{ width: `${progress}%` }}
          />

          {/* Scrub dot — always visible like YouTube */}
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-full bg-purple-500 transition-all duration-100"
            style={{
              width: IS_COARSE ? 20 : (active ? 14 : 12),
              height: IS_COARSE ? 20 : (active ? 14 : 12),
              left: `calc(${progress}% - ${IS_COARSE ? 10 : (active ? 7 : 6)}px)`,
            }}
          />
        </div>

        {/* Hover time tooltip */}
        {active && !isDragging && (
          <div
            className="absolute bottom-full mb-1 px-2 py-0.5 bg-black/90 text-white text-xs rounded pointer-events-none whitespace-nowrap"
            style={{
              left: `clamp(24px, ${hoverPercent}%, calc(100% - 24px))`,
              transform: 'translateX(-50%)',
            }}
          >
            {hoverTime}
          </div>
        )}
      </div>

      {/* Controls bar — YouTube layout: play | volume | time ... fullscreen */}
      <div className={`flex items-center justify-between px-3 z-10 ${IS_COARSE ? 'gap-2 pb-4 pt-1' : 'pb-2.5'}`} style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}>
        {/* Left group */}
        <div className={`flex items-center ${IS_COARSE ? 'gap-3' : 'gap-1'}`}>
          {/* Play / Pause */}
          <button
            onClick={onTogglePlay}
            className={`text-white hover:text-white/80 transition-colors ${IS_COARSE ? 'p-2.5' : 'p-1.5'}`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying
              ? <Pause size={IS_COARSE ? 26 : 22} fill="white" />
              : <Play size={IS_COARSE ? 26 : 22} fill="white" />
            }
          </button>

          {/* Restart */}
          <button
            onClick={() => onSeek?.(0)}
            className={`text-white hover:text-white/80 transition-colors ${IS_COARSE ? 'p-2.5' : 'p-1.5'}`}
            title="Restart (Home)"
          >
            <RotateCcw size={IS_COARSE ? 24 : 20} />
          </button>

          {/* Volume — icon + slider on hover, like YouTube */}
          {showVolume && (
            <div
              className="flex items-center"
              onMouseEnter={handleVolumeEnter}
              onMouseLeave={handleVolumeLeave}
            >
              <button
                onClick={onToggleMute}
                className={`text-white hover:text-white/80 transition-colors ${IS_COARSE ? 'p-2.5' : 'p-1.5'}`}
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0
                  ? <VolumeX size={IS_COARSE ? 26 : 22} />
                  : <Volume2 size={IS_COARSE ? 26 : 22} />
                }
              </button>
              {!IS_COARSE && (
                <div
                  className="overflow-hidden transition-all duration-200"
                  style={{ width: showVolumeSlider ? 60 : 0, opacity: showVolumeSlider ? 1 : 0 }}
                >
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeInput}
                    className="w-[56px] h-1 bg-white/30 rounded-full appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                      [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                  />
                </div>
              )}
            </div>
          )}

          {/* Time */}
          <span className={`text-white font-mono select-none ${IS_COARSE ? 'text-xs ml-1' : 'text-sm ml-2'}`}>
            {formatTimeCompact(currentTime)}<span className="text-white/60"> / {formatTimeCompact(duration)}</span>
          </span>
        </div>

        {/* Right group */}
        <div className={`flex items-center ${IS_COARSE ? 'gap-3' : 'gap-1'}`}>
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className={`text-white hover:text-white/80 transition-colors ${IS_COARSE ? 'p-2.5' : 'p-1.5'}`}
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? <Minimize size={IS_COARSE ? 26 : 22} /> : <Maximize size={IS_COARSE ? 26 : 22} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoControls;
