import { useEffect } from 'react';
import { X, Video, Film, RotateCcw, Check, AudioLines, MapPin } from 'lucide-react';
import { ANNOTATE } from '../../config/displayNames';

/**
 * FixTimingStrip (T8900; T17700 "Sync") — the yellow mode-swap strip that replaces the
 * primary "Add Play" CTA block under the canvas while the parent moves ONE camera
 * until both cameras show the same moment. Follows the T8600 under-canvas mode-swap
 * pattern (a strip that takes the CTA block's place, not a modal); the timeline stays
 * visible above so the parent can also drag the camera's bar.
 *
 * Two steps:
 *  - 'place' (a video we placed at the end, after "Same time"): play the main camera
 *    to about where it begins, tap Starts here (onPlace, the one write of that step).
 *  - 'sync': Earlier / Later in 10s, 1s and 0.1s steps, compare buttons, Done.
 *
 * All state is LOCAL to the session (owned by AnnotateContainer): nudges and drags
 * mutate a pending offset that previews through the T8880 lane model WITHOUT touching
 * loaded gameVideos. Persistence is gesture-based: Done is the only save of a move
 * (owner ruling 2026-11-18 Q4: a drop no longer saves), never reactive.
 *
 * Esc discards (two-layer Esc precedent, T8600): this strip owns the outer layer here.
 * X does the same. Undo moves restores the loaded value.
 *
 * T17710 (sync by sound) will add a status line under the header; not shown yet.
 */

// The running move in words, rounded to 0.1s (nudge granularity) so float
// accumulation (0.1+0.1+0.1) never leaks noise into the readout. A negative
// delta moves the camera earlier on the game's timeline.
export function formatMoved(seconds) {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded === 0) return ANNOTATE.SYNC_NOT_MOVED;
  // String() drops a trailing .0 (1.0 -> "1").
  return ANNOTATE.syncMoved(String(Math.abs(rounded)), rounded < 0);
}

const STEPS = [10, 1, 0.1];

