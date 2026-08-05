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

// T6610 -- pointer travel (px) below which a body pointerdown->up is a CLICK
// (select the block), not a drag (move it). Mirrors PosterMarkerLayer's
// DRAG_THRESHOLD_PX (T6560): small enough that any intended drag clears it, large
// enough to swallow the sub-pixel jitter of a click-in-place -- so grabbing a
// block to SELECT it never nudges its time.
const BODY_DRAG_THRESHOLD_PX = 4;
const KEY_NUDGE_SECONDS = 1 / 30;      // one frame at 30fps (matches PosterMarkerLayer)
const KEY_NUDGE_SECONDS_COARSE = 1.0;  // Shift+Arrow: a bigger, 1-second step

export default function TextLayer({
  blocks = [],
  duration,
  visualDuration,
  clipBoundaries = [],
  selectedTextId = null,
  onAddText,
  onMoveTextStart,
  onMoveTextEnd,
  onMoveTextBody,
  onSelectText,
  onDeleteText,
  onToggleText,
  visualTimeToSourceTime = (t) => t,
  edgePadding = 20,
}) {
  const [draggingLever, setDraggingLever] = useState(null); // { blockId, type: 'start' | 'end', pointerId }
  // T6610 -- body drag (move the whole block, duration preserved). Separate from
  // draggingLever so the lever code path is untouched: a pointerdown on a lever
  // stops propagation before it ever reaches the body handler, so a lever press
  // still RESIZES and a body press MOVES (the hit-testing the task calls out).
  const [draggingBody, setDraggingBody] = useState(null); // { blockId, pointerId, grabOffset, blockDuration }
  const bodyDownXRef = useRef(null);
  const bodyMovedRef = useRef(false);
  const trackRef = useRef(null);

  const isCoarsePointer = useIsCoarsePointer();
  const leverHitWidth = isCoarsePointer ? 44 : 32;
  const leverHitOffset = leverHitWidth / 2;
  // T6610 item 2: 44px hit box on coarse pointers for the per-block controls
  // (delete/toggle), 28px on fine pointers.
  const controlHitClass = isCoarsePointer ? 'w-11 h-11' : 'w-7 h-7';

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

  // Snap an arbitrary TIME to the nearest clip boundary within SNAP_PX (the same
  // math the levers use, just decoupled from a clientX so the body drag can snap
  // either edge). Returns the raw time unchanged when nothing is within range.
  const snapTimeToBoundary = useCallback((time) => {
    const pxPerSecond = currentPxPerSecond();
    if (!pxPerSecond) return time;
    return snapToBoundary(time, snapCandidates, SNAP_PX, pxPerSecond);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPxPerSecond, JSON.stringify(snapCandidates)]);

  const computeSnappedTime = useCallback((clientX) => {
    return snapTimeToBoundary(pixelToTimeValue(clientX));
  }, [pixelToTimeValue, snapTimeToBoundary]);

  // T6610 -- for a whole-block move, compute the snapped START time by testing
  // BOTH the leading (start) and trailing (end) edges against the clip
  // boundaries and snapping whichever is closer (matching lever behaviour, where
  // the edge nearest a cut snaps). The block shifts rigidly, so snapping the end
  // edge means offsetting the start by the block's duration -- duration is always
  // preserved. Returns the desired start unchanged when neither edge is in range.
  const computeSnappedBodyStart = useCallback((desiredStart, blockDuration) => {
    const desiredEnd = desiredStart + blockDuration;
    const snappedStart = snapTimeToBoundary(desiredStart);
    const snappedEnd = snapTimeToBoundary(desiredEnd);
    const startDelta = Math.abs(snappedStart - desiredStart);
    const endDelta = Math.abs(snappedEnd - desiredEnd);
    const startSnapped = startDelta > 1e-6;
    const endSnapped = endDelta > 1e-6;
    if (startSnapped && (!endSnapped || startDelta <= endDelta)) return snappedStart;
    if (endSnapped) return snappedEnd - blockDuration;
    return desiredStart;
  }, [snapTimeToBoundary]);

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

  // T6610 -- body drag: move the whole block, preserving duration. Persistence is
  // gesture-based: the block updates LOCALLY on every move (commit=false, no
  // network write) so the drag is smooth, and exactly ONE surgical write fires on
  // pointerup (commit=true) via the SAME move/persist path the levers use
  // (onMoveTextBody -> moveTextBlock -> moveTextEdge with both edges). No write
  // happens mid-drag and none from a useEffect.
  useEffect(() => {
    if (!draggingBody) return;

    const handlePointerMove = (e) => {
      if (draggingBody.pointerId != null && e.pointerId !== draggingBody.pointerId) return;
      if (e.cancelable) e.preventDefault();

      if (bodyDownXRef.current != null
          && Math.abs(e.clientX - bodyDownXRef.current) > BODY_DRAG_THRESHOLD_PX) {
        bodyMovedRef.current = true;
      }
      if (!bodyMovedRef.current) return; // sub-threshold: still a click, don't move

      const desiredStart = pixelToTimeValue(e.clientX) - draggingBody.grabOffset;
      const snappedStart = computeSnappedBodyStart(desiredStart, draggingBody.blockDuration);
      onMoveTextBody?.(draggingBody.blockId, snappedStart, false);
    };

    const handlePointerUp = (e) => {
      if (draggingBody.pointerId != null && e.pointerId !== draggingBody.pointerId) return;
      const moved = bodyMovedRef.current;
      if (moved) {
        const desiredStart = pixelToTimeValue(e.clientX) - draggingBody.grabOffset;
        const snappedStart = computeSnappedBodyStart(desiredStart, draggingBody.blockDuration);
        // The single persist for this drag (commit=true).
        onMoveTextBody?.(draggingBody.blockId, snappedStart, true);
      }
      // A click / release-in-place is NOT a move -- selection is handled by the
      // block's onClick, so we commit nothing here.
      bodyDownXRef.current = null;
      bodyMovedRef.current = false;
      setDraggingBody(null);
    };

    const handlePointerCancel = () => {
      bodyDownXRef.current = null;
      bodyMovedRef.current = false;
      setDraggingBody(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [draggingBody, pixelToTimeValue, computeSnappedBodyStart, onMoveTextBody]);

  // T6610 -- keyboard equivalent for the body drag (accessibility). Each arrow
  // press is its own gesture, so each commits ONE surgical write (commit=true);
  // the hook clamps the block inside the reel.
  const nudgeBlock = useCallback((block, deltaSeconds) => {
    if (!onMoveTextBody) return;
    onMoveTextBody(block.id, block.startTime + deltaSeconds, true);
  }, [onMoveTextBody]);

  const handleBlockKeyDown = useCallback((e, block) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeBlock(block, -(e.shiftKey ? KEY_NUDGE_SECONDS_COARSE : KEY_NUDGE_SECONDS));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeBlock(block, e.shiftKey ? KEY_NUDGE_SECONDS_COARSE : KEY_NUDGE_SECONDS);
    }
  }, [nudgeBlock]);

  const handleBodyPointerDown = useCallback((e, block) => {
    // Levers stopPropagation on their own pointerdown, so this only ever fires for
    // a press on the block BODY -- the resize-vs-move hit-test.
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    bodyDownXRef.current = e.clientX;
    bodyMovedRef.current = false;
    const grabOffset = pixelToTimeValue(e.clientX) - block.startTime;
    setDraggingBody({
      blockId: block.id,
      pointerId: e.pointerId,
      grabOffset,
      blockDuration: block.endTime - block.startTime,
    });
  }, [pixelToTimeValue]);

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
    // h-28 (was h-14): the per-block controls render BELOW the h-10 track via
    // `top-full`; the extra lane height reserves clear space between them and the
    // timeline's horizontal scrollbar at the container's bottom edge (T6610 item
    // 2). Keep in sync with OverlayMode.getTotalLayerHeight() + the text label.
    <div className="relative bg-gray-800/95 border-t border-gray-700/50 overflow-visible rounded-r-lg h-28 pb-2">
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
                data-testid={`text-block-body-${block.index}`}
                role="slider"
                tabIndex={0}
                aria-label={`Text block ${block.spec?.text ? `"${block.spec.text}"` : ''} -- drag or use arrow keys to move`}
                aria-valuenow={Math.round(block.startTime * 100) / 100}
                aria-valuemin={0}
                aria-valuemax={duration}
                className={`h-full transition-all relative overflow-hidden border-l-2 border-r-2 border-cyan-400 bg-cyan-500 touch-none select-none cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-cyan-200 ${
                  block.enabled === false ? 'bg-opacity-10' : 'bg-opacity-20'
                } ${isSelected ? 'ring-2 ring-cyan-300' : ''} ${
                  draggingBody?.blockId === block.id ? 'ring-2 ring-cyan-200' : ''
                }`}
                title={block.spec?.text || 'Text block'}
                onPointerDown={(e) => handleBodyPointerDown(e, block)}
                onKeyDown={(e) => handleBlockKeyDown(e, block)}
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

              {/* Toggle (mute/unmute) + Delete. T6610 item 2: the controls sit
                  BELOW the lane, which on a zoomed timeline crowds the horizontal
                  scrollbar -- the parent lane now reserves extra height beneath
                  them (h-28) so there is clear separation, and each control meets
                  the 44px coarse-pointer hit floor (isCoarsePointer ? 44 : 28,
                  the PosterMarkerLayer precedent) with the icon centred. */}
              <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 z-10 flex gap-2">
                <button
                  className={`${controlHitClass} flex items-center justify-center rounded transition-colors bg-gray-700 hover:bg-gray-600 text-white`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleText && onToggleText(block.id, block.enabled === false);
                  }}
                  title={block.enabled === false ? 'Show text' : 'Hide text (keep block)'}
                >
                  {block.enabled === false ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  className={`${controlHitClass} flex items-center justify-center rounded transition-colors bg-red-600 hover:bg-red-700 text-white`}
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
