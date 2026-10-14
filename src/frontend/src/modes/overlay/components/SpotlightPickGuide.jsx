import { useGuidanceSettings } from '../../../stores/settingsStore';
import { useEffect, useState } from 'react';
import { MousePointerClick, Check } from 'lucide-react';
import { EDITOR_PANELS } from '../../../components/instructions/catalog';
import { GUIDE } from '../../../config/displayNames';
import { resolvePickGuide } from '../../../components/instructions/resolveGuide';
import { InstructionCoach } from '../../../components/instructions';
import FloatingCoach from '../../../components/instructions/FloatingCoach';

/**
 * SpotlightPickGuide (T11570) -- the on-screen guide for the auto-advancing
 * athlete-pick walk. Presentational: every value is a prop, driven by
 * `useGuidedAthletePick`'s phase/step/total via OverlayContainer.
 *
 * T12640: mounted as a FloatingCoach step like every other guide (shade that
 * leaves the video stage clear, Got it, docked above the action band on phones,
 * beside the stage on desktop), so it never sits inside a narrow portrait video.
 * `compact` drops the sub-line and shortens the frame count (small phone, phone
 * fullscreen/landscape) per the Copy table.
 */
function ActiveSpotlightPickGuide({
  phase, // null | 'parked' | 'confirm' | 'away' | 'done' | 'none' (no detections, T12790)
  step,
  total,
  assignedCount = 0,
  progress = [],
  compact = false,
  isTouch = false,
  onResumeStep,
  onNotBoxed,
  boxed, // T12350: parent's box visibility. Given = controlled (the single source); omitted = standalone harness.
  noBoxes = false,
}) {
  const [localHint, setLocalHint] = useState(false);
  const controlled = boxed !== undefined;
  const dragHintOpen = controlled ? boxed === false : localHint;
  // T12350: the state shown here is the resolver's, the same call the box pulse makes.
  const guide = resolvePickGuide({ phase, step, total, assigned: assignedCount, boxed: !dragHintOpen, noBoxes });
  const guideId = guide?.id ?? null;
  const effectiveCompact = compact;

  useEffect(() => { setLocalHint(false); }, [step]);

  if (!phase || !guide) return null;

  return (
    <FloatingCoach guideId={guideId} tone={guide.tone} keepClear={guide.keepClear} phase={guideId}
      target={guide.anchor.target} fallbackTarget={guide.anchor.fallback} avoid={guide.avoid}>
      <div data-testid="spotlight-pick-guide" data-phase={phase} data-guide-id={guideId}>
        <InstructionCoach
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 min-h-11 w-full text-base font-semibold"
          phase={phase}
          tone={guide.tone}
        >
          {guideId === 'overlay.pick.done' && (
            <DoneBody total={total} compact={effectiveCompact} />
          )}
          {guideId === 'overlay.pick.away' && (
            <AwayBody step={step} total={total} compact={effectiveCompact} onResumeStep={onResumeStep} />
          )}
          {phase === 'none' && <NoneBody />}
          {phase !== 'none' && guideId !== 'overlay.pick.done' && guideId !== 'overlay.pick.away' && (
            <PickingBody
              phase={phase}
              step={step}
              total={total}
              compact={effectiveCompact}
              isTouch={isTouch}
              assignedCount={assignedCount}
              progress={progress}
              dragHintOpen={dragHintOpen}
              onToggleDragHint={() => { if (!controlled) setLocalHint((v) => !v); onNotBoxed?.(); }}
            />
          )}
        </InstructionCoach>
      </div>
    </FloatingCoach>
  );
}

// Every interactive element gets `pointer-events-auto` explicitly -- the
// pill body above is `pointer-events-none` so a tap on a box the pill
// happens to still cover reaches the box underneath (T11570 MAJOR-2 fix;
// the OLD T9620 banner was pointer-events-none throughout for the same
// reason, but this guide has real buttons, so only THEY opt back in).
const BUTTON_CLASS = 'pointer-events-auto ml-1 min-h-11 px-3 rounded-full bg-white/20 hover:bg-white/30 font-medium';

function DoneBody({ total, compact }) {
  return (
    <>
      <Check size={16} aria-hidden="true" className="shrink-0" />
      <div data-testid="pick-guide-done-body" className="flex flex-col items-start gap-0.5">
        <span data-testid="pick-guide-text">{EDITOR_PANELS.PICK_GUIDE_DONE(total, compact)}</span>
        {!compact && <span className="text-sm text-white/80 font-normal">{EDITOR_PANELS.PICK_GUIDE_DONE_BODY}</span>}
      </div>
    </>
  );
}

function NoneBody() {
  return (
    <>
      <MousePointerClick size={16} aria-hidden="true" className="shrink-0" />
      <span data-testid="pick-guide-text">{EDITOR_PANELS.PICK_GUIDE_DRAG}</span>
    </>
  );
}

function AwayBody({ step, total, compact, onResumeStep }) {
  return (
    <>
      <MousePointerClick size={16} aria-hidden="true" className="shrink-0" />
      <span data-testid="pick-guide-text">{EDITOR_PANELS.PICK_GUIDE_AWAY(step, total, compact)}</span>
      <button type="button" onClick={onResumeStep} className={BUTTON_CLASS}>
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
        <p className="text-sm text-white/80 font-normal">
          {assignedCount === 0 ? EDITOR_PANELS.PICK_GUIDE_WHY(total) : EDITOR_PANELS.PICK_GUIDE_AGAIN}
        </p>
      )}
      {phase === 'parked' && (
        dragHintOpen && <p className="text-sm text-white/80 font-normal">{GUIDE.overlay.pick.notOutlined.title}</p>
      )}
      {phase === 'parked' && (
        <button
          type="button"
          data-testid="pick-guide-not-boxed"
          onClick={onToggleDragHint}
          className="pointer-events-auto self-start text-sm text-white/70 font-normal min-h-11 flex items-center text-left"
        >
          {dragHintOpen ? EDITOR_PANELS.PICK_GUIDE_NOT_OUTLINED_DONE : EDITOR_PANELS.PICK_GUIDE_NOT_OUTLINED}
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

export default function SpotlightPickGuide(props) {
  const { coachEnabled } = useGuidanceSettings();
  return coachEnabled ? <ActiveSpotlightPickGuide {...props} /> : null;
}
