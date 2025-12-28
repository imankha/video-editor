import React from 'react';
import { Film, Scissors } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import ClipRegionLayer from './layers/ClipRegionLayer';

/**
 * AnnotateTimeline - Mode-specific timeline for Annotate mode.
 * Renders ClipRegionLayer within TimelineBase.
 *
 * This is a simpler timeline than Overlay mode:
 * - Video track for playhead/scrubbing
 * - Clip regions layer with draggable start/end handles
 * - No zoom/trim complexity needed
 */
export function AnnotateTimeline({
  // TimelineBase props
  currentTime,
  duration,
  onSeek,
  isPlaying = false,
  // ClipRegionLayer props
  regions = [],
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
}) {
  // Fixed layer height for Annotate (Video + Clips)
  // Video (h-12 = 3rem) + Clips (h-12 = 3rem) + margin (mt-1 = 0.25rem) + buffer
  const totalLayerHeight = '6.75rem';

  // Layer labels for the fixed left column
  const layerLabels = (
    <>
      {/* Video Timeline Label */}
      <div
        className="h-12 flex items-center justify-center border-r border-gray-700 rounded-tl-lg bg-gray-900"
      >
        <Film size={18} className="text-blue-400" />
      </div>

      {/* Clips Layer Label */}
      <div
        className="mt-1 h-12 flex items-center justify-center border-r border-gray-700/50 rounded-bl-lg bg-gray-900"
      >
        <div className="flex items-center gap-1 px-2 text-green-400">
          <Scissors size={16} />
          <span className="text-xs">Clips</span>
        </div>
      </div>
    </>
  );

  return (
    <TimelineBase
      currentTime={currentTime}
      duration={duration}
      onSeek={onSeek}
      layerLabels={layerLabels}
      totalLayerHeight={totalLayerHeight}
      isPlaying={isPlaying}
      // Disable zoom/trim features for Annotate mode
      timelineZoom={100}
      timelineScale={1}
      timelineScrollPosition={0}
      selectedLayer="playhead"
    >
      {/* Clip Regions Layer */}
      <div className="mt-1">
        <ClipRegionLayer
          regions={regions}
          duration={duration}
          selectedRegionId={selectedRegionId}
          onSelectRegion={onSelectRegion}
          onDeleteRegion={onDeleteRegion}
          edgePadding={EDGE_PADDING}
        />
      </div>
    </TimelineBase>
  );
}

export default AnnotateTimeline;
