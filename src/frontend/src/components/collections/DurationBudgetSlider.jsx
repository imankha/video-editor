import React from 'react';
import { Clock } from 'lucide-react';
import { formatDuration } from './format';
import { snapToStep } from './budget';

/**
 * DurationBudgetSlider - picks the Play-all length for a collection (T3610 §0B.5).
 * 15s precision; runs 30s -> cap (the collection's full duration).
 *
 * @param {number}   cap      - max budget = full collection duration (seconds)
 * @param {number}   value    - current budget (seconds)
 * @param {Function} onChange - (seconds) => void
 */
export function DurationBudgetSlider({ cap, value, onChange }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Clock size={14} className="text-gray-400 shrink-0" />
      <input
        type="range"
        min={30}
        max={cap}
        step={15}
        value={value}
        onChange={(e) => onChange(snapToStep(Number(e.target.value), cap))}
        className="flex-1 h-9 accent-cyan-500 cursor-pointer"
        aria-label="Highlight length"
      />
      <span className="text-xs text-gray-300 w-10 text-right tabular-nums">
        {formatDuration(value)}
      </span>
    </div>
  );
}

export default DurationBudgetSlider;
