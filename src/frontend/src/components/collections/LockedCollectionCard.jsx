import React from 'react';
import { Lock } from 'lucide-react';
import { ratioGlyph, ratioLabel, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { formatDurationHuman } from './format';
import { CardStack } from '../shared/MediaCard';

/**
 * LockedCollectionCard - the shared "not ready yet" card chrome (T3610/T3630).
 *
 * Amber across the board signals "incomplete / locked": a smart collection, a
 * game's highlights, anything sub-30s. Tapping it surfaces the exact reason
 * (caller passes onClick). Presentational only.
 *
 * @param {string}   name       - title (e.g. "Top Plays", "Vs g1 Jan 22 highlights")
 * @param {string=}  subtitle   - secondary line (e.g. "Build more reels to unlock")
 * @param {string}   ratio      - '9:16' | '16:9' (glyph)
 * @param {number}   currentSec - duration so far
 * @param {Function} onClick    - open the locked-reason popup
 */
export function LockedCollectionCard({ name, subtitle, ratio, currentSec, onClick, stacked = true }) {
  const pct = Math.max(
    0,
    Math.min(100, Math.round(((currentSec || 0) / COLLECTION_MIN_DURATION_SEC) * 100)),
  );

  const Tag = onClick ? 'button' : 'div';
  const interactive = onClick
    ? 'hover:bg-amber-900/20 hover:border-amber-500/50 transition-colors'
    : '';

  const inner = (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={onClick ? 'Why is this locked?' : undefined}
      className={`w-full text-left p-3 bg-amber-900/10 rounded-lg border border-amber-500/30 ${interactive}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 bg-amber-900/30">
          <Lock size={18} className="text-amber-400/90" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {ratio && (
              <span className="text-base leading-none text-amber-400/90 shrink-0" title={ratioLabel(ratio)}>
                {ratioGlyph(ratio)}
              </span>
            )}
            <h3 className="text-gray-200 font-medium truncate">{name}</h3>
          </div>
          {subtitle && <p className="text-xs text-amber-300/70 mt-0.5 truncate">{subtitle}</p>}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-gray-700 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-amber-300/80 shrink-0 tabular-nums">
              {formatDurationHuman(currentSec) || '0s'} / {formatDurationHuman(COLLECTION_MIN_DURATION_SEC)}
            </span>
          </div>
        </div>
      </div>
    </Tag>
  );

  // Collections get the stacked-paper cue; the (single) ranking launcher doesn't.
  return stacked
    ? <CardStack className="mb-2" layerClassName="border-amber-500/30 bg-amber-900/20" baseBg="bg-gray-800">{inner}</CardStack>
    : <div className="mb-2">{inner}</div>;
}

export default LockedCollectionCard;
