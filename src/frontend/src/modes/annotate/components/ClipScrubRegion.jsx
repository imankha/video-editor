import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Square } from 'lucide-react';

const WINDOW_BEFORE = 20; // seconds before anchor
const WINDOW_AFTER = 10;  // seconds after anchor
const MIN_REGION_DURATION = 0.5; // minimum clip duration in seconds

/**
 * Format seconds to MM:SS.s
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
}

/**
 * ClipScrubRegion - Mini-timeline with two draggable handles for selecting clip start/end.
 *
 * Replaces the duration slider in the fullscreen overlay. Shows a 30-second window
 * around the clip point with draggable start/end handles. Dragging a handle seeks
 * the video to that frame for real-time visual feedback.
 *
 * @param {number} currentTime - The "Add Clip" point (playhead time when paused)
 * @param {number} videoDuration - Total video duration in seconds
 * @param {Object|null} existingClip - Existing clip for edit mode (has startTime, endTime)
 * @param {number} startTime - Current start handle position
 * @param {number} endTime - Current end handle position
 * @param {Function} onStartTimeChange - Called when start handle moves
 * @param {Function} onEndTimeChange - Called when end handle moves
 * @param {Function} onSeek - Called with time in seconds to seek the video
 * @param {Object} videoRef - React ref to the video element (for play preview)
 */
