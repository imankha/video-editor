import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { ratioGlyph, ratioLabel, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { formatDuration } from './format';
import { LockedReasonModal } from './LockedReasonModal';

/**
 * SmartLockedCard - A sub-30s smart collection as a locked near-miss card
 * (T3610 §0B.3, EPIC #6). Same card chrome as the collection cards, but
 * amber-coded (border + Lock + amber progress) to symbolize "incomplete".
 * Tapping it opens a popup explaining exactly why it's locked.
 *
 * @param {string} name       - smart collection name (e.g. "Top Goals & Assists")
 * @param {string} ratio      - '9:16' | '16:9' (glyph)
 * @param {number} currentSec - this ratio's duration so far
 */
export function SmartLockedCard({ name, ratio, currentSec }) {
  const [showReason, setShowReason] = useState(false);
  const pct = Math.max(
    0,
    Math.min(100, Math.round(((currentSec || 0) / COLLECTION_MIN_DURATION_SEC) * 100)),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setShowReason(true)}
        title="Why is this locked?"
        className="w-full text-left p-3 bg-gray-700/40 rounded-lg border border-amber-500/30 mb-2 hover:bg-gray-700/60 hover:border-amber-500/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 bg-amber-900/30">
            <Lock size={18} className="text-amber-400/90" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none text-amber-400/90 shrink-0" title={ratioLabel(ratio)}>
                {ratioGlyph(ratio)}
              </span>
              <h3 className="text-gray-300 font-medium truncate">{name}</h3>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-gray-700 overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-amber-300/80 shrink-0 tabular-nums">
                {formatDuration(currentSec) || '0:00'} / {formatDuration(COLLECTION_MIN_DURATION_SEC)}
              </span>
            </div>
          </div>
        </div>
      </button>

      {showReason && (
        <LockedReasonModal
          name={name}
          ratio={ratio}
          currentSec={currentSec}
          onClose={() => setShowReason(false)}
        />
      )}
    </>
  );
}

export default SmartLockedCard;
