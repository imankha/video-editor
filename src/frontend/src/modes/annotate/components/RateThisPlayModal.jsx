import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { RatingMeaningsList } from './RatingMeaningsList';

/**
 * RateThisPlayModal (T11120) — the gate that opens when the user tries to leave
 * the editor on an UNRATED play. It renders the SAME RatingMeaningsList the
 * editor's old rating pill popup opened (owner ruling: one component). Picking a row is the
 * rating gesture (onPick persists it and continues the original exit). There is
 * no competing rating action; the header X (T11840) and Escape are the no-save
 * exits, and the backdrop is inert.
 *
 * Rendered through a portal at z above the mobile fullscreen editor
 * (AnnotateModeView's `fixed inset-0 z-[100]`), and mobile is a bottom sheet.
 * Its Escape handler is on `document` with stopPropagation (mirroring
 * the old rating pill) so the same keypress can't also trip the overlay's window-level
 * Escape or the container's fullscreen-exit Escape.
 *
 * @param {(value:number)=>void} onPick  chosen rating (1-5)
 * @param {()=>void} onDismiss  Escape or the header X, returns to the editor
 * @param {boolean} isMobile  bottom-sheet vs centered card
 * @param {number|null} rating  current rating (always null in practice — the
 *        gate only opens for unrated plays — but drives aria-checked correctly)
 * @param {number|null} pendingRating  T11400: the just-picked rating whose
 *        persisted write is in flight. Forwarded to RatingMeaningsList so the
 *        pick is acknowledged immediately (selected + busy row, other rows
 *        disabled) during the await-before-navigate window.
 */
export function RateThisPlayModal({ onPick, onDismiss, isMobile, rating = null, pendingRating = null }) {
  const headingId = useId();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // While the gate is open, Escape means ONLY "dismiss the gate". Capture
      // phase + stopImmediatePropagation makes that win order-INDEPENDENTLY over
      // every other Escape listener — the editor's window handler AND the
      // container's fullscreen-exit `document` handler (a plain stopPropagation
      // on `document` would NOT stop that same-target sibling; only capture +
      // stopImmediate does). So dismissing can never also re-toggle fullscreen
      // or re-stash a stale continuation, regardless of listener mount order.
      e.stopImmediatePropagation();
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
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
        <div className="flex items-start justify-between gap-2">
          <h2 id={headingId} className="text-lg font-bold text-white">{ANNOTATE.RATE_PLAY}</h2>
          {/* T11840 (H2): the touch-reachable twin of Escape. Same behavior: back
              to the editor, nothing written. The backdrop stays inert. */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label={ANNOTATE.RATE_MODAL_CLOSE_LABEL}
            className="shrink-0 -m-2 p-2 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] flex items-center justify-center text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mt-0.5 mb-3 text-sm text-gray-400">{ANNOTATE.RATE_GATE_SUBTITLE}</p>
        <RatingMeaningsList rating={rating} headingId={headingId} onPick={onPick} pendingRating={pendingRating} />
      </div>
    </div>,
    document.body,
  );
}

export default RateThisPlayModal;
