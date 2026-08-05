import useVideoDisplayRect from '../../../hooks/useVideoDisplayRect';
import RichText from '../../../components/RichText';

/**
 * TextOverlayPreview -- live "what you see is what renders" preview for
 * Overlay text blocks (T5225 design §4.3). Positions the SAME <RichText>
 * component (T5180) the card editor will use, absolutely over the displayed
 * video area via the shared `useVideoDisplayRect` transform (the same SSOT
 * every overlay -- crop, highlight, player detection -- already uses).
 *
 * Renders a block when it is ENABLED and its `[startTime, endTime)` half-open
 * range contains `currentTime` (design O6) -- OR when it is the currently
 * SELECTED block (so editing is visible even while the playhead sits outside
 * the range). Display-only: never writes.
 */
export default function TextOverlayPreview({
  videoRef,
  videoMetadata,
  textOverlays = [],
  currentTime,
  selectedTextId = null,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  isFullscreen = false,
}) {
  const { rect } = useVideoDisplayRect(videoRef, videoMetadata, { zoom, panOffset, isFullscreen });

  if (!rect || !rect.width || !rect.height) return null;

  const visibleBlocks = textOverlays.filter((block) => {
    if (block.id === selectedTextId) return true;
    if (block.enabled === false) return false;
    return block.startTime <= currentTime && currentTime < block.endTime;
  });

  if (visibleBlocks.length === 0) return null;

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: rect.offsetX, top: rect.offsetY, width: rect.width, height: rect.height }}
    >
      {visibleBlocks.map((block) => (
        <div key={block.id} className="absolute inset-0">
          <RichText spec={block.spec} boxWidth={rect.width} boxHeight={rect.height} />
        </div>
      ))}
    </div>
  );
}
