import { useRef, useState } from 'react';
import { Clock, FileText, AlertTriangle, Check, ChevronRight, Plus, X } from 'lucide-react';
import { useIsCoarsePointer } from '../hooks/useIsMobile';
import { humanizeMinutes, footageEvidence, gapDisplay } from '../utils/footageDisplay';

/**
 * T8820 — FootageStrip: the trust-building confirm strip for a multi-file game.
 *
 * Purely presentational: renders `useFootageIntake` state (order, confidence, gaps,
 * skipped) as evidence-bearing chips joined by chevrons / labelled gap connectors,
 * one plain-language trust line, a humanized header, a "+ Add more" chip and the
 * skipped-junk disclosure. All order/junk logic lives upstream in the hook — this
 * only shows what it decided. Callbacks (onRemove/onAddMore/onAdjustOrder) are the
 * user gestures the parent wires to the hook.
 *
 * The ALWAYS-visible per-row remove lives on FootageReorderList; the chip X here is
 * a SECONDARY path (hover on desktop, long-press on coarse pointers). A probeError
 * chip is the exception: its remove is always visible because removing it is the
 * chip's only action.
 */

// Trust line: exact approved strings + icon + color per confidence (artifact 03-C).
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

const LONG_PRESS_MS = 500;

export function FootageStrip({
  order = [],
  items = [],
  confidence = 'unknown',
  gaps = [],
  skipped = [],
  onRemove,
  onAddMore,
  onAdjustOrder,
}) {
  const isCoarse = useIsCoarsePointer();
  // Coarse-pointer long-press reveals a single chip's X (fine pointers use hover).
  const [revealedRemove, setRevealedRemove] = useState(null);
  const longPressTimer = useRef(null);

  const isUnknown = confidence === 'unknown';
  const trust = TRUST[confidence] || TRUST.unknown;
  const gapByIndex = new Map(gaps.map((g) => [g.afterIndex, g.seconds]));

  // Unreadable files are kept so the user can see + remove them, but excluded from
  // the ordered timeline and from the header totals.
  const probeErrors = items.filter((it) => it.probeError);
  const totalSeconds = order.reduce((sum, it) => sum + (it.duration || 0), 0);

  const startLongPress = (name) => {
    if (!isCoarse) return;
    clearLongPress();
    longPressTimer.current = setTimeout(() => setRevealedRemove(name), LONG_PRESS_MS);
  };
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const removeVisibilityCls = (name) =>
    isCoarse
      ? revealedRemove === name
        ? 'opacity-100'
        : 'opacity-0'
      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

  const containerCls = isUnknown
    ? 'border-yellow-500 bg-yellow-900/20'
    : 'border-green-500 bg-green-900/20';

  return (
    <div
      data-testid="footage-strip"
      className={`w-full px-4 py-3 border-2 rounded-lg ${containerCls}`}
    >
      <p className="text-sm font-medium text-gray-200" data-testid="footage-strip-header">
        Your game - {order.length} videos - {humanizeMinutes(totalSeconds)}
      </p>

      {/* Chip row: evidence-bearing cards joined by chevrons / gap connectors. */}
      <div className="flex gap-2 overflow-x-auto snap-x mt-3 pb-1">
        {order.map((item, i) => {
          const evidence = footageEvidence(item, confidence);
          const gapSeconds = gapByIndex.get(i);
          return (
            <div key={item.name} className="flex items-stretch gap-2 shrink-0">
              <div
                className="group relative w-[88px] shrink-0 snap-start rounded-md bg-gray-800/70 border border-gray-700 p-2 text-center"
                title={item.name}
                aria-label={item.name}
                onPointerDown={() => startLongPress(item.name)}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                data-testid="footage-chip"
              >
                <div
                  className={`mx-auto w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white ${
                    isUnknown ? 'bg-yellow-600' : 'bg-green-600'
                  }`}
                >
                  {i + 1}
                </div>
                <div className="mt-1 text-xs text-gray-300">{humanizeMinutes(item.duration)}</div>
                <div
                  className={`mt-0.5 text-[11px] text-gray-400 truncate ${
                    evidence.mono ? 'font-mono' : ''
                  }`}
                  data-testid="footage-chip-evidence"
                >
                  {evidence.text}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove?.(item.name)}
                  aria-label={`Remove ${item.name}`}
                  className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 border border-gray-600 text-gray-300 hover:text-white flex items-center justify-center transition-opacity ${removeVisibilityCls(
                    item.name
                  )}`}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Connector to the next chip: gap -> dashed label; else a chevron. */}
              {i < order.length - 1 &&
                (gapSeconds != null ? (
                  <GapConnector seconds={gapSeconds} />
                ) : (
                  <div className="flex items-center text-gray-600" aria-hidden="true">
                    <ChevronRight size={16} />
                  </div>
                ))}
            </div>
          );
        })}

        {/* Unreadable files: red chip, remove is the ONLY action, always visible. */}
        {probeErrors.map((item) => (
          <div
            key={item.name}
            className="w-[88px] shrink-0 snap-start rounded-md bg-red-900/30 border border-red-600 p-2 text-center relative"
            title={item.name}
            aria-label={item.name}
            data-testid="footage-chip-error"
          >
            <div className="text-[11px] text-red-300 leading-tight mt-3">{"Can't read this one"}</div>
            <button
              type="button"
              onClick={() => onRemove?.(item.name)}
              aria-label={`Remove ${item.name}`}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 border border-red-600 text-red-300 hover:text-white flex items-center justify-center"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Drops still merge via the container drop target; this chip opens the picker. */}
        <button
          type="button"
          onClick={() => onAddMore?.()}
          className="w-[88px] shrink-0 snap-start rounded-md border-2 border-dashed border-gray-600 hover:border-gray-500 text-gray-400 hover:text-gray-300 flex flex-col items-center justify-center py-2"
          data-testid="footage-add-more"
        >
          <Plus size={18} />
          <span className="text-[11px] mt-1">Add more</span>
        </button>
      </div>

      {/* Trust line + always-visible Adjust order button. */}
      <div className="flex items-center justify-between mt-3 gap-2">
        <div className={`flex items-center gap-1.5 text-xs ${trust.cls}`} data-testid="footage-trust-line">
          <trust.Icon size={14} className="shrink-0" />
          <span>{trust.text}</span>
        </div>
        <button
          type="button"
          onClick={() => onAdjustOrder?.()}
          className={`text-xs text-blue-400 hover:text-blue-300 shrink-0 flex items-center justify-center ${
            isCoarse ? 'min-h-[44px] min-w-[44px]' : ''
          }`}
          data-testid="footage-adjust-order"
        >
          Adjust order
        </button>
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
          <p className="mt-1 text-gray-600">
            Photos and helper files the camera makes - not game video.
          </p>
        </details>
      )}
    </div>
  );
}

/** A break between two continuous segments. Normal breaks are a dashed gray
 *  connector; a >3hr gap turns yellow and asks whether it is a second game. */
function GapConnector({ seconds }) {
  const { huge, label } = gapDisplay(seconds);
  if (huge) {
    return (
      <div
        className="flex flex-col items-center justify-center px-1 text-center text-yellow-400 border-l-2 border-dashed border-yellow-500"
        data-testid="footage-gap-connector"
        data-huge="true"
      >
        <span className="text-[11px] font-medium whitespace-nowrap">{label}</span>
        <span className="text-[10px] text-yellow-500/80 max-w-[120px] leading-tight">
          If some of these are a different game, remove them here and upload that game separately.
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center px-1 text-gray-500 border-l-2 border-dashed border-gray-600"
      data-testid="footage-gap-connector"
      data-huge="false"
    >
      <span className="text-[11px] whitespace-nowrap">{label}</span>
    </div>
  );
}

export default FootageStrip;
