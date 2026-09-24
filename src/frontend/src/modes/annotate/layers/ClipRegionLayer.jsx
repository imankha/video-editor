import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Video } from 'lucide-react';
import { generateClipName } from '../../../utils/clipDisplayName';
import { getRatingLabel } from '../../../components/shared/clipConstants';
import { RatingIcon } from '../../../components/shared/RatingIcon';
import { ANNOTATE } from '../../../config/displayNames';
import { formatInstant, PRECISION } from '../../../utils/timeFormat';

// T8890: violet-400 accent for a clip cut from an "angle" (non-backbone source).
// Backbone clips get NONE of this treatment — the common case stays clean.
const ANGLE_ACCENT = '#a78bfa'; // violet-400

/**
 * T6400: the marker tooltip is PORTALLED to document.body and positioned `fixed`.
 *
 * It used to be an absolutely-positioned child of the lane, which meant it was
 * both clipped by the track and out-stacked by the lane's own label column — a
 * z-index inside the lane can never escape an ancestor's stacking context or
 * overflow. Rendering into <body> puts it above ALL app UI (user requirement),
 * and `fixed` coordinates come from the marker's own bounding rect, so it tracks
 * the marker without needing a layout observer.
 *
 * The layer is signalled ONLY by the left accent bar (cyan = My Athlete,
 * amber = Team) — never text.
 */
