import { AlertCircle } from 'lucide-react';
import { FOCUS_HINTS } from '../config/displayNames';

/**
 * ActionBand (T9270) — the full-width page-level action band that anchors the
 * primary CTA on Focus and Overlay.
 *
 * THE GOVERNING RULE: one saturated element per screen, and it is the CTA. The
 * band is a `flex: none` bar at the BOTTOM of the screen shell, spanning the FULL
 * width under both the main column and the settings rail, so it reads as a
 * page-level layer rather than a column footer.
 *
 * From `sm:` up (>=640px): three cells in a row — a `flex-1` status cell (left),
 * the CTA (auto width, centered on the viewport axis by the equal-flex sides), a
 * `flex-1` cost cell (right, justify-end). Progress / failed-retry / disabled-
 * reason all render in the status cell, preserving T8510's "reason next to the
 * button" property.
 *
 * Below `sm:` (T10630): the row stacks — CTA first (the governing element),
 * status above it, cost below it, both as full-width centered lines. A
 * non-wrapping three-cell row left each text cell ~60-80px at 393px, wrapping
 * captions one word per line; stacking fixes that without changing content.
 *
 * The CTA NEVER resizes, moves, or collapses — the settings rail's state has no
 * effect on it. Its rendered box is byte-identical rail-expanded vs collapsed and
 * drawer-open vs closed (desktop `sm:` row is otherwise unchanged by this fix).
 *
 * Presentational only. `status`, `cta`, and `cost` are nodes supplied by the host.
 * `data-testid="action-band"` is the stable hook the e2e/unit specs assert against.
 *
 * T11720: `compactLocked` collapses the band to ONE ~52px row BELOW `sm` only
 * (an unlock caption + a disabled Generate pill) so the timeline and Trim
 * controls above the sticky band stay on screen while Generate is still locked.
 * The full band keeps rendering at `sm`+ (so the REAL CTA stays in the DOM for
 * desktop/tablet and the T4880 reachability spec). Desktop/tablet are byte-
 * identical to before; the compact row is a sanctioned exception to T9270's
 * never-resize rule (that rule governs the settings rail — see ui-style-guide).
 */
export default function ActionBand({ status = null, cta = null, cost = null, compactLocked = false, className = '' }) {
  return (
    <div
      data-testid="action-band"
      className={`flex-none w-full ${className}`}
      style={{
        background: '#0b1220',
        borderTop: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* Phone-only compact locked row (T11720). Hidden at sm+ via sm:hidden. */}
      {compactLocked && (
        <div
          data-testid="action-band-compact"
          className="sm:hidden flex items-center gap-2 px-3 py-2"
        >
          <span className="flex flex-1 min-w-0 items-center gap-1.5 text-xs text-amber-400">
            <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{FOCUS_HINTS.GENERATE_LOCKED_SHORT}</span>
          </span>
          <span
            data-testid="generate-locked-pill"
            aria-disabled="true"
            className="flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium bg-blue-900/50 text-blue-300/60"
          >
            {FOCUS_HINTS.GENERATE_LOCKED_CTA}
          </span>
        </div>
      )}
      <div className={`${compactLocked ? 'hidden sm:flex' : 'flex'} flex-col sm:flex-row items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:min-h-[76px]`}>
        {/* Status cell — progress, failed/retry, disabled reason (T8510). */}
        <div className="order-2 sm:order-1 flex-1 min-w-0 w-full sm:w-auto flex flex-col justify-center gap-1 text-center sm:text-left">
          {status}
        </div>
        {/* CTA — the one saturated element; never resizes/moves; first on mobile. */}
        <div className="order-1 sm:order-2 flex-none flex items-center justify-center">
          {cta}
        </div>
        {/* Cost cell — credit estimate, output length. */}
        <div className="order-3 flex-1 min-w-0 w-full sm:w-auto flex flex-col justify-center items-center sm:items-end gap-1 text-center sm:text-right">
          {cost}
        </div>
      </div>
    </div>
  );
}
