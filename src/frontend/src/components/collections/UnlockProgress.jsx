import React from 'react';
import { REEL } from '../../config/themeColors';
import { ratioGlyph, ratioLabel, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { formatDuration } from './format';

/**
 * UnlockProgress - shared progress bar toward the 30s collection threshold
 * (T3610 §0.10 / §0B.3). Used by game sub-30s sub-lists and smart near-miss
 * cards. Presentational; the caller supplies the ratio label + caption.
 *
 * @param {string} ratio       - '9:16' | '16:9' (label + glyph)
 * @param {number} currentSec  - this ratio's duration so far
 * @param {string} caption     - copy under the bar
 */
export function UnlockProgress({ ratio, currentSec, caption }) {
  const pct = Math.max(
    0,
    Math.min(100, Math.round(((currentSec || 0) / COLLECTION_MIN_DURATION_SEC) * 100)),
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`text-base leading-none ${REEL.accent}`} title={ratioLabel(ratio)}>{ratioGlyph(ratio)}</span>
        <span className="text-xs text-gray-500">
          {formatDuration(currentSec) || '0:00'} / {formatDuration(COLLECTION_MIN_DURATION_SEC)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
        <div
          className={`h-full ${REEL.bg} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{caption}</p>
    </div>
  );
}

export default UnlockProgress;
