import { useEffect } from 'react';
import { X, Video, Film, RotateCcw, Check } from 'lucide-react';

/**
 * FixTimingStrip (T8900) — the yellow mode-swap strip that replaces the primary
 * "Add Play" CTA block under the canvas while the user is nudging ONE angle into
 * alignment. Follows the T8600 under-canvas mode-swap pattern (a strip that takes
 * the CTA block's place, not a modal); the timeline stays visible above so the
 * user can also drag the bar itself.
 *
 * All state is LOCAL to the Fix-timing session (owned by AnnotateContainer): the
 * nudge/drag mutate a pending offset that previews through the T8880 lane model
 * WITHOUT touching loaded gameVideos. Persistence is gesture-based: exactly one
 * PATCH fires from onDone, never reactively as the offset changes.
 *
 * Esc discards (two-layer Esc precedent, T8600): this strip owns the outer layer
 * here — Esc cancels Fix-timing. X does the same. Reset restores the loaded value.
 */

// Format the running "moved" delta as +/-Ns, rounded to 0.1s (nudge granularity)
// so float accumulation (0.1+0.1+0.1) never leaks noise into the readout.
export function formatMoved(seconds) {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded === 0) return 'Moved 0s';
  const sign = rounded > 0 ? '+' : ''; // negatives already carry '-'
  // String(rounded) already drops a trailing .0 (1.0 -> "1", 1.5 -> "1.5").
  return `Moved ${sign}${rounded}s`;
}

export default function FixTimingStrip({
  angleName,
  moved = 0,
  onNudge,
  onPlayAngle,
  onPlayMain,
  onReset,
  onDone,
  onCancel,
}) {
  // Outer-layer Esc: cancel Fix-timing (discard). Registered at the document so
  // it fires whether or not a strip control has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const nudgeBtn = 'px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold min-w-[52px] transition-colors';

  return (
    <div
      data-testid="fix-timing-strip"
      className="mt-3 sm:mt-6 rounded-xl border bg-yellow-950/20 border-yellow-800/40 p-3 sm:p-4"
    >
      {/* Header: title + X to cancel */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-yellow-200">
          <Video size={18} className="shrink-0" />
          <h3 className="text-base font-bold truncate">Fix timing: {angleName}</h3>
        </div>
        <button
          type="button"
          data-testid="fix-timing-cancel"
          onClick={onCancel}
          title="Cancel (Esc)"
          className="p-1.5 rounded-lg text-yellow-200/80 hover:text-white hover:bg-yellow-900/40 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <p className="mt-1 text-sm text-yellow-100/80">
        Line it up: find a moment you can hear in both, like a whistle or a big cheer,
        then nudge until they match.
      </p>

      {/* Nudge controls row (flex-wrap so it never overflows at 320px). */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" data-testid="fix-timing-nudge--1" onClick={() => onNudge?.(-1)} className={nudgeBtn}>
          -1s
        </button>
        <button type="button" data-testid="fix-timing-nudge--0.1" onClick={() => onNudge?.(-0.1)} className={nudgeBtn}>
          -0.1s
        </button>
        <span
          data-testid="fix-timing-moved"
          className="px-2 min-w-[92px] text-center text-sm font-semibold text-yellow-100"
        >
          {formatMoved(moved)}
        </span>
        <button type="button" data-testid="fix-timing-nudge-0.1" onClick={() => onNudge?.(0.1)} className={nudgeBtn}>
          +0.1s
        </button>
        <button type="button" data-testid="fix-timing-nudge-1" onClick={() => onNudge?.(1)} className={nudgeBtn}>
          +1s
        </button>
      </div>

      {/* A/B play row: same game moment from each source, ~3s each. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="fix-timing-play-angle"
          onClick={onPlayAngle}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
        >
          <Video size={16} /> Play this angle
        </button>
        <button
          type="button"
          data-testid="fix-timing-play-main"
          onClick={onPlayMain}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
        >
          <Film size={16} /> Play main camera
        </button>
      </div>

      {/* Reset / Done row. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="fix-timing-reset"
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-yellow-200/90 hover:text-white hover:bg-yellow-900/40 text-sm font-medium transition-colors"
        >
          <RotateCcw size={16} /> Reset
        </button>
        <button
          type="button"
          data-testid="fix-timing-done"
          onClick={onDone}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-white text-sm font-bold shadow-lg shadow-green-900/40 transition-colors"
        >
          <Check size={18} /> Done
        </button>
      </div>
    </div>
  );
}
