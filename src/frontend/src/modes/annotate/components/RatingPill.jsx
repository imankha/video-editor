import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Star, X } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { Z } from '../../../constants/zLayers';
import {
  RATING_ADJECTIVES,
  RATING_BACKGROUND_COLORS,
  RATING_BADGE_COLORS,
  UNRATED_BACKGROUND_COLOR,
  UNRATED_BADGE_COLOR,
  getRatingLabel,
} from '../../../components/shared/clipConstants';
import { RatingMeaningsList } from './RatingMeaningsList';

// Desktop picker geometry (T11410). Margin keeps the card off the viewport edge;
// GAP is the breathing room between the pill and the card so a flip never covers
// the trigger. The height estimate is a first-pass only — the real height is
// measured in a useLayoutEffect and the position corrected before paint (the
// shipped ReelTile kebab pattern).
const PICKER_MARGIN = 8;
const PICKER_GAP = 8;
const PICKER_EST_HEIGHT = 360;
const PICKER_MAX_WIDTH = 320;

// Flip-aware, viewport-clamped position for the desktop picker, computed from the
// pill's anchor rect. Returns viewport (`fixed`) coordinates plus a maxHeight so
// an edge-anchored card scrolls its rows into reach instead of overflowing.
function computePickerPos(anchorRect, cardWidth, cardHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal: left-align to the pill, then clamp so the full card stays on-screen.
  let left = anchorRect.left;
  left = Math.min(left, vw - PICKER_MARGIN - cardWidth);
  left = Math.max(PICKER_MARGIN, left);

  // Vertical: prefer below the pill; flip above only when below can't fit AND
  // above has more room. Either placement is offset by GAP so it never covers
  // the trigger. maxHeight clamps the card to the available space.
  const spaceBelow = vh - anchorRect.bottom - PICKER_GAP - PICKER_MARGIN;
  const spaceAbove = anchorRect.top - PICKER_GAP - PICKER_MARGIN;
  if (cardHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    return { top: anchorRect.bottom + PICKER_GAP, left, maxHeight: Math.max(0, spaceBelow) };
  }
  const maxHeight = Math.max(0, spaceAbove);
  return { top: anchorRect.top - PICKER_GAP - Math.min(cardHeight, maxHeight), left, maxHeight };
}

/**
 * RatingPill (T11150) — the play editor's rating control, replacing the old
 * T10410 RatingBadge (chess-notation disc + "Required"/amber-dashed to-do
 * treatment). A normal labeled pill: neutral slate when unrated (no amber, no
 * dashed border, no "Required" copy — rating is optional, not a checklist
 * item), amber-starred with the rating's adjective once set, and a gold pill
 * (T11110's RATING_BADGE_COLORS[5]) at a 5-star rating specifically — reusing
 * the shipped gold, not inventing a new color.
 *
 * The popup is the shared RatingMeaningsList (T11120): five rows, best-first
 * (5 -> 1), each an amber star strip + RATING_ADJECTIVES + a one-line meaning —
 * the SAME list the "Rate this play" gate modal renders (owner ruling: one
 * component). NO chess RATING_NOTATION anywhere (dropped per the H12A=A2
 * ruling). Mobile renders a bottom sheet (explicit X, no
 * backdrop-close — the standing project rule); desktop an anchored dropdown.
 * The Escape handler lives on `document` with `stopPropagation()` so it
 * doesn't also trip the editor's own window-level Escape handler on the same
 * keypress (T10590 landmine, preserved here).
 */