export default function FixTimingStrip({
  step = 'sync',
  angleName,
  mainName = ANNOTATE.MAIN_CAMERA,
  moved = 0,
  // false while the playhead is outside the part both cameras filmed: the compare
  // buttons would have nothing shared to play.
  canCompare = true,
  // true after a placed-at-end video was given a rough spot with Starts here: X then
  // keeps that spot (owner ruling Q3), and the strip says so.
  placed = false,
  placeDisabledReason = null,
  onNudge,
  onPlayAngle,
  onPlayMain,
  onPlace,
  onReset,
  onDone,
  onCancel,
}) {
  // Outer-layer Esc: cancel (discard). Registered at the document so it fires
  // whether or not a strip control has focus.
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

  // Desktop keys while focus is inside the strip: Left/Right = 0.1s, Shift = 1s,
  // Enter on the strip itself = Done. Buttons keep their own Enter/Space.
  const onStripKey = (e) => {
    if (step !== 'sync') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const s = e.shiftKey ? 1 : 0.1;
      onNudge?.(e.key === 'ArrowLeft' ? -s : s);
    } else if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      onDone?.();
    }
  };

  const nudgeBtn = 'px-3 py-2 coarse-pointer:min-h-11 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold min-w-[52px] tabular-nums transition-colors';
  const rowLabel = 'w-16 shrink-0 text-xs font-semibold text-yellow-200 uppercase tracking-wide';
  const title = step === 'place' ? ANNOTATE.placeStepTitle(angleName) : ANNOTATE.syncWith(angleName, mainName);

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-yellow-200">
        {step === 'place' ? <MapPin size={18} className="shrink-0" /> : <AudioLines size={18} className="shrink-0" />}
        <h3 className="text-base font-bold truncate">{title}</h3>
      </div>
      <button
        type="button"
        data-testid="fix-timing-cancel"
        onClick={onCancel}
        aria-label={ANNOTATE.SYNC_CANCEL}
        title={ANNOTATE.SYNC_CANCEL}
        className="shrink-0 p-1.5 coarse-pointer:min-h-11 coarse-pointer:min-w-11 inline-flex items-center justify-center rounded-lg text-yellow-200/80 hover:text-white hover:bg-yellow-900/40 transition-colors"
      >
        <X size={18} />
      </button>
    </div>
  );

  const container = 'mt-3 sm:mt-6 rounded-xl border bg-yellow-950/20 border-yellow-800/40 p-3 sm:p-4';

  if (step === 'place') {
    return (
      <div data-testid="fix-timing-strip" data-step="place" className={container}>
        {header}
        <p className="mt-1 text-sm text-yellow-100/80">{ANNOTATE.placeStepText(angleName)}</p>
        {placeDisabledReason && <p className="mt-1 text-sm text-amber-200">{placeDisabledReason}</p>}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-testid="fix-timing-place-confirm"
            onClick={onPlace}
            disabled={!!placeDisabledReason}
            className="flex items-center gap-1.5 px-4 py-2 coarse-pointer:min-h-11 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:hover:bg-green-500 text-white text-sm font-bold transition-colors"
          >
            <MapPin size={16} /> {ANNOTATE.PLACE_STEP_CONFIRM}
          </button>
        </div>
      </div>
    );
  }

  const hasPlayRow = !!(onPlayAngle || onPlayMain);
  const nudgeRow = (earlier) => (
    <div className="flex items-center gap-2">
      <span className={rowLabel}>{earlier ? ANNOTATE.SYNC_EARLIER : ANNOTATE.SYNC_LATER}</span>
      {(earlier ? STEPS : [...STEPS].reverse()).map((s) => (
        <button
          key={s}
          type="button"
          data-testid={`fix-timing-${earlier ? 'earlier' : 'later'}-${s}`}
          aria-label={ANNOTATE.syncNudgeAria(angleName, s, earlier)}
          onClick={() => onNudge?.(earlier ? -s : s)}
          className={nudgeBtn}
        >
          {s}s
        </button>
      ))}
    </div>
  );

  return (
    // tabIndex so the desktop arrow keys work once the parent clicks into the strip.
    <div data-testid="fix-timing-strip" data-step="sync" tabIndex={-1} onKeyDown={onStripKey} className={`${container} outline-none`}>
      {header}
      <p className="mt-1 text-sm text-yellow-100/80">{ANNOTATE.SYNC_INSTRUCTION}</p>
      {placed && <p className="mt-1 text-xs text-yellow-200/70">{ANNOTATE.PLACE_STEP_CANCEL_NOTE}</p>}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* Compare: the same game moment from each camera, ~3s each. */}
        {hasPlayRow && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="fix-timing-play-angle"
                onClick={onPlayAngle}
                disabled={!canCompare}
                className="flex items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-11 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-700 text-white text-sm font-medium transition-colors"
              >
                <Video size={16} /> {ANNOTATE.playCamera(angleName)}
              </button>
              <button
                type="button"
                data-testid="fix-timing-play-main"
                onClick={onPlayMain}
                disabled={!canCompare}
                className="flex items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-11 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:hover:bg-gray-700 text-white text-sm font-medium transition-colors"
              >
                <Film size={16} /> {ANNOTATE.PLAY_MAIN_CAMERA}
              </button>
            </div>
            <p className="mt-1 text-xs text-yellow-100/70">
              {canCompare ? ANNOTATE.SYNC_COMPARE_CAPTION : ANNOTATE.SYNC_NEED_OVERLAP}
            </p>
          </div>
        )}

        {/* Move: two labeled rows (flex-wrap so nothing overflows at 320px). */}
        <div className="flex flex-col gap-2">
          {nudgeRow(true)}
          {nudgeRow(false)}
          <span data-testid="fix-timing-moved" className="text-sm font-semibold text-yellow-100 tabular-nums">
            {formatMoved(moved)}
          </span>
          <span className="text-xs text-yellow-100/70">{ANNOTATE.syncDragHint(angleName)}</span>
        </div>
      </div>

      <p className="mt-3 text-sm text-yellow-100/80">{ANNOTATE.SYNC_DONE_HINT}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="fix-timing-reset"
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-11 rounded-lg text-yellow-200/90 hover:text-white hover:bg-yellow-900/40 text-sm font-medium transition-colors"
        >
          <RotateCcw size={16} aria-hidden="true" /><span>{ANNOTATE.SYNC_UNDO}</span>
        </button>
        <button
          type="button"
          data-testid="fix-timing-done"
          onClick={onDone}
          className="flex items-center gap-1.5 px-4 py-2 coarse-pointer:min-h-11 rounded-lg bg-green-500 hover:bg-green-400 text-white text-sm font-bold shadow-lg shadow-green-900/40 transition-colors"
        >
          <Check size={18} /> {ANNOTATE.SYNC_DONE}
        </button>
      </div>
    </div>
  );
}
