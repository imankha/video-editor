import React, { useState, useRef, useCallback, useEffect } from 'react';

const WINDOW_BEFORE = 30; // seconds before anchor
const WINDOW_AFTER = 30;  // seconds after anchor
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
 * Replaces the duration slider in the fullscreen overlay. Shows a window around
 * the clip point with draggable start/end handles. Dragging a handle seeks the
 * video to that frame for real-time visual feedback.
 *
 * T8760: the single playback control while editing is the MAIN transport bar
 * (play/pause + spacebar). This component no longer renders its own Preview
 * button — instead, while a clip is open for EDITING, the playhead-follow loop
 * below constrains playback to the clip's [start, end] region and loops back to
 * the start when it runs past the end. That looping is scoped structurally to
 * this component being mounted (it is only mounted while the clip editor is
 * open), so normal game scrubbing/playback outside clip-edit mode is never
 * affected. All the clip-scoped behaviors here are gated on `existingClip`
 * (edit mode); create mode (placing a NEW play) keeps the wide game-context
 * window and unconstrained playback.
 *
 * @param {number} currentTime - The "Add Clip" point (playhead time when paused)
 * @param {number} videoDuration - Total video duration in seconds
 * @param {Object|null} existingClip - Existing clip for edit mode (has startTime, endTime)
 * @param {number} startTime - Current start handle position
 * @param {number} endTime - Current end handle position
 * @param {Function} onStartTimeChange - Called when start handle moves
 * @param {Function} onEndTimeChange - Called when end handle moves
 * @param {Function} onSeek - Called with time in seconds to seek the video
 * @param {Object} videoController - Video controller for play/pause/seek
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
  videoController,
  compact,
  // T8760: true ONLY for the primary clip editor (the Add/Edit overlay + strip),
  // false for the clips-sidebar ClipDetailsEditor's scrub region. Gates ALL the
  // clip-scoped edit behaviors — looping playback, seed-to-clip-start, and the
  // zoom-to-green-region timeline — so they fire exactly where the transport
  // readout also goes clip-relative (showAnnotateOverlay), and never leak into
  // the merely-SELECTED sidebar state (where playback stays whole-game).
  clipEditorActive = false,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'start' | 'end' | null
  // T8720: the playhead marker mirrors the video's ACTUAL current time, so it
  // is always visible (even when stopped) and tracks playback identically no
  // matter how it was started — the transport play/pause button or the spacebar.
  // Seeded from the controller; a RAF (below) keeps it in sync.
  const [playheadTime, setPlayheadTime] = useState(() => {
    const t = videoController?.getCurrentTime?.();
    return Number.isFinite(t) ? t : (currentTime ?? null);
  });

  // "Editing" — for the clip-scoped zoom/loop/seed — means the PRIMARY editor is
  // open on an existing clip. The sidebar's scrub region (clipEditorActive false)
  // keeps the wide game-context window and unconstrained playback.
  const isEditing = clipEditorActive && !!existingClip;

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
  // T8760 item 8: while EDITING, zoom the timeline to (roughly) the clip's own
  // green region — dropping the ±30s game-context window and its 5-second
  // game-clock ticks the user asked to remove. A margin (half the clip length,
  // min 2s) on each side keeps room for the start/end handles to still extend
  // the clip. Create mode keeps the wide ±30s window for game context.
  const editHalfWindow = isEditing
    ? Math.abs(existingClip.endTime - existingClip.startTime) * 0.5
      + Math.max(2, Math.abs(existingClip.endTime - existingClip.startTime) * 0.5)
    : 0;
  const windowStart = Math.max(0, anchor - (isEditing ? editHalfWindow : WINDOW_BEFORE));
  const windowEnd = Math.min(videoDuration, anchor + (isEditing ? editHalfWindow : WINDOW_AFTER));
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

  // T8760: whether a clip is being EDITED (gates the clip-scoped loop below).
  // Read from a ref so the always-running follow RAF sees the live value
  // without being re-created each render.
  const isEditingRef = useRef(isEditing);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

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
    if (videoController && !videoController.isPaused()) {
      videoController.pause();
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
  }, [pixelToTime, videoController]);

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

  // T8720 + T8760: keep the playhead marker locked to the video's real current
  // time, AND (edit mode only) enforce clip-scoped looping. A single RAF runs
  // the whole time the editor is open: it reads the controller each frame,
  // updates the marker only when the time changes (a paused video costs no
  // re-renders), and — while EDITING and PLAYING — seeks back to the clip start
  // the instant playback runs past the clip end. The loop lives here, gated on
  // this mounted component, so it can never leak into normal game playback.
  useEffect(() => {
    if (typeof videoController?.getCurrentTime !== 'function') return undefined;
    let raf = null;
    let last = null;
    const follow = () => {
      const t = videoController.getCurrentTime();
      if (t !== last) {
        last = t;
        setPlayheadTime(t);
      }
      // T8760 item 6: clip-scoped looping playback (edit mode only).
      if (isEditingRef.current
          && typeof videoController.isPaused === 'function'
          && !videoController.isPaused()) {
        const s = startTimeRef.current;
        const e = endTimeRef.current;
        if (Number.isFinite(s) && Number.isFinite(e) && e > s && t >= e) {
          videoController.seek(s);
        }
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [videoController]);

  // T8760 item 7: on opening a clip for EDITING, default the playhead to the
  // clip's start — not wherever the game video happened to be positioned. Once
  // per clip id (the id is stable during scrub), so dragging a handle never
  // yanks the playhead back to the start.
  const seededClipRef = useRef(null);
  useEffect(() => {
    if (!clipEditorActive || !existingClip || typeof videoController?.seek !== 'function') return;
    if (seededClipRef.current === existingClip.id) return;
    seededClipRef.current = existingClip.id;
    videoController.seek(existingClip.startTime);
    setPlayheadTime(existingClip.startTime);
  }, [existingClip, videoController, clipEditorActive]);

  const startPercent = timeToPercent(startTime);
  const endPercent = timeToPercent(endTime);
  const anchorPercent = timeToPercent(anchor);
  const clipDuration = endTime - startTime;

  // Playhead marker: shown whenever the real playhead is within the visible
  // window (always the case while editing this clip), regardless of play state.
  const playheadVisible =
    Number.isFinite(playheadTime) &&
    playheadTime >= windowStart &&
    playheadTime <= windowEnd;
  const playheadPercent = playheadVisible ? timeToPercent(playheadTime) : 0;

  // Tick marks for the timeline (every 5 seconds) — game-context only, so they
  // are suppressed while editing (item 8: only the green area is shown).
  const ticks = [];
  const tickInterval = 5;
  const firstTick = Math.ceil(windowStart / tickInterval) * tickInterval;
  for (let t = firstTick; t <= windowEnd; t += tickInterval) {
    ticks.push(t);
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="text-xs font-mono whitespace-nowrap">
          <span className="text-white">{formatTime(startTime)}</span>
          <span className="text-gray-500 mx-0.5">-</span>
          <span className="text-white">{formatTime(endTime)}</span>
        </div>
        <div
          ref={trackRef}
          className="relative flex-1 h-8 bg-gray-800 rounded-lg select-none touch-none"
          style={{ cursor: dragging ? 'col-resize' : 'default' }}
        >
          <div
            className="absolute top-0 h-full bg-green-500/20 border-y border-green-500/30"
            style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-yellow-500/50 pointer-events-none"
            style={{ left: `${anchorPercent}%` }}
          />
          {playheadVisible && (
            <div
              data-testid="scrub-playhead"
              data-playhead-time={playheadTime}
              className="absolute top-0 h-full w-0.5 bg-white pointer-events-none z-10"
              style={{ left: `${playheadPercent}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full" />
            </div>
          )}
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
        <span className="text-xs font-mono text-gray-400 whitespace-nowrap">{clipDuration.toFixed(1)}s</span>
      </div>
    );
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
        <span className="text-sm font-mono text-gray-400">{clipDuration.toFixed(1)}s</span>
      </div>

      {/* Timeline track */}
      <div
        ref={trackRef}
        className="relative h-10 bg-gray-800 rounded-lg select-none touch-none"
        style={{ cursor: dragging ? 'col-resize' : 'default' }}
      >
        {/* Tick marks — clipped to the track. Game-context only; suppressed
            while editing so only the clip's own green region is shown (T8760
            item 8). The clip layer wraps ONLY the ticks, so the drag handles /
            region / playhead (siblings below) keep their edge overhang. */}
        {!isEditing && (
          <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
            {ticks.map((t) => {
              const pct = timeToPercent(t);
              return (
                <div
                  key={t}
                  className="absolute top-0 h-full flex flex-col items-center"
                  style={{ left: `${pct}%` }}
                >
                  <div className="w-px h-2 bg-gray-600" />
                  <span className="text-[9px] text-gray-600 mt-0.5 font-mono">
                    {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}
                  </span>
                </div>
              );
            })}
          </div>
        )}

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

        {/* Playhead (always visible while editing; tracks the real video time) */}
        {playheadVisible && (
          <div
            data-testid="scrub-playhead"
            data-playhead-time={playheadTime}
            className="absolute top-0 h-full w-0.5 bg-white pointer-events-none z-10"
            style={{ left: `${playheadPercent}%` }}
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

      {/* Window range label — game-context only, hidden while editing (item 8) */}
      {!isEditing && (
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-500 font-mono">{formatTime(windowStart)}</span>
          <span className="text-[10px] text-gray-500 font-mono">{formatTime(windowEnd)}</span>
        </div>
      )}
    </div>
  );
}

export default ClipScrubRegion;
