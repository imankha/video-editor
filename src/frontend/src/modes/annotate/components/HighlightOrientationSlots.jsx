import { Plus, ChevronRight, RectangleVertical, RectangleHorizontal } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { ORIENTATION } from '../clipStage';

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
    Icon: RectangleVertical,
  },
  {
    orientation: ORIENTATION.LANDSCAPE,
    aspectRatio: '16:9',
    title: ANNOTATE.LANDSCAPE,
    hint: ANNOTATE.LANDSCAPE_HINT,
    makeLabel: ANNOTATE.MAKE_LANDSCAPE,
    Icon: RectangleHorizontal,
  },
];

function Slot({ slot, instances, pending, onMake, onOpen }) {
  const { orientation, aspectRatio, title, hint, makeLabel, Icon } = slot;
  const hasInstances = instances.length > 0;
  const summary = hasInstances ? instances[0].bareStatus : ANNOTATE.HIGHLIGHT_NOT_STARTED;
  return (
    <div
      role="group"
      aria-label={`${title} highlight, ${summary.toLowerCase()}`}
      data-testid={`annotate-highlight-slot-${orientation}`}
      className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-white/5 text-purple-200/80 flex items-center justify-center">
          <Icon size={18} strokeWidth={2} aria-hidden="true" data-testid={`instance-orientation-icon-${orientation}`} />
        </span>
        <span className="leading-tight min-w-0">
          <span className="block text-sm font-bold text-white">{title}</span>
          <span className="block text-xs text-white/60">{hint}</span>
        </span>
      </div>

      {hasInstances ? (
        instances.map((instance) => {
          const actionLabel = instance.action === 'focus' ? ANNOTATE.CONTINUE_HIGHLIGHT : instance.label;
          return (
          <button
            key={instance.projectId}
            onClick={() => onOpen(instance)}
            data-testid="annotate-highlight-instance-cta"
            aria-label={`${title} highlight, ${instance.bareStatus}: ${actionLabel}`}
            className="group w-full min-h-[48px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:bg-white/15 text-white text-sm font-semibold flex items-center justify-between gap-3 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <span className="text-left leading-tight">
              {instance.ordinal != null && instance.ordinal >= 2 ? `${instance.ordinal}. ` : ''}
              {instance.bareStatus}
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
          onClick={() => onMake(aspectRatio)}
          disabled={pending}
          data-testid={`annotate-make-highlight-${orientation}`}
          aria-label={`Make ${orientation} highlight`}
          className="w-full min-h-[48px] px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <Plus size={16} className="shrink-0" aria-hidden="true" />
          {makeLabel}
        </button>
      )}
    </div>
  );
}

export function HighlightOrientationSlots({ instances, pending, onMake, onOpen }) {
  return (
    <div className="space-y-2" data-testid="annotate-highlight-slots" role="group" aria-label={ANNOTATE.MAKE_A_HIGHLIGHT}>
      <p className="text-sm font-semibold text-white/80">{ANNOTATE.MAKE_A_HIGHLIGHT}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {SLOTS.map((slot) => (
          <Slot
            key={slot.orientation}
            slot={slot}
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
