import React from 'react';
import { Clock } from 'lucide-react';
import { formatDuration } from './format';
import { detentsForCap, snapToDetent } from './budget';

/**
 * DurationBudgetSlider - picks the Play-all length for a collection (T3610 §0B.5).
 * Snaps to EPIC #7 detents (30s/1m/2m/3m/5m/Max) within [30s, cap].
 *
 * @param {number}   cap      - max budget (seconds)
 * @param {number}   value    - current budget (seconds)
 * @param {Function} onChange - (seconds) => void
 */
export function DurationBudgetSlider({ cap, value, onChange }) {
  const stops = detentsForCap(cap);
  const single = stops.length <= 1; // collection barely over 30s — nothing to drag

  return (
    <div className="flex items-center gap-2">
      <Clock size={14} className="text-gray-400 shrink-0" />
      <input
        type="range"
        min={30}
        max={cap}
        step={1}
        value={value}
        disabled={single}
        onChange={(e) => onChange(snapToDetent(Number(e.target.value), cap))}
        className="flex-1 h-9 accent-cyan-500 cursor-pointer disabled:opacity-50"
        aria-label="Highlight length"
      />
      <span className="text-xs text-gray-300 w-10 text-right tabular-nums">
        {formatDuration(value)}
      </span>
    </div>
  );
}

export default DurationBudgetSlider;
