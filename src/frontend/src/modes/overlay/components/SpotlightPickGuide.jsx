import { useEffect, useState } from 'react';
import { MousePointerClick, Check } from 'lucide-react';
import { EDITOR_PANELS } from '../../../config/displayNames';

/**
 * SpotlightPickGuide (T11570) — the on-screen guide for the auto-advancing
 * athlete-pick walk. Purely presentational: every value is a prop, driven by
 * `useGuidedAthletePick`'s phase/step/total via OverlayContainer.
 *
 * Placement (from the approved design artifact):
 *  - `placement="overlay"` — a floating pill over the video (desktop/laptop,
 *    tablet portrait, tablet landscape). `flipToBottom` moves it to the
 *    bottom when a box sits in the top 20% of the frame, so it never covers
 *    a box.
 *  - `placement="strip"` — a block between the video and the timeline
 *    (phone inline, small phone). Never drawn over the video.
 *  - `safeArea` (phone fullscreen / landscape, still `placement="overlay"`)
 *    pads the top for the safe-area inset.
 *  - `compact` drops the sub-line and the word "Step" (small phone, phone
 *    fullscreen/landscape) per the Copy table.
 */
export default function SpotlightPickGuide({
  phase, // null | 'parked' | 'confirm' | 'away' | 'done'
  step,
  total,
  assignedCount = 0,
  progress = [],
  placement = 'overlay',
  compact = false,
  safeArea = false,
  isTouch = false,
  flipToBottom = false,
  isPlaying = false,
  onResumeStep,
  onPlaySpotlight,
}) {
  // Done auto-hides on the next play or after 4s -- ephemeral UI state only,
  // never persisted, reset whenever the walk re-enters 'done'.
  const [doneDismissed, setDoneDismissed] = useState(false);
  const [dragHintOpen, setDragHintOpen] = useState(false);

  useEffect(() => {
    if (phase !== 'done') { setDoneDismissed(false); return; }
    if (isPlaying) { setDoneDismissed(true); return; }
    const timer = setTimeout(() => setDoneDismissed(true), 4000);
    return () => clearTimeout(timer);
  }, [phase, isPlaying]);

  useEffect(() => { setDragHintOpen(false); }, [step]);

  if (!phase || (phase === 'done' && doneDismissed)) return null;

  const isOverlay = placement === 'overlay';
  const positionClass = isOverlay
    ? `absolute left-1/2 -translate-x-1/2 z-20 max-w-[92%] ${flipToBottom ? 'bottom-4' : 'top-4'}`
    : 'relative w-full';

  return (
    <div
      data-testid="spotlight-pick-guide"
      data-phase={phase}
      className={`${positionClass} ${isOverlay ? 'pointer-events-none' : ''}`}
      style={safeArea ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}
    >
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 px-4 min-h-11 rounded-full shadow-lg ring-1 ring-white/20 text-white text-sm font-semibold ${
          phase === 'confirm' ? 'bg-green-600/95' : 'bg-blue-600/95'
        } ${isOverlay ? 'pointer-events-auto' : ''}`}
      >
        {phase === 'done' && (
          <DoneBody total={total} compact={compact} onPlaySpotlight={onPlaySpotlight} />
        )}
        {phase === 'away' && (
          <AwayBody step={step} total={total} compact={compact} onResumeStep={onResumeStep} />
        )}
        {(phase === 'parked' || phase === 'confirm') && (
          <PickingBody
            phase={phase}
            step={step}
            total={total}
            compact={compact}
            isTouch={isTouch}
            assignedCount={assignedCount}
            progress={progress}
            dragHintOpen={dragHintOpen}
            onToggleDragHint={() => setDragHintOpen((v) => !v)}
          />
        )}
      </div>
    </div>
  );
}

function DoneBody({ total, compact, onPlaySpotlight }) {
  return (
    <>
      <Check size={16} aria-hidden="true" className="shrink-0" />
      <span data-testid="pick-guide-text">{EDITOR_PANELS.PICK_GUIDE_DONE(total, compact)}</span>
      <button
        type="button"
        onClick={onPlaySpotlight}
        className="ml-1 min-h-11 px-3 rounded-full bg-white/20 hover:bg-white/30 font-medium"
      >
        {EDITOR_PANELS.PICK_GUIDE_PLAY_SPOTLIGHT}
      </button>
    </>
  );
}

function AwayBody({ step, total, compact, onResumeStep }) {
  return (
    <>
      <MousePointerClick size={16} aria-hidden="true" className="shrink-0" />
      <span data-testid="pick-guide-text">{EDITOR_PANELS.PICK_GUIDE_AWAY(step, total, compact)}</span>
      <button
        type="button"
        onClick={onResumeStep}
        className="ml-1 min-h-11 px-3 rounded-full bg-white/20 hover:bg-white/30 font-medium"
      >
        {EDITOR_PANELS.PICK_GUIDE_AWAY_BUTTON(step)}
      </button>
    </>
  );
}

function PickingBody({ phase, step, total, compact, isTouch, assignedCount, progress, dragHintOpen, onToggleDragHint }) {
  const verb = phase === 'confirm'
    ? EDITOR_PANELS.PICK_GUIDE_CONFIRM
    : (isTouch ? EDITOR_PANELS.PICK_GUIDE_TAP : EDITOR_PANELS.PICK_GUIDE_CLICK);

  return (
    <div className="flex flex-col gap-1 py-1 w-full">
      <div className="flex items-center gap-2">
        {phase === 'confirm'
          ? <Check size={16} aria-hidden="true" className="shrink-0" />
          : <MousePointerClick size={16} aria-hidden="true" className="shrink-0" />}
        <span data-testid="pick-guide-text">{verb}</span>
        <span className="text-white/60" aria-hidden="true">&middot;</span>
        <span data-testid="pick-guide-step">{EDITOR_PANELS.PICK_GUIDE_STEP(step, total, compact)}</span>
      </div>
      {!compact && phase === 'parked' && (
        <p className="text-xs text-white/80 font-normal">
          {assignedCount === 0 ? EDITOR_PANELS.PICK_GUIDE_WHY : EDITOR_PANELS.PICK_GUIDE_AGAIN}
        </p>
      )}
      {phase === 'parked' && (
        <button
          type="button"
          data-testid="pick-guide-not-boxed"
          onClick={onToggleDragHint}
          className="self-start text-xs text-white/70 font-normal min-h-11 flex items-center text-left"
        >
          {dragHintOpen ? EDITOR_PANELS.PICK_GUIDE_DRAG : EDITOR_PANELS.PICK_GUIDE_NOT_BOXED(compact)}
        </button>
      )}
      <ProgressDots progress={progress} activeIndex={step != null ? step - 1 : -1} />
    </div>
  );
}

function ProgressDots({ progress, activeIndex }) {
  if (!progress?.length) return null;
  return (
    <div data-testid="pick-guide-progress-dots" className="flex items-center gap-1" aria-hidden="true">
      {progress.map((picked, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            picked ? 'bg-green-400' : i === activeIndex ? 'bg-white ring-1 ring-white' : 'bg-white/30'
          }`}
        />
      ))}
    </div>
  );
}
