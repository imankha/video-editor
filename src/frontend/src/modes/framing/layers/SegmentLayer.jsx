import { Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

/**
 * SegmentLayer component - displays video segments with speed control and trimming
 * Shows vertical lines for segment boundaries and allows speed adjustments
 */
export default function SegmentLayer({
  segments,
  boundaries,
  duration,
  visualDuration,
  currentTime,
  onAddBoundary,
  onRemoveBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  trimRange = null,  // NEW: Current trim range {start, end} or null
  trimHistory = [],  // NEW: Trim history for showing de-trim button state
  onDetrimStart,  // NEW: Callback to de-trim from start
  onDetrimEnd,  // NEW: Callback to de-trim from end
  isActive,
  segmentVisualLayout = [], // Pre-calculated visual positions from hook
  sourceTimeToVisualTime = (t) => t, // Convert source time to visual time
  visualTimeToSourceTime = (t) => t,  // Convert visual time to source time
  timelineScale = 1,
  edgePadding = 20  // Matches TimelineBase EDGE_PADDING
}) {
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState(null);
  const segmentTrackRef = useRef(null);

  // Debug: measure container width
  useEffect(() => {
    if (segmentTrackRef.current) {
      const rect = segmentTrackRef.current.getBoundingClientRect();
      console.log('[SegmentLayer] Container width:', rect.width, 'px');
    }
  }, [boundaries]);

  if (!duration) return null;

  /**
   * Convert source time to visual pixel position on timeline
   */
  const sourceTimeToPixel = (sourceTime) => {
    const effectiveDuration = visualDuration || duration;
    if (!effectiveDuration) return 0;

    // Convert source time to visual time, then to pixel percentage
    const visualTime = sourceTimeToVisualTime(sourceTime);
    return (visualTime / effectiveDuration) * 100;
  };

  /**
   * Convert pixel position to source time (for adding boundaries)
   */
  const pixelToTime = (pixelPercent) => {
    const effectiveDuration = visualDuration || duration;
    // Convert pixel to visual time
    const visualTime = (pixelPercent / 100) * effectiveDuration;
    // Convert visual time back to source time
    return visualTimeToSourceTime(visualTime);
  };

  /**
   * Handle click to add boundary
   * Accounts for edge padding and snaps to playhead if click is near it
   */
  const handleTrackClick = (e) => {
    // Don't add boundary if clicking on a button
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

    // Calculate position from currentTarget (the track container)
    const rect = e.currentTarget.getBoundingClientRect();

    // Account for edge padding - usable area starts at edgePadding and ends at width - edgePadding
    const usableWidth = rect.width - (edgePadding * 2);
    const x = e.clientX - rect.left - edgePadding;

    // Clamp x to usable area and convert to percentage
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentX = (clampedX / usableWidth) * 100;
    const clickTime = pixelToTime(percentX);

    // Snap to playhead if click is near the playhead position
    // Use time-based comparison for robustness against scaling/transformation issues
    const effectiveDuration = visualDuration || duration;

    // Calculate snap threshold in time units (equivalent to ~15px at current scale)
    const pixelThreshold = 15;
    const timeThreshold = effectiveDuration > 0
      ? (pixelThreshold / usableWidth) * effectiveDuration
      : 0.1; // fallback to 100ms

    // Compare visual times for accurate snapping
    const clickVisualTime = (percentX / 100) * effectiveDuration;
    const playheadVisualTime = sourceTimeToVisualTime(currentTime);

    // If click is within threshold of playhead (in visual time), snap to exact currentTime
    const shouldSnap = Math.abs(clickVisualTime - playheadVisualTime) < timeThreshold;
    const time = shouldSnap ? currentTime : clickTime;

    // Debug: log snap decision
    const playheadX = (playheadVisualTime / effectiveDuration) * usableWidth;
    const distancePx = Math.abs(clampedX - playheadX);
    console.log(`[SegmentLayer] Boundary added:`, {
      distanceToPlayhead: `${distancePx.toFixed(1)}px`,
      snapped: shouldSnap,
      threshold: `${pixelThreshold}px (${timeThreshold.toFixed(3)}s)`,
      clickTime: clickTime.toFixed(3),
      currentTime: currentTime.toFixed(3),
      finalTime: time.toFixed(3)
    });

    onAddBoundary(time);
  };

  /**
   * Handle speed change for a segment
   */
  const handleSpeedChange = (segmentIndex, speed) => {
    onSegmentSpeedChange(segmentIndex, speed);
  };

  /**
   * Handle trim (toggle) for a segment
   */
  const handleTrim = (segmentIndex) => {
    onSegmentTrim(segmentIndex);
  };

  return (
    <div className="relative bg-gray-800/95 border-t border-gray-700/50 overflow-visible rounded-r-lg h-20 pb-2">
      {/* Segments track */}
      <div
        ref={segmentTrackRef}
        className="segment-track absolute inset-x-0 top-0 h-12 cursor-pointer overflow-visible rounded-r-lg"
        onClick={handleTrackClick}
      >
        {/* Background track */}
        <div
          className="absolute inset-0 bg-purple-900 bg-opacity-10 segment-bg rounded-r-lg"
        />

        {/* Placeholder text when no segments */}
        {segments.length === 1 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Split Segments to trim or control speed</span>
          </div>
        )}

        {/* Render active (non-trimmed) segments - using pre-calculated visual layout */}
        {segmentVisualLayout.map(({ segment, visualStartPercent, visualWidthPercent }) => (
          <div
            key={segment.index}
            className="absolute top-0"
            style={{
              // Account for edge padding - positions relative to the padded timeline area
              left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${visualStartPercent / 100})`,
              width: `calc((100% - ${edgePadding * 2}px) * ${visualWidthPercent / 100})`
            }}
          >
            {/* Segment background */}
            <div
              className={`h-12 transition-all ${hoveredSegmentIndex === segment.index ? 'bg-purple-500 bg-opacity-30' : ''}`}
              title={`Segment ${segment.index + 1}: ${segment.speed}x (${segment.actualDuration.toFixed(1)}s → ${segment.visualDuration.toFixed(1)}s)`}
            >
              {/* Speed indicator (show if speed != 1) */}
              {segment.speed !== 1 && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                  <div className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                    {segment.speed}x
                  </div>
                </div>
              )}
            </div>

            {/* Segment controls - always visible below the segment */}
            <div
              className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 flex gap-1 z-10"
              onMouseEnter={() => setHoveredSegmentIndex(segment.index)}
              onMouseLeave={() => setHoveredSegmentIndex(null)}
            >
              {/* Trash button (only for first or last segment, and only if there are at least 2 non-trimmed segments) */}
              {(segment.isFirst || segment.isLast) && segments.filter(s => !s.isTrimmed).length >= 2 && (
                <button
                  className="p-1.5 rounded transition-colors bg-red-600 hover:bg-red-700 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTrim(segment.index);
                  }}
                  title="Trim segment"
                >
                  <Trash2 size={12} />
                </button>
              )}

              {/* Speed buttons (only show speeds that aren't current) */}
              <>
                {segment.speed !== 0.5 && (
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSpeedChange(segment.index, 0.5);
                    }}
                    title="Set speed to 0.5x"
                  >
                    0.5x
                  </button>
                )}
                {segment.speed !== 1 && (
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSpeedChange(segment.index, 1);
                    }}
                    title="Set speed to 1x (normal)"
                  >
                    1x
                  </button>
                )}
              </>
            </div>
          </div>
        ))}

        {/* Render segment boundaries (vertical lines) */}
        {boundaries.map((time, index) => {
          const position = sourceTimeToPixel(time);
          const isStart = Math.abs(time) < 0.01;
          const isEnd = Math.abs(time - duration) < 0.01;
          const isAtCurrentTime = Math.abs(time - currentTime) < 0.01;

          // Debug: compare boundary position with playhead position
          if (isAtCurrentTime && !isStart && !isEnd) {
            const effectiveDuration = visualDuration || duration;
            const playheadVisualTime = sourceTimeToVisualTime(currentTime);
            const playheadPercent = effectiveDuration > 0 ? (playheadVisualTime / effectiveDuration) * 100 : 0;
            const boundaryVisualTime = sourceTimeToVisualTime(time);
            console.log(`[SegmentLayer] Boundary at currentTime render:`, {
              boundaryTime: time.toFixed(3),
              currentTime: currentTime.toFixed(3),
              boundaryPosition: `${position.toFixed(2)}%`,
              playheadPercent: `${playheadPercent.toFixed(2)}%`,
              boundaryVisualTime: boundaryVisualTime.toFixed(3),
              playheadVisualTime: playheadVisualTime.toFixed(3),
              effectiveDuration: effectiveDuration.toFixed(3),
              mismatch: Math.abs(position - playheadPercent) > 0.01 ? 'YES - MISALIGNED!' : 'no'
            });
          }

          // Debug logs (disabled - too spammy on every render)
          // console.log('[SegmentLayer] Rendering boundary:', time, 'isStart:', isStart, 'isEnd:', isEnd);

          // Don't show start and end boundaries
          if (isStart || isEnd) {
            // console.log('[SegmentLayer] Skipping start/end boundary at:', time);
            return null;
          }

          // console.log('[SegmentLayer] Drawing vertical line at:', position, '%');

          // Calculate pixel position to match playhead exactly
          // Formula: edgePadding + (containerWidth - 2*edgePadding) * (position/100)
          // But since we don't know exact container width in CSS, we use percentage of usable area
          // containerWidth = 100%, usableWidth = containerWidth - 2*edgePadding
          // leftPx = edgePadding + usableWidth * (position/100)
          // As percentage of full container: leftPx / containerWidth
          // = (edgePadding + (containerWidth - 2*edgePadding) * position/100) / containerWidth
          // = edgePadding/containerWidth + (1 - 2*edgePadding/containerWidth) * position/100
          //
          // Using segmentTrackRef to get actual width for precise positioning
          const containerWidth = segmentTrackRef.current?.getBoundingClientRect().width || 1325;
          const usableWidth = containerWidth - (edgePadding * 2);
          // Add 2px to align with playhead center (playhead has w-1 = 4px width, center is +2px from left edge)
          const leftPx = edgePadding + (usableWidth * position / 100) + 2;

          return (
            <div
              key={index}
              className="absolute top-0 h-full cursor-pointer group z-20"
              style={{
                // Use calculated pixel position for precise alignment with playhead
                left: `${leftPx}px`,
                width: '16px',
                marginLeft: '-8px'
              }}
              title={`Boundary at ${time.toFixed(2)}s`}
            >
              {/* Thin visual line centered in hit area */}
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-purple-400 group-hover:bg-purple-300 pointer-events-none" />

              {/* Delete button for boundary */}
              <button
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBoundary(time);
                }}
                title="Delete boundary"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
