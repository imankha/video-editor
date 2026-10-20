import { createPortal } from 'react-dom';
import { PLAYS_ONLY } from '../config/displayNames';

/**
 * PlaysOnlyConfirmSheet (T12930)
 *
 * Confirm sheet for "Keep only marked plays" / "Restore full video". Bottom sheet on
 * phones, centered card on desktop. Never closes on backdrop click (house rule):
 * Cancel is the only dismissal, and it writes nothing.
 */
export function PlaysOnlyConfirmSheet({ title, body, confirmLabel, busy = false, onConfirm, onCancel }) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/60" data-testid="plays-only-sheet-backdrop" />
      <div className="relative w-full sm:max-w-sm bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <h2 className="text-white text-base font-semibold mb-2">{title}</h2>
        <p className="text-gray-300 text-sm mb-5">{body}</p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} disabled={busy}
            className="min-h-[44px] px-4 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition-colors disabled:opacity-50">
            {PLAYS_ONLY.CANCEL}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="min-h-[44px] px-4 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
