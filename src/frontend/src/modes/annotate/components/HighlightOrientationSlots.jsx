import { ChevronRight, RectangleVertical, RectangleHorizontal, Sparkles, Crop } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { ORIENTATION, HIGHLIGHT_STATUS, CLIP_STAGE, SLOT_ACTION } from '../clipStage';

// T11910: the ONE highlight surface for a selected play, rendered identically in
// every state (none / one / both / in progress / published) so a play looks the
// same right after creating a highlight and after a reload. Two permanent
// orientation slots; a slot with no highlight offers its own Make button, a slot
// with highlights lists them (open the stage each one is at). Neither slot is
// preselected or visually favored: the user chooses deliberately (UX consult,
// 2026-10-06).
//
// Presentational only: instances come from clipStage.getClipStages (server-synced
// region.highlightInstances); the container owns create/open.

const SLOTS = [
  {
    orientation: ORIENTATION.PORTRAIT,
    aspectRatio: '9:16',
    title: ANNOTATE.PORTRAIT,
    hint: ANNOTATE.PORTRAIT_HINT,
    makeLabel: ANNOTATE.MAKE_PORTRAIT,
    spotlightLabel: ANNOTATE.ADD_SPOTLIGHT_PORTRAIT,
    framingLabel: ANNOTATE.CONTINUE_FRAMING_PORTRAIT,
    continueSpotlightLabel: ANNOTATE.CONTINUE_SPOTLIGHT_PORTRAIT,
    OrientationIcon: RectangleVertical,
    StageIcon: Sparkles,
  },
  {
    orientation: ORIENTATION.LANDSCAPE,
    aspectRatio: '16:9',
    title: ANNOTATE.LANDSCAPE,
    hint: ANNOTATE.LANDSCAPE_HINT,
    makeLabel: ANNOTATE.MAKE_LANDSCAPE,
    spotlightLabel: ANNOTATE.ADD_SPOTLIGHT_LANDSCAPE,
    framingLabel: ANNOTATE.CONTINUE_FRAMING_LANDSCAPE,
    continueSpotlightLabel: ANNOTATE.CONTINUE_SPOTLIGHT_LANDSCAPE,
    OrientationIcon: RectangleHorizontal,
    StageIcon: Crop,
  },
];

// The Clipped stage is internal bookkeeping; never shown to the user.
function displayStatus(bareStatus) {
  return bareStatus === HIGHLIGHT_STATUS.CLIPPED ? ANNOTATE.HIGHLIGHT_NOT_STARTED : bareStatus;
}

