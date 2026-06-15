import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Maximize2, Check, ArrowLeftRight } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ClipVideo } from './ClipVideo';

/**
 * HeroMatchup - the mobile-portrait layout (T3630). A 9:16 clip is ~ the phone's
 * shape, so ONE clip fills the whole screen (zero deadspace). You compare by
 * SWAPPING to the other clip, then pick whichever you're viewing:
 *  - swipe left/right across the video, OR
 *  - tap the named thumbnail of the other clip (top-left), OR
 *  - tap the dots.
 * A single "Pick" picks the shown clip. No "A/B" -- clips are named.
 *
 * @param {object}   pair    - { a, b } matchup sides
 * @param {number}   wonId   - id flashing the win cue (or null)
 * @param {Function} onPick  - (winner, loser) => void
 * @param {Function} onReplay- (side) => void; open the full-screen player
 */
export function HeroMatchup({ pair, wonId, onPick, onReplay }) {
  const sides = [pair.a, pair.b];
  const [active, setActive] = useState(0);
  // New matchup -> start on the first clip again.
  useEffect(() => { setActive(0); }, [pair.a.id, pair.b.id]);

  const cur = sides[active];
  const other = sides[active ^ 1];
  const swap = useCallback(() => setActive((i) => i ^ 1), []);

  // Swipe to swap.
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) swap();
    touchX.current = null;
  };

  const minuteLabel = cur.minute != null ? `${cur.minute}'` : null;
  const won = wonId === cur.id;

  return (
    <div
      className="relative flex-1 min-h-0 overflow-hidden bg-black"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <ClipVideo key={cur.id} streamUrl={cur.stream_url} active />

      {/* Named thumbnail of the OTHER clip -> tap to swap. */}
      <button
        type="button"
        onClick={swap}
        title={`Switch to ${other.name}`}
        className="absolute top-2 left-2 z-20 w-12 rounded-lg overflow-hidden border-2 border-cyan-400 bg-black/60"
      >
        <div className="relative h-20"><ClipVideo streamUrl={other.stream_url} active={false} /></div>
        <div className="flex items-center justify-center gap-1 px-1 py-0.5 text-[9px] leading-tight text-gray-100 bg-black/75 truncate">
          <ArrowLeftRight size={9} className="shrink-0" />
          <span className="truncate">{other.name}</span>
        </div>
      </button>

      {/* Expand -> full-screen player. */}
      <button
        type="button"
        onClick={() => onReplay(cur)}
        title="Play full screen"
        className="absolute top-2 right-2 z-20 p-1.5 rounded-lg bg-black/45 text-cyan-200 hover:bg-black/70"
      >
        <Maximize2 size={16} />
      </button>

      {/* Swipe hint + dots (dots also swap). */}
      <button
        type="button"
        onClick={swap}
        className="absolute left-1/2 -translate-x-1/2 bottom-[118px] z-10 flex items-center gap-2 text-[11px] text-white/75"
      >
        <span>‹ swipe to compare ›</span>
        <span className="flex gap-1.5">
          {sides.map((s, i) => (
            <span key={s.id} className={`w-1.5 h-1.5 rounded-full ${i === active ? 'bg-cyan-300' : 'bg-white/40'}`} />
          ))}
        </span>
      </button>

      {/* Bottom overlay: name + info + single Pick. */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 pt-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
        <div className="text-white font-semibold text-base truncate">{cur.name}</div>
        {cur.opponent_line && <div className="text-xs text-gray-300 truncate">{cur.opponent_line}</div>}
        <div className="flex items-center gap-2 flex-wrap text-xs mt-0.5">
          {minuteLabel && <span className="font-mono text-cyan-300">{minuteLabel}</span>}
          {(cur.tags || []).map((t) => <span key={t} className="text-cyan-200/80">#{t}</span>)}
        </div>
        <button
          type="button"
          onClick={() => onPick(cur, other)}
          className={`mt-2 flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl
            font-bold text-white ${REEL.bgCta} ${REEL.bgCtaHover} transition-colors`}
        >
          <Check size={18} /> Pick
        </button>
      </div>

      {won && (
        <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center text-5xl reel-sparkle">
          ✨
        </span>
      )}
    </div>
  );
}

export default HeroMatchup;
