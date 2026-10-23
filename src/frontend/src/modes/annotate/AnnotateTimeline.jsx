import React from 'react';
import { Film, Scissors, Video } from 'lucide-react';
import { TimelineBase, EDGE_PADDING } from '../../components/timeline/TimelineBase';
import ClipRegionLayer from './layers/ClipRegionLayer';
import AngleLanes from './AngleLanes';
import VideoLane from './VideoLane';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ANNOTATE } from '../../config/displayNames';

/**
 * AnnotateTimeline - Mode-specific timeline for Annotate mode.
 * Renders ClipRegionLayer within TimelineBase.
 *
 * This is a simpler timeline than Overlay mode:
 * - Video track for playhead/scrubbing
 * - Clip regions layer with draggable start/end handles
 * - Zoom 100-500% via the `zoom` prop (T10930); no trim
 *
 * Layer selection:
 * - Clicking playhead layer label selects 'playhead' (arrow keys step frames)
 * - Clicking a clips layer label, a clip, or empty clips-track space selects 'clips'
 *   (arrow keys navigate clips, across BOTH lanes together - there is one clips
 *   layer, split into two tracks)
 * - T11050: clicking empty space in a clips track (not on a clip) ALSO seeks the
 *   playhead there, same as clicking the video track above it -- previously a dead
 *   click target with no competing gesture (unlike Focus/Overlay's crop/highlight
 *   tracks, where a background click already adds a keyframe).
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
  // T13280: the desktop Videos lane { videos, activeSequence, onPick, pulseSequence },
  // null for a single-video game (byte-identical DOM). Phone keeps only the boundary
  // flags; the SourceBar under the player is the control there.
  videoLane = null,
  // T8890: overlap-angle data (null for angle-free games -> zero angle pixels)
  angleData = null,
  // T10930: user zoom (useTimelineZoom, owned by AnnotateModeView so a
  // fullscreen toggle -- which remounts this timeline -- keeps the zoom):
  // { timelineZoom, zoomByWheel, zoomIn, zoomOut, resetZoom }. Absent (unit
  // tests, harnesses) = T10780's fixed scale: 3x on a phone, 1x on desktop.
  zoom = null,
}) {
  const isMobile = useIsMobile();

  // T10780: the whole game is illegible squeezed into ~280 CSS px on a phone, so
  // the plays track (and the scrubber/angle strip above it, all % positioned)
  // renders at 3x there. T10930 made that the phone's DEFAULT zoom rather than
  // its only value: the chip/wheel can take it 100-500% on every viewport.
  const timelineZoom = zoom ? zoom.timelineZoom : (isMobile ? 300 : 100);
  const timelineScale = timelineZoom / 100;

  // T8890: render angle UI ONLY when angles genuinely exist (EPIC: zero angles =
  // zero pixels). For an angle-free game angleData is null, so every branch below
  // is inert and the DOM is byte-identical to pre-T8890.
  const hasAngles = !!angleData && angleData.angles.length > 0;
  const shownAngleRows = hasAngles ? (isMobile ? 1 : Math.min(angleData.laneCount, 3)) : 0;

  // T13280: desktop-only Videos lane, the map of the same videos the SourceBar lists.
  const showVideoLane = !isMobile && !!videoLane && videoLane.videos.length > 0;
  const videoLaneExtraRem = showVideoLane ? 1.75 /* mt-1 + h-6 */ : 0;

  // Legacy-NULL rule (T5700): region.my_athlete ?? true -> My Athlete.
  const mineRegions = regions.filter(region => region.my_athlete !== false);
  const teamRegions = regions.filter(region => region.my_athlete === false);

  // T12170: one 'Plays' lane (as phones always had) until a Team play exists.
  const singleLane = isMobile || teamRegions.length === 0;

  // Fixed layer height for Annotate. TimelineBase draws the playhead at
  // `totalLayerHeight - 0.25rem`, so this must equal the in-flow lane stack
  // + 0.25rem EXACTLY: any excess is a playhead tail overshooting the lanes,
  // which (the scroll container is overflow-x:auto) grew a VERTICAL scrollbar on
  // non-overlay-scrollbar browsers (Windows) -- the user's first T10780 phone
  // test. index.css now pins the container overflow-y:hidden as the structural
  // guard; the e2e spec asserts zero vertical overflow on the real screen.
  // Mobile: Video (h-8 = 2rem) + mt-1 (0.25rem) + single Clips track
  //   (ClipRegionLayer's track root is always h-12 = 3rem) = 5.25rem + 0.25.
  //   (Was 6.75rem since Clipify #100: a 20px tail below the lane.)
  // Desktop: Video (h-12 = 3rem) + mt-1 + My Athlete lane (h-12) + mt-1 + Team
  //   lane (h-12) = 9.5rem + 0.25.
  // The angle strip adds height ONLY when angles exist (same terms as its DOM).
  //   Desktop with no Team play (T12170): Video (3rem) + mt-1 + one lane (3rem) = 6.25 + 0.25.
  const baseHeightRem = isMobile ? 5.5 : (singleLane ? 6.5 : 9.75);
  const angleExtraRem = hasAngles
    ? (isMobile ? 1.125 /* mt-1 + h-3.5 */ : 0.25 + shownAngleRows * 1.375 /* mt-1 + rows*(h-5+mb-0.5) */)
    : 0;
  const totalLayerHeight = `${baseHeightRem + videoLaneExtraRem + angleExtraRem}rem`;

  const leftCalc = (t) => `calc(${EDGE_PADDING}px + (100% - ${2 * EDGE_PADDING}px) * ${t / duration})`;
  const widthCalc = (a, b) => `calc((100% - ${2 * EDGE_PADDING}px) * ${(b - a) / duration})`;

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

      {/* T13280: Videos label, aligned with the desktop VideoLane (first child below
          the scrubber). Rendered only for multi-video games on desktop. */}
      {showVideoLane && (
        <div
          data-testid="video-lane-label"
          className="mt-1 h-6 flex items-center justify-center border-r border-blue-500/40 bg-gray-900"
          title={ANNOTATE.VIDEOS_HELP}
        >
          <div className="flex items-center gap-1 px-2 text-blue-400">
            <Film size={14} />
            <span className="text-xs">{ANNOTATE.VIDEOS_LABEL}</span>
          </div>
        </div>
      )}

      {/* T8890: Angles label — aligns with the angle strip. Rendered only when
          angles exist (zero angles = zero pixels). */}
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

      {singleLane ? (
        // Phone, or no Team play yet: single tinted Plays track
        <div
          className={clipsLayerLabelClass('mt-0.5 lg:mt-1 rounded-bl-lg')}
          onClick={() => onLayerSelect?.('clips')}
        >
          <div className="flex items-center gap-1 px-2 text-green-400">
            <Scissors size={16} />
            <span className="text-xs">{ANNOTATE.PLAYS_HEADING}</span>
          </div>
        </div>
      ) : (
        // Desktop: two stacked, labeled lanes - each still selects the one 'clips' layer
        <>
          <div
            data-testid="clip-lane-label-mine"
            className={clipsLayerLabelClass('mt-0.5 lg:mt-1')}
            onClick={() => onLayerSelect?.('clips')}
          >
            <div className="flex items-center gap-1 px-2 text-cyan-400">
              <Scissors size={16} />
              <span className="text-xs">{ANNOTATE.LAYER_MINE}</span>
            </div>
          </div>
          <div
            data-testid="clip-lane-label-team"
            className={clipsLayerLabelClass('mt-0.5 lg:mt-1 rounded-bl-lg')}
            onClick={() => onLayerSelect?.('clips')}
          >
            <div className="flex items-center gap-1 px-2 text-amber-400">
              <Scissors size={16} />
              <span className="text-xs">{ANNOTATE.LAYER_TEAM}</span>
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
      // T10930: real zoom state. Above 100% the touch scrollbar (phone) / native
      // bar (desktop) shows and the follow re-anchors the playhead 1/3 in on a
      // forward crossing + scrolls a non-playback/mount off-screen playhead into
      // view (page-forward, T10780). The chip is the visible control; the wheel
      // (scrub row selected) is the desktop shortcut. No read-only badge.
      timelineZoom={timelineZoom}
      timelineScale={timelineScale}
      timelineScrollPosition={0}
      onTimelineZoomByWheel={zoom?.zoomByWheel}
      // T11860: `zoom.hideChip` (a fresh game, 0 plays) drops the chip so no zoom
      // number shows; the track scale itself is unaffected.
      timelineZoomControls={zoom && !zoom.hideChip ? { zoomIn: zoom.zoomIn, zoomOut: zoom.zoomOut, resetZoom: zoom.resetZoom, defaultZoom: zoom.defaultZoom } : null}
      centerPlayheadKey={zoom?.centerPlayheadKey}
      showZoomBadge={false}
      followAnchor="page-forward"
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
    >
      {/* T13280: desktop Videos lane (directly below the scrubber). Only mounted for
          multi-video games on desktop. */}
      {showVideoLane && (
        <VideoLane
          videos={videoLane.videos}
          activeSequence={videoLane.activeSequence}
          duration={duration}
          onPick={videoLane.onPick}
          pulseSequence={videoLane.pulseSequence}
          fixSequence={videoLane.fixSequence}
          fixPendingOffset={videoLane.fixPendingOffset}
          onFixDragTo={videoLane.onFixDragTo}
          onFixDragEnd={videoLane.onFixDragEnd}
          edgePadding={EDGE_PADDING}
        />
      )}
      {/* T8890: angle strip (below the Videos lane, above the clip lanes). Only
          mounted when angles exist. */}
      {hasAngles && (
        <AngleLanes
          angles={angleData.angles}
          laneCount={angleData.laneCount}
          duration={duration}
          activeSourceSequence={angleData.activeSourceSequence}
          onSelectAngle={angleData.onSelectAngle}
          edgePadding={EDGE_PADDING}
          isMobile={isMobile}
          // T8900 Fix-timing: entry point + drag-in-mode + lane-change pulse.
          onRequestFixTiming={angleData.onRequestFixTiming}
          fixSequence={angleData.fixSequence}
          fixPendingOffset={angleData.fixPendingOffset}
          onFixDragTo={angleData.onFixDragTo}
          onFixDragEnd={angleData.onFixDragEnd}
          pulseSequence={angleData.pulseSequence}
          pulseNonce={angleData.pulseNonce}
        />
      )}
      {singleLane ? (
        <div className="mt-1" data-testid="clip-track-mobile">
          <ClipRegionLayer
            regions={regions}
            duration={duration}
            selectedRegionId={selectedRegionId}
            onSelectRegion={onSelectRegion}
            onDeleteRegion={onDeleteRegion}
            edgePadding={EDGE_PADDING}
            angleSequences={angleData?.angleSequences}
            onSeek={onSeek}
            onLayerSelect={() => onLayerSelect?.('clips')}
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
              emptyMessage={`No ${ANNOTATE.LAYER_MINE} plays yet`}
              angleSequences={angleData?.angleSequences}
              onSeek={onSeek}
              onLayerSelect={() => onLayerSelect?.('clips')}
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
              emptyMessage={`No ${ANNOTATE.LAYER_TEAM} plays yet`}
              angleSequences={angleData?.angleSequences}
              onSeek={onSeek}
              onLayerSelect={() => onLayerSelect?.('clips')}
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
          title="Only your sideline video covers this part"
          style={{
            left: leftCalc(ext.virtualStart),
            width: widthCalc(ext.virtualStart, ext.virtualEnd),
            zIndex: 4,
            background: 'repeating-linear-gradient(45deg, rgba(55,65,81,0.55) 0, rgba(55,65,81,0.55) 6px, rgba(31,41,55,0.55) 6px, rgba(31,41,55,0.55) 12px)',
          }}
        />
      ))}
      {/* T2750/T13280: video boundary flags. A 2px line with a small triangle at the
          top of the Video track, so the boundary reads at a glance; it marks WHERE the
          next video starts, the SourceBar says WHAT. Pointer-transparent. */}
      {boundaryOffsets?.map(offset => (
        <div
          key={offset}
          data-testid="video-boundary"
          className="absolute top-0 bottom-0 w-0.5 -ml-px bg-gray-300/80 pointer-events-none"
          style={{ left: `calc(${EDGE_PADDING}px + (100% - ${2 * EDGE_PADDING}px) * ${offset / duration})`, zIndex: 5 }}
        >
          <span
            aria-hidden="true"
            className="absolute top-0 -left-[4px] block w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-300"
          />
        </div>
      ))}
    </TimelineBase>
  );
}

export default AnnotateTimeline;
