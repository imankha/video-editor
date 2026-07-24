import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * CardCarousel - horizontal, snap-scrolling row of cards (T5672).
 *
 * Presentational primitive (a View): it owns NO data and NO persisted state —
 * scroll position is ephemeral DOM state, never written anywhere (epic decision #3).
 *
 * - Touch (coarse pointer): native momentum swipe + CSS scroll-snap; no arrows.
 * - Desktop (fine pointer): solid circular arrow buttons, always visible when
 *   the row overflows, vertically centered and half-out past the row edge.
 *   Track scroll position to disable/hide the left arrow at scroll start and
 *   the right arrow at scroll end.
 *
 * No JS carousel library — CSS scroll-snap only (epic decision #2).
 *
 * @param {React.ReactNode} children - the cards (e.g. DraftTile) to lay out in the row
 * @param {string} ariaLabel - accessible label for the scroll region
 * @param {string} className - extra classes for the outer wrapper
 */
export function CardCarousel({ children, ariaLabel, className = '' }) {
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(false);

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

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setIsOverflowing(scrollWidth > clientWidth);
    setScrollState({
      canScrollLeft: scrollLeft > 0,
      canScrollRight: scrollLeft < scrollWidth - clientWidth - 10, // 10px tolerance
    });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Update on initial layout
    updateScrollState();

    // Update on scroll
    el.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);

    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  const page = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  // Only show chevrons on fine pointer (desktop) when row is overflowing
  const showChevrons = isFinePointer && isOverflowing;

  return (
    <div className={`relative group/row ${className}`}>
      <div
        ref={scrollRef}
        role="group"
        aria-label={ariaLabel}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide scroll-smooth px-1 pb-1"
      >
        {children}
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
    </div>
  );
}

export default CardCarousel;
