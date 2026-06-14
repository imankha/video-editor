import React from 'react';
import { Play } from 'lucide-react';
import { REEL } from '../../config/themeColors';

/**
 * ReelMatchCard - one side of a ranking matchup (T3630).
 *
 * Presentational: identity (name, "vs opponent - date", soccer-notation minute,
 * tags) + a tap-to-replay affordance + a PICK button. Tapping anywhere on the
 * card body picks this reel; the small play button replays it (stops propagation
 * so it doesn't count as a pick). All touch targets are >= 44px (EPIC #14).
 *
 * @param {object}   side       - { id, name, aspect_ratio, opponent_line, minute, tags }
 * @param {Function} onPick     - () => void; this reel won
 * @param {Function} onReplay   - () => void; open the tap-to-replay player
 * @param {string}   pickLabel  - "Pick A" | "Pick B"
 * @param {boolean=} won        - true briefly after selection (sparkle + scale)
 */
export function ReelMatchCard({ side, onPick, onReplay, pickLabel, won }) {
  const minuteLabel = side.minute != null ? `${side.minute}'` : null;

  return (
    <button
      type="button"
      onClick={onPick}
      className={`group relative w-full text-left rounded-xl border bg-gray-800 overflow-hidden
        transition-transform duration-200 ${REEL.borderHover}
        ${won ? 'scale-[1.03] border-cyan-400 reel-match-won' : 'border-gray-700'}`}
    >
      {/* Tap-to-replay area */}
      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onReplay(); }}
        className={`flex items-center justify-center gap-2 h-24 ${REEL.bgSubtle} text-cyan-200
          hover:bg-cyan-900/50 transition-colors`}
      >
        <Play size={20} className={REEL.accent} />
        <span className="text-sm">tap to play</span>
      </div>

      {/* Identity */}
      <div className="p-3 space-y-1">
        <div className="text-white font-semibold truncate">{side.name}</div>
        {side.opponent_line && (
          <div className="text-xs text-gray-400 truncate">{side.opponent_line}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {minuteLabel && (
            <span className="font-mono text-cyan-300">{minuteLabel}</span>
          )}
          {(side.tags || []).map((t) => (
            <span key={t} className="text-gray-400">#{t}</span>
          ))}
        </div>
      </div>

      {/* Pick button */}
      <div className="px-3 pb-3">
        <span
          className={`flex items-center justify-center w-full min-h-[44px] rounded-lg font-semibold
            text-white ${REEL.bgCta} ${REEL.bgCtaHover} transition-colors`}
        >
          {pickLabel}
        </span>
      </div>

      {/* Sparkle burst on win */}
      {won && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl reel-sparkle">
          ✨
        </span>
      )}
    </button>
  );
}

export default ReelMatchCard;
