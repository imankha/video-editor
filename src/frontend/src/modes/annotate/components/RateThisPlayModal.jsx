import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { ANNOTATE } from '../../../config/displayNames';
import { RatingMeaningsList } from './RatingMeaningsList';

/**
 * RateThisPlayModal (T11120) — the gate that opens when the user tries to leave
 * the editor on an UNRATED play. It renders the SAME RatingMeaningsList the
 * editor's rating pill opens (owner ruling: one component). Picking a row is the
 * rating gesture (onPick persists it and continues the original exit); the ONLY
 * no-save exit is "Keep editing" (M6) or Escape (onDismiss) — the backdrop is
 * inert (never closes on backdrop click).
 *
 * Rendered through a portal at z above the mobile fullscreen editor
 * (AnnotateModeView's `fixed inset-0 z-[100]`), and mobile is a bottom sheet.
 * Its Escape handler is on `document` with stopPropagation (mirroring
 * RatingPill) so the same keypress can't also trip the overlay's window-level
 * Escape or the container's fullscreen-exit Escape.
 *
 * @param {(value:number)=>void} onPick  chosen rating (1-5)
 * @param {()=>void} onDismiss  "Keep editing" / Escape — returns to the editor
 * @param {boolean} isMobile  bottom-sheet vs centered card
 * @param {number|null} rating  current rating (always null in practice — the
 *        gate only opens for unrated plays — but drives aria-checked correctly)
 */
export function RateThisPlayModal({ onPick, onDismiss, isMobile, rating = null }) {
  const headingId = useId();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss();
    };
    // `document` (not `window`) + stopPropagation, so this Escape doesn't also
    // reach the editor's window-level Escape or the container's fullscreen-exit
    // handler on the same keypress.
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return createPortal(
    <div
      role="presentation"
      data-testid="rate-gate-backdrop"
      className={
        isMobile
          ? 'fixed inset-0 z-[200] flex items-end justify-center bg-black/60'
          : 'fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4'
      }
      // Backdrop is inert — clicking it does NOT dismiss (owner ruling).
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="rate-gate-modal"
        className={
          isMobile
            ? 'w-full pb-[max(0.75rem,env(safe-area-inset-bottom))] rounded-t-2xl p-4 border border-gray-700 bg-gray-800 shadow-xl'
            : 'w-full max-w-sm rounded-2xl p-5 border border-gray-700 bg-gray-800 shadow-xl'
        }
      >
        {isMobile && (
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-600" />
        )}
        <h2 id={headingId} className="text-lg font-bold text-white">{ANNOTATE.RATE_PLAY}</h2>
        <p className="mt-0.5 mb-3 text-sm text-gray-400">{ANNOTATE.RATE_GATE_SUBTITLE}</p>
        <RatingMeaningsList rating={rating} headingId={headingId} onPick={onPick} />
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 w-full px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700/70 rounded-lg transition-colors coarse-pointer:min-h-[44px]"
        >
          {ANNOTATE.RATE_GATE_KEEP_EDITING}
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default RateThisPlayModal;
