import React, { useRef, useCallback } from 'react';
import { Play, Check } from 'lucide-react';
import { API_BASE } from '../../config';
import { REEL } from '../../config/themeColors';

/**
 * ReelMatchCard - one side of a ranking matchup (T3630).
 *
 * Presentational: a clip preview (first frame + silent hover preview on desktop)
 * + identity (name, "vs opponent - date", soccer-notation minute, tags) + a PICK
 * button. Tapping anywhere on the card body picks this reel; tapping the preview
 * opens the full-screen replay player (stops propagation so it doesn't count as a
 * pick). All touch targets are >= 44px (EPIC #14).
 *
 * There is no "A"/"B" framing - each card is judged on its own clip, so the pick
 * CTA is content-neutral ("Pick this one"). Server-side A/B order is randomized
 * (rank.py), so position carries no meaning.
 *
 * @param {object}   side        - { id, name, aspect_ratio, opponent_line, minute, tags, stream_url }
 * @param {Function} onPick      - () => void; this reel won
 * @param {Function} onReplay    - () => void; open the full replay player
 * @param {boolean=} won         - true briefly after selection (sparkle + scale)
 * @param {string=}  hotkeyHint  - keycap shown on the CTA on desktop (e.g. '<-')
 */
export function ReelMatchCard({ side, onPick, onReplay, won, hotkeyHint }) {
  const minuteLabel = side.minute != null ? `${side.minute}'` : null;
  const videoRef = useRef(null);
  const streamUrl = `${API_BASE}${side.stream_url}`;

  // Desktop nicety: silent inline preview while hovering the card. Tapping the
  // preview still opens the full player; this just brings the clip to life so the
  // user can judge without committing a click.
  const startPreview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => { /* muted autoplay can still be blocked; ignore */ });
  }, []);
  const stopPreview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  }, []);

  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      className={`group relative w-full text-left rounded-xl border bg-gray-800 overflow-hidden
        transition-transform duration-200 ${REEL.borderHover}
        ${won ? 'scale-[1.03] border-cyan-400 reel-match-won' : 'border-gray-700'}`}
    >
      {/* Clip preview: shows the first frame (poster), previews muted on hover,
          opens the full player on tap. object-contain keeps both portrait and
          landscape reels fully visible inside a bounded, equal-height frame. */}
      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onReplay(); }}
        className="relative w-full h-44 md:h-56 bg-black overflow-hidden"
      >
        <video
          ref={videoRef}
          src={`${streamUrl}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-contain"
        />
        {/* Play affordance: fades out while the hover preview plays. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2
          text-cyan-100 bg-black/30 opacity-100 group-hover:opacity-0 transition-opacity">
          <Play size={18} className={REEL.accent} />
          <span className="text-sm">play</span>
        </span>
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

      {/* Pick CTA - content-neutral, no A/B framing. */}
      <div className="px-3 pb-3">
        <span
          className={`flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg
            font-semibold text-white ${REEL.bgCta} ${REEL.bgCtaHover} transition-colors`}
        >
          <Check size={18} />
          Pick this one
          {hotkeyHint && (
            <kbd className="hidden md:inline ml-1 px-1.5 py-0.5 rounded bg-black/25 text-xs font-mono leading-none">
              {hotkeyHint}
            </kbd>
          )}
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