export function ClipScrubRegion({
  currentTime,
  videoDuration,
  existingClip,
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  onSeek,
  onDragStart,
  onDragEnd,
  videoRef,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'start' | 'end' | null
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewTime, setPreviewTime] = useState(null); // null when not previewing
  const previewRafRef = useRef(null);

  // Stable anchor: captured per-clip so the window doesn't shift during drag
  // (onSeek updates currentTime, which would otherwise recalculate the window).
  // Must update when existingClip changes so the window re-centers on the new clip.
  const anchorRef = useRef(
    existingClip
      ? (existingClip.startTime + existingClip.endTime) / 2
      : currentTime
  );
  const prevClipIdRef = useRef(existingClip?.id ?? null);
  if ((existingClip?.id ?? null) !== prevClipIdRef.current) {
    prevClipIdRef.current = existingClip?.id ?? null;
    anchorRef.current = existingClip
      ? (existingClip.startTime + existingClip.endTime) / 2
      : currentTime;
  }
  const anchor = anchorRef.current;
  const windowStart = Math.max(0, anchor - WINDOW_BEFORE);
  const windowEnd = Math.min(videoDuration, anchor + WINDOW_AFTER);
  const windowDuration = windowEnd - windowStart;

  // Convert time to percentage within the window
  const timeToPercent = useCallback((time) => {
    if (windowDuration <= 0) return 0;
    return ((time - windowStart) / windowDuration) * 100;
  }, [windowStart, windowDuration]);

  // Convert pixel position to time
  const pixelToTime = useCallback((clientX) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return windowStart + percent * windowDuration;
  }, [windowStart, windowDuration]);

  // Use refs for start/end so the RAF loop always reads latest values
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  useEffect(() => { startTimeRef.current = startTime; }, [startTime]);
  useEffect(() => { endTimeRef.current = endTime; }, [endTime]);

  // Stop preview helper (must be defined before handlePointerDown which references it)
  const stopPreview = useCallback(() => {
    const video = videoRef?.current;
    if (video) video.pause();
    setIsPreviewing(false);
    setPreviewTime(null);
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  }, [videoRef]);

  // All drag state in refs to avoid stale closures when switching handles
  const draggingRef = useRef(null);
  const dragOffsetRef = useRef(0);

  // Stable refs for callbacks so window listeners never go stale
  const onStartTimeChangeRef = useRef(onStartTimeChange);
  const onEndTimeChangeRef = useRef(onEndTimeChange);
  const onSeekRef = useRef(onSeek);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => { onStartTimeChangeRef.current = onStartTimeChange; }, [onStartTimeChange]);
  useEffect(() => { onEndTimeChangeRef.current = onEndTimeChange; }, [onEndTimeChange]);
  useEffect(() => { onSeekRef.current = onSeek; }, [onSeek]);
  useEffect(() => { onDragStartRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);

  // Handle pointer down on a handle
  const handlePointerDown = useCallback((handle, e) => {
    e.preventDefault();
    e.stopPropagation();
    // Pause video when user starts dragging (prevents playback fighting with drag preview)
    const video = videoRef?.current;
    if (video && !video.paused) {
      video.pause();
    }
    // Stop any running preview when user starts dragging
    if (isPreviewing) {
      stopPreview();
    }
    // Calculate offset: where the user clicked vs where the handle center is
    const clickTime = pixelToTime(e.clientX);
    const handleTime = handle === 'start' ? startTimeRef.current : endTimeRef.current;
    dragOffsetRef.current = clickTime - handleTime;
    // Notify parent that drag is starting (e.g. to suppress auto-deselect)
    onDragStartRef.current?.();
    // Seek immediately so the video shows this handle's frame (no jump on first move)
    onSeekRef.current?.(handleTime);
    // Set ref immediately (no async state delay)
    draggingRef.current = handle;
    setDragging(handle);
    e.target.setPointerCapture(e.pointerId);
  }, [isPreviewing, stopPreview, pixelToTime]);

  // Handle pointer move — reads everything from refs, never stale
  const handlePointerMove = useCallback((e) => {
    const d = draggingRef.current;
    if (!d) return;
    e.preventDefault();

    // Subtract the initial click offset so the handle stays under the cursor
    const time = pixelToTime(e.clientX) - dragOffsetRef.current;
    const s = startTimeRef.current;
    const en = endTimeRef.current;

    if (d === 'start') {
      const clamped = Math.max(
        Math.max(0, windowStart),
        Math.min(time, en - MIN_REGION_DURATION)
      );
      onStartTimeChangeRef.current(clamped);
      onSeekRef.current?.(clamped);
    } else if (d === 'end') {
      const clamped = Math.min(
        Math.min(videoDuration, windowEnd),
        Math.max(time, s + MIN_REGION_DURATION)
      );
      onEndTimeChangeRef.current(clamped);
      onSeekRef.current?.(clamped);
    }
  }, [pixelToTime, windowStart, windowEnd, videoDuration]);

  // Handle pointer up — notify parent that drag is complete
  const handlePointerUp = useCallback((e) => {
    if (draggingRef.current) {
      e.preventDefault();
      onDragEndRef.current?.(startTimeRef.current, endTimeRef.current);
      draggingRef.current = null;
      setDragging(null);
    }
  }, []);

  // Attach move/up to window once, stable listeners (no churn)
  useEffect(() => {
    const onMove = (e) => handlePointerMove(e);
    const onUp = (e) => handlePointerUp(e);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // Play preview: loop from startTime to endTime with visual playhead
  const handlePreviewPlay = useCallback(() => {
    const video = videoRef?.current;
    if (!video) return;

    if (isPreviewing) {
      stopPreview();
      return;
    }

    video.currentTime = startTime;
    video.play();
    setIsPreviewing(true);
    setPreviewTime(startTime);

    const tick = () => {
      const s = startTimeRef.current;
      const e = endTimeRef.current;

      if (video.paused && previewRafRef.current) {
        // Video was paused externally — stop preview
        setIsPreviewing(false);
        setPreviewTime(null);
        previewRafRef.current = null;
        return;
      }

      if (video.currentTime >= e) {
        // Loop back to start
        video.currentTime = s;
      }

      setPreviewTime(video.currentTime);
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);
  }, [videoRef, startTime, isPreviewing, stopPreview]);

  // Cleanup preview on unmount
  useEffect(() => {
    return () => {
      if (previewRafRef.current) {
        cancelAnimationFrame(previewRafRef.current);
      }
    };
  }, []);

  const startPercent = timeToPercent(startTime);
  const endPercent = timeToPercent(endTime);
  const anchorPercent = timeToPercent(anchor);
  const clipDuration = endTime - startTime;

  // Tick marks for the timeline (every 5 seconds)
  const ticks = [];
  const tickInterval = 5;
  const firstTick = Math.ceil(windowStart / tickInterval) * tickInterval;
  for (let t = firstTick; t <= windowEnd; t += tickInterval) {
    ticks.push(t);
  }

  return (
    <div className="mb-4">
      {/* Time display */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-400">
          <span className="font-mono text-white">{formatTime(startTime)}</span>
          {' '}&rarr;{' '}
          <span className="font-mono text-white">{formatTime(endTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-gray-400">{clipDuration.toFixed(1)}s</span>
          <button
            onClick={handlePreviewPlay}
            className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
            title={isPreviewing ? 'Stop preview' : 'Preview clip'}
          >
            {isPreviewing ? (
              <Square size={16} className="text-red-400" />
            ) : (
              <Play size={16} className="text-green-400" />
            )}
          </button>
        </div>
      </div>

      {/* Timeline track */}
      <div
        ref={trackRef}
        className="relative h-10 bg-gray-800 rounded-lg select-none touch-none"
        style={{ cursor: dragging ? 'col-resize' : 'default' }}
      >
        {/* Tick marks */}
        {ticks.map((t) => {
          const pct = timeToPercent(t);
          return (
            <div
              key={t}
              className="absolute top-0 h-full flex flex-col items-center pointer-events-none"
              style={{ left: `${pct}%` }}
            >
              <div className="w-px h-2 bg-gray-600" />
              <span className="text-[9px] text-gray-600 mt-0.5 font-mono">
                {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}
              </span>
            </div>
          );
        })}

        {/* Selected region highlight */}
        <div
          className="absolute top-0 h-full bg-green-500/20 border-y border-green-500/30"
          style={{
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`,
          }}
        />

        {/* Anchor line (the "Add Clip" point) */}
        <div
          className="absolute top-0 h-full w-px bg-yellow-500/50 pointer-events-none"
          style={{ left: `${anchorPercent}%` }}
        />

        {/* Preview playhead */}
        {previewTime !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white pointer-events-none z-10"
            style={{ left: `${timeToPercent(previewTime)}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full" />
          </div>
        )}

        {/* Start handle */}
        <div
          className="absolute top-0 h-full flex items-center"
          style={{ left: `${startPercent}%`, transform: 'translateX(-50%)' }}
        >
          <div
            onPointerDown={(e) => handlePointerDown('start', e)}
            className={`w-3 h-full rounded-l cursor-col-resize
              ${dragging === 'start' ? 'bg-green-400' : 'bg-green-500 hover:bg-green-400'}
              transition-colors`}
            style={{ minWidth: '12px', touchAction: 'none' }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-0.5 h-4 bg-green-900/50 rounded" />
            </div>
          </div>
        </div>

        {/* End handle */}
        <div
          className="absolute top-0 h-full flex items-center"
          style={{ left: `${endPercent}%`, transform: 'translateX(-50%)' }}
        >
          <div
            onPointerDown={(e) => handlePointerDown('end', e)}
            className={`w-3 h-full rounded-r cursor-col-resize
              ${dragging === 'end' ? 'bg-green-400' : 'bg-green-500 hover:bg-green-400'}
              transition-colors`}
            style={{ minWidth: '12px', touchAction: 'none' }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-0.5 h-4 bg-green-900/50 rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* Window range label */}
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-500 font-mono">{formatTime(windowStart)}</span>
        <span className="text-[10px] text-gray-500 font-mono">{formatTime(windowEnd)}</span>
      </div>
    </div>
  );
}

export default ClipScrubRegion;
