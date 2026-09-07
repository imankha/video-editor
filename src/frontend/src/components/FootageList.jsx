import { useEffect, useRef, useState } from 'react';
import { GripVertical, Clock, FileText, AlertTriangle, Check, X, Plus, Camera } from 'lucide-react';
import { useIsCoarsePointer } from '../hooks/useIsMobile';
import { humanizeMinutes, footageEvidence, gapDisplay, overlapSentence, shortLabel } from '../utils/footageDisplay';

/**
 * T8822/T8824 — FootageList: the layered order editor for a multi-file game.
 *
 * Lane 0 stays the original T8822 always-draggable vertical list (order/evidence/
 * trust/junk-disclosure display AND drag-to-reorder). When footage genuinely
 * overlaps (`lanes.length > 1`), a violet angle section renders below it — a
 * time-proportional mini-map plus one labelled row per angle — reusing the SAME
 * `assignLanes` Annotate uses, so the picker's lanes are provably Annotate's
 * lanes (design doc docs/plans/tasks/T8824-design.md §2/§4). This SUPERSEDES
 * T8822's light-touch overlap badge (`overlapGroups`, deleted) — the lanes ARE
 * the overlap disclosure now.
 *
 * `lanes.length === 1` renders BYTE-IDENTICAL to the pre-T8824 component: zero
 * new pixels, same trust line, no angle section, no question, no override link.
 *
 * Drag uses Pointer Events + setPointerCapture + `touch-none` (unchanged from
 * T8822/FootageReorderList — the timeline trim levers/RegionLayer pattern, so a
 * fingertip drag works on mobile). Drag is lane-0-only; dragging folds any
 * showing angles into the one resulting sequential lane (T8824 §4 point 4/6) by
 * appending their names after the dragged lane-0 order before calling onReorder.
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

const ARTIFACT_NAMES_TEXT = 'These look like two parts of one recording - put in order by their names';
const ASK_TRUST_TEXT = "We put them in order by their names - check this looks right";

const LINK_COPY = {
  toSequence: 'Not two cameras? Put them all in order instead',
  toTime: 'Were they filmed at the same time? Show them as angles',
  restoreTime: 'Use the recorded times instead',
};

/** Every item has a usable embedded recording time (the override link only does
 *  something when this is true — forcing 'time' with no clock is a no-op). */
function _allTimed(items) {
  return (
    items.length > 0 &&
    items.every((it) => it.creationTime instanceof Date && !Number.isNaN(it.creationTime.getTime()))
  );
}

/**
 * Trust line + optional override link, derived from the model (no new hook
 * state — T8824 §4.1's copy table). ASK takes priority over everything else.
 */
function deriveTrust({ question, confidence, placement, lanes, lane0Items }, onSetPlacementMode) {
  if (question) {
    return { text: ASK_TRUST_TEXT, Icon: AlertTriangle, cls: 'text-yellow-400', isAsk: true, link: null };
  }
  if (confidence === 'manual') {
    const link = _allTimed(lane0Items)
      ? { text: LINK_COPY.restoreTime, onClick: () => onSetPlacementMode?.('time') }
      : null;
    return { ...TRUST.manual, isAsk: false, link };
  }
  if (placement === 'sequence') {
    if (confidence === 'time') {
      // Slop (Q4): clock evidence is still true even though placement isn't.
      return { ...TRUST.time, isAsk: false, link: null };
    }
    if (_allTimed(lane0Items)) {
      return {
        text: ARTIFACT_NAMES_TEXT,
        Icon: FileText,
        cls: 'text-gray-400',
        isAsk: false,
        link: { text: LINK_COPY.toTime, onClick: () => onSetPlacementMode?.('time') },
      };
    }
    return { ...(TRUST[confidence] || TRUST.unknown), isAsk: false, link: null };
  }
  // placement === 'time'
  if (lanes.length > 1) {
    const n = lanes.length - 1;
    return {
      ...TRUST.time,
      text: `${TRUST.time.text} - and ${n} angle${n !== 1 ? 's' : ''} filmed at the same time`,
      isAsk: false,
      link: { text: LINK_COPY.toSequence, onClick: () => onSetPlacementMode?.('sequence') },
    };
  }
  return { ...TRUST.time, isAsk: false, link: null };
}

