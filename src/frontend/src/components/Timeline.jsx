import React from 'react';
import { Film, Crop, Split, Circle, Eye, EyeOff } from 'lucide-react';
import { formatTimeSimple } from '../utils/timeFormat';
import CropLayer from './CropLayer';
import HighlightLayer from './HighlightLayer';
import SegmentLayer from './SegmentLayer';

/**
 * Timeline component - Shows timeline with playhead and scrubber
 * @param {Object} props
 * @param {number} props.currentTime - Current video time
 * @param {number} props.duration - Total source video duration
 * @param {number} props.visualDuration - Effective duration after speed/trim changes
 * @param {number} props.sourceDuration - Original video duration
 * @param {number} props.trimmedDuration - Total trimmed time
 * @param {Function} props.onSeek - Callback when user seeks
 * @param {Array} props.cropKeyframes - Crop keyframes to display
 * @param {number} props.framerate - Video framerate for frame-based crop keyframes
 * @param {boolean} props.isCropActive - Whether crop layer is active
 * @param {Function} props.onCropKeyframeClick - Callback when crop keyframe is clicked
 * @param {Function} props.onCropKeyframeDelete - Callback when crop keyframe is deleted
 * @param {Function} props.onCropKeyframeCopy - Callback when crop keyframe is copied
 * @param {Function} props.onCropKeyframePaste - Callback when crop is pasted at a time
 * @param {number|null} props.selectedCropKeyframeIndex - Index of selected crop keyframe
 * @param {Array} props.highlightKeyframes - Highlight keyframes to display
 * @param {number} props.highlightFramerate - Video framerate for highlight keyframes
 * @param {boolean} props.isHighlightActive - Whether highlight layer is active
 * @param {Function} props.onHighlightKeyframeClick - Callback when highlight keyframe is clicked
 * @param {Function} props.onHighlightKeyframeDelete - Callback when highlight keyframe is deleted
 * @param {Function} props.onHighlightKeyframeCopy - Callback when highlight keyframe is copied
 * @param {Function} props.onHighlightKeyframePaste - Callback when highlight is pasted at a time
 * @param {number|null} props.selectedHighlightKeyframeIndex - Index of selected highlight keyframe
 * @param {Function} props.onHighlightToggleEnabled - Callback to toggle highlight layer enabled state
 * @param {Function} props.onHighlightDurationChange - Callback when highlight duration changes
 * @param {string} props.selectedLayer - Currently selected layer ('playhead' | 'crop' | 'highlight')
 * @param {Function} props.onLayerSelect - Callback when layer is selected
 * @param {Array} props.segments - Segments to display
 * @param {Array} props.segmentBoundaries - Segment boundaries
 * @param {Array} props.segmentVisualLayout - Pre-calculated segment visual positions
 * @param {boolean} props.isSegmentActive - Whether segment layer is active
 * @param {Function} props.onAddSegmentBoundary - Callback when adding segment boundary
 * @param {Function} props.onRemoveSegmentBoundary - Callback when removing segment boundary
 * @param {Function} props.onSegmentSpeedChange - Callback when segment speed changes
 * @param {Function} props.onSegmentTrim - Callback when segment is trimmed
 * @param {Object|null} props.trimRange - Current trim range {start, end} or null
 * @param {Array} props.trimHistory - Trim history for de-trim functionality
 * @param {Function} props.onDetrimStart - Callback to undo last start trim
 * @param {Function} props.onDetrimEnd - Callback to undo last end trim
 * @param {Function} props.sourceTimeToVisualTime - Convert source time to visual time
 * @param {Function} props.visualTimeToSourceTime - Convert visual time to source time
 * @param {number} props.timelineZoom - Current timeline zoom level (10-100%)
 * @param {Function} props.onTimelineZoomByWheel - Callback when zoom changes via mousewheel
 * @param {number} props.timelineScale - Scale factor for timeline width (1-5x)
 * @param {number} props.timelineScrollPosition - Current scroll position (0-100%)
 * @param {Function} props.onTimelineScrollPositionChange - Callback when scroll position changes
 */
