import { X } from 'lucide-react';
import { FOCUS_COCKPIT } from '../../../config/displayNames';

/**
 * CockpitSheet (T10840, Zone E) — a side sheet that slides in from the right,
 * ABSOLUTE inside the cockpit shell (never `fixed`, D6) so it can never escape
 * the shell's containing block and 364px of the stage stays visible behind it.
 *
 * The scrim is `pointer-events-none` (D6 / T10820 precedent): there is no
 * backdrop-tap-to-close. The sheet is closed only by the 44x44 X in its header.
 * The scrim sits between the transport rail (left-14) and the action rail
 * (right-[72px]) so the action rail's CTA is never dimmed.
 *
 * @param {boolean} open
 * @param {string} title
 * @param {() => void} onClose
 * @param {React.ReactNode} children — the scrollable body.
 */
export default function CockpitSheet({ open, title, onClose, children }) {
  return (
    <>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-14 right-[72px] z-30 bg-black/45 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        data-testid="cockpit-sheet"
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        className={`absolute inset-y-0 right-[72px] z-40 flex w-80 flex-col border-l border-gray-700 bg-[#0f172a] ${
          open ? '' : 'pointer-events-none'
        }`}
        style={{
          boxShadow: '-12px 0 32px rgba(0,0,0,0.5)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          visibility: open ? 'visible' : 'hidden',
          transition: open
            ? 'transform 320ms cubic-bezier(0.2,0.8,0.2,1)'
            : 'transform 320ms cubic-bezier(0.2,0.8,0.2,1), visibility 0s linear 320ms',
        }}
      >
        <div className="flex flex-none items-center justify-between border-b border-gray-700 px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <button
            type="button"
            data-testid="cockpit-sheet-close"
            onClick={onClose}
            title={FOCUS_COCKPIT.CLOSE_SHEET}
            aria-label={FOCUS_COCKPIT.CLOSE_SHEET}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