export function FootageList({
  items = [],
  confidence = 'unknown',
  gaps = [],
  placement = 'time',
  lanes = [],
  question = null,
  skipped = [],
  onReorder,
  onRemove,
  onAddMore,
  onSetPlacementMode,
}) {
  const isCoarse = useIsCoarsePointer();
  const [dragging, setDragging] = useState(null); // { name, pointerId }
  const rowEls = useRef(new Map());

  const lane0 = lanes[0] ? lanes[0].map((p) => p.item) : [];
  const angleLanes = lanes.slice(1);
  const hasAngles = angleLanes.length > 0;
  const angleNames = angleLanes.flat().map((p) => p.item.name);

  const isUnknown = confidence === 'unknown' || Boolean(question);
  const trust = deriveTrust({ question, confidence, placement, lanes, lane0Items: lane0 }, onSetPlacementMode);
  const gapByIndex = new Map(gaps.map((g) => [g.afterIndex, g.seconds]));

  const probeErrors = items.filter((it) => it.probeError);
  const totalSeconds = lanes.flat().reduce((sum, p) => sum + (p.item.duration || 0), 0);
  const totalVideos = lanes.flat().length;

  const setRowEl = (name) => (el) => {
    if (el) rowEls.current.set(name, el);
    else rowEls.current.delete(name);
  };

  // Window-level listeners so the captured pointer keeps driving the drag even when
  // it leaves the row. Rebinds when `lane0` changes (a live reorder re-renders us),
  // so the closure always sees the current order.
  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (e) => {
      if (dragging.pointerId != null && e.pointerId !== dragging.pointerId) return;
      if (e.cancelable) e.preventDefault();

      if (!lane0.some((it) => it.name === dragging.name)) return;

      const without = lane0.filter((it) => it.name !== dragging.name);
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
      const draggedItem = lane0.find((it) => it.name === dragging.name);
      without.splice(to, 0, draggedItem);
      const changed = without.some((it, i) => it.name !== lane0[i].name);
      // A drag says "the clock is not the order" -- fold any showing angles into
      // the one resulting sequential lane (T8824 §4 point 4/6).
      if (changed) onReorder?.([...without.map((it) => it.name), ...angleNames]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, lanes, onReorder]);

  const containerCls = isUnknown
    ? 'border-yellow-500 bg-yellow-900/20'
    : 'border-green-500 bg-green-900/20';

  return (
    <div data-testid="footage-list" className={`w-full px-4 py-3 border-2 rounded-lg ${containerCls}`}>
      <p className="text-sm font-medium text-gray-200" data-testid="footage-list-header">
        Your game - {totalVideos} videos - {humanizeMinutes(totalSeconds)}
      </p>

      <ul className="mt-3 space-y-1">
        {lane0.map((item, i) => {
          const evidence = footageEvidence(item, confidence);
          const gapSeconds = gapByIndex.get(i);
          const isDragged = dragging?.name === item.name;

          return (
            <li key={item.name}>
              <div
                ref={setRowEl(item.name)}
                data-testid="footage-row"
                className={`flex items-center gap-2 rounded-md bg-gray-800/70 border border-gray-700 px-2 ${
                  isCoarse ? 'min-h-[44px] py-2' : 'py-1.5'
                } ${isDragged ? 'opacity-60' : ''}`}
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

              {/* Gap connector: a break before the NEXT row (never after the last one,
                  even if a stale `gaps` entry named it). */}
              {i < lane0.length - 1 && gapSeconds != null && <GapConnector seconds={gapSeconds} />}
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

      {/* Angle section: only when footage genuinely overlaps. Zero pixels otherwise. */}
      {hasAngles && <AngleLanes lanes={lanes} onRemove={onRemove} />}

      {/* ASK state: one plain question, safe default preselected, submit never blocked. */}
      {question && (
        <div
          className="mt-3 border border-yellow-500/50 bg-yellow-900/25 rounded-md px-3 py-2"
          data-testid="footage-question"
        >
          <p className="text-xs text-yellow-200 mb-2">
            Were {shortLabel(question.a.name)} and {shortLabel(question.b.name)} filmed at the same time?
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onSetPlacementMode?.('sequence')}
              data-testid="footage-question-no"
              className="flex-1 min-w-[140px] min-h-[40px] rounded-md border border-green-500 bg-green-900/35 text-green-200 text-xs px-2"
            >
              No - two parts of one game
            </button>
            <button
              type="button"
              onClick={() => onSetPlacementMode?.('time')}
              data-testid="footage-question-yes"
              className="flex-1 min-w-[140px] min-h-[40px] rounded-md border border-gray-600 bg-gray-900 text-gray-200 text-xs px-2"
            >
              Yes - two cameras at once
            </button>
          </div>
        </div>
      )}

      {/* Trust line. */}
      <div className={`flex items-center gap-1.5 text-xs mt-3 ${trust.cls}`} data-testid="footage-trust-line">
        <trust.Icon size={14} className="shrink-0" />
        <span>{trust.text}</span>
      </div>

      {/* One override link, three phrasings, one code path (setPlacementMode). */}
      {trust.link && (
        <button
          type="button"
          onClick={trust.link.onClick}
          className="mt-2 text-[11px] text-blue-400 hover:text-blue-300 underline"
          data-testid="footage-override-link"
        >
          {trust.link.text}
        </button>
      )}

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

/**
 * T8824 — the violet angle section: a time-proportional mini-map (lane 0 gray
 * blocks, angle lanes violet) plus one labelled row per angle, flattened across
 * angle lanes and sorted by when they start. Reuses `assignLanes`'s lane numbers
 * verbatim (`lanes` prop) so this is provably the same picture Annotate renders.
 */
function AngleLanes({ lanes, onRemove }) {
  const isCoarse = useIsCoarsePointer();
  const allPlaced = lanes.flat();
  const spanSeconds = Math.max(1, ...allPlaced.map((p) => p.endSeconds));
  const pct = (n) => `${Math.max(0, Math.min(100, (n / spanSeconds) * 100))}%`;

  const angleRows = lanes
    .slice(1)
    .flat()
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);

  const partnersFor = (placed) =>
    allPlaced
      .filter((p) => p !== placed)
      .map((p) => ({
        item: p.item,
        overlapAmount: Math.min(placed.endSeconds, p.endSeconds) - Math.max(placed.offsetSeconds, p.offsetSeconds),
      }))
      .filter((p) => p.overlapAmount > 0)
      .sort((a, b) => b.overlapAmount - a.overlapAmount)
      .map((p) => p.item);

  return (
    <div className="mt-3 pt-2 border-t border-violet-500/35" data-testid="footage-angle-section">
      <p className="text-[11px] text-violet-300 mb-1.5">Also filmed at the same time</p>

      <div className="mb-2" data-testid="footage-angle-minimap">
        {lanes.map((lane, laneIndex) => (
          <div key={laneIndex} className="relative h-3.5 mb-1 rounded bg-gray-700/35">
            {lane.map((p) => (
              <div
                key={p.item.name}
                className={`absolute top-0 bottom-0 rounded ${
                  laneIndex === 0 ? 'bg-gray-500 border border-gray-400' : 'bg-violet-500 border border-violet-300'
                }`}
                style={{ left: pct(p.offsetSeconds), width: pct(p.endSeconds - p.offsetSeconds) }}
              />
            ))}
          </div>
        ))}
      </div>

      {angleRows.map((placed) => (
        <div
          key={placed.item.name}
          className={`flex items-center gap-2 rounded-md bg-violet-900/25 border border-violet-500/60 px-2 mb-1 ${
            isCoarse ? 'min-h-[44px] py-2' : 'py-1.5'
          }`}
          data-testid="footage-angle-row"
        >
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-violet-700 text-violet-100 shrink-0">
            <Camera size={12} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-200 truncate" title={placed.item.name}>
              {placed.item.name}
            </div>
            <div className="text-[11px] text-violet-300" data-testid="footage-angle-row-sub">
              {overlapSentence(placed.item, partnersFor(placed))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRemove?.(placed.item.name)}
            aria-label={`Remove ${placed.item.name}`}
            className={`shrink-0 rounded-full text-gray-400 hover:text-white flex items-center justify-center ${
              isCoarse ? 'w-11 h-11' : 'w-7 h-7'
            }`}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default FootageList;
