import { PLAYS_ONLY } from '../config/displayNames';
import { DialogShell } from './shared/DialogShell';
import { Z } from '../constants/zLayers';

/**
 * PlaysOnlyConfirmSheet (T12930)
 *
 * Confirm sheet for "Keep only marked plays" / "Restore full video". Bottom sheet on
 * phones, centered card on desktop (DialogShell's sheet variant, T4560). Never closes
 * on backdrop click (house rule) and has no Escape: Cancel is the only dismissal, and
 * it writes nothing. Sits on the PLAYER rung (its z-[70] from before the shell).
 */
export function PlaysOnlyConfirmSheet({ title, body, confirmLabel, busy = false, onConfirm, onCancel }) {
  return (
    <DialogShell variant="sheet" zLayer={Z.PLAYER} ariaLabel={title} backdropTestId="plays-only-sheet-backdrop">
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
    </DialogShell>
  );
}