export function Timeline({
  currentTime,
  duration,
  visualDuration,
  sourceDuration,
  trimmedDuration,
  onSeek,
  cropKeyframes = [],
  framerate = 30,
  isCropActive = false,
  onCropKeyframeClick,
  onCropKeyframeDelete,
  onCropKeyframeCopy,
  onCropKeyframePaste,
  selectedCropKeyframeIndex = null,
  highlightKeyframes = [],
  highlightFramerate = 30,
  isHighlightActive = false,
  onHighlightKeyframeClick,
  onHighlightKeyframeDelete,
  onHighlightKeyframeCopy,
  onHighlightKeyframePaste,
  selectedHighlightKeyframeIndex = null,
  onHighlightToggleEnabled,
  onHighlightDurationChange,
  selectedLayer = 'playhead',
  onLayerSelect,
  segments = [],
  segmentBoundaries = [],
  segmentVisualLayout = [],
  trimRange = null,
  trimHistory = [],
  onDetrimStart,
  onDetrimEnd,
  isSegmentActive = false,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  sourceTimeToVisualTime = (t) => t,
  visualTimeToSourceTime = (t) => t,
  timelineZoom = 100,
  onTimelineZoomByWheel,
  timelineScale = 1,
  timelineScrollPosition = 0,
  onTimelineScrollPositionChange
}) {
  const timelineRef = React.useRef(null);
  const scrollContainerRef = React.useRef(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [hoverX, setHoverX] = React.useState(0);

  const getTimeFromPosition = (clientX) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));

    // Calculate visual time from position (timeline displays visual duration)
    const effectiveDuration = visualDuration || duration;
    const visualTime = (x / rect.width) * effectiveDuration;

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
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));

    // Calculate visual time for display
    const effectiveDuration = visualDuration || duration;
    const visualTime = (x / rect.width) * effectiveDuration;

    setHoverX(x);
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
        {/* Fixed layer labels on the left */}
        <div className="absolute left-0 top-0 w-32 z-10">
          {/* Video Timeline Label */}
          <div
            className={`h-12 flex items-center justify-center border-r border-gray-700 rounded-l-lg transition-colors cursor-pointer ${
              selectedLayer === 'playhead' ? 'bg-blue-900/50' : 'bg-gray-900 hover:bg-gray-800'
            }`}
            onClick={() => onLayerSelect && onLayerSelect('playhead')}
          >
            <Film size={18} className={selectedLayer === 'playhead' ? 'text-blue-300' : 'text-blue-400'} />
          </div>

          {/* Crop Layer Label */}
          <div
            className={`mt-1 h-12 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
              selectedLayer === 'crop' ? 'bg-yellow-900/30' : 'bg-gray-900 hover:bg-gray-800'
            }`}
            onClick={() => onLayerSelect && onLayerSelect('crop')}
          >
            <Crop size={18} className={selectedLayer === 'crop' ? 'text-yellow-300' : 'text-yellow-400'} />
          </div>

          {/* Segment Layer Label (only if segments exist) */}
          {segments.length > 0 && (
            <div className="mt-1 h-12 flex items-center justify-center bg-gray-900 border-r border-gray-700/50 rounded-bl-lg">
              <Split size={18} className="text-purple-400" />
            </div>
          )}

          {/* Highlight Layer Label */}
          <div
            className={`mt-1 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg transition-colors cursor-pointer ${
              selectedLayer === 'highlight' ? 'bg-orange-900/30' : 'bg-gray-900 hover:bg-gray-800'
            }`}
            style={{ height: isHighlightActive && highlightKeyframes.length > 0 ? '5rem' : '3rem' }}
            onClick={(e) => {
              if (!e.target.closest('button')) {
                onLayerSelect && onLayerSelect('highlight');
              }
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHighlightToggleEnabled();
                onLayerSelect && onLayerSelect('highlight');
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                isHighlightActive
                  ? selectedLayer === 'highlight' ? 'text-orange-300 hover:text-orange-200' : 'text-orange-400 hover:text-orange-300'
                  : 'text-gray-500 hover:text-gray-400'
              }`}
              title={isHighlightActive ? 'Disable highlight layer' : 'Enable highlight layer'}
            >
              <Circle size={18} className={isHighlightActive ? 'fill-current' : ''} />
              {isHighlightActive ? (
                <Eye size={14} />
              ) : (
                <EyeOff size={14} />
              )}
            </button>
          </div>
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
            <div className="relative">
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
                  {/* Progress bar */}
                  <div
                    className="absolute top-0 left-0 h-full bg-blue-600 rounded-r-lg transition-all pointer-events-none"
                    style={{ width: `${progress}%` }}
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
                  left: `${progress}%`,
                  height: segments.length > 0 ? 'calc(100% - 0.25rem)' : 'calc(9.25rem - 0.25rem)'
                }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full" />
              </div>

              {/* Crop Layer */}
              <div className="mt-1">
                <CropLayer
                  keyframes={cropKeyframes}
                  duration={duration}
                  visualDuration={visualDuration}
                  currentTime={currentTime}
                  framerate={framerate}
                  isActive={isCropActive}
                  onKeyframeClick={onCropKeyframeClick}
                  onKeyframeDelete={onCropKeyframeDelete}
                  onKeyframeCopy={onCropKeyframeCopy}
                  onKeyframePaste={onCropKeyframePaste}
                  selectedKeyframeIndex={selectedCropKeyframeIndex}
                  isLayerSelected={selectedLayer === 'crop'}
                  onLayerSelect={() => onLayerSelect && onLayerSelect('crop')}
                  sourceTimeToVisualTime={sourceTimeToVisualTime}
                  visualTimeToSourceTime={visualTimeToSourceTime}
                  timelineScale={timelineScale}
                />
              </div>

              {/* Segment Layer */}
              {segments.length > 0 && (
                <div className="mt-1">
                  <SegmentLayer
                    segments={segments}
                    boundaries={segmentBoundaries}
                    duration={duration}
                    visualDuration={visualDuration}
                    currentTime={currentTime}
                    isActive={isSegmentActive}
                    segmentVisualLayout={segmentVisualLayout}
                    onAddBoundary={onAddSegmentBoundary}
                    onRemoveBoundary={onRemoveSegmentBoundary}
                    onSegmentSpeedChange={onSegmentSpeedChange}
                    onSegmentTrim={onSegmentTrim}
                    trimRange={trimRange}
                    trimHistory={trimHistory}
                    onDetrimStart={onDetrimStart}
                    onDetrimEnd={onDetrimEnd}
                    sourceTimeToVisualTime={sourceTimeToVisualTime}
                    visualTimeToSourceTime={visualTimeToSourceTime}
                    timelineScale={timelineScale}
                  />
                </div>
              )}

              {/* Highlight Layer - at the bottom */}
              <div className="mt-1">
                <HighlightLayer
                  keyframes={highlightKeyframes}
                  duration={duration}
                  visualDuration={visualDuration}
                  currentTime={currentTime}
                  framerate={highlightFramerate}
                  isActive={isHighlightActive}
                  onKeyframeClick={onHighlightKeyframeClick}
                  onKeyframeDelete={onHighlightKeyframeDelete}
                  onKeyframeCopy={onHighlightKeyframeCopy}
                  onKeyframePaste={onHighlightKeyframePaste}
                  selectedKeyframeIndex={selectedHighlightKeyframeIndex}
                  isLayerSelected={selectedLayer === 'highlight'}
                  onLayerSelect={() => onLayerSelect && onLayerSelect('highlight')}
                  onToggleEnabled={onHighlightToggleEnabled}
                  onDurationChange={onHighlightDurationChange}
                  sourceTimeToVisualTime={sourceTimeToVisualTime}
                  visualTimeToSourceTime={visualTimeToSourceTime}
                  timelineScale={timelineScale}
                />
              </div>
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
