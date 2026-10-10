import { bandsCollide } from '../../../components/instructions/placement';
import { useGuidanceSettings } from '../../../stores/settingsStore';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MousePointerClick, Check } from 'lucide-react';
import { EDITOR_PANELS } from '../../../components/instructions/catalog';
import { GUIDE } from '../../../config/displayNames';
import { resolvePickGuide } from '../../../components/instructions/resolveGuide';
import { InstructionCoach } from '../../../components/instructions';

const EDGE_MARGIN_PX = 16; // matches the top-4/bottom-4 Tailwind offset

/**
 * True if two [top, bottom] pixel bands overlap.
 */


/**
 * SpotlightPickGuide (T11570) — the on-screen guide for the auto-advancing
 * athlete-pick walk. Presentational: every value is a prop, driven by
 * `useGuidedAthletePick`'s phase/step/total via OverlayContainer.
 *
 * Placement (from the approved design artifact):
 *  - `placement="overlay"` — a floating pill over the video (desktop/laptop,
 *    tablet portrait, tablet landscape). The pill measures its OWN rendered
 *    height and checks it against `obstacleBoxes` (real detection box
 *    rects, video-pixel space) converted into the SAME pixel space via
 *    `stageRef`'s measured height — it picks whichever of top/bottom is
 *    actually clear, trying a compact render once if NEITHER band is clear
 *    at full size, before giving up and defaulting to top. Pointer events
 *    pass through the pill's body (only its buttons are clickable), so a
 *    box the pill still ends up covering in a genuinely cramped layout
 *    remains tappable underneath it.
 *  - `placement="strip"` — a block between the video and the timeline
 *    (phone inline, small phone). Never drawn over the video, so no
 *    measurement is needed.
 *  - `safeArea` (phone fullscreen / landscape, still `placement="overlay"`)
 *    pads the top for the safe-area inset.
 *  - `compact` drops the sub-line and shortens the frame count (small phone, phone
 *    fullscreen/landscape) per the Copy table. May be forced on internally
 *    (see above) even when the caller passed `compact={false}`.
 */