function Slot({ slot, instances, pending, onMake, onOpen, pulse = false }) {
  const { orientation, aspectRatio, title, hint, makeLabel, spotlightLabel, framingLabel, continueSpotlightLabel, OrientationIcon, StageIcon } = slot;
  // A single in-progress highlight (not yet a final video) is the slot's one
  // primary button, worded by the next action. A slot with nothing started shows
  // the same button as Make, so the two slots never look like different states.
  const inProgress = instances.length === 1
    && (instances[0].stage === CLIP_STAGE.FOCUS || instances[0].stage === CLIP_STAGE.SPOTLIGHT)
    ? instances[0] : null;
  const hasInstances = instances.length > 0 && !inProgress;
  const primaryLabel = {
    [SLOT_ACTION.MAKE]: makeLabel,
    [SLOT_ACTION.CONTINUE_FRAMING]: framingLabel,
    [SLOT_ACTION.ADD_SPOTLIGHT]: spotlightLabel,
    [SLOT_ACTION.CONTINUE_SPOTLIGHT]: continueSpotlightLabel,
  }[inProgress?.slotAction] ?? makeLabel;
  const actionLabel = primaryLabel
    .replace(/Make (Portrait|Landscape) Highlight/g, 'Make highlight')
    .replace(/Continue Adding Spotlight to (Portrait|Landscape)/g, 'Continue adding spotlight')
    .replace(/Continue Framing (Portrait|Landscape) Highlight/g, 'Continue framing highlight');
  const summary = hasInstances ? displayStatus(instances[0].bareStatus) : ANNOTATE.HIGHLIGHT_NOT_STARTED;
  return (
    <div
      role="group"
      aria-label={`${title} highlight, ${summary.toLowerCase()}`}
      data-testid={`annotate-highlight-slot-${orientation}`}
      tabIndex={pending ? -1 : 0}
      onClick={() => { if (!pending) (hasInstances ? onOpen(instances[0]) : onMake(aspectRatio)); }}
      onKeyDown={(event) => { if (!pending && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); hasInstances ? onOpen(instances[0]) : onMake(aspectRatio); } }}
      className={`group/slot rounded-2xl border border-white/10 bg-slate-950/55 p-3 sm:p-4 flex flex-col gap-3 shadow-xl shadow-black/20 transition-colors hover:border-cyan-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${pulse && !pending ? 'coach-target-pulse' : ''}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-cyan-200 ring-1 ring-cyan-200/20">
          <OrientationIcon size={18} strokeWidth={2} aria-hidden="true" data-testid={`instance-orientation-icon-${orientation}`} />
        </span>
        <span className="leading-tight min-w-0">
          <span className="block text-base font-extrabold text-white">{title}</span>
          <span className="block text-xs leading-relaxed text-white/60">{hint}</span>
        </span>
      </div>

      {hasInstances ? (
        instances.map((instance) => {
          const actionLabel = instance.action === 'focus' ? ANNOTATE.CONTINUE_HIGHLIGHT : instance.label;
          return (
          <button
            key={instance.projectId}
            onClick={(event) => { event.stopPropagation(); onOpen(instance); }}
            data-testid="annotate-highlight-instance-cta"
            aria-label={`${title} highlight, ${displayStatus(instance.bareStatus)}: ${actionLabel}`}
            className="group w-full min-h-[96px] px-4 py-3 rounded-xl border border-white/10 bg-slate-900/80 hover:bg-slate-800 hover:border-cyan-300/30 active:bg-slate-700 text-white text-sm font-semibold flex flex-col items-center justify-center gap-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-cyan-200">
              <Sparkles size={17} aria-hidden="true" />
            </span>
            <span className="text-center leading-tight">
              {displayStatus(instance.bareStatus) === ANNOTATE.HIGHLIGHT_NOT_STARTED
                ? `Start ${title} Highlight ${instance.ordinal ?? 1}`
                : <>{instance.ordinal != null && instance.ordinal >= 2 ? `${instance.ordinal}. ` : ''}{displayStatus(instance.bareStatus)}</>}
            </span>
            <span className="shrink-0 flex items-center gap-1 whitespace-nowrap text-cyan-300 group-hover:text-cyan-200">
              {actionLabel}
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </button>
          );
        })
      ) : (
        <button
          onClick={(event) => { event.stopPropagation(); inProgress ? onOpen(inProgress) : onMake(aspectRatio); }}
          disabled={pending}
          data-testid={`annotate-make-highlight-${orientation}`}
          aria-label={inProgress ? primaryLabel : `Make ${orientation} highlight`}
          className="w-full min-h-[112px] px-4 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 disabled:opacity-60 text-slate-950 text-sm font-extrabold flex flex-col items-center justify-center gap-2 shadow-lg shadow-cyan-950/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/15">
            <StageIcon size={20} className="shrink-0" aria-hidden="true" />
          </span>
          <span className="text-center leading-tight">{actionLabel}</span>
        </button>
      )}
    </div>
  );
}

export function HighlightOrientationSlots({ instances, pending, onMake, onOpen, inline = false, pulsePortrait = false }) {
  return (
    <div className={inline ? 'contents' : 'space-y-2'} data-testid="annotate-highlight-slots" role="group" aria-label={ANNOTATE.MAKE_A_HIGHLIGHT}>
      <div className={inline ? 'contents' : 'grid gap-2 sm:grid-cols-2'}>
        {SLOTS.map((slot) => (
          <Slot
            key={slot.orientation}
            slot={slot}
            pulse={pulsePortrait && slot.orientation === ORIENTATION.PORTRAIT}
            instances={instances.filter((i) => i.orientation === slot.orientation)}
            pending={pending}
            onMake={onMake}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
