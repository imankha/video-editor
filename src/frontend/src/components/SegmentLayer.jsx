import { Split, Trash2 } from 'lucide-react';

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
  isActive
}) {
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
    // Check if click is on the track background (not on segment or buttons)
    if (e.target.classList.contains('segment-track') || e.target.classList.contains('segment-bg')) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentX = (clickX / rect.width) * 100;
      const time = pixelToTime(percentX);
      onAddBoundary(time);
    }
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
    <div className={`relative bg-gray-800 border-t border-gray-700 ${isActive ? 'ring-2 ring-blue-500' : ''}`} style={{ minHeight: '60px', paddingBottom: '8px' }}>
      {/* Layer label */}
      <div className="absolute left-0 top-0 h-12 flex items-center justify-center bg-gray-900 border-r border-gray-700 w-32">
        <Split size={18} className="text-purple-400" />
      </div>

      {/* Segments track */}
      <div
        className="segment-track absolute left-32 right-0 top-0 h-12 cursor-pointer"
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

        {/* Render segments */}
        {segments.map((segment) => {
          const startPos = timeToPixel(segment.start);
          const endPos = timeToPixel(segment.end);
          const width = endPos - startPos;

          return (
            <div
              key={segment.index}
              className="absolute top-0"
              style={{
                left: `${startPos}%`,
                width: `${width}%`
              }}
            >
              {/* Segment background */}
              <div
                className={`h-12 transition-all ${
                  segment.isTrimmed
                    ? 'bg-red-900 bg-opacity-40'
                    : 'hover:bg-purple-700 hover:bg-opacity-30'
                }`}
                title={`Segment ${segment.index + 1}: ${segment.speed}x${segment.isTrimmed ? ' (trimmed)' : ''}`}
              >
                {/* Speed indicator (show if speed != 1) */}
                {segment.speed !== 1 && !segment.isTrimmed && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                    <div className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                      {segment.speed}x
                    </div>
                  </div>
                )}

                {/* Trimmed indicator */}
                {segment.isTrimmed && (
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                    <div className="bg-red-600 text-white text-xs px-2 py-0.5 rounded font-semibold">
                      TRIMMED
                    </div>
                  </div>
                )}
              </div>

              {/* Segment controls - always visible below the segment */}
              <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 flex gap-1 z-10">
                {/* Trash button (only for first or last segment, and only if there are at least 2 segments) */}
                {(segment.isFirst || segment.isLast) && segments.length >= 2 && (
                  <button
                    className={`p-1.5 rounded transition-colors ${
                      segment.isTrimmed
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTrim(segment.index);
                    }}
                    title={segment.isTrimmed ? 'Restore segment' : 'Trim segment'}
                  >
                    <Trash2 size={12} />
                  </button>
                )}

                {/* Speed buttons (only show speeds that aren't current) */}
                {!segment.isTrimmed && (
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
                    {segment.speed !== 2 && (
                      <button
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSpeedChange(segment.index, 2);
                        }}
                        title="Set speed to 2x"
                      >
                        2x
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Render segment boundaries (vertical lines) */}
        {boundaries.map((time, index) => {
          const position = timeToPixel(time);
          const isStart = Math.abs(time) < 0.01;
          const isEnd = Math.abs(time - duration) < 0.01;
          const isAtCurrentTime = Math.abs(time - currentTime) < 0.01;

          // Don't show start and end boundaries
          if (isStart || isEnd) return null;

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
