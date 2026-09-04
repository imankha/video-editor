import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { generateClipName } from '../../../utils/clipDisplayName';
import { RATING_NOTATION, RATING_ADJECTIVES } from '../../../components/shared/clipConstants';

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

// Format seconds to MM:SS or HH:MM:SS
const formatTime = (seconds) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Rating to color map (color-blind safe palette)
// Brightness scales from darkest (1⭐) to brightest (5⭐)
const RATING_COLORS = {
  1: '#C62828', // Brick Red - Blunder
  2: '#F9A825', // Amber Yellow - Weak/Caution
  3: '#1565C0', // Strong Blue - Interesting
  4: '#2E7D32', // Teal-Green - Good
  5: '#66BB6A', // Light Green - Excellent (festive!)
};

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
const layerNameFor = (region) => (region.my_athlete === false ? 'Team' : 'My Athlete');

/**
 * ClipRegionLayer - Timeline layer displaying clip markers with rating notation
 *
 * Interaction:
 * - Click marker to select it
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

  useEffect(() => {
    const el = activeRegionId ? markerRefs.current.get(activeRegionId) : null;
    setAnchorRect(el ? el.getBoundingClientRect() : null);
    // `regions`/`duration` re-run this after a re-layout (zoom, lane split) so the
    // fixed tooltip does not stick to a stale position.
  }, [activeRegionId, regions, duration]);
  const [trackWidth, setTrackWidth] = useState(0);

  // Measure track width for dynamic mobile marker sizing
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setTrackWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!duration) return null;

  // Mobile marker width: fit all clips without overlap
  // Formula: (usableTrackWidth / clipCount) - gap, clamped to [4, 12]
  const MOBILE_MARKER_MIN = 4;
  const MOBILE_MARKER_MAX = 12;
  const MOBILE_MARKER_GAP = 2;
  const clipCount = regions.length || 1;
  const usableWidth = trackWidth - (edgePadding * 2);
  const mobileMarkerWidth = Math.min(
    MOBILE_MARKER_MAX,
    Math.max(MOBILE_MARKER_MIN, Math.floor(usableWidth / clipCount) - MOBILE_MARKER_GAP)
  );

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

  return (
    <div
      ref={trackRef}
      className="relative h-12 bg-gray-800 rounded"
      style={{
        paddingLeft: `${edgePadding}px`,
        paddingRight: `${edgePadding}px`,
      }}
    >
      {/* Inner track area */}
      <div className="relative h-full">
        {/* Clip markers */}
        {regions.map((region) => {
          const isSelected = region.id === selectedRegionId;
          const isHovered = region.id === hoveredRegionId;
          const left = timeToPercent(region.endTime);
          const rating = region.rating || 3;
          const notation = RATING_NOTATION[rating];
          const color = RATING_COLORS[rating];
          // Use same fallback logic as ClipListItem
          const displayName = region.name || generateClipName(rating, region.tags || [], region.notes || '') || '';
          const layerColor = layerColorFor(region);
          const layerName = layerNameFor(region);

          return (
            <div
              key={region.id}
              ref={(el) => {
                if (el) markerRefs.current.set(region.id, el);
                else markerRefs.current.delete(region.id);
              }}
              aria-label={`${displayName || `Clip ${region.index + 1}`} - ${layerName} layer`}
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
              {/* Mobile: color bar sized to fit without overlap */}
              <div
                className="sm:hidden relative"
                style={{ padding: '8px 4px' }}
              >
                <div
                  className={`
                    rounded transition-all duration-150
                    ${isSelected ? 'ring-2 ring-white shadow-lg' : ''}
                  `}
                  style={{
                    width: `${mobileMarkerWidth}px`,
                    height: isSelected ? '28px' : '20px',
                    backgroundColor: color,
                    border: '1px solid rgba(0,0,0,0.3)',
                    borderBottom: `3px solid ${layerColor}`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}
                />
              </div>
              {/* Desktop: rating notation badge */}
              <div
                className={`
                  hidden sm:block px-1.5 py-0.5 rounded font-bold transition-all duration-150
                  ${isSelected
                    ? 'text-lg ring-2 ring-white shadow-lg'
                    : 'text-sm hover:scale-110'
                  }
                `}
                style={{
                  backgroundColor: color,
                  color: '#ffffff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(0,0,0,0.3)',
                  borderBottom: `2px solid ${layerColor}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
                title={RATING_ADJECTIVES[rating]}
                aria-label={RATING_ADJECTIVES[rating]}
              >
                {notation}
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
              || generateClipName(activeRegion.rating || 3, activeRegion.tags || [], activeRegion.notes || '')
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
