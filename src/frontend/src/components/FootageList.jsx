import { useEffect, useRef, useState } from 'react';
import { GripVertical, Clock, FileText, AlertTriangle, Check, X, Plus, Layers } from 'lucide-react';
import { useIsCoarsePointer } from '../hooks/useIsMobile';
import { humanizeMinutes, footageEvidence, gapDisplay, overlapGroups, shortLabel } from '../utils/footageDisplay';

/**
 * T8822 — FootageList: the trust-building confirm list for a multi-file game.
 *
 * Replaces T8820's FootageStrip + FootageReorderList (live-testing feedback: every
 * video showed in two places — a horizontal chip for confirmation and a separate
 * vertical row for reordering). ONE always-draggable vertical list now does both:
 * order/evidence/trust/junk-disclosure display AND drag-to-reorder, with no separate
 * "Adjust order" mode to open or close.
 *
 * Drag uses Pointer Events + setPointerCapture + `touch-none`, unchanged from
 * FootageReorderList (same pattern as the timeline trim levers/RegionLayer, so a
 * fingertip drag works on mobile — mouse events only synthesize after touchend).
 *
 * Overlap badge (new): a light-touch, purely informational heads-up when two items'
 * recorded time ranges intersect (`overlapGroups` in footageDisplay.js) — NOT the real
 * lane/angle system (T8880/T8890 own that in Annotate against the server's canonical
 * offset_seconds). Violet, matching the eventual angle color (EPIC decision 8).
 */

const TRUST = {
  time: { text: 'Put in order by the time each was recorded', Icon: Clock, cls: 'text-green-400' },
  name: { text: 'Put in order by their names', Icon: FileText, cls: 'text-gray-400' },
  unknown: {
    text: "We couldn't tell what order these go in - please check",
    Icon: AlertTriangle,
    cls: 'text-yellow-400',
  },
  manual: { text: 'Order set by you', Icon: Check, cls: 'text-green-400' },
};

// A JS string (not raw JSX text) so the apostrophes need no HTML-entity escaping.
// `extraCount` names the rest when an item overlaps more than one other (rare, but
// overlapGroups reports every partner - don't silently drop them from the copy).
const OVERLAP_BADGE_TEXT = (label, extraCount) =>
  `Looks like this overlaps with ${label}${extraCount > 0 ? ` (and ${extraCount} more)` : ''} -` +
  ` that's fine, we'll treat it as a second angle.`;

