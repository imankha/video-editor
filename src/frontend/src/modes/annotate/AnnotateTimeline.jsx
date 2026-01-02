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
 *
 * Layer selection:
 * - Clicking playhead layer label selects 'playhead' (arrow keys step frames)
 * - Clicking clips layer label or a clip selects 'clips' (arrow keys navigate clips)
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
  // Layer selection props
  selectedLayer = 'clips',
  onLayerSelect,
}) {
  // Fixed layer height for Annotate (Video + Clips)
  // Video (h-12 = 3rem) + Clips (h-12 = 3rem) + margin (mt-1 = 0.25rem) + buffer
  const totalLayerHeight = '6.75rem';

  // Layer labels for the fixed left column - clickable to select layer
  const layerLabels = (
    <>
      {/* Video Timeline Label - click to select playhead layer */}
      <div
        className={`h-12 flex items-center justify-center border-r rounded-tl-lg cursor-pointer transition-colors ${
          selectedLayer === 'playhead'
            ? 'bg-blue-900/50 border-blue-500 ring-1 ring-inset ring-blue-500'
            : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect?.('playhead')}
        title="Click to select playhead layer (arrow keys step frames)"
      >
        <Film size={18} className="text-blue-400" />
      </div>

      {/* Clips Layer Label - click to select clips layer */}
      <div
        className={`mt-1 h-12 flex items-center justify-center border-r rounded-bl-lg cursor-pointer transition-colors ${
          selectedLayer === 'clips'
            ? 'bg-green-900/50 border-green-500 ring-1 ring-inset ring-green-500'
            : 'border-gray-700/50 bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect?.('clips')}
        title="Click to select clips layer (arrow keys navigate clips)"
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
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
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