function MarkerTooltip({ anchorRect, accentColor, children }) {
  if (!anchorRect) return null;
  return createPortal(
    <div
      role="tooltip"
      data-testid="clip-marker-tooltip"
      className="fixed whitespace-nowrap text-xs text-white bg-gray-900 px-1.5 py-0.5 rounded shadow pointer-events-none"
      style={{
        // Above every app surface (modals sit at z-50/z-100; this must clear them).
        zIndex: 2147483000,
        left: anchorRect.left + anchorRect.width / 2,
        // Sit just above the marker; translate handles centering + lift.
        top: anchorRect.top,
        transform: 'translate(-50%, -130%)',
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

// T10810: a marker's bounding rect ignores clipping, so once the zoomed track
// is scrolled (T10780 mobile 3x, desktop zoom) a marker that has left the
// visible window -- or sits under the opaque lane-label column -- still
// reports a screen position and the portalled tooltip keeps rendering at it.
// Anchor only while the marker's center is inside the horizontal viewport of
// `.timeline-scroll-container` (TimelineBase); no such ancestor = unclipped.
function visibleAnchorRect(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const scroller = el.closest('.timeline-scroll-container');
  if (!scroller) return rect;
  const view = scroller.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  if (centerX < view.left || centerX > view.right) return null;
  return rect;
}

// T9480: the active region's end time is a POSITION on the game timeline (an
// instant), not a span -- floors at second precision via the shared formatInstant.
const formatTime = (seconds) => formatInstant(seconds, PRECISION.SECOND);

// T5700: layer tint — a secondary cue (colored underline foot), NOT a
// replacement for the rating hue above, which stays the primary scanning signal.
const LAYER_COLORS = {
  mine: '#06b6d4', // cyan-500
  team: '#f59e0b', // amber-500
};
const layerColorFor = (region) => (region.my_athlete === false ? LAYER_COLORS.team : LAYER_COLORS.mine);
// T6400: the layer NAME is deliberately no longer shown in the hover tooltip
// (color/underline signal the layer). It survives only as the marker's
// aria-label (accessible name) so the layer isn't conveyed by color alone.
const layerNameFor = (region) => (region.my_athlete === false ? ANNOTATE.LAYER_TEAM : ANNOTATE.LAYER_MINE);

/**
 * ClipRegionLayer - Timeline layer displaying clip markers with rating notation
 *
 * Interaction:
 * - Click marker to select it
 * - Click empty track space to seek the playhead there (T11050)
 * - Delete clips via sidebar (not by clicking)
 * - Shows rating notation: ?? (1), ? (2), !? (3), ! (4), !! (5)
 *
 * Clips are added via:
 * - "Add Play" button (primary CTA under the video, or in the controls bar)
 * - Pausing in fullscreen mode
 */
export default function ClipRegionLayer({
  regions = [],
  duration,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
  edgePadding = 20,
  emptyMessage = 'No clips yet',
  // T8890: Set of source sequences that are ANGLES (non-backbone). A region whose
  // videoSequence is in this set gets the violet accent + camera glyph. Absent /
  // empty for angle-free games -> zero visual change (byte-identical common case).
  angleSequences = null,
  // T11050: seek the playhead when the user clicks empty track space (no clip
  // there), and select this layer -- same two effects the label column already
  // triggers, so the track itself isn't a dead click target. Both optional
  // (omitted in contexts with no seek/layer-select concept, tests/harnesses).
  onSeek,
  onLayerSelect,
}) {
  const trackRef = useRef(null);
  const [hoveredRegionId, setHoveredRegionId] = useState(null);

  // T6400: portalled tooltip needs the marker's viewport rect. Hover wins over
  // selection so moving the mouse always retargets the tooltip.
  const markerRefs = useRef(new Map());
  const [anchorRect, setAnchorRect] = useState(null);
  const activeRegionId = hoveredRegionId || selectedRegionId || null;
  const activeRegion = activeRegionId
    ? regions.find((r) => r.id === activeRegionId) || null
    : null;

  const [trackWidth, setTrackWidth] = useState(0);

  // Measure track width so a selected marker's tooltip re-anchors on resize (T10391)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setTrackWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = activeRegionId ? markerRefs.current.get(activeRegionId) : null;
    setAnchorRect(visibleAnchorRect(el));
    // `regions`/`duration` re-run this after a re-layout (zoom, lane split); `trackWidth`
    // re-runs it whenever the track itself resizes (fullscreen toggle, viewport resize)
    // so a SELECTED marker's tooltip (which survives that transition, unlike hover)
    // doesn't stay pinned to its pre-resize pixel position (T10391).
  }, [activeRegionId, regions, duration, trackWidth]);

  // T10510: scrolling any ancestor (the page, a fullscreen strip, a sidebar)
  // moves the marker in the viewport without touching activeRegionId/regions/
  // duration/trackWidth, so the effect above never re-fires and the `fixed`
  // tooltip is left pointing at its pre-scroll pixel position. Listen on
  // window with capture so a scroll fired on ANY descendant scroll container
  // is caught (scroll events don't bubble, but capture-phase listeners still
  // see them travel down from window) and recompute directly off the DOM
  // rather than waiting for a React state change that never comes.
  useEffect(() => {
    if (!activeRegionId) return undefined;
    const recompute = () => {
      setAnchorRect(visibleAnchorRect(markerRefs.current.get(activeRegionId)));
    };
    window.addEventListener('scroll', recompute, true);
    return () => window.removeEventListener('scroll', recompute, true);
  }, [activeRegionId]);

  if (!duration) return null;

  // Convert time to percentage position
  const timeToPercent = (time) => (time / duration) * 100;

  // Handle marker click - select the marker
  const handleMarkerClick = (e, regionId) => {
    e.stopPropagation();

    // Select the marker (even if already selected, this is a no-op)
    if (onSelectRegion) {
      onSelectRegion(regionId);
    }
  };

  // T11050: clicking empty lane space seeks the playhead here, mirroring the
  // video track above it. Marker/span clicks stopPropagation() above, so they
  // never reach this handler -- only genuinely empty track space seeks.
  // Mirrors TimelineBase.getTimeFromPosition's own edge-padding math so a
  // click lines up with the SAME point on the ruler regardless of which lane
  // (or the video track) it landed in.
  const handleTrackClick = (e) => {
    onLayerSelect?.();
    if (!onSeek || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const usableWidth = rect.width - edgePadding * 2;
    if (usableWidth <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left - edgePadding, usableWidth));
    onSeek((x / usableWidth) * duration);
  };

  return (
    <div
      ref={trackRef}
      data-testid="clip-track"
      className={`relative h-12 bg-gray-800 rounded${onSeek ? ' cursor-pointer' : ''}`}
      style={{
        paddingLeft: `${edgePadding}px`,
        paddingRight: `${edgePadding}px`,
      }}
      onClick={handleTrackClick}
    >
      {/* Inner track area */}
      <div className="relative h-full">
        {/* T10430: layer-colored span bar per clip, covering its REAL
            startTime..endTime range along the track (was a fixed-width
            underline foot on the marker). Hover/select highlights it. */}
        {regions.map((region) => {
          const isActive = region.id === selectedRegionId || region.id === hoveredRegionId;
          const startPct = timeToPercent(region.startTime);
          const widthPct = Math.max(timeToPercent(region.endTime) - startPct, 0);
          return (
            <div
              key={`span-${region.id}`}
              data-testid="clip-span"
              data-region-id={region.id}
              className="absolute rounded-full cursor-pointer transition-all duration-150"
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                minWidth: '3px',
                bottom: isActive ? '3px' : '4px',
                height: isActive ? '5px' : '3px',
                backgroundColor: layerColorFor(region),
                opacity: isActive ? 1 : 0.8,
                zIndex: isActive ? 6 : 5,
              }}
              onClick={(e) => handleMarkerClick(e, region.id)}
              onMouseEnter={() => setHoveredRegionId(region.id)}
              onMouseLeave={() => setHoveredRegionId(null)}
            />
          );
        })}

        {/* Clip markers */}
        {regions.map((region) => {
          const isSelected = region.id === selectedRegionId;
          const isHovered = region.id === hoveredRegionId;
          const left = timeToPercent((region.startTime + region.endTime) / 2);
          const rating = region.rating ?? null;
          // Use same fallback logic as ClipListItem
          const displayName = region.name || generateClipName(rating, region.tags || [], region.notes || '') || '';
          const layerName = layerNameFor(region);
          const isAngle = !!angleSequences && region.videoSequence != null
            && (angleSequences.has ? angleSequences.has(region.videoSequence) : angleSequences.includes?.(region.videoSequence));

          return (
            <div
              key={region.id}
              ref={(el) => {
                if (el) markerRefs.current.set(region.id, el);
                else markerRefs.current.delete(region.id);
              }}
              aria-label={`${displayName || `Clip ${region.index + 1}`} - ${layerName}`}
              className="clip-marker absolute top-1/2 cursor-pointer transition-all duration-150"
              style={{
                left: `${left}%`,
                transform: `translateX(-50%) translateY(-50%)`,
                zIndex: isSelected ? 20 : isHovered ? 15 : 10,
              }}
              onClick={(e) => handleMarkerClick(e, region.id)}
              onMouseEnter={() => setHoveredRegionId(region.id)}
              onMouseLeave={() => setHoveredRegionId(null)}
            >
              {/* Rating disc icon (T10430). No filled box: the layer is carried
                  by the span bar under the track, an angle by a violet ring around
                  the disc. T10810: one marker for every viewport -- the old
                  sm:hidden "fit all clips without overlap" bar predates the
                  mobile 3x zoom (T10780) and shrank plays to unreadable pills. */}
              <div
                className={`
                  relative rounded-full transition-all duration-150
                  ${isSelected ? 'ring-2 ring-white' : 'hover:scale-110'}
                `}
                style={isAngle ? { border: `2px solid ${ANGLE_ACCENT}` } : undefined}
                title={isAngle ? `${getRatingLabel(rating)} — from an angle` : getRatingLabel(rating)}
                aria-label={isAngle ? `${getRatingLabel(rating)} — angle clip` : getRatingLabel(rating)}
              >
                <RatingIcon rating={rating} size={isSelected ? 30 : 24} />
                {isAngle && (
                  <span
                    className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full bg-violet-600 text-white"
                    style={{ width: 12, height: 12 }}
                    data-testid="angle-clip-glyph"
                  >
                    <Video size={8} />
                  </span>
                )}
              </div>
              {/* Show tooltip on hover or select - end timestamp before clip name.
                  T6400: the layer is signalled by the left accent bar ONLY (cyan =
                  My Athlete, amber = Team) — same two colors as the marker underline
                  and the two lanes, so all three agree. No layer text (user decision);
                  the accessible name on the marker keeps it non-color-only. */}
            </div>
          );
        })}

        {/* T6400: ONE portalled tooltip for the active (hovered, else selected)
            marker — rendered into <body> so no lane label, track overflow or
            sibling stacking context can occlude it. */}
        {activeRegion && (
          <MarkerTooltip anchorRect={anchorRect} accentColor={layerColorFor(activeRegion)}>
            <span className="text-blue-400">{formatTime(activeRegion.endTime)}</span>
            <span className="text-gray-500 mx-1">|</span>
            <span className="text-gray-400">{activeRegion.index + 1}.</span>{' '}
            {activeRegion.name
              || generateClipName(activeRegion.rating ?? null, activeRegion.tags || [], activeRegion.notes || '')
              || ''}
          </MarkerTooltip>
        )}

        {/* Empty state message */}
        {regions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm px-2 text-center">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
