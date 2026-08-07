import { useState, useRef, useCallback, useEffect } from 'react';
import { useIsCoarsePointer } from '../../hooks/useIsMobile';
import { snapToBoundary } from '../../utils/textSnapping';

// T5225 -- Overlay text range layer. A near-clone of RegionLayer's
// pointer-event drag mechanics (design §3.1) -- NOT a new drag idiom. The one
// addition is clip-boundary SNAPPING on the edge levers (design §3.2, epic
// decision 4): a drag ending within SNAP_PX of a clip boundary (or the reel
// start/end) snaps onto it; otherwise it free-parks at the raw time.
//
// T6630 round 4 -- MODEL REFRAME: each block on this lane is now a REGION (a
// time span) that can CONTAIN MULTIPLE ELEMENTS, all rendering simultaneously
// during the region's window (user direction: "a text region can have
// multiple text elements"). This lane still shows ONE block per region --
// element management (add/remove/settings) lives entirely in the Text tab
// (TextManagementPanel); this lane is TIMING ONLY (drag the body, drag a
// lever, arrow-key nudge, keyboard delete the REGION).
const SNAP_PX = 10; // px radius, converted to a time delta at drag time (zoom-invariant)

// T6610 -- pointer travel (px) below which a body pointerdown->up is a CLICK
// (select the region), not a drag (move it). Mirrors PosterMarkerLayer's
// DRAG_THRESHOLD_PX (T6560): small enough that any intended drag clears it, large
// enough to swallow the sub-pixel jitter of a click-in-place -- so grabbing a
// block to SELECT it never nudges its time.
const BODY_DRAG_THRESHOLD_PX = 4;
const KEY_NUDGE_SECONDS = 1 / 30;      // one frame at 30fps (matches PosterMarkerLayer)
const KEY_NUDGE_SECONDS_COARSE = 1.0;  // Shift+Arrow: a bigger, 1-second step

// A region's on-lane LABEL: the first element's text, plus a count when the
// region holds more than one (e.g. "My Text +2") -- so the lane hints at
// multi-element regions without needing to open the Text tab.
function regionLabel(region) {
  const elements = region.elements || [];
  const first = elements[0]?.spec?.text || 'Text';
  return elements.length > 1 ? `${first} +${elements.length - 1}` : first;
}

