import React from 'react';
import { Undo2 } from 'lucide-react';
import { formatTimeSimple } from '../../utils/timeFormat';

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
}) {
  const timelineRef = React.useRef(null);
  const scrollContainerRef = React.useRef(null);
  const layersContainerRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [hoverX, setHoverX] = React.useState(0);

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
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
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
    }
  };

  // Convert current source time to visual time for correct playhead positioning
  const visualCurrentTime = sourceTimeToVisualTime(currentTime);

  // Calculate progress using visual time and visual duration
  const effectiveDuration = visualDuration || duration;
  const progress = effectiveDuration > 0 ? (visualCurrentTime / effectiveDuration) * 100 : 0;

  // Auto-scroll to keep playhead visible when zoomed
  React.useEffect(() => {
    if (!scrollContainerRef.current || timelineScale <= 1) return;

    const container = scrollContainerRef.current;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 0) return;

    // Calculate where the playhead is in the scrollable content
    const playheadPercent = progress / 100;
    const idealScrollPercent = playheadPercent * 100;

    // Only auto-scroll if the playhead is out of view
    const currentScrollPercent = (container.scrollLeft / maxScroll) * 100;
    const viewportWidthPercent = (container.clientWidth / container.scrollWidth) * 100;
    const leftEdge = currentScrollPercent;
    const rightEdge = currentScrollPercent + viewportWidthPercent;

    // Check if playhead is outside the current view (with some padding)
    const playheadPosition = idealScrollPercent;
    if (playheadPosition < leftEdge + 5 || playheadPosition > rightEdge - 5) {
      // Center the playhead in view
      const targetScroll = Math.max(0, Math.min(100, idealScrollPercent - viewportWidthPercent / 2));
      container.scrollLeft = (targetScroll / 100) * maxScroll;
    }
  }, [progress, timelineScale]);

  // Use visual duration for display (if segments exist), otherwise use source duration
  const displayDuration = visualDuration || duration;

  return (
    <div className="timeline-container py-4">
      {/* Time labels - shows visual duration (after speed/trim adjustments) */}
      <div className="flex justify-between mb-2 text-xs text-gray-400 pl-32">
        <span>{formatTimeSimple(visualCurrentTime)}</span>
        <div className="flex items-center gap-2">
          {timelineZoom > 100 && (
            <span className="text-blue-400">Zoom: {Math.round(timelineZoom)}%</span>
          )}
          <span title={visualDuration !== duration ? `Source: ${formatTimeSimple(duration)}` : undefined}>
            {formatTimeSimple(displayDuration)}
          </span>
        </div>
      </div>

      {/* Timeline with fixed labels and scrollable tracks */}
      <div className="relative">
        {/* Fixed layer labels on the left - provided by mode */}
        <div className="absolute left-0 top-0 w-32 z-10">
          {layerLabels}
        </div>

        {/* Scrollable timeline tracks container */}
        <div
          ref={scrollContainerRef}
          className="ml-32 overflow-x-auto"
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
              <div className={`relative bg-gray-800 h-12 rounded-r-lg transition-all ${
                selectedLayer === 'playhead' ? 'ring-2 ring-blue-400 ring-opacity-75' : ''
              }`}>
                {/* Timeline track */}
                <div
                  ref={timelineRef}
                  className="absolute inset-0 bg-gray-700 rounded-r-lg cursor-pointer select-none"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Progress bar - accounts for edge padding */}
                  <div
                    className="absolute top-0 h-full bg-blue-600 rounded-r-lg transition-all pointer-events-none"
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

      {/* Zoom hint when playhead layer is selected */}
      {selectedLayer === 'playhead' && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          Scroll to zoom timeline (current: {Math.round(timelineZoom)}%)
        </div>
      )}
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
