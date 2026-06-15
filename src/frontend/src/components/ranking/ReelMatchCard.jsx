import React from 'react';
import { Maximize2, Check } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ClipVideo } from './ClipVideo';

/**
 * ReelMatchCard - one side of a "both clips shown" matchup (stacked or
 * side-by-side; T3630). Full-bleed clip with the name + info + a "Pick this one"
 * CTA overlaid on a bottom gradient (no separate rows). The whole card is the
 * pick target; the expand button opens the full-screen player. Clips are
 * identified by NAME, never "A/B".
 *
 * Sizing is owned by the parent via `className` (e.g. `flex-1 min-h-0 min-w-0`),
 * so the same card fills a column (side-by-side) or a row (stacked).
 *
 * @param {object}   side       - { id, name, aspect_ratio, opponent_line, minute, tags, stream_url }
 * @param {Function} onPick     - () => void; this clip won
 * @param {Function} onReplay   - () => void; open the full-screen player
 * @param {boolean=} won        - true briefly after selection (sparkle + ring)
 * @param {string=}  hotkeyHint - keycap shown on the CTA on desktop (e.g. '<-')
 * @param {string=}  className  - sizing/placement from the parent layout
 */
export function ReelMatchCard({ side, onPick, onReplay, won, hotkeyHint, className = '' }) {
  const minuteLabel = side.minute != null ? `${side.minute}'` : null;

  return (
    <button
      type="button"
      onClick={onPick}
      className={`group relative overflow-hidden rounded-xl border bg-black text-left
        transition-transform duration-200
        ${won ? 'border-cyan-400 reel-match-won' : 'border-gray-700'} ${className}`}
    >
      <ClipVideo streamUrl={side.stream_url} active />

      {/* Expand -> full-screen player (does not count as a pick). */}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onReplay(); }}
        title="Play full screen"
        className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/45 text-cyan-200 hover:bg-black/70 transition-colors"
      >
        <Maximize2 size={15} />
      </span>

      {/* Bottom overlay: name + info + Pick CTA. */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 pt-9 bg-gradient-to-t from-black/90 via-black/55 to-transparent">
        <div className="text-white font-semibold text-sm truncate">{side.name}</div>
        {side.opponent_line && (
          <div className="text-[11px] text-gray-300 truncate">{side.opponent_line}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-[11px] mt-0.5">
          {minuteLabel && <span className="font-mono text-cyan-300">{minuteLabel}</span>}
          {(side.tags || []).map((t) => (
            <span key={t} className="text-cyan-200/80">#{t}</span>
          ))}
        </div>
        <span
          className={`mt-2 flex items-center justify-center gap-2 w-full min-h-[40px] rounded-lg
            font-semibold text-white ${REEL.bgCta} ${REEL.bgCtaHover} transition-colors`}
        >
          <Check size={16} /> Pick this one
          {hotkeyHint && (
            <kbd className="hidden md:inline ml-1 px-1.5 py-0.5 rounded bg-black/25 text-xs font-mono leading-none">
              {hotkeyHint}
            </kbd>
          )}
        </span>
      </div>

      {won && (
        <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-4xl reel-sparkle">
          ✨
        </span>
      )}
    </button>
  );
}

export default ReelMatchCard;
