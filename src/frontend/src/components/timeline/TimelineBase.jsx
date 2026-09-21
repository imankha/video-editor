import React, { useCallback } from 'react';
import { Undo2 } from 'lucide-react';
import { formatTimeSimple } from '../../utils/timeFormat';

/**
 * Pixel-based follow-playhead target: where the scroll container should sit so the
 * playhead stays within a 15%-of-viewport margin of either edge. Operates entirely in
 * pixels (unlike percent-of-content vs percent-of-maxScroll, which diverge once
 * timelineScale != 1 and let the playhead drift off-screen at zoom).
 *
 * `anchor` (T10780) controls the FORWARD crossing only:
 *  - 'margin' (default, Focus/Overlay): nudge just far enough to sit inside the
 *    right 15% margin — the playhead rides the right edge with little lookahead.
 *  - 'page-forward' (mobile Annotate): re-anchor the playhead ~1/3 in from the
 *    left, so upcoming plays stay visible ahead of it (page-forward with lookahead).
 * The BACKWARD crossing is anchor-independent (always the left margin), so a
 * reverse seek behaves identically in every mode.
 */
export function computeFollowScrollTarget({ scrollLeft, scrollWidth, clientWidth, maxScroll, progress, edgePadding, anchor = 'margin' }) {
  const playheadPx = edgePadding + (scrollWidth - 2 * edgePadding) * (progress / 100);
  const margin = clientWidth * 0.15;
  let target = scrollLeft;
  if (playheadPx < scrollLeft + margin) {
    target = playheadPx - margin;
  } else if (playheadPx > scrollLeft + clientWidth - margin) {
    target = anchor === 'page-forward'
      ? playheadPx - clientWidth / 3
      : playheadPx - clientWidth + margin;
  }
  return Math.max(0, Math.min(target, maxScroll));
}

/**
 * Shared timeline foundation used by both Framing and Overlay modes.
 * Handles: playhead, scrubbing, time display, zoom, scroll sync.
 * Does NOT handle: mode-specific layers (passed as children).
 *
 * @param {Object} props
 * @param {number} props.currentTime - Current video time (source time)
 * @param {number} props.duration - Total source video duration
 * @param {number} props.visualDuration - Effective duration after speed/trim changes
 * @param {Function} props.onSeek - Callback when user seeks (receives source time)
 * @param {Function} props.sourceTimeToVisualTime - Convert source time to visual time
 * @param {Function} props.visualTimeToSourceTime - Convert visual time to source time
 * @param {number} props.timelineZoom - Current timeline zoom level (10-100%)
 * @param {Function} props.onTimelineZoomByWheel - Callback when zoom changes via mousewheel
 * @param {number} props.timelineScale - Scale factor for timeline width (1-5x)
 * @param {number} props.timelineScrollPosition - Current scroll position (0-100%)
 * @param {Function} props.onTimelineScrollPositionChange - Callback when scroll position changes
 * @param {string} props.selectedLayer - Currently selected layer for zoom behavior
 * @param {Function} props.onLayerSelect - Callback when layer is selected
 * @param {React.ReactNode} props.layerLabels - Mode-specific layer labels (rendered in fixed left column)
 * @param {React.ReactNode} props.children - Mode-specific timeline layers
 * @param {number} props.totalLayerHeight - Total height of all layers for playhead line
 * @param {Object|null} props.trimRange - Current trim range {start, end} or null
 * @param {Function} props.onDetrimStart - Callback to undo last start trim
 * @param {Function} props.onDetrimEnd - Callback to undo last end trim
 */
