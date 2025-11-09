import { Split, Trash2, RotateCcw } from 'lucide-react';

/**
 * SegmentLayer component - displays video segments with speed control and trimming
 * Shows vertical lines for segment boundaries and allows speed adjustments
 */
export default function SegmentLayer({
  segments,
  boundaries,
  duration,
  currentTime,
  onAddBoundary,
  onRemoveBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  isActive,
  segmentVisualLayout = [] // Pre-calculated visual positions from hook
}) {
  console.log('[SegmentLayer] Render - segments:', segments.length, 'visualLayout:', segmentVisualLayout.length);

  if (!duration) return null;

  /**
   * Convert time to pixel position on timeline
   */
  const timeToPixel = (time) => {
    if (!duration) return 0;
    return (time / duration) * 100;
  };

  /**
   * Convert pixel position to time
   */
  const pixelToTime = (pixelPercent) => {
    return (pixelPercent / 100) * duration;
  };

  /**
   * Handle click to add boundary
   */
  const handleTrackClick = (e) => {
    console.log('[SegmentLayer] Click detected on:', e.target.className);
    console.log('[SegmentLayer] Click target tag:', e.target.tagName);

    // Don't add boundary if clicking on a button
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      console.log('[SegmentLayer] Click ignored - clicked on a button');
      return;
    }

    // Calculate position from currentTarget (the track container)
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentX = (clickX / rect.width) * 100;
    const time = pixelToTime(percentX);

    console.log('[SegmentLayer] Adding boundary at time:', time, 'seconds');
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
    <div className={`relative bg-gray-800 border-t border-gray-700 overflow-visible ${isActive ? 'ring-2 ring-blue-500' : ''}`} style={{ minHeight: '60px', paddingBottom: '8px' }}>
      {/* Layer label */}
      <div className="absolute left-0 top-0 h-12 flex items-center justify-center bg-gray-900 border-r border-gray-700 w-32">
        <Split size={18} className="text-purple-400" />
      </div>

      {/* Segments track */}
      <div
        className="segment-track absolute left-32 right-0 top-0 h-12 cursor-pointer overflow-visible"
        onClick={handleTrackClick}
      >
        {/* Background track */}
        <div
          className="absolute inset-0 bg-purple-900 bg-opacity-20 segment-bg"
        />

        {/* Placeholder text when no segments */}
        {segments.length === 1 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Click to create Segments</span>
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
              className="h-12"
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
            <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 flex gap-1 z-10">
              {/* Trash button (only for first or last segment, and only if there are at least 2 segments) */}
              {(segment.isFirst || segment.isLast) && segments.length >= 2 && (
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

        {/* Render trimmed segments as collapsed indicators outside timeline */}
        {(() => {
          // Calculate cumulative trim durations for start and end
          const trimmedSegments = segments.filter(s => s.isTrimmed);

          // Group consecutive trimmed segments at start and end
          const startTrimmed = [];
          const endTrimmed = [];

          for (let i = 0; i < segments.length; i++) {
            if (segments[i].isTrimmed && segments[i].isFirst) {
              // Collect all consecutive trimmed segments from start
              for (let j = i; j < segments.length && segments[j].isTrimmed; j++) {
                startTrimmed.push(segments[j]);
              }
              break;
            }
          }

          for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].isTrimmed && segments[i].isLast) {
              // Collect all consecutive trimmed segments from end
              for (let j = i; j >= 0 && segments[j].isTrimmed; j--) {
                endTrimmed.unshift(segments[j]);
              }
              break;
            }
          }

          const indicators = [];

          // Start trim indicator
          if (startTrimmed.length > 0) {
            const totalDuration = startTrimmed.reduce((sum, s) => sum + (s.end - s.start), 0);
            indicators.push(
              <div
                key="trimmed-start"
                className="absolute top-0 h-12"
                style={{
                  left: '-60px',
                  width: '50px'
                }}
              >
                <div className="h-12 bg-gray-700 bg-opacity-60 border-2 border-dashed border-gray-500 rounded flex flex-col items-center justify-center cursor-pointer hover:bg-gray-600 transition-all">
                  <div className="text-gray-300 text-[10px] font-semibold">TRIM</div>
                  <div className="text-gray-400 text-[9px]">{totalDuration.toFixed(1)}s</div>
                </div>
                <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 z-10">
                  <button
                    className="p-1.5 rounded transition-colors bg-green-600 hover:bg-green-700 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Restore all start trimmed segments
                      startTrimmed.forEach(s => handleTrim(s.index));
                    }}
                    title={`Restore ${totalDuration.toFixed(1)}s from start`}
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            );
          }

          // End trim indicator
          if (endTrimmed.length > 0 && !endTrimmed.some(s => startTrimmed.includes(s))) {
            const totalDuration = endTrimmed.reduce((sum, s) => sum + (s.end - s.start), 0);
            indicators.push(
              <div
                key="trimmed-end"
                className="absolute top-0 h-12"
                style={{
                  left: 'calc(100% + 10px)',
                  width: '50px'
                }}
              >
                <div className="h-12 bg-gray-700 bg-opacity-60 border-2 border-dashed border-gray-500 rounded flex flex-col items-center justify-center cursor-pointer hover:bg-gray-600 transition-all">
                  <div className="text-gray-300 text-[10px] font-semibold">TRIM</div>
                  <div className="text-gray-400 text-[9px]">{totalDuration.toFixed(1)}s</div>
                </div>
                <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 z-10">
                  <button
                    className="p-1.5 rounded transition-colors bg-green-600 hover:bg-green-700 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Restore all end trimmed segments
                      endTrimmed.forEach(s => handleTrim(s.index));
                    }}
                    title={`Restore ${totalDuration.toFixed(1)}s from end`}
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            );
          }

          return indicators;
        })()}

        {/* Render segment boundaries (vertical lines) */}
        {boundaries.map((time, index) => {
          const position = timeToPixel(time);
          const isStart = Math.abs(time) < 0.01;
          const isEnd = Math.abs(time - duration) < 0.01;
          const isAtCurrentTime = Math.abs(time - currentTime) < 0.01;

          console.log('[SegmentLayer] Rendering boundary:', time, 'isStart:', isStart, 'isEnd:', isEnd);

          // Don't show start and end boundaries
          if (isStart || isEnd) {
            console.log('[SegmentLayer] Skipping start/end boundary at:', time);
            return null;
          }

          console.log('[SegmentLayer] Drawing vertical line at:', position, '%');

          return (
            <div
              key={index}
              className="absolute top-0 h-full w-0.5 bg-purple-400 hover:bg-purple-300 group z-20 cursor-pointer"
              style={{ left: `${position}%` }}
              title={`Boundary at ${time.toFixed(2)}s`}
            >
              {/* Delete button for boundary */}
              <button
                className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 hover:bg-red-700 text-white rounded-full p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBoundary(time);
                  // Close options if this boundary's segment was selected
                  if (selectedSegment) {
                    setSelectedSegment(null);
                  }
                }}
                title="Delete boundary"
              >
                <Trash2 size={10} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