export default function TextLayer({
  regions = [],
  duration,
  visualDuration,
  clipBoundaries = [],
  selectedRegionId = null,
  onAddRegion,
  onMoveTextStart,
  onMoveTextEnd,
  onMoveTextBody,
  onSelectRegion,
  onDeleteTextRegion,
  visualTimeToSourceTime = (t) => t,
  edgePadding = 20,
}) {
  const [draggingLever, setDraggingLever] = useState(null); // { regionId, type: 'start' | 'end', pointerId }
  // T6610 -- body drag (move the whole region, duration preserved). Separate
  // from draggingLever so the lever code path is untouched: a pointerdown on
  // a lever stops propagation before it ever reaches the body handler, so a
  // lever press still RESIZES and a body press MOVES (the hit-testing the
  // task calls out).
  const [draggingBody, setDraggingBody] = useState(null); // { regionId, pointerId, grabOffset, blockDuration }
  const bodyDownXRef = useRef(null);
  const bodyMovedRef = useRef(false);
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

  // T6610 -- for a whole-region move, compute the snapped START time by testing
  // BOTH the leading (start) and trailing (end) edges against the clip
  // boundaries and snapping whichever is closer (matching lever behaviour, where
  // the edge nearest a cut snaps). The region shifts rigidly, so snapping the end
  // edge means offsetting the start by the region's duration -- duration is always
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
      const region = regions.find(r => r.id === draggingLever.regionId);
      if (!region) return;

      if (draggingLever.type === 'start' && onMoveTextStart) {
        onMoveTextStart(draggingLever.regionId, newTime);
      } else if (draggingLever.type === 'end' && onMoveTextEnd) {
        onMoveTextEnd(draggingLever.regionId, newTime);
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
  }, [draggingLever, regions, onMoveTextStart, onMoveTextEnd, computeSnappedTime]);

  // T6610 -- body drag: move the whole region, preserving duration. Persistence is
  // gesture-based: the region updates LOCALLY on every move (commit=false, no
  // network write) so the drag is smooth, and exactly ONE surgical write fires on
  // pointerup (commit=true) via the SAME move/persist path the levers use
  // (onMoveTextBody -> moveRegionBlock -> moveTextEdge with both edges). No write
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
      onMoveTextBody?.(draggingBody.regionId, snappedStart, false);
    };

    const handlePointerUp = (e) => {
      if (draggingBody.pointerId != null && e.pointerId !== draggingBody.pointerId) return;
      const moved = bodyMovedRef.current;
      if (moved) {
        const desiredStart = pixelToTimeValue(e.clientX) - draggingBody.grabOffset;
        const snappedStart = computeSnappedBodyStart(desiredStart, draggingBody.blockDuration);
        // The single persist for this drag (commit=true).
        onMoveTextBody?.(draggingBody.regionId, snappedStart, true);
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
  // the hook clamps the region inside the reel.
  const nudgeBlock = useCallback((region, deltaSeconds) => {
    if (!onMoveTextBody) return;
    onMoveTextBody(region.id, region.startTime + deltaSeconds, true);
  }, [onMoveTextBody]);

  const handleBlockKeyDown = useCallback((e, region) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeBlock(region, -(e.shiftKey ? KEY_NUDGE_SECONDS_COARSE : KEY_NUDGE_SECONDS));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeBlock(region, e.shiftKey ? KEY_NUDGE_SECONDS_COARSE : KEY_NUDGE_SECONDS);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // T6630 round 4 -- keyboard delete of the focused REGION (deletes every
      // element inside it too, one surgical write). The lane's addressable
      // unit is the region, not an individual element.
      e.preventDefault();
      onDeleteTextRegion && onDeleteTextRegion(region.id);
    }
  }, [nudgeBlock, onDeleteTextRegion]);

  const handleBodyPointerDown = useCallback((e, region) => {
    // Levers stopPropagation on their own pointerdown, so this only ever fires for
    // a press on the block BODY -- the resize-vs-move hit-test.
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    bodyDownXRef.current = e.clientX;
    bodyMovedRef.current = false;
    const grabOffset = pixelToTimeValue(e.clientX) - region.startTime;
    setDraggingBody({
      regionId: region.id,
      pointerId: e.pointerId,
      grabOffset,
      blockDuration: region.endTime - region.startTime,
    });
  }, [pixelToTimeValue]);

  // T6630 round 5 -- user direction reversed round 3's "Text tab only" call:
  // "Adding/selecting a text region is something that is done on the
  // timeline, not in settings." Mirrors RegionLayer's highlight-mode
  // handleTrackClick (mode === 'highlight' -> onAddRegion(time)): a click on
  // EMPTY track area creates a region at that time. Existing region bodies
  // and levers already stopPropagation on their own onClick/onPointerDown
  // (see handleBodyPointerDown above and the lever handlers below), so a
  // click there never reaches this handler -- no extra target checks needed.
  const handleTrackClick = useCallback((e) => {
    if (!onAddRegion) return;
    const time = pixelToTimeValue(e.clientX);
    onAddRegion(time);
  }, [onAddRegion, pixelToTimeValue]);

  if (!duration) return null;

  // T6630 round 5 -- the lane is TIMING *and* CREATION: a click on empty
  // track area adds a region there (see handleTrackClick above), matching
  // how the highlight lane already works. Element management (add/remove
  // elements within a region, settings) still lives entirely in the Text
  // tab -- only whole-region creation moved back to the timeline. This lane
  // also still supports keyboard Delete/Backspace on the focused region.
  return (
    <div className="relative bg-gray-800/95 border-t border-gray-700/50 overflow-visible rounded-r-lg h-28 pb-2">
      <div
        ref={trackRef}
        className="text-track absolute inset-x-0 top-0 h-10 overflow-visible rounded-r-lg cursor-pointer"
        onClick={handleTrackClick}
      >
        <div className="absolute inset-0 bg-cyan-900 bg-opacity-10 rounded-r-lg" />

        {regions.map((region) => {
          const isDraggingThisBlock = draggingLever?.regionId === region.id;
          const isSelected = selectedRegionId === region.id;
          const elements = region.elements || [];
          const allDisabled = elements.length > 0 && elements.every((el) => el.enabled === false);

          return (
            <div
              key={region.id}
              className="absolute top-0 h-10 overflow-visible"
              style={{
                left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${region.visualStartPercent / 100})`,
                width: `calc((100% - ${edgePadding * 2}px) * ${region.visualWidthPercent / 100})`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectRegion && onSelectRegion(region.id);
              }}
            >
              <div
                data-testid={`text-block-body-${region.index}`}
                role="slider"
                tabIndex={0}
                aria-label={`Text region "${regionLabel(region)}" -- drag or use arrow keys to move`}
                aria-valuenow={Math.round(region.startTime * 100) / 100}
                aria-valuemin={0}
                aria-valuemax={duration}
                className={`h-full transition-all relative overflow-hidden border-l-2 border-r-2 border-cyan-400 bg-cyan-500 touch-none select-none cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-cyan-200 hover:bg-opacity-40 hover:ring-1 hover:ring-cyan-300/70 ${
                  allDisabled ? 'bg-opacity-10' : 'bg-opacity-20'
                } ${isSelected ? 'ring-2 ring-cyan-300' : ''} ${
                  draggingBody?.regionId === region.id ? 'ring-2 ring-cyan-200' : ''
                }`}
                title={regionLabel(region)}
                onPointerDown={(e) => handleBodyPointerDown(e, region)}
                onKeyDown={(e) => handleBlockKeyDown(e, region)}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-1">
                  <span className="text-[10px] text-cyan-100 truncate">{regionLabel(region)}</span>
                </div>
              </div>

              {/* Start lever */}
              <div
                data-testid={`text-lever-start-${region.index}`}
                className="lever-handle absolute top-0 h-full flex items-end pointer-events-auto touch-none"
                style={{ left: `-${leverHitOffset}px`, width: `${leverHitWidth}px`, zIndex: 100 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDraggingLever({ regionId: region.id, type: 'start', pointerId: e.pointerId });
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
                data-testid={`text-lever-end-${region.index}`}
                className="lever-handle absolute top-0 h-full flex items-end justify-end pointer-events-auto touch-none"
                style={{ right: `-${leverHitOffset}px`, width: `${leverHitWidth}px`, zIndex: 100 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDraggingLever({ regionId: region.id, type: 'end', pointerId: e.pointerId });
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
