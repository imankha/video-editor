import { useState, useEffect, useRef, useCallback } from 'react';
import { Maximize2, Check, ArrowLeftRight } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ClipVideo } from './ClipVideo';
import { HeroIntroModal } from './HeroIntroModal';

const PICK_GATE_SEC = 3; // disable Pick this long after a clip appears (watch first)

/**
 * HeroMatchup - the mobile-portrait layout (T3630). A 9:16 clip is ~ the phone's
 * shape, so ONE clip fills the whole screen (zero deadspace). You compare by
 * SWAPPING to the other clip, then pick whichever you're viewing:
 *  - swipe left/right across the video, OR
 *  - tap the named thumbnail of the other clip (top-left), OR
 *  - tap the dots.
 * A single "Pick" picks the shown clip. No "A/B" -- clips are named.
 *
 * Swap behavior: until the user takes control, the hero AUTO-SWAPS to the other
 * clip each time the current one finishes -- cycling A->B->A so both get seen.
 * The first manual swap hands control to the user: from then on the shown clip
 * LOOPS until they swap again. A new matchup resets to auto-cycle.
 *
 * The active clip plays sound when `muted` is false (hero only); the browser may
 * fall back to muted if it blocks autoplay-with-sound (handled in ClipVideo).
 *
 * @param {object}   pair    - { a, b } matchup sides
 * @param {number}   wonId   - id flashing the win cue (or null)
 * @param {boolean}  muted   - mute the active clip's audio
 * @param {Function} onPick  - (winner, loser) => void
 * @param {Function} onReplay- (side) => void; open the full-screen player
 */
export function HeroMatchup({ pair, wonId, muted = true, onPick, onReplay }) {
  const sides = [pair.a, pair.b];
  const [active, setActive] = useState(0);
  const [userControlled, setUserControlled] = useState(false);
  const [introSeen, setIntroSeen] = useState(false); // first-time explainer
  // New matchup -> first clip, auto-cycle again.
  useEffect(() => { setActive(0); setUserControlled(false); }, [pair.a.id, pair.b.id]);

  const cur = sides[active];
  const other = sides[active ^ 1];

  // Pick gate: disable "Pick" for the first few seconds of each clip so the user
  // can't pick before seeing it. Counts down once the intro is dismissed and
  // restarts whenever the shown clip changes (swap / auto-swap).
  const [pickGate, setPickGate] = useState(PICK_GATE_SEC);
  useEffect(() => {
    if (!introSeen) { setPickGate(PICK_GATE_SEC); return; }
    setPickGate(PICK_GATE_SEC);
    let n = PICK_GATE_SEC;
    const iv = setInterval(() => {
      n -= 1;
      setPickGate(n);
      if (n <= 0) clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [introSeen, cur.id]);
  const canPick = introSeen && pickGate <= 0;

  // onEnded while hands-off: advance to the other clip (does NOT take control).
  const autoAdvance = useCallback(() => setActive((i) => i ^ 1), []);
  // Any deliberate swap takes control -> the shown clip then loops.
  const manualSwap = useCallback(() => {
    setUserControlled(true);
    setActive((i) => i ^ 1);
  }, []);

  // Swipe to swap (counts as taking control).
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) manualSwap();
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
      {/* No remount key: reuse the element across swaps (src just changes) so
          decoders don't churn -- see ClipVideo lifecycle notes. */}
      <ClipVideo
        streamUrl={cur.stream_url}
        active
        muted={muted}
        loop={userControlled}
        onEnded={userControlled ? undefined : autoAdvance}
      />

      {/* Named thumbnail of the OTHER clip -> tap to swap. */}
      <button
        type="button"
        onClick={manualSwap}
        title={`Switch to ${other.name}`}
        className="absolute top-2 left-2 z-20 w-12 rounded-lg overflow-hidden border-2 border-cyan-400 bg-black/60"
      >
        <div className="relative h-20"><ClipVideo streamUrl={other.stream_url} active={false} blur={false} /></div>
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
        onClick={manualSwap}
        className="absolute left-1/2 -translate-x-1/2 bottom-[118px] z-10 flex items-center gap-2 text-[11px] text-white/75"
      >
        <span>‹ swipe to compare ›</span>
        <span className="flex gap-1.5">
          {sides.map((s, i) => (
            <span key={s.id} className={`w-1.5 h-1.5 rounded-full ${i === active ? 'bg-cyan-300' : 'bg-white/40'}`} />
          ))}
        </span>
      </button>

      {/* Bottom overlay. T4760: the whole name+info+button block is the pick target
          (not just the 48px button) so near-misses still register. The video stays
          watch-only. While the pick gate is counting down the target is inert (the
          visible "Pick in Ns" communicates why); only the video/swap affordances work. */}
      <div className="absolute inset-x-0 bottom-0 z-10 pt-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
        <div
          role="button"
          tabIndex={canPick ? 0 : -1}
          aria-disabled={!canPick}
          onClick={() => { if (canPick) onPick(cur, other); }}
          onKeyDown={(e) => {
            if (canPick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(cur, other); }
          }}
          aria-label={`Pick ${cur.name}`}
          data-testid="hero-pick-target"
          className={`p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${canPick ? 'cursor-pointer' : 'cursor-not-allowed'}`}
        >
          <div className="text-white font-semibold text-base truncate">{cur.name}</div>
          {cur.opponent_line && <div className="text-xs text-gray-300 truncate">{cur.opponent_line}</div>}
          <div className="flex items-center gap-2 flex-wrap text-xs mt-0.5">
            {minuteLabel && <span className="font-mono text-cyan-300">{minuteLabel}</span>}
            {(cur.tags || []).map((t) => <span key={t} className="text-cyan-200/80">#{t}</span>)}
          </div>
          {/* Visual affordance only; the clickable target is the wrapper above. */}
          <div
            className={`pointer-events-none mt-2 flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl
              font-bold text-white ${REEL.bgCta} transition-colors
              ${canPick ? REEL.bgCtaHover : 'opacity-50'}`}
          >
            <Check size={18} /> {canPick ? 'Pick' : `Pick in ${pickGate}s`}
          </div>
        </div>
      </div>

      {won && (
        <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center text-5xl reel-sparkle">
          ✨
        </span>
      )}

      {!introSeen && <HeroIntroModal onClose={() => setIntroSeen(true)} />}
    </div>
  );
}

export default HeroMatchup;