export function TimelineBase({
  currentTime,
  duration,
  visualDuration,
  onSeek,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  timelineZoom = 100,
  onTimelineZoomByWheel,
  timelineScale = 1,
  timelineScrollPosition = 0,
  onTimelineScrollPositionChange,
  selectedLayer = 'playhead',
  onLayerSelect,
  layerLabels,
  children,
  totalLayerHeight = '9.5rem',
  trimRange = null,
  onDetrimStart,
  onDetrimEnd,
  isPlaying = false, // Only auto-scroll when video is playing
  // T10780: show the "Zoom: N%" badge (Focus/Overlay, where zoom is a user
  // state). Annotate passes false: its scale is a fixed mobile constant, not a
  // state the user changed, so the badge would be misleading.
  showZoomBadge = true,
  // T10780: follow-scroll anchor. 'margin' (default) = Focus/Overlay right-edge
  // nudge. 'page-forward' = mobile Annotate — re-anchor the playhead ~1/3 in on a
  // forward crossing AND scroll a non-playback/mount off-screen playhead into view.
  followAnchor = 'margin',
}) {
  const pageForward = followAnchor === 'page-forward';
  const timelineRef = React.useRef(null);
  const scrollContainerRef = React.useRef(null);
  const layersContainerRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [hoverX, setHoverX] = React.useState(0);
  // Track when user manually scrolls to disable auto-scroll temporarily
  const userScrolledRef = React.useRef(false);
  const userScrollTimeoutRef = React.useRef(null);
  // Track previous isPlaying state to detect playback start
  const wasPlayingRef = React.useRef(false);
  // Track the progress when playback started to avoid immediate scroll on play
  const playbackStartProgressRef = React.useRef(null);
  // Set immediately before the auto-scroll effect writes scrollLeft itself, so
  // handleScroll can tell "our own programmatic scroll" apart from a real user
  // scroll and skip arming the manual-scroll pause for it. lastAutoScrollValueRef
  // guards a coalescing race: if a user scroll lands in the same browser task as
  // our write (before its 'scroll' event has fired), only ONE scroll event is
  // dispatched, reporting whichever scrollLeft is current - which may be the
  // user's, not ours. Comparing against the value we actually set catches that.
  const isAutoScrollingRef = React.useRef(false);
  const lastAutoScrollValueRef = React.useRef(null);

  // Padding at timeline edges for easier keyframe selection (in pixels)
  const EDGE_PADDING = 20;

  const getTimeFromPosition = (clientX) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();

    // Account for edge padding - usable area starts at EDGE_PADDING and ends at width - EDGE_PADDING
    const usableWidth = rect.width - (EDGE_PADDING * 2);
    const x = clientX - rect.left - EDGE_PADDING;

    // Clamp x to usable area and convert to percentage
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentage = clampedX / usableWidth;

    // Calculate visual time from position (timeline displays visual duration)
    const effectiveDuration = visualDuration || duration;
    const visualTime = percentage * effectiveDuration;

    // Convert visual time to source time for seeking
    const sourceTime = visualTimeToSourceTime(visualTime);

    return Math.max(0, Math.min(sourceTime, duration));
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    const time = getTimeFromPosition(e.clientX);
    onSeek(time);
    // Select playhead layer when clicking on video timeline
    if (onLayerSelect) {
      onLayerSelect('playhead');
    }
  };

  const handleTouchStart = (e) => {
    setIsDragging(true);
    const time = getTimeFromPosition(e.touches[0].clientX);
    onSeek(time);
    if (onLayerSelect) {
      onLayerSelect('playhead');
    }
  };

  const handleMouseMove = (e) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();

    // Account for edge padding - usable area starts at EDGE_PADDING
    const usableWidth = rect.width - (EDGE_PADDING * 2);
    const x = e.clientX - rect.left - EDGE_PADDING;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentage = clampedX / usableWidth;

    // Calculate visual time for display
    const effectiveDuration = visualDuration || duration;
    const visualTime = percentage * effectiveDuration;

    // Store hover position relative to padded area (add padding back for tooltip positioning)
    setHoverX(clampedX + EDGE_PADDING);
    setHoverTime(visualTime); // Store visual time for display

    if (isDragging) {
      // Get source time for seeking
      const sourceTime = getTimeFromPosition(e.clientX);
      onSeek(sourceTime);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      const handleTouchMove = (e) => {
        e.preventDefault();
        const time = getTimeFromPosition(e.touches[0].clientX);
        onSeek(time);
      };
      const handleTouchEnd = () => setIsDragging(false);

      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      return () => {
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging]);

  // Handle mousewheel zoom when playhead layer is selected
  React.useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleWheel = (e) => {
      // Only zoom when playhead layer is selected
      if (selectedLayer !== 'playhead') return;

      // Prevent default scroll behavior
      e.preventDefault();
      e.stopPropagation();

      // Call zoom handler
      if (onTimelineZoomByWheel) {
        onTimelineZoomByWheel(e.deltaY);
      }
    };

    scrollContainer.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollContainer.removeEventListener('wheel', handleWheel);
  }, [selectedLayer, onTimelineZoomByWheel]);

  // Sync scroll position when scrolling the container
  const handleScroll = (e) => {
    if (!onTimelineScrollPositionChange) return;
    const container = e.target;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll > 0) {
      const scrollPercent = (container.scrollLeft / maxScroll) * 100;
      onTimelineScrollPositionChange(scrollPercent);

      if (isAutoScrollingRef.current) {
        isAutoScrollingRef.current = false;
        // Only treat this as "our own" scroll if scrollLeft still matches what
        // we set - otherwise a user scroll coalesced into the same dispatched
        // event and must still arm the manual-scroll pause below.
        if (Math.abs(container.scrollLeft - lastAutoScrollValueRef.current) < 1) {
          return;
        }
      }

      // Mark that user manually scrolled - disable auto-scroll for 2 seconds
      userScrolledRef.current = true;
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      userScrollTimeoutRef.current = setTimeout(() => {
        userScrolledRef.current = false;
      }, 2000);
    }
  };

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, []);

  // Convert current source time to visual time for correct playhead positioning
  const visualCurrentTime = sourceTimeToVisualTime(currentTime);

  // Calculate progress using visual time and visual duration
  const effectiveDuration = visualDuration || duration;
  const progress = effectiveDuration > 0 ? (visualCurrentTime / effectiveDuration) * 100 : 0;

  // Auto-scroll to keep playhead visible when zoomed and playing
  // Only auto-scroll during playback - manual navigation shouldn't trigger auto-scroll
  React.useEffect(() => {
    // Detect playback start/stop transitions
    if (isPlaying && !wasPlayingRef.current) {
      // Playback just started - record the starting progress
      playbackStartProgressRef.current = progress;
    } else if (!isPlaying && wasPlayingRef.current) {
      // Playback just stopped - clear the start progress
      playbackStartProgressRef.current = null;
    }
    wasPlayingRef.current = isPlaying;

    if (!scrollContainerRef.current || timelineScale <= 1) return;
    // Only auto-scroll during playback
    if (!isPlaying) return;
    // Don't auto-scroll if user recently scrolled manually
    if (userScrolledRef.current) return;

    // Don't auto-scroll until playhead has moved at least 2% from where playback started
    // This prevents the scroll from "kicking back" immediately when user hits play
    if (playbackStartProgressRef.current !== null) {
      const progressSinceStart = Math.abs(progress - playbackStartProgressRef.current);
      if (progressSinceStart < 2) return;
    }

    const container = scrollContainerRef.current;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 0) return;

    const target = computeFollowScrollTarget({
      scrollLeft: container.scrollLeft,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      maxScroll,
      progress,
      edgePadding: EDGE_PADDING,
      anchor: followAnchor,
    });

    // Only touch scrollLeft (and thus fire a scroll event) when it actually
    // moves - an unconditional write here would mark every render as an
    // auto-scroll and could mask a genuine user scroll landing on the same tick.
    if (target !== container.scrollLeft) {
      isAutoScrollingRef.current = true;
      lastAutoScrollValueRef.current = target;
      container.scrollLeft = target;
    }
  }, [progress, timelineScale, isPlaying, followAnchor]);

  // Keep the playhead reachable outside of playback. Two behaviors share this
  // effect (it already watches `progress`, so no second scroll mechanism):
  //  - page-forward (mobile Annotate): ANY non-playback seek (tap a play,
  //    prev/next, open from list) OR the initial mount that lands the playhead
  //    outside the window scrolls it back into view. Playback is owned by the
  //    auto-scroll effect above, so we bow out while playing.
  //  - default (Focus/Overlay): unchanged legacy behavior — snap back to the
  //    start ONLY on the transition *to* the start (Restart/reset seeks to 0),
  //    keyed off the crossing (not idling there) so it doesn't fight a user who
  //    scrolled while parked at the beginning. Reset is an explicit gesture, so
  //    it overrides the recent-manual-scroll guard.
  const prevProgressRef = React.useRef(progress);
  React.useEffect(() => {
    const prevProgress = prevProgressRef.current;
    prevProgressRef.current = progress;
    const container = scrollContainerRef.current;
    if (!container || timelineScale <= 1) return;

    if (pageForward) {
      if (isPlaying) return; // playback follow is owned by the effect above
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) return;
      const target = computeFollowScrollTarget({
        scrollLeft: container.scrollLeft,
        scrollWidth: container.scrollWidth,
        clientWidth: container.clientWidth,
        maxScroll,
        progress,
        edgePadding: EDGE_PADDING,
        anchor: followAnchor,
      });
      if (target !== container.scrollLeft) {
        // Mark as programmatic so handleScroll doesn't arm the 2s manual-scroll
        // pause for our own write.
        isAutoScrollingRef.current = true;
        lastAutoScrollValueRef.current = target;
        container.scrollLeft = target;
      }
      return;
    }

    if (progress < 0.5 && prevProgress >= 0.5) {
      container.scrollLeft = 0;
    }
  }, [progress, timelineScale, pageForward, isPlaying, followAnchor]);

  return (
    <div className="timeline-container py-0.5 lg:py-4">
      {/* Zoom indicator (timestamps removed - redundant with player timecode).
          T10780: suppressed on mobile Annotate (showZoomBadge=false) where the
          scale is a fixed constant, not a user-changed state. */}
      {showZoomBadge && timelineZoom > 100 && (
        <div className="flex justify-end mb-0.5 lg:mb-2 text-xs text-gray-400 pr-2">
          <span className="text-blue-400">Zoom: {Math.round(timelineZoom)}%</span>
        </div>
      )}

      {/* Timeline with fixed labels and scrollable tracks */}
      <div className="relative">
        {/* Fixed layer labels on the left - provided by mode */}
        <div className="absolute left-0 top-0 w-20 lg:w-32 z-10">
          {layerLabels}
        </div>

        {/* Scrollable timeline tracks container */}
        <div
          ref={scrollContainerRef}
          className="ml-20 lg:ml-32 overflow-x-auto timeline-scroll-container"
          onScroll={handleScroll}
          style={{
            scrollbarWidth: timelineScale > 1 ? 'auto' : 'none',
          }}
        >
          {/* Scaled timeline content */}
          <div
            style={{
              width: timelineScale > 1 ? `${timelineScale * 100}%` : '100%',
              minWidth: '100%',
            }}
          >
            {/* Timeline layers container with unified playhead */}
            <div className="relative" ref={layersContainerRef}>
              {/* Video Timeline Track */}
              <div className={`relative bg-gray-800 h-8 lg:h-12 rounded-r-lg transition-all ${
                selectedLayer === 'playhead' ? 'ring-2 ring-blue-400 ring-opacity-75' : ''
              }`}>
                {/* Timeline track */}
                <div
                  ref={timelineRef}
                  className="absolute inset-0 bg-gray-700 rounded-r-lg cursor-pointer select-none touch-none"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={handleTouchStart}
                >
                  {/* Progress bar - accounts for edge padding */}
                  <div
                    className="absolute top-0 h-full bg-blue-600 rounded-r-lg pointer-events-none"
                    style={{
                      left: `${EDGE_PADDING}px`,
                      width: `calc((100% - ${EDGE_PADDING * 2}px) * ${progress / 100})`
                    }}
                  />

                  {/* Hover tooltip */}
                  {hoverTime !== null && !isDragging && (
                    <div
                      className="absolute -top-8 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none"
                      style={{ left: `${hoverX}px` }}
                    >
                      {formatTimeSimple(hoverTime)}
                    </div>
                  )}
                </div>
              </div>

              {/* Unified Playhead - extends through all layers */}
              <div
                data-testid="timeline-playhead"
                className="absolute top-0 w-1 bg-white shadow-lg pointer-events-none"
                style={{
                  left: `calc(${EDGE_PADDING}px + (100% - ${EDGE_PADDING * 2}px) * ${progress / 100})`,
                  height: `calc(${totalLayerHeight} - 0.25rem)`
                }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full" />
              </div>

              {/* Start Trim Undo Indicator - centered in left padding area */}
              {trimRange && trimRange.start > 0 && onDetrimStart && (
                <TrimUndoButton
                  position="start"
                  trimAmount={trimRange.start}
                  totalLayerHeight={totalLayerHeight}
                  edgePadding={EDGE_PADDING}
                  onClick={onDetrimStart}
                />
              )}

              {/* End Trim Undo Indicator - centered in right padding area */}
              {trimRange && trimRange.end < duration && onDetrimEnd && (
                <TrimUndoButton
                  position="end"
                  trimAmount={duration - trimRange.end}
                  totalLayerHeight={totalLayerHeight}
                  edgePadding={EDGE_PADDING}
                  onClick={onDetrimEnd}
                />
              )}

              {/* Mode-specific layers (passed as children) */}
              {children}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile-friendly scrollbar - shown only on small screens when zoomed */}
      {timelineScale > 1 && (
        <MobileScrollbar scrollContainerRef={scrollContainerRef} timelineScale={timelineScale} />
      )}

      {/* Zoom hint when playhead layer is selected — only when the mode actually
          wired the wheel handler (T10370: Annotate never does, so this always read
          a dead, misleading "100%" there). */}
      {selectedLayer === 'playhead' && onTimelineZoomByWheel && (
        <div className="hidden lg:block mt-1 text-xs text-gray-500 text-center">
          Scroll to zoom timeline (current: {Math.round(timelineZoom)}%)
        </div>
      )}
    </div>
  );
}

