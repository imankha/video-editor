import { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { useIsCoarsePointer } from '../hooks/useIsMobile';
import { humanizeMinutes, footageEvidence } from '../utils/footageDisplay';

/**
 * T8820 — FootageReorderList: the vertical drag-to-reorder editor that opens under
 * the confirm strip when the user taps "Adjust order" (and auto-opens when the
 * order is `unknown`). Dragging live-updates the strip; ANY manual reorder calls
 * onReorder, which the parent routes to `setManualOrder` — flipping the trust line
 * to "Order set by you".
 *
 * Drag uses Pointer Events + setPointerCapture + `touch-none`, the same pattern as
 * the timeline trim levers (RegionLayer) so a fingertip drag works on mobile: mouse
 * events only synthesize after touchend, so a mouse-based drag never moves on a
 * phone. Rows are >=44px tall on coarse pointers.
 */
export function FootageReorderList({ order = [], confidence = 'unknown', onReorder, onRemove, onClose }) {
  const isCoarse = useIsCoarsePointer();
  const [dragging, setDragging] = useState(null); // { name, pointerId }
  const rowEls = useRef(new Map());

  const setRowEl = (name) => (el) => {
    if (el) rowEls.current.set(name, el);
    else rowEls.current.delete(name);
  };

  // Window-level listeners so the captured pointer keeps driving the drag even when
  // it leaves the row. Rebinds when `order` changes (a live reorder re-renders us),
  // so the closure always sees the current order — same reasoning as RegionLayer.
  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (e) => {
      if (dragging.pointerId != null && e.pointerId !== dragging.pointerId) return;
      if (e.cancelable) e.preventDefault();

      if (!order.some((it) => it.name === dragging.name)) return;

      // Insertion slot = first non-dragged row whose vertical midpoint the pointer
      // sits above; default to the end.
      const without = order.filter((it) => it.name !== dragging.name);
      let to = without.length;
      for (let idx = 0; idx < without.length; idx++) {
        const el = rowEls.current.get(without[idx].name);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (e.clientY < mid) {
          to = idx;
          break;
        }
      }
      const draggedItem = order.find((it) => it.name === dragging.name);
      without.splice(to, 0, draggedItem);
      const nextNames = without.map((it) => it.name);
      const changed = nextNames.some((n, i) => n !== order[i].name);
      if (changed) onReorder?.(nextNames);
    };

    const handlePointerUp = (e) => {
      if (dragging.pointerId != null && e.pointerId !== dragging.pointerId) return;
      setDragging(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragging, order, onReorder]);

  return (
    <div
      data-testid="footage-reorder-list"
      className="w-full mt-2 px-4 py-3 rounded-lg border bg-yellow-950/20 border-yellow-800/40"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-200">Fix the order</p>
        <button
          type="button"
          onClick={() => onClose?.()}
          className={`text-xs text-blue-400 hover:text-blue-300 flex items-center justify-center ${
            isCoarse ? 'min-h-[44px] min-w-[44px]' : ''
          }`}
          data-testid="footage-reorder-done"
        >
          Done
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">Drag to match how the game was played</p>

      <ul className="mt-2 space-y-1">
        {order.map((item, i) => {
          const evidence = footageEvidence(item, confidence);
          const isDragged = dragging?.name === item.name;
          return (
            <li
              key={item.name}
              ref={setRowEl(item.name)}
              data-testid="footage-reorder-row"
              className={`flex items-center gap-2 rounded-md bg-gray-800/70 border border-gray-700 px-2 ${
                isCoarse ? 'min-h-[44px] py-2' : 'py-1.5'
              } ${isDragged ? 'opacity-60' : ''}`}
            >
              <div
                data-testid={`footage-reorder-handle-${i}`}
                className="drag-handle touch-none cursor-grab text-gray-500 hover:text-gray-300 shrink-0"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  setDragging({ name: item.name, pointerId: e.pointerId });
                }}
              >
                <GripVertical size={16} />
              </div>
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 ${
                  confidence === 'unknown' ? 'bg-yellow-600' : 'bg-green-600'
                }`}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-200 truncate" title={item.name}>
                  {item.name}
                </div>
                <div className="text-[11px] text-gray-400">
                  {humanizeMinutes(item.duration)}
                  {evidence.mono ? (
                    <span className="font-mono ml-1">{evidence.text}</span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove?.(item.name)}
                aria-label={`Remove ${item.name}`}
                className={`shrink-0 rounded-full text-gray-400 hover:text-white flex items-center justify-center ${
                  isCoarse ? 'w-11 h-11' : 'w-7 h-7'
                }`}
              >
                <X size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default FootageReorderList;
