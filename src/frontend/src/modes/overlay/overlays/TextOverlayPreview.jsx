import useVideoDisplayRect from '../../../hooks/useVideoDisplayRect';
import RichText from '../../../components/RichText';

/**
 * TextOverlayPreview -- live "what you see is what renders" preview for
 * Overlay text (T5225 design §4.3; T6630 round 4 model reframe). Positions
 * the SAME <RichText> component (T5180) the card editor will use, absolutely
 * over the displayed video area via the shared `useVideoDisplayRect`
 * transform (the same SSOT every overlay -- crop, highlight, player
 * detection -- already uses).
 *
 * MODEL (T6630 round 4): `textOverlays` is a list of REGIONS -- time spans
 * that each CONTAIN N elements, all rendering SIMULTANEOUSLY during the
 * region's window (user direction: "a text region can have multiple text
 * elements"). A region is ACTIVE when its `[startTime, endTime)` half-open
 * range contains `currentTime` (design O6) -- OR when it is the currently
 * SELECTED region (so editing is visible even while the playhead sits
 * outside the range). Every element of an active region renders, except one
 * individually disabled (T6620's per-element eye).
 *
 * T6620: a DISABLED element (`enabled === false`) is hidden UNCONDITIONALLY --
 * checked BEFORE the selected-region short-circuit. Previously a selected
 * block rendered regardless of `enabled`, so clicking the eye on the element
 * you were editing never hid its text ("the eye button doesn't turn off the
 * text"). The export already honours it (`_rasterize_text_layers` filters
 * `enabled` after `_flatten_text_regions`), so this closes the preview/export
 * gap. `enabled === false` (not `!enabled`) is deliberate: a DB-loaded
 * element with `enabled === undefined` (never toggled) must still SHOW.
 *
 * Display-only: never writes.
 */
export default function TextOverlayPreview({
  videoRef,
  videoMetadata,
  textOverlays = [],
  currentTime,
  selectedRegionId = null,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  isFullscreen = false,
}) {
  const { rect } = useVideoDisplayRect(videoRef, videoMetadata, { zoom, panOffset, isFullscreen });

  if (!rect || !rect.width || !rect.height) return null;

  const activeRegions = textOverlays.filter((region) => {
    if (region.id === selectedRegionId) return true;
    return region.startTime <= currentTime && currentTime < region.endTime;
  });

  // Flatten active regions' elements -- ALL elements of an active region
  // render at once (the core round-4 fix: two elements in the SAME region
  // now share one time window and render TOGETHER, not "only the second one
  // showed up"). Each element keeps its own spec (position/styling).
  const visibleElements = activeRegions.flatMap((region) =>
    (region.elements || [])
      .filter((element) => element.enabled !== false) // hidden wins (T6620)
      .map((element) => ({ ...element, regionId: region.id }))
  );

  if (visibleElements.length === 0) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: rect.offsetX, top: rect.offsetY, width: rect.width, height: rect.height }}
    >
      {visibleElements.map((element) => (
        <div
          key={element.id}
          data-testid={`text-preview-element-${element.id}`}
          className="absolute inset-0"
        >
          <RichText spec={element.spec} boxWidth={rect.width} boxHeight={rect.height} />
        </div>
      ))}
    </div>
  );
}