/**
 * MobileScrollbar - Touch-friendly scrollbar for zoomed timelines (T10780).
 * Hidden on lg+ screens where the native scrollbar + a fine pointer are usable.
 *
 * A REAL finger control (user ruling 2026-09-20): the whole row is a >= 44px hit
 * area (`min-h-[44px]` + `py-1`) drawn as a 36px pill, with a >= 56px thumb that
 * carries a 3-line grip. `mt-2` puts 8px of air above (from the plays track) and
 * `mb-3` 12px below (before the Edit-play strip). The row is offset `ml-20
 * lg:ml-32` so it lines up edge-to-edge with the plays track, never the label
 * column.
 */
function MobileScrollbar({ scrollContainerRef, timelineScale }) {
  const trackRef = React.useRef(null);
  const thumbRef = React.useRef(null);
  const thumbWidthPercent = Math.max(20, (1 / timelineScale) * 100);
  const [thumbLeftPx, setThumbLeftPx] = React.useState(0);

  // Sync thumb position from native scroll. Travel is measured in PIXELS against
  // the thumb's ACTUAL rendered width (which honors min-w-[56px]); using the
  // percent width here would overshoot the rail at wide zooms where
  // 100/scale% renders narrower than the 56px floor.
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;
    const sync = () => {
      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) { setThumbLeftPx(0); return; }
      const scrollFraction = container.scrollLeft / maxScroll;
      const railWidth = track.clientWidth;
      const thumbWidth = thumbRef.current
        ? thumbRef.current.offsetWidth
        : (railWidth * thumbWidthPercent) / 100;
      const maxThumbLeft = Math.max(0, railWidth - thumbWidth);
      setThumbLeftPx(scrollFraction * maxThumbLeft);
    };
    container.addEventListener('scroll', sync);
    sync();
    return () => container.removeEventListener('scroll', sync);
  }, [scrollContainerRef, thumbWidthPercent]);

  const handleDrag = useCallback((clientX) => {
    const track = trackRef.current;
    const container = scrollContainerRef.current;
    if (!track || !container) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const maxScroll = container.scrollWidth - container.clientWidth;
    container.scrollLeft = fraction * maxScroll;
  }, [scrollContainerRef]);

  const handleTouchStart = useCallback((e) => {
    handleDrag(e.touches[0].clientX);
    const onMove = (ev) => { ev.preventDefault(); handleDrag(ev.touches[0].clientX); };
    const onEnd = () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, [handleDrag]);

  return (
    <div
      ref={trackRef}
      data-testid="mobile-scrollbar-track"
      className="lg:hidden ml-20 lg:ml-32 mt-2 mb-3 py-1 min-h-[44px] flex items-center relative touch-none"
      onTouchStart={handleTouchStart}
      onClick={(e) => { handleDrag(e.clientX); }}
    >
      {/* 36px visual rail pill */}
      <div className="relative w-full h-9 bg-gray-800 rounded-full">
        <div
          ref={thumbRef}
          data-testid="mobile-scrollbar-thumb"
          className="absolute top-1 bottom-1 min-w-[56px] bg-gray-500 rounded-full active:bg-gray-400 flex items-center justify-center gap-0.5"
          style={{ left: `${thumbLeftPx}px`, width: `${thumbWidthPercent}%` }}
        >
          {/* 3-line grip glyph */}
          <span className="w-0.5 h-3 rounded-full bg-gray-300/80" />
          <span className="w-0.5 h-3 rounded-full bg-gray-300/80" />
          <span className="w-0.5 h-3 rounded-full bg-gray-300/80" />
        </div>
      </div>
    </div>
  );
}

/**
 * Trim undo button component - used for start/end trim indicators
 */
function TrimUndoButton({ position, trimAmount, totalLayerHeight, edgePadding, onClick }) {
  const isStart = position === 'start';
  const style = {
    width: '16px',
    height: `calc(${totalLayerHeight} - 0.25rem)`,
    ...(isStart
      ? { left: `${edgePadding / 2}px`, transform: 'translateX(-50%)' }
      : { right: `${edgePadding / 2}px`, transform: 'translateX(50%)' }
    ),
  };

  return (
    <button
      className="absolute top-0 flex items-center justify-center bg-gray-600 hover:bg-blue-600 rounded transition-colors cursor-pointer z-40"
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`Undo ${position} trim (${trimAmount.toFixed(1)}s trimmed)`}
    >
      <Undo2 size={10} className={`text-white ${isStart ? '' : 'rotate-180'}`} />
    </button>
  );
}

// Export constants for use by layer components
export const EDGE_PADDING = 20;
export const PLAYHEAD_WIDTH_PX = 4; // Corresponds to Tailwind w-1 class
