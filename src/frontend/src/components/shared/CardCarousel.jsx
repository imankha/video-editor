import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * CardCarousel - horizontal, snap-scrolling row of cards (T5672).
 *
 * Presentational primitive (a View): it owns NO data and NO persisted state —
 * scroll position is ephemeral DOM state, never written anywhere (epic decision #3).
 *
 * - Touch (coarse pointer): native momentum swipe + CSS scroll-snap; no chevrons.
 * - Desktop (fine pointer): chevron buttons fade in on row hover and page the row
 *   by ~one visible width. Chevrons are hidden on coarse pointers, so the 44px
 *   touch floor applies only to the tiles themselves, not these controls.
 *
 * No JS carousel library — CSS scroll-snap only (epic decision #2).
 *
 * @param {React.ReactNode} children - the cards (e.g. DraftTile) to lay out in the row
 * @param {string} ariaLabel - accessible label for the scroll region
 * @param {string} className - extra classes for the outer wrapper
 */
export function CardCarousel({ children, ariaLabel, className = '' }) {
  const scrollRef = useRef(null);

  const page = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    // Page by ~one visible width so the user always keeps a tile of context.
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

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

      {/* Left chevron — desktop only, on row hover. */}
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => page(-1)}
        className="hidden fine-pointer:group-hover/row:flex absolute left-0 inset-y-0 z-10 w-10
                   items-center justify-center text-white
                   bg-gradient-to-r from-gray-900/90 to-transparent
                   hover:from-gray-900 transition-colors"
      >
        <ChevronLeft size={22} />
      </button>

      {/* Right chevron — desktop only, on row hover. */}
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => page(1)}
        className="hidden fine-pointer:group-hover/row:flex absolute right-0 inset-y-0 z-10 w-10
                   items-center justify-center text-white
                   bg-gradient-to-l from-gray-900/90 to-transparent
                   hover:from-gray-900 transition-colors"
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}

export default CardCarousel;
