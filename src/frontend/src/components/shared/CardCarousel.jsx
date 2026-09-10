import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * CardCarousel - horizontal, snap-scrolling row of cards (T5672).
 *
 * Presentational primitive (a View): it owns NO data and NO persisted state —
 * scroll position, the peek gap, and the progress indicator are all ephemeral
 * DOM-derived state, never written anywhere (epic decision #3).
 *
 * - Touch (coarse pointer): native momentum swipe + CSS scroll-snap; no arrows.
 * - Desktop (fine pointer): solid circular arrow buttons, always visible when
 *   the row overflows, vertically centered and half-out past the row edge.
 *   Track scroll position to disable/dim the left arrow at scroll start and
 *   the right arrow at scroll end.
 * - Peek (item 1): whenever the row overflows, the inter-card gap is nudged so a
 *   PARTIAL next card always shows at the row's right edge — the cut-off card is
 *   the scroll affordance. Fixed-width tiles otherwise land flush at unlucky
 *   container widths; a small gap adjustment guarantees a peek at every width.
 * - Progress (item 4): a thin position indicator under the row (page dots when
 *   <=6 pages, else a scrollbar-style thumb) — only when overflowing, ephemeral.
 *
 * No JS carousel library — CSS scroll-snap only (epic decision #2).
 *
 * @param {React.ReactNode} children - the cards (e.g. DraftTile) to lay out in the row
 * @param {string} ariaLabel - accessible label for the scroll region
 * @param {string} className - extra classes for the outer wrapper
 */
// Sub-pixel scroll positions (0.3px etc.) are common after smooth scrolls; a few
// pixels of slack keeps the left arrow disabled at a visual scroll-start and the
// right arrow disabled at a visual scroll-end.
const SCROLL_EPS = 2;
const DEFAULT_GAP = 12; // matches the old gap-3
const MIN_GAP = 6;
const MAX_GAP = 28;
// Target peek: how much of the next card should poke past the right edge, as a
// fraction of one tile. ~35% reads clearly as "there's more" without wasting space.
const TARGET_PEEK_FRACTION = 0.35;
// T8990: minimum width the optional trailing `fillerSlot` needs to read as a real
// coaching tile rather than a sliver. Matches the filler wrapper's min-w-[280px];
// the filler only mounts while at least this much space is free beside the tiles.
const MIN_FILLER_WIDTH = 280;

/**
 * Decide whether the trailing `fillerSlot` (T8990) fits beside the row's tiles.
 * The verdict is read from the NON-filler tiles only, so the filler can never
 * change its own answer (mount it and re-measuring the tiles yields the same
 * result -> no mount/unmount loop). "Fits" means the tiles plus one more gap plus
 * a minimum-width filler still sit within the container. Pure + exported so the
 * width-driven behavior is unit-testable without a real layout engine (jsdom
 * measures nothing -- the T5380 landmine), mirroring pickPeekGap.
 *
 * @param {number} tileW - natural width of one tile (px)
 * @param {number} containerW - the carousel's clientWidth (px)
 * @param {number} tileCount - number of NON-filler tiles in the row
 * @returns {boolean} true when the filler should be mounted
 */
export function fillerFits(tileW, containerW, tileCount) {
  if (!(tileW > 0) || !(containerW > 0) || !(tileCount > 0)) return false;
  // tiles + the gap between each (including one before the filler) at the default
  // gap: when the filler fits the row is not overflowing, so the peek gap never
  // kicks in and DEFAULT_GAP is the real spacing.
  const tilesWidth = tileCount * tileW + tileCount * DEFAULT_GAP;
  return tilesWidth + MIN_FILLER_WIDTH <= containerW;
}

// The real tiles of a carousel row, excluding the optional trailing fillerSlot
// (marked data-carousel-filler). Both the peek-gap count and the fits-check read
// tiles-only, so the filler never influences a decision about itself (T8990).
function tileChildren(el) {
  return Array.from(el.children).filter((c) => !c.hasAttribute('data-carousel-filler'));
}

/**
 * Pick an inter-card gap (px) that guarantees a partial "peek" of the next card
 * at the row's right edge (item 1). The width of the trailing card that shows is
 * (containerW mod step), step = tileW + gap. Sweeping the gap across
 * [MIN_GAP, MAX_GAP] sweeps that remainder, so we can nearly always land a real
 * sliver on screen instead of a flush edge. Pure + exported for unit testing.
 *
 * @returns {number} gap in px (DEFAULT_GAP when the row can't overflow)
 */
export function pickPeekGap(tileW, containerW, childCount) {
  if (!(tileW > 0) || !(containerW > 0) || !(childCount > 0)) return DEFAULT_GAP;
  // Everything fits at the default gap -> nothing to peek, keep it tidy.
  const naturalWidth = childCount * tileW + (childCount - 1) * DEFAULT_GAP;
  if (naturalWidth <= containerW) return DEFAULT_GAP;

  const targetPeek = tileW * TARGET_PEEK_FRACTION;
  const minVisible = tileW * 0.05; // below this the sliver reads as flush
  const maxVisible = tileW * 0.92; // above this the trailing card looks fully there
  let best = DEFAULT_GAP;
  let bestScore = Infinity;
  let foundPeek = false;
  // Absolute fallback: the largest sub-full sliver seen, so we never return a
  // near-flush gap even when no gap lands in the ideal visible band.
  let fallbackGap = DEFAULT_GAP;
  let fallbackPeek = -1;
  for (let g = MIN_GAP; g <= MAX_GAP; g++) {
    const step = tileW + g;
    const remainder = containerW % step; // width available to the trailing card
    if (remainder < tileW && remainder > fallbackPeek) {
      fallbackPeek = remainder;
      fallbackGap = g;
    }
    if (remainder >= minVisible && remainder <= maxVisible) {
      const score = Math.abs(remainder - targetPeek);
      if (!foundPeek || score < bestScore) {
        foundPeek = true;
        best = g;
        bestScore = score;
      }
    }
  }
  return foundPeek ? best : fallbackGap;
}

export function CardCarousel({ children, ariaLabel, className = '', fillerSlot = null }) {
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(false);
  const [gap, setGap] = useState(DEFAULT_GAP);
  // T8990: whether the optional trailing fillerSlot currently fits beside the
  // tiles. Ephemeral, width-derived (never persisted); guarded so it cannot loop.
  const [fillerVisible, setFillerVisible] = useState(false);
  // Ephemeral scroll-position indicator: ratio 0..1, page dots metadata, thumb size.
  const [progress, setProgress] = useState({ ratio: 0, pages: 1, page: 0, thumbPct: 100 });

  useEffect(() => {
    // Detect fine pointer at mount (never changes during a session)
    // Feature-detect matchMedia for test environments where it may not be available
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
      setIsFinePointer(mediaQuery.matches);
    } else {
      // In test environments without matchMedia, assume false (coarse pointer)
      // Real browsers always have matchMedia
      setIsFinePointer(false);
    }
  }, []);

  // Recompute scroll-position derived state (arrows + progress). Reads the DOM,
  // sets state only when a value actually changed so it can run after every
  // render without looping.
  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const overflow = maxScroll > SCROLL_EPS;

    setIsOverflowing((prev) => (prev === overflow ? prev : overflow));
    setScrollState((prev) => {
      const canScrollLeft = scrollLeft > SCROLL_EPS;
      const canScrollRight = scrollLeft < maxScroll - SCROLL_EPS;
      return prev.canScrollLeft === canScrollLeft && prev.canScrollRight === canScrollRight
        ? prev
        : { canScrollLeft, canScrollRight };
    });

    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, scrollLeft / maxScroll)) : 0;
    const pages = clientWidth > 0 ? Math.max(1, Math.ceil(scrollWidth / clientWidth)) : 1;
    const page = Math.round(ratio * (pages - 1));
    const thumbPct = scrollWidth > 0 ? Math.min(100, Math.max(12, (clientWidth / scrollWidth) * 100)) : 100;
    setProgress((prev) =>
      prev.ratio === ratio && prev.pages === pages && prev.page === page && prev.thumbPct === thumbPct
        ? prev
        : { ratio, pages, page, thumbPct }
    );
  }, []);

  // Item 1 (peek): pick an inter-card gap so the row never lands flush. The
  // amount of the trailing card that shows is (clientWidth mod step), where
  // step = tileWidth + gap; sweeping the gap sweeps that remainder, so we can
  // always find a gap in [MIN_GAP, MAX_GAP] that puts a real sliver on screen.
  const computeGap = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstChild = el.firstElementChild;
    if (!firstChild) return;
    // offsetWidth, NOT getBoundingClientRect().width: the latter reflects CSS
    // transforms, and the tiles carry hover/press `scale` under a transition
    // (DraftTile `hover:scale-[1.03] transition-all`). During that ease the
    // transformed width drifts sub-pixel every frame, which flips pickPeekGap's
    // threshold verdict back and forth, and the no-deps post-render effect below
    // re-runs setGap on each flip -> "Maximum update depth" loop (T9300). The
    // untransformed layout box (offsetWidth) is what the peek math actually wants
    // and a scale transition can never perturb it.
    const tileW = firstChild.offsetWidth;
    const containerW = el.clientWidth;
    // Exclude the trailing filler (T8990) from the peek-gap child count -- the
    // peek is a property of the real tiles, and counting the filler would let it
    // change its own row's gap.
    const childCount = tileChildren(el).length;
    if (tileW <= 0 || containerW <= 0) return;
    const best = pickPeekGap(tileW, containerW, childCount);
    setGap((prev) => (prev === best ? prev : best));
  }, []);

  // T8990: decide whether the trailing fillerSlot fits, from the NON-filler tiles
  // only (fillerFits is pure over the tiles, so mounting the filler yields the
  // same verdict -> no mount/unmount loop). Runs in the same post-render pass as
  // computeGap so it reacts to tiles being added/removed without a resize event.
  const computeFiller = useCallback(() => {
    if (!fillerSlot) return;
    const el = scrollRef.current;
    if (!el) return;
    const tiles = tileChildren(el);
    if (tiles.length === 0) {
      setFillerVisible((prev) => (prev === false ? prev : false));
      return;
    }
    // offsetWidth (untransformed layout box), not getBoundingClientRect().width:
    // same T9300 reason as computeGap -- a hover/press scale transition on the
    // tile would otherwise drift the measured width across the fillerFits
    // threshold every frame and re-fire setFillerVisible in a loop.
    const tileW = tiles[0].offsetWidth;
    const containerW = el.clientWidth;
    if (tileW <= 0 || containerW <= 0) return;
    const fits = fillerFits(tileW, containerW, tiles.length);
    setFillerVisible((prev) => (prev === fits ? prev : fits));
  }, [fillerSlot]);

  // Scroll listener (position only — gap is size-driven, not scroll-driven).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', recompute, { passive: true });
    return () => el.removeEventListener('scroll', recompute);
  }, [recompute]);

  // Size-driven recompute: window resize + element resize (ResizeObserver catches
  // late layout, font swaps, container/flex reflow that no scroll event would).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onResize = () => { computeGap(); computeFiller(); recompute(); };
    window.addEventListener('resize', onResize);
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [computeGap, computeFiller, recompute]);

  // Run after EVERY render (no deps): keeps arrows/progress/gap/filler correct even
  // when the children list changes (tiles added/removed) — which alters scrollWidth
  // without firing a scroll or resize event. Guarded setters prevent a loop.
  useEffect(() => {
    computeGap();
    computeFiller();
    recompute();
  });

  const page = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  // Only show chevrons on fine pointer (desktop) when row is overflowing
  const showChevrons = isFinePointer && isOverflowing;
  const useDots = progress.pages <= 6;

  return (
    <div className={`relative group/row ${className}`}>
      <div
        ref={scrollRef}
        role="group"
        aria-label={ariaLabel}
        style={{ gap: `${gap}px` }}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide scroll-smooth px-1 pb-1"
      >
        {children}
        {/* T8990: trailing coaching filler, mounted only while it fits beside the
            tiles (fillerVisible, width-driven). self-stretch matches the row's
            tile height; data-carousel-filler keeps it out of the peek/fits math. */}
        {fillerSlot && fillerVisible && (
          <div
            data-carousel-filler
            className="flex-1 self-stretch min-w-[280px] max-w-[420px]"
          >
            {fillerSlot}
          </div>
        )}
      </div>

      {/* Left arrow — desktop only, solid circular button half-out past the row edge */}
      {showChevrons && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => page(-1)}
          disabled={!scrollState.canScrollLeft}
          className={`absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center border border-gray-600 shadow-lg
                     transition-colors
                     ${scrollState.canScrollLeft
                       ? 'bg-gray-800/95 text-white hover:bg-gray-700'
                       : 'bg-gray-800/60 text-gray-500 cursor-not-allowed'}`}
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {/* Right arrow — desktop only, solid circular button half-out past the row edge */}
      {showChevrons && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => page(1)}
          disabled={!scrollState.canScrollRight}
          className={`absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full
                     flex items-center justify-center border border-gray-600 shadow-lg
                     transition-colors
                     ${scrollState.canScrollRight
                       ? 'bg-gray-800/95 text-white hover:bg-gray-700'
                       : 'bg-gray-800/60 text-gray-500 cursor-not-allowed'}`}
        >
          <ChevronRight size={20} />
        </button>
      )}

      {/* Scroll-progress indicator (item 4) — only when overflowing; ephemeral.
          Page dots when there are few pages, a scrollbar-style thumb otherwise. */}
      {isOverflowing && (
        useDots ? (
          <div data-testid="carousel-progress-dots" className="mt-1.5 flex items-center justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: progress.pages }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === progress.page ? 'w-4 bg-gray-300' : 'w-1.5 bg-gray-600'
                }`}
              />
            ))}
          </div>
        ) : (
          <div data-testid="carousel-progress-bar" className="mt-1.5 mx-auto h-1 w-1/2 max-w-[240px] rounded-full bg-gray-700/70 overflow-hidden" aria-hidden="true">
            <div
              className="h-full rounded-full bg-gray-400"
              style={{
                width: `${progress.thumbPct}%`,
                marginLeft: `${progress.ratio * (100 - progress.thumbPct)}%`,
              }}
            />
          </div>
        )
      )}
    </div>
  );
}

export default CardCarousel;
