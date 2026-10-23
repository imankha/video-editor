import { useEffect, useRef, useState } from 'react';
import { Film, Clock } from 'lucide-react';
import { PULSE_CLASS } from './hooks/usePulseHighlight';
import { ANNOTATE } from '../../config/displayNames';

/**
 * VideoLane (T13280) - the desktop timeline's map of a multi-video game: one block per
 * main-footage video directly below the scrubber, tapping a block picks that video
 * (the same `onPick` as the SourceBar under the player, so both surfaces behave as one
 * control). Angles keep their own violet rows (AngleLanes) below this lane.
 *
 * Blocks are positioned on the time axis but never shrink below MIN_BLOCK_PX, and a
 * block that would overlap the previous one is pushed right. So a 19 second video next
 * to an 85 minute one is still a readable, tappable block instead of a 4px sliver; the
 * boundary flag on the Video track above keeps the TRUE position honest.
 *
 * Not mounted on phones (AnnotateTimeline gates on !isMobile): the lane would scroll
 * with the 3x track there, and the SourceBar already lists every video.
 *
 * T13280 follow-up (drag-to-reposition): the block whose sequence matches `fixSequence`
 * (Fix Timing open for it, via the SourceBar's Fix Timing button) becomes horizontally
 * draggable (Pointer Events + setPointerCapture + touch-none, orange styling, same
 * mechanism AngleLanes' drag-in-mode uses) and its click-to-pick is suppressed. Drag is
 * attached ONLY to the fix-target block, so a bare drag off that mode is structurally
 * impossible.
 *
 * The fix-target's rendered LEFT comes straight from `fixPendingOffset` (not from its
 * entry in `videos`, which is frozen to the loaded/committed state -- see
 * AnnotateContainer.videoSegments) so the block visually tracks the pointer on every
 * drag, including one that would create genuine overlap with another video (the common
 * case when the backbone video is most of the game's duration -- almost ANY reposition
 * crosses that line immediately, so freezing there read as "dragging does nothing").
 * This is deliberately decoupled from overlap/angle classification entirely: nothing
 * about which component renders this block, or whether it's still in `videos` at all,
 * changes mid-drag, so there is no remount-under-the-pointer risk. Only on Done does the
 * committed offset get classified for real, promoting it to a genuine angle if it now
 * overlaps something -- this component has no opinion on that, it only reports pixel
 * deltas to `onFixDragTo` and draws wherever the current pending offset says to.
 */

// Minimum rendered width of a block, px. Enough for the icon plus a few characters.
export const MIN_BLOCK_PX = 56;
const GAP_PX = 2;

export default function VideoLane({
  videos = [],
  activeSequence = null,
  duration,
  onPick,
  edgePadding = 20,
  pulseSequence = null,
  fixSequence = null,
  fixPendingOffset = 0,
  onFixDragTo,
  // Fired on pointer up after a real drag: the drop saves (container commits).
  onFixDragEnd,
}) {
  // The inner strip (inside the edge padding) is the usable axis; its width drives the
  // px layout the collision pass needs.
  const innerRef = useRef(null);
  const [innerWidth, setInnerWidth] = useState(0);
  const dragRef = useRef(null); // { startX, startOffset }

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setInnerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!duration || videos.length === 0) return null;

  let cursor = 0;
  const blocks = videos.map((v) => {
    const trueLeft = innerWidth * (v.virtualStart / duration);
    const left = Math.max(trueLeft, cursor);
    const naturalWidth = innerWidth * ((v.virtualEnd - v.virtualStart) / duration);
    const roomRight = Math.max(MIN_BLOCK_PX, innerWidth - left);
    const width = Math.min(Math.max(naturalWidth, MIN_BLOCK_PX), roomRight);
    cursor = left + width + GAP_PX;
    // The fix-target ignores the collision-pushed `left` above and tracks the live
    // pending offset instead (see the file header); its width is unaffected, a drag
    // repositions it, it never resizes.
    const liveLeft = v.sequence === fixSequence && innerWidth > 0
      ? Math.max(0, Math.min(innerWidth - width, innerWidth * (fixPendingOffset / duration)))
      : left;
    return { ...v, left: liveLeft, width };
  });

  // ---- Drag-in-mode (ONLY the fix-target block binds these) ----
  // `fixPendingOffset` (not the block's own `virtualStart`, which is a PLACEMENT, not
  // necessarily the raw offset_seconds for a clock-placed video) is the live truth:
  // it already reflects any prior nudge-button presses by the time a drag starts.
  const onDragPointerDown = (e, sequence) => {
    if (sequence !== fixSequence) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startOffset: fixPendingOffset };
  };
  const onDragPointerMove = (e, sequence) => {
    if (!dragRef.current || sequence !== fixSequence || innerWidth <= 0) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaSeconds = (dx / innerWidth) * duration;
    onFixDragTo?.(dragRef.current.startOffset + deltaSeconds);
  };
  const onDragPointerUp = (e) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const wasDragging = !!dragRef.current;
    dragRef.current = null;
    if (wasDragging) onFixDragEnd?.();
  };

  return (
    <div className="mt-1" data-testid="video-lane">
      <div
        className="relative h-6 bg-gray-800 rounded"
        style={{ paddingLeft: `${edgePadding}px`, paddingRight: `${edgePadding}px` }}
      >
        <div ref={innerRef} className="relative h-full">
          {blocks.map((b) => {
            const isActive = b.sequence === activeSequence;
            const isFixTarget = b.sequence === fixSequence;
            return (
              <button
                key={b.sequence}
                type="button"
                data-testid={`video-block-${b.sequence}`}
                data-fix-target={isFixTarget ? 'true' : 'false'}
                aria-pressed={isActive}
                title={isFixTarget
                  ? ANNOTATE.dragToRepositionTitle(b.name)
                  : (b.placedAtEnd ? ANNOTATE.appendedFootageTitle(b.name) : ANNOTATE.jumpToVideoTitle(b.name))}
                onClick={isFixTarget ? undefined : (e) => { e.stopPropagation(); onPick?.(b.sequence); }}
                onPointerDown={(e) => onDragPointerDown(e, b.sequence)}
                onPointerMove={(e) => onDragPointerMove(e, b.sequence)}
                onPointerUp={onDragPointerUp}
                onPointerCancel={onDragPointerUp}
                className={`absolute top-0 bottom-0 flex items-center gap-1 rounded px-1.5 overflow-hidden text-[11px] font-medium leading-none transition-colors ${
                  isFixTarget
                    ? 'bg-orange-500 text-white ring-2 ring-inset ring-orange-300 cursor-ew-resize'
                    : (isActive
                      ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-300'
                      : 'bg-gray-700 border border-blue-500/30 text-blue-100 hover:bg-gray-600')
                } ${b.sequence === pulseSequence ? PULSE_CLASS : ''}`}
                style={{ left: `${b.left}px`, width: `${b.width}px`, touchAction: isFixTarget ? 'none' : undefined }}
              >
                {b.placedAtEnd
                  ? <Clock size={11} className="shrink-0 text-amber-300" />
                  : <Film size={11} className="shrink-0" />}
                <span className="truncate">{b.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
