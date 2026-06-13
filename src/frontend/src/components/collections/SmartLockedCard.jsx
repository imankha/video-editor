import React from 'react';
import { UnlockProgress } from './UnlockProgress';
import { ratioLabel } from '../../constants/aspectRatios';

/**
 * SmartLockedCard - A sub-30s smart collection rendered as a locked near-miss
 * card (T3610 §0B.3, EPIC #6). No clip list, no verbs — just the name and an
 * unlock progress bar ("almost!").
 *
 * @param {string} name       - smart collection name (e.g. "Top Goals & Assists")
 * @param {string} ratio      - '9:16' | '16:9'
 * @param {number} currentSec - this ratio's duration so far
 */
export function SmartLockedCard({ name, ratio, currentSec }) {
  return (
    <div className="rounded-lg bg-gray-800/40 px-3 py-2 mb-2">
      <h3 className="text-sm font-semibold text-gray-300 truncate mb-1">
        {name} - {ratioLabel(ratio)}
      </h3>
      <UnlockProgress ratio={ratio} currentSec={currentSec} caption="Almost there!" />
    </div>
  );
}

export default SmartLockedCard;