export function RatingPill({ rating, onRatingChange, myAthlete, isMobile }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  // T11410: desktop picker is portaled to document.body (to escape the fullscreen
  // editor's stacking context, the T5700/T8140 landmine) and `fixed`-positioned
  // from the pill's anchor rect. null until computed, so the portal mounts only
  // once it has a viewport-safe position.
  const [pos, setPos] = useState(null);
  const headingId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      // The desktop card is portaled outside rootRef, so a click inside it would
      // otherwise read as "outside" and close before the row's click lands —
      // exclude the card too (the ReelTile portal-menu pattern).
      if (rootRef.current?.contains(e.target) || cardRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // T10590 (preserved): stopPropagation so this Escape doesn't also reach
      // AnnotateFullscreenOverlay's window-level Escape handler, which would
      // otherwise close the whole editor on the same keypress that just
      // closed this picker.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // T11410: compute (and keep updating on resize/scroll) the desktop picker's
  // viewport position from the pill anchor. Mobile is viewport-fixed already, so
  // it needs none of this. First pass uses the height estimate; the layout effect
  // below corrects with the measured height before paint.
  useEffect(() => {
    if (!open || isMobile) { setPos(null); return undefined; }
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const measured = cardRef.current?.getBoundingClientRect();
      const cardWidth = measured?.width || PICKER_MAX_WIDTH;
      const cardHeight = measured?.height || PICKER_EST_HEIGHT;
      setPos(computePickerPos(anchor, cardWidth, cardHeight));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, isMobile]);

  // T11410: once the portal is mounted, measure its REAL size and correct the
  // flip/clamp before paint (the first pass positioned from an estimate, before
  // the card existed to measure). Converges in one correction via the guard.
  useLayoutEffect(() => {
    if (!open || isMobile || !pos || !cardRef.current || !triggerRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const measured = cardRef.current.getBoundingClientRect();
    const next = computePickerPos(anchor, measured.width, measured.height);
    if (next.top !== pos.top || next.left !== pos.left || next.maxHeight !== pos.maxHeight) {
      setPos(next);
    }
  }, [open, isMobile, pos]);

  const pickerTitle = myAthlete ? ANNOTATE.RATE_ATHLETES_PLAY : ANNOTATE.RATE_TEAMS_PLAY;
  const rated = rating != null;
  const pillTitle = rated ? getRatingLabel(rating) : ANNOTATE.RATE_PLAY;
  const color = rated ? RATING_BADGE_COLORS[rating] : UNRATED_BADGE_COLOR;
  const backgroundColor = rated ? RATING_BACKGROUND_COLORS[rating] : UNRATED_BACKGROUND_COLOR;

  // The shared meanings list — identical for the mobile sheet and the desktop
  // popover, so both surfaces render the SAME component (T11120 owner ruling).
  const pickerList = (
    <RatingMeaningsList
      rating={rating}
      headingId={headingId}
      onPick={(value) => {
        onRatingChange(value);
        setOpen(false);
      }}
    />
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="rating-pill"
        data-state={rated ? 'rated' : 'unrated'}
        data-rating={rating ?? ''}
        title={pillTitle}
        aria-label={pillTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium transition-transform hover:scale-[1.03] coarse-pointer:min-h-[44px]"
        style={{ color, backgroundColor, borderColor: `${color}80` }}
      >
        <Star
          size={14}
          fill={rated ? color : 'transparent'}
          color={color}
          strokeWidth={1.5}
        />
        {rated ? RATING_ADJECTIVES[rating] : ANNOTATE.RATE_PLAY}
      </button>
      {/* Mobile: the viewport-fixed full-width bottom sheet, unchanged (T11410
          leaves mobile alone). It stays INSIDE rootRef so a backdrop tap reads as
          "inside" and does not close — the project's no-backdrop-close rule. */}
      {open && isMobile && (
        <div role="presentation" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
          <div
            ref={cardRef}
            data-testid="rating-picker"
            className="w-full pb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-t-2xl p-2 border border-gray-700 bg-gray-800 shadow-xl"
          >
            <div aria-hidden="true" className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full bg-gray-600" />
            <div className="flex items-start justify-between gap-2 px-1.5 pt-1 pb-2.5">
              <div id={headingId} className="text-lg font-bold text-white">{pickerTitle}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 p-1 -m-1 rounded text-gray-400 hover:text-white hover:bg-gray-700/70 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]"
              >
                <X size={18} />
              </button>
            </div>
            {pickerList}
          </div>
        </div>
      )}
      {/* Desktop: portaled to document.body with flip-aware, viewport-clamped
          `fixed` positioning so a pill near the bottom/right edge (fullscreen
          editor) never pushes the card off-screen. maxHeight + overflow keeps
          every row reachable at extreme anchors. */}
      {open && !isMobile && pos && createPortal(
        <div
          ref={cardRef}
          data-testid="rating-picker"
          className={`${Z.POPOVER} w-auto min-w-[260px] max-w-[320px] overflow-y-auto pb-2 rounded-xl p-2 border border-gray-700 bg-gray-800 shadow-xl`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
        >
          <div id={headingId} className="px-1.5 pt-1 pb-2.5 text-lg font-bold text-white">{pickerTitle}</div>
          {pickerList}
        </div>,
        document.body
      )}
    </div>
  );
}

export default RatingPill;
