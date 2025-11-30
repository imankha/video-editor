import { Trash2 } from 'lucide-react';
import { useState } from 'react';

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
  timelineScale = 1
}) {
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState(null);

  // Debug log (disabled - too spammy on every render)
  // console.log('[SegmentLayer] Render - segments:', segments.length, 'visualLayout:', segmentVisualLayout.length);

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
   */
  const handleTrackClick = (e) => {
    // Don't add boundary if clicking on a button
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

    // Calculate position from currentTarget (the track container)
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentX = (clickX / rect.width) * 100;
    const time = pixelToTime(percentX);

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
              left: `${visualStartPercent}%`,
              width: `${visualWidthPercent}%`
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

          // Debug logs (disabled - too spammy on every render)
          // console.log('[SegmentLayer] Rendering boundary:', time, 'isStart:', isStart, 'isEnd:', isEnd);

          // Don't show start and end boundaries
          if (isStart || isEnd) {
            // console.log('[SegmentLayer] Skipping start/end boundary at:', time);
            return null;
          }

          // console.log('[SegmentLayer] Drawing vertical line at:', position, '%');

          return (
            <div
              key={index}
              className="absolute top-0 h-full cursor-pointer group z-20"
              style={{ left: `${position}%`, width: '16px', marginLeft: '-8px' }}
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
