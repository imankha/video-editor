import React from 'react';
import { REEL } from '../../config/themeColors';
import { ratioDisplay } from '../../constants/aspectRatios';

/**
 * RatioUnlockGroup - A game's sub-30s ratio sub-list (T3610, §0.10).
 *
 * A ratio with reels but < COLLECTION_MIN_DURATION_SEC of content forms no
 * collection. It still lists its reels (browsable + individually playable) under
 * a ratio label, with an unlock progress bar toward the 30s threshold. No
 * collection-level verbs (Play-all / Share / Video).
 *
 * @param {string}   ratio       - '9:16' | '16:9' (label + glyph)
 * @param {number}   progressPct - 0..100 (duration / threshold), capped by caller
 * @param {string}   captionText - e.g. "Build more reels to unlock game highlights"
 * @param {Array}    reels       - this ratio's members
 * @param {Function} renderCard  - (download) => ReactNode (reuses the panel card)
 */
export function RatioUnlockGroup({ ratio, progressPct, captionText, reels, renderCard }) {
  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-gray-300">{ratioDisplay(ratio)}</span>
        <span className="text-xs text-gray-500">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
        <div
          className={`h-full ${REEL.bg} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{captionText}</p>
      <div className="mt-2 space-y-2">
        {reels.map((d) => renderCard(d))}
      </div>
    </div>
  );
}

export default RatioUnlockGroup;
