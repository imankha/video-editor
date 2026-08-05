import { Trash2, Eye, EyeOff } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useIsCoarsePointer } from '../../hooks/useIsMobile';
import { snapToBoundary } from '../../utils/textSnapping';

// T5225 -- Overlay text range layer. A near-clone of RegionLayer's
// pointer-event drag mechanics (design §3.1) -- NOT a new drag idiom. The one
// addition is clip-boundary SNAPPING on the edge levers (design §3.2, epic
// decision 4): a drag ending within SNAP_PX of a clip boundary (or the reel
// start/end) snaps onto it; otherwise it free-parks at the raw time.
const SNAP_PX = 10; // px radius, converted to a time delta at drag time (zoom-invariant)

export default function TextLayer({
  blocks = [],
  duration,
  visualDuration,
  clipBoundaries = [],
  selectedTextId = null,
  onAddText,
  onMoveTextStart,
  onMoveTextEnd,
  onSelectText,
  onDeleteText,
  onToggleText,
  visualTimeToSourceTime = (t) => t,
  edgePadding = 20,
}) {
  const [draggingLever, setDraggingLever] = useState(null); // { blockId, type: 'start' | 'end', pointerId }
  const trackRef = useRef(null);

  const isCoarsePointer = useIsCoarsePointer();
  const leverHitWidth = isCoarsePointer ? 44 : 32;
  const leverHitOffset = leverHitWidth / 2;

  const effectiveDuration = visualDuration || duration;

  // Raw (unsnapped) time under the pointer -- mirrors RegionLayer's
  // pixelToTimeValue exactly.
  const pixelToTimeValue = useCallback((clientX) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const usableWidth = rect.width - (edgePadding * 2);
    const x = clientX - rect.left - edgePadding;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentX = (clampedX / usableWidth) * 100;
    const visualTime = (percentX / 100) * (visualDuration || duration);
    return visualTimeToSourceTime(visualTime);
  }, [edgePadding, visualDuration, duration, visualTimeToSourceTime]);

  const currentPxPerSecond = useCallback(() => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const usableWidth = rect.width - (edgePadding * 2);
    return effectiveDuration > 0 ? usableWidth / effectiveDuration : 0;
  }, [edgePadding, effectiveDuration]);

  const snapCandidates = [0, ...clipBoundaries, effectiveDuration];

  const computeSnappedTime = useCallback((clientX) => {
    const rawTime = pixelToTimeValue(clientX);
    const pxPerSecond = currentPxPerSecond();
    if (!pxPerSecond) return rawTime;
    return snapToBoundary(rawTime, snapCandidates, SNAP_PX, pxPerSecond);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixelToTimeValue, currentPxPerSecond, JSON.stringify(snapCandidates)]);

  useEffect(() => {
    if (!draggingLever) return;

    const handlePointerMove = (e) => {
      if (draggingLever.pointerId != null && e.pointerId !== draggingLever.pointerId) return;
      if (e.cancelable) e.preventDefault();

      const newTime = computeSnappedTime(e.clientX);
      const block = blocks.find(b => b.id === draggingLever.blockId);
      if (!block) return;

      if (draggingLever.type === 'start' && onMoveTextStart) {
        onMoveTextStart(draggingLever.blockId, newTime);
      } else if (draggingLever.type === 'end' && onMoveTextEnd) {
        onMoveTextEnd(draggingLever.blockId, newTime);
      }
    };

    const handlePointerUp = (e) => {
      if (draggingLever.pointerId != null && e.pointerId !== draggingLever.pointerId) return;
      setDraggingLever(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingLever, blocks, onMoveTextStart, onMoveTextEnd, computeSnappedTime]);

  if (!duration) return null;

  const pixelPercentToTime = (percent) => {
    const visualTime = (percent / 100) * effectiveDuration;
    return visualTimeToSourceTime(visualTime);
  };

  const handleTrackClick = (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    if (e.target.closest('.lever-handle')) return;
    if (!onAddText) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const usableWidth = rect.width - (edgePadding * 2);
    const x = e.clientX - rect.left - edgePadding;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percentX = (clampedX / usableWidth) * 100;
    const clickTime = pixelPercentToTime(percentX);

    onAddText(clickTime);
  };

  return (
    <div className="relative bg-gray-800/95 border-t border-gray-700/50 overflow-visible rounded-r-lg h-14 pb-2">
      <div
        ref={trackRef}
        className="text-track absolute inset-x-0 top-0 h-10 cursor-pointer overflow-visible rounded-r-lg"
        onClick={handleTrackClick}
      >
        <div className="absolute inset-0 bg-cyan-900 bg-opacity-10 rounded-r-lg" />

        {blocks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">Click to add text</span>
          </div>
        )}

        {blocks.map((block) => {
          const isDraggingThisBlock = draggingLever?.blockId === block.id;
          const isSelected = selectedTextId === block.id;

          return (
            <div
              key={block.id}
              className="absolute top-0 h-10 overflow-visible"
              style={{
                left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${block.visualStartPercent / 100})`,
                width: `calc((100% - ${edgePadding * 2}px) * ${block.visualWidthPercent / 100})`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectText && onSelectText(block.id);
              }}
            >
              <div
                className={`h-full transition-all relative overflow-hidden border-l-2 border-r-2 border-cyan-400 bg-cyan-500 ${
                  block.enabled === false ? 'bg-opacity-10' : 'bg-opacity-20'
                } ${isSelected ? 'ring-2 ring-cyan-300' : ''}`}
                title={block.spec?.text || 'Text block'}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                  <span className="text-[10px] text-cyan-100 truncate">{block.spec?.text}</span>
                </div>
              </div>

              {/* Start lever */}
              <div
                data-testid={`text-lever-start-${block.index}`}
                className="lever-handle absolute top-0 h-full flex items-end pointer-events-auto touch-none"
                style={{ left: `-${leverHitOffset}px`, width: `${leverHitWidth}px`, zIndex: 100 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDraggingLever({ blockId: block.id, type: 'start', pointerId: e.pointerId });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 border-cyan-400 cursor-ew-resize transition-all ${
                    isDraggingThisBlock && draggingLever?.type === 'start'
                      ? 'bg-cyan-400 scale-125'
                      : 'bg-gray-900 hover:bg-cyan-400'
                  }`}
                />
              </div>

              {/* End lever */}
              <div
                data-testid={`text-lever-end-${block.index}`}
                className="lever-handle absolute top-0 h-full flex items-end justify-end pointer-events-auto touch-none"
                style={{ right: `-${leverHitOffset}px`, width: `${leverHitWidth}px`, zIndex: 100 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDraggingLever({ blockId: block.id, type: 'end', pointerId: e.pointerId });
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 border-cyan-400 cursor-ew-resize transition-all ${
                    isDraggingThisBlock && draggingLever?.type === 'end'
                      ? 'bg-cyan-400 scale-125'
                      : 'bg-gray-900 hover:bg-cyan-400'
                  }`}
                />
              </div>

              {/* Toggle (mute/unmute) + Delete */}
              <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 z-10 flex gap-1">
                <button
                  className="p-1 rounded transition-colors bg-gray-700 hover:bg-gray-600 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleText && onToggleText(block.id, block.enabled === false);
                  }}
                  title={block.enabled === false ? 'Show text' : 'Hide text (keep block)'}
                >
                  {block.enabled === false ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  className="p-1 rounded transition-colors bg-red-600 hover:bg-red-700 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteText && onDeleteText(block.id);
                  }}
                  title="Delete text block"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
