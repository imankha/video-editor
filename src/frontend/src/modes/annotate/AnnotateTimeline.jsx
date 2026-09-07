import React from 'react';
import { Film, Scissors, Video } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import ClipRegionLayer from './layers/ClipRegionLayer';
import AngleLanes from './AngleLanes';
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
  // T8890: overlap-angle data (null for angle-free games -> zero angle pixels)
  angleData = null,
}) {
  const isMobile = useIsMobile();

  // T8890: render angle UI ONLY when angles genuinely exist (EPIC: zero angles =
  // zero pixels). For an angle-free game angleData is null, so every branch below
  // is inert and the DOM is byte-identical to pre-T8890.
  const hasAngles = !!angleData && angleData.angles.length > 0;
  const shownAngleRows = hasAngles ? (isMobile ? 1 : Math.min(angleData.laneCount, 3)) : 0;

  // Fixed layer height for Annotate.
  // Mobile: Video (h-8 = 2rem) + single Clips track (ClipRegionLayer's track root
  // is always h-12 = 3rem) + margin + buffer.
  // Desktop: Video (h-12 = 3rem) + My Athlete lane (h-12) + Team lane (h-12) + margins + buffer.
  // The angle strip adds height ONLY when angles exist.
  const baseHeightRem = isMobile ? 6.75 : 9.75;
  const angleExtraRem = hasAngles
    ? (isMobile ? 1.125 /* mt-1 + h-3.5 */ : 0.25 + shownAngleRows * 1.375 /* mt-1 + rows*(h-5+mb-0.5) */)
    : 0;
  const totalLayerHeight = `${baseHeightRem + angleExtraRem}rem`;

  const leftCalc = (t) => `calc(${EDGE_PADDING}px + (100% - ${2 * EDGE_PADDING}px) * ${t / duration})`;
  const widthCalc = (a, b) => `calc((100% - ${2 * EDGE_PADDING}px) * ${(b - a) / duration})`;

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

      {/* T8890: Angles label — aligns with the angle strip (first child below the
          scrubber). Rendered only when angles exist (zero angles = zero pixels). */}
      {hasAngles && (
        <div
          data-testid="angle-lane-label"
          className="mt-1 flex items-center justify-center border-r border-violet-500/40 bg-gray-900"
          style={{ height: `${angleExtraRem - 0.25}rem` }}
          title="Camera angles — click a bar to switch"
        >
          <div className="flex items-center gap-1 px-2 text-violet-300">
            <Video size={14} />
            <span className="text-xs">Angles</span>
          </div>
        </div>
      )}

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
      {/* T8890: angle strip — first child (directly below the scrubber, above the
          clip lanes). Only mounted when angles exist. */}
      {hasAngles && (
        <AngleLanes
          angles={angleData.angles}
          laneCount={angleData.laneCount}
          duration={duration}
          activeSourceSequence={angleData.activeSourceSequence}
          onSelectAngle={angleData.onSelectAngle}
          edgePadding={EDGE_PADDING}
          isMobile={isMobile}
        />
      )}
      {isMobile ? (
        <div className="mt-1" data-testid="clip-track-mobile">
          <ClipRegionLayer
            regions={regions}
            duration={duration}
            selectedRegionId={selectedRegionId}
            onSelectRegion={onSelectRegion}
            onDeleteRegion={onDeleteRegion}
            edgePadding={EDGE_PADDING}
            angleSequences={angleData?.angleSequences}
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
              angleSequences={angleData?.angleSequences}
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
              angleSequences={angleData?.angleSequences}
            />
          </div>
        </>
      )}
      {/* T8890: coverage-extension hatch on the main track — "no main camera"
          stretches where only an angle has footage. */}
      {hasAngles && angleData.extensions?.map((ext) => (
        <div
          key={`ext-${ext.virtualStart}`}
          data-testid="angle-extension-hatch"
          className="absolute top-0 bottom-0 pointer-events-none"
          title="Only your sideline clip covers this part"
          style={{
            left: leftCalc(ext.virtualStart),
            width: widthCalc(ext.virtualStart, ext.virtualEnd),
            zIndex: 4,
            background: 'repeating-linear-gradient(45deg, rgba(55,65,81,0.55) 0, rgba(55,65,81,0.55) 6px, rgba(31,41,55,0.55) 6px, rgba(31,41,55,0.55) 12px)',
          }}
        />
      ))}
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
