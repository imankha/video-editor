import React from 'react';
import { Film, Scissors } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import ClipRegionLayer from './layers/ClipRegionLayer';
import { useIsMobile } from '../../hooks/useIsMobile';

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
 * - Clicking a clips layer label or a clip selects 'clips' (arrow keys navigate clips,
 *   across BOTH lanes together - there is one clips layer, split into two tracks)
 *
 * T5700 follow-up - two clip lanes ("My Athlete" / "Team") on wide viewports, collapsing
 * to the original single tinted track on phones. Gated on `useIsMobile()` (width OR
 * coarse-pointer), NOT the `sm` (640px) breakpoint this screen's sidebar uses - `sm` is
 * width-only, so a LANDSCAPE phone (>=640px wide, T4933 landmine) would be misread as
 * desktop and get the taller two-lane layout in an already height-starved viewport.
 * useIsMobile's coarse-pointer clause keeps a phone single-lane in any orientation.
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
  // T2750: Video boundary markers
  boundaryOffsets,
}) {
  const isMobile = useIsMobile();

  // Fixed layer height for Annotate.
  // Mobile: Video (h-8 = 2rem) + single Clips track (ClipRegionLayer's track root
  // is always h-12 = 3rem) + margin + buffer.
  // Desktop: Video (h-12 = 3rem) + My Athlete lane (h-12) + Team lane (h-12) + margins + buffer.
  const totalLayerHeight = isMobile ? '6.75rem' : '9.75rem';

  // Legacy-NULL rule (T5700): region.my_athlete ?? true -> My Athlete.
  const mineRegions = regions.filter(region => region.my_athlete !== false);
  const teamRegions = regions.filter(region => region.my_athlete === false);

  const clipsLayerLabelClass = (extra) => `${extra} h-8 lg:h-12 flex items-center justify-center border-r cursor-pointer transition-colors ${
    selectedLayer === 'clips'
      ? 'bg-green-900/50 border-green-500 ring-1 ring-inset ring-green-500'
      : 'border-gray-700/50 bg-gray-900 hover:bg-gray-800'
  }`;

  // Layer labels for the fixed left column - clickable to select layer
  const layerLabels = (
    <>
      {/* Video Timeline Label - click to select playhead layer */}
      <div
        className={`h-8 lg:h-12 flex items-center justify-center border-r rounded-tl-lg cursor-pointer transition-colors ${
          selectedLayer === 'playhead'
            ? 'bg-blue-900/50 border-blue-500 ring-1 ring-inset ring-blue-500'
            : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
        }`}
        onClick={() => onLayerSelect?.('playhead')}
        title="Click to select playhead layer (arrow keys step frames)"
      >
        <Film size={18} className="text-blue-400" />
      </div>

      {isMobile ? (
        // Phone: single tinted Clips track (unchanged from pre-follow-up T5700 shape)
        <div
          className={clipsLayerLabelClass('mt-0.5 lg:mt-1 rounded-bl-lg')}
          onClick={() => onLayerSelect?.('clips')}
          title="Click to select clips layer (arrow keys navigate clips)"
        >
          <div className="flex items-center gap-1 px-2 text-green-400">
            <Scissors size={16} />
            <span className="text-xs">Clips</span>
          </div>
        </div>
      ) : (
        // Desktop: two stacked, labeled lanes - each still selects the one 'clips' layer
        <>
          <div
            data-testid="clip-lane-label-mine"
            className={clipsLayerLabelClass('mt-0.5 lg:mt-1')}
            onClick={() => onLayerSelect?.('clips')}
            title="Click to select clips layer (arrow keys navigate clips)"
          >
            <div className="flex items-center gap-1 px-2 text-cyan-400">
              <Scissors size={16} />
              <span className="text-xs">My Athlete</span>
            </div>
          </div>
          <div
            data-testid="clip-lane-label-team"
            className={clipsLayerLabelClass('mt-0.5 lg:mt-1 rounded-bl-lg')}
            onClick={() => onLayerSelect?.('clips')}
            title="Click to select clips layer (arrow keys navigate clips)"
          >
            <div className="flex items-center gap-1 px-2 text-amber-400">
              <Scissors size={16} />
              <span className="text-xs">Team</span>
            </div>
          </div>
        </>
      )}
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
      {isMobile ? (
        <div className="mt-1" data-testid="clip-track-mobile">
          <ClipRegionLayer
            regions={regions}
            duration={duration}
            selectedRegionId={selectedRegionId}
            onSelectRegion={onSelectRegion}
            onDeleteRegion={onDeleteRegion}
            edgePadding={EDGE_PADDING}
          />
        </div>
      ) : (
        <>
          <div className="mt-1" data-testid="clip-lane-mine">
            <ClipRegionLayer
              regions={mineRegions}
              duration={duration}
              selectedRegionId={selectedRegionId}
              onSelectRegion={onSelectRegion}
              onDeleteRegion={onDeleteRegion}
              edgePadding={EDGE_PADDING}
              emptyMessage="No My Athlete clips yet"
            />
          </div>
          <div className="mt-0.5 lg:mt-1" data-testid="clip-lane-team">
            <ClipRegionLayer
              regions={teamRegions}
              duration={duration}
              selectedRegionId={selectedRegionId}
              onSelectRegion={onSelectRegion}
              onDeleteRegion={onDeleteRegion}
              edgePadding={EDGE_PADDING}
              emptyMessage="No Team clips yet"
            />
          </div>
        </>
      )}
      {/* T2750: Video boundary markers */}
      {boundaryOffsets?.map(offset => {
        return (
          <div
            key={offset}
            className="absolute top-0 bottom-0 w-px bg-gray-500/30 pointer-events-none"
            style={{ left: `calc(${EDGE_PADDING}px + (100% - ${2 * EDGE_PADDING}px) * ${offset / duration})`, zIndex: 5 }}
          />
        );
      })}
    </TimelineBase>
  );
}

export default AnnotateTimeline;