function ActiveSpotlightPickGuide({
  phase, // null | 'parked' | 'confirm' | 'away' | 'done'
  step,
  total,
  assignedCount = 0,
  progress = [],
  placement = 'overlay',
  compact = false,
  safeArea = false,
  isTouch = false,
  stageRef = null, // ref to the stage container -- for measuring real height ('overlay' only)
  obstacleBoxes = [], // [{y, height}] in video-pixel space (e.g. playerDetections)
  videoHeight = 0, // detectionVideoHeight -- the space obstacleBoxes' y/height are in
  onResumeStep,
  onPlaySpotlight,
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
  const pillRef = useRef(null);
  const [side, setSide] = useState('top');
  const [forcedCompact, setForcedCompact] = useState(false);
  // Tracks the inputs the LAST measurement pass decided against, so a
  // forced-compact decision is only revisited when something REAL changed
  // (a new obstacle set, phase, or step) -- never just because the compact
  // form happens to fit on this pass (see the BLOCKING infinite-loop fix
  // below: resetting forcedCompact reactively inside the "it fits" branch
  // re-measures the FULL pill next, which doesn't fit, forcing compact
  // again, which fits, resetting again... forever).
  const measuredInputsKeyRef = useRef(null);
  // `stageRef` points at a DOM node owned by an ANCESTOR (OverlayModeView /
  // the diag harness), not this component's own tree -- on the very first
  // commit its ref callback is not yet guaranteed to have run by the time
  // THIS component's layout effect fires (observed in real browsers: the
  // ancestor's own commit can still be in flight). `mountTick` forces one
  // guaranteed extra measurement pass after the browser's first paint, by
  // which point the whole tree has definitely settled.
  const [mountTick, setMountTick] = useState(0);

  useEffect(() => { setLocalHint(false); }, [step]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMountTick((t) => t + 1));
    return () => cancelAnimationFrame(raf);
  }, []);

  const isOverlay = placement === 'overlay';
  const effectiveCompact = compact || forcedCompact;

  // Real-geometry flip: measure the pill's ACTUAL rendered height and the
  // stage's ACTUAL rendered height, then check the top/bottom candidate
  // bands against every real obstacle box -- never a static "top 20%"
  // heuristic blind to the pill's own size or to obstacles near the bottom.
  useLayoutEffect(() => {
    if (!isOverlay || !stageRef?.current || !pillRef.current || !videoHeight) {
      // Don't commit to 'top' permanently here -- mountTick (above) retries
      // once more after the next paint, in case the ancestor's stageRef
      // simply hadn't attached yet on this pass.
      return;
    }

    // A genuinely NEW input (different obstacles/phase/step) gets a fresh
    // shot at full size, even if we'd previously forced compact for the
    // old inputs. Re-entering this branch mid-measurement-cycle (same
    // inputs, just re-running because `effectiveCompact`/`forcedCompact`
    // themselves changed) must NOT reset forcedCompact -- that's exactly
    // the BLOCKING infinite loop (compact fits -> reset to full -> full
    // doesn't fit -> force compact -> compact fits -> reset -> ... forever).
    const inputsKey = JSON.stringify({ obstacleBoxes, phase, step });
    if (measuredInputsKeyRef.current !== inputsKey) {
      measuredInputsKeyRef.current = inputsKey;
      if (forcedCompact) {
        setForcedCompact(false);
        return; // re-measure at full size on the next pass, fresh inputs
      }
    }

    const stageH = stageRef.current.getBoundingClientRect().height;
    const pillH = pillRef.current.getBoundingClientRect().height;
    if (!stageH || !pillH) return;

    const bands = {
      top: { top: EDGE_MARGIN_PX, bottom: EDGE_MARGIN_PX + pillH },
      bottom: { top: stageH - EDGE_MARGIN_PX - pillH, bottom: stageH - EDGE_MARGIN_PX },
    };
    const obstaclesPx = obstacleBoxes.map((box) => ({
      top: ((box.y ?? 0) - (box.height ?? 0) / 2) / videoHeight * stageH,
      bottom: ((box.y ?? 0) + (box.height ?? 0) / 2) / videoHeight * stageH,
    }));
    const bandClear = (band) => !obstaclesPx.some((o) => bandsCollide(band, o));
    const topClear = bandClear(bands.top);
    const bottomClear = bandClear(bands.bottom);

    // NOTE: neither branch below touches forcedCompact -- once compact was
    // forced for these inputs, it STAYS forced for these inputs, even
    // though it now fits. Only the inputsKey check above may un-force it.
    if (topClear) { setSide('top'); return; }
    if (bottomClear) { setSide('bottom'); return; }
    // Neither band is clear at the current size -- try the compact form
    // once (shorter pill may fit where the full one didn't); re-measures on
    // the next layout pass since `forcedCompact` is a dependency below.
    if (!forcedCompact) { setForcedCompact(true); return; }
    // Still nothing clear even compact -- give up gracefully. pointer-events
    // stay scoped to the buttons only, so a covered box is still tappable.
    setSide('top');
  }, [isOverlay, stageRef, obstacleBoxes, videoHeight, phase, step, effectiveCompact, forcedCompact, mountTick]);

  if (!phase) return null;

  const positionClass = isOverlay
    ? `absolute left-1/2 -translate-x-1/2 z-20 max-w-[92%] ${side === 'bottom' ? 'bottom-4' : 'top-4'}`
    : 'relative w-full';

  return (
    <div
      data-testid="spotlight-pick-guide"
      data-phase={phase}
      data-guide-id={guideId ?? undefined}
      data-side={isOverlay ? side : undefined}
      className={`${positionClass} ${isOverlay ? 'pointer-events-none' : ''}`}
      style={safeArea ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}
    >
      <InstructionCoach
        ref={pillRef}
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 min-h-11 w-[26rem] max-w-full text-base font-semibold pointer-events-none"
        phase={phase}
        tone={phase === 'done' ? 'strong' : 'coach'}
      >
        {guideId === 'overlay.pick.done' && (
          <DoneBody total={total} compact={effectiveCompact} />
        )}
        {guideId === 'overlay.pick.away' && (
          <AwayBody step={step} total={total} compact={effectiveCompact} onResumeStep={onResumeStep} />
        )}
        {guideId && guideId !== 'overlay.pick.done' && guideId !== 'overlay.pick.away' && (
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
          {assignedCount === 0 ? EDITOR_PANELS.PICK_GUIDE_WHY() : EDITOR_PANELS.PICK_GUIDE_AGAIN}
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
