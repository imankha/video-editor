import React from 'react';
import { Clock } from 'lucide-react';
import { formatDuration } from './format';
import { snapToStep } from './budget';

/**
 * DurationBudgetSlider - picks the MAX Play-all length for a collection
 * (T3610 §0B.5). It's a ceiling, not an exact length: the actual length depends
 * on which reels fit (and which are "top" keeps changing as ranking updates).
 * 15s precision; runs 30s -> cap (full duration rounded up to a 15s step).
 *
 * @param {number}   cap      - max budget = full collection duration (seconds)
 * @param {number}   value    - current budget (seconds)
 * @param {Function} onChange - (seconds) => void
 */
export function DurationBudgetSlider({ cap, value, onChange }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Clock size={14} className="text-gray-400 shrink-0" />
      <span className="text-xs text-gray-400 shrink-0">Max</span>
      <input
        type="range"
        min={30}
        max={cap}
        step={15}
        value={value}
        onChange={(e) => onChange(snapToStep(Number(e.target.value), cap))}
        className="flex-1 h-9 accent-cyan-500 cursor-pointer"
        aria-label="Maximum highlight length"
      />
      <span className="text-xs text-gray-300 w-10 text-right tabular-nums">
        {formatDuration(value)}
      </span>
    </div>
  );
}

export default DurationBudgetSlider;