export function FootageList({
  order = [],
  items = [],
  confidence = 'unknown',
  gaps = [],
  skipped = [],
  onReorder,
  onRemove,
  onAddMore,
}) {
  const isCoarse = useIsCoarsePointer();
  const [dragging, setDragging] = useState(null); // { name, pointerId }
  const rowEls = useRef(new Map());

  const isUnknown = confidence === 'unknown';
  const trust = TRUST[confidence] || TRUST.unknown;
  const gapByIndex = new Map(gaps.map((g) => [g.afterIndex, g.seconds]));
  const overlaps = overlapGroups(order, confidence);

  const probeErrors = items.filter((it) => it.probeError);
  const totalSeconds = order.reduce((sum, it) => sum + (it.duration || 0), 0);

  const setRowEl = (name) => (el) => {
    if (el) rowEls.current.set(name, el);
    else rowEls.current.delete(name);
  };

  // Window-level listeners so the captured pointer keeps driving the drag even when
  // it leaves the row. Rebinds when `order` changes (a live reorder re-renders us),
  // so the closure always sees the current order.
  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (e) => {
      if (dragging.pointerId != null && e.pointerId !== dragging.pointerId) return;
      if (e.cancelable) e.preventDefault();

      if (!order.some((it) => it.name === dragging.name)) return;

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

  const containerCls = isUnknown
    ? 'border-yellow-500 bg-yellow-900/20'
    : 'border-green-500 bg-green-900/20';

  return (
    <div data-testid="footage-list" className={`w-full px-4 py-3 border-2 rounded-lg ${containerCls}`}>
      <p className="text-sm font-medium text-gray-200" data-testid="footage-list-header">
        Your game - {order.length} videos - {humanizeMinutes(totalSeconds)}
      </p>

      <ul className="mt-3 space-y-1">
        {order.map((item, i) => {
          const evidence = footageEvidence(item, confidence);
          const gapSeconds = gapByIndex.get(i);
          const isDragged = dragging?.name === item.name;
          const overlapNames = overlaps.get(item.name);

          return (
            <li key={item.name}>
              <div
                ref={setRowEl(item.name)}
                data-testid="footage-row"
                className={`flex items-center gap-2 rounded-md bg-gray-800/70 border px-2 ${
                  overlapNames ? 'border-violet-500/60' : 'border-gray-700'
                } ${isCoarse ? 'min-h-[44px] py-2' : 'py-1.5'} ${isDragged ? 'opacity-60' : ''}`}
              >
                <div
                  data-testid={`footage-row-handle-${i}`}
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
                    isUnknown ? 'bg-yellow-600' : 'bg-green-600'
                  }`}
                >
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-200 truncate" title={item.name}>
                    {item.name}
                  </div>
                  <div className="text-[11px] text-gray-400" data-testid="footage-row-evidence">
                    {humanizeMinutes(item.duration)}
                    {/* Non-mono evidence IS the filename, already shown on the title line above -
                        only the clock-time evidence adds new information here. */}
                    {evidence.mono ? <span className="font-mono ml-1">{evidence.text}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove?.(item.name)}
                  aria-label={`Remove ${item.name}`}
                  data-testid="footage-row-remove"
                  className={`shrink-0 rounded-full text-gray-400 hover:text-white flex items-center justify-center ${
                    isCoarse ? 'w-11 h-11' : 'w-7 h-7'
                  }`}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Overlap badge: informational only, never blocks or reorders anything. */}
              {overlapNames && overlapNames.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-[11px] text-violet-400 mt-1 ml-8"
                  data-testid="footage-overlap-badge"
                >
                  <Layers size={12} className="shrink-0" />
                  <span>
                    {OVERLAP_BADGE_TEXT(shortLabel(overlapNames[0]), overlapNames.length - 1)}
                  </span>
                </div>
              )}

              {/* Gap connector: a break before the NEXT row (never after the last one,
                  even if a stale `gaps` entry named it). */}
              {i < order.length - 1 && gapSeconds != null && <GapConnector seconds={gapSeconds} />}
            </li>
          );
        })}

        {/* Unreadable files: red row, remove is the ONLY action, always visible. */}
        {probeErrors.map((item) => (
          <li key={item.name}>
            <div
              className={`flex items-center gap-2 rounded-md bg-red-900/30 border border-red-600 px-2 ${
                isCoarse ? 'min-h-[44px] py-2' : 'py-1.5'
              }`}
              data-testid="footage-row-error"
            >
              <div className="min-w-0 flex-1 text-[11px] text-red-300 truncate" title={item.name}>
                {"Can't read this one"} - {item.name}
              </div>
              <button
                type="button"
                onClick={() => onRemove?.(item.name)}
                aria-label={`Remove ${item.name}`}
                className={`shrink-0 rounded-full text-red-300 hover:text-white flex items-center justify-center ${
                  isCoarse ? 'w-11 h-11' : 'w-7 h-7'
                }`}
              >
                <X size={16} />
              </button>
            </div>
          </li>
        ))}

        {/* Drops still merge via the container drop target; this row opens the picker. */}
        <li>
          <button
            type="button"
            onClick={() => onAddMore?.()}
            className={`w-full flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-gray-600 hover:border-gray-500 text-gray-400 hover:text-gray-300 ${
              isCoarse ? 'min-h-[44px]' : 'py-1.5'
            }`}
            data-testid="footage-add-more"
          >
            <Plus size={16} />
            <span className="text-xs">Add more</span>
          </button>
        </li>
      </ul>

      {/* Trust line. */}
      <div className={`flex items-center gap-1.5 text-xs mt-3 ${trust.cls}`} data-testid="footage-trust-line">
        <trust.Icon size={14} className="shrink-0" />
        <span>{trust.text}</span>
      </div>

      {/* Skipped junk: quiet gray disclosure, never a warning color. */}
      {skipped.length > 0 && (
        <details className="mt-2 text-xs text-gray-500" data-testid="footage-skipped">
          <summary className="cursor-pointer">
            Skipped {skipped.length} extra camera file{skipped.length !== 1 ? 's' : ''}
          </summary>
          <ul className="mt-1 pl-4 list-disc">
            {skipped.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-gray-600">Photos and helper files the camera makes - not game video.</p>
        </details>
      )}
    </div>
  );
}

/** A break between two continuous segments. Normal breaks are a dashed gray divider;
 *  a >3hr gap turns yellow and asks whether it is a second game. */
function GapConnector({ seconds }) {
  const { huge, label } = gapDisplay(seconds);
  if (huge) {
    return (
      <div
        className="flex flex-col items-center py-1 my-1 text-center text-yellow-400 border-t-2 border-dashed border-yellow-500"
        data-testid="footage-gap-connector"
        data-huge="true"
      >
        <span className="text-[11px] font-medium">{label}</span>
        <span className="text-[10px] text-yellow-500/80 leading-tight">
          If some of these are a different game, remove them here and upload that game separately.
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center justify-center py-1 my-1 text-gray-500 border-t-2 border-dashed border-gray-600"
      data-testid="footage-gap-connector"
      data-huge="false"
    >
      <span className="text-[11px]">{label}</span>
    </div>
  );
}

export default FootageList;
