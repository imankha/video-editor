import { useState } from 'react';
import { ChevronRight, Clapperboard, RectangleVertical, RectangleHorizontal, Sparkles } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { CLIP_STAGE, SLOT_ACTION, HIGHLIGHT_STATUS, ORIENTATION } from '../clipStage';
import { useGuidePulse } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../../../components/instructions/guideTargets';

// T14770: replaces the T11910 two-slot surface with ONE Make highlight entry
// (HighlightEntry) -- the shape is picked in Frame, not here -- plus a list of
// every highlight already made from this play (HighlightList). A play can get
// several highlights of each shape; the list shows each one and opens it where
// it left off (handleOpenInstance).

const ORIENTATION_ICON = { [ORIENTATION.PORTRAIT]: RectangleVertical, [ORIENTATION.LANDSCAPE]: RectangleHorizontal };
const ORIENTATION_LABEL = { [ORIENTATION.PORTRAIT]: ANNOTATE.PORTRAIT, [ORIENTATION.LANDSCAPE]: ANNOTATE.LANDSCAPE };

/**
 * HighlightEntry — the single primary "Make highlight" card. Always creates a
 * NEW portrait (9:16) highlight (forceNew) and opens Frame, where the shape is
 * picked (design decision 1, Option C). Locked while the game is still
 * uploading; inert ("Opening Frame...") while a create is in flight.
 */
export function HighlightEntry({ pending, locked = false, onMake }) {
  const inert = pending || locked;
  const pulseClass = useGuidePulse(GUIDE_PULSE.MAKE_HIGHLIGHT, { suppress: inert });
  return (
    <button
      type="button"
      onClick={() => { if (!inert) onMake('9:16'); }}
      disabled={inert}
      data-testid="annotate-make-highlight"
      aria-label={ANNOTATE.MAKE_HIGHLIGHT}
      className={`w-full min-h-[112px] px-4 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 disabled:opacity-60 text-slate-950 text-sm font-extrabold flex flex-col items-center justify-center gap-2 shadow-lg shadow-cyan-950/40 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${pulseClass}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/15">
        <Clapperboard size={20} className="shrink-0" aria-hidden="true" />
      </span>
      <span className="text-center leading-tight">
        {locked ? ANNOTATE.HIGHLIGHT_AFTER_UPLOAD : pending ? ANNOTATE.OPENING_FRAME : ANNOTATE.MAKE_HIGHLIGHT}
      </span>
      {!locked && !pending && (
        <span className="text-center text-xs font-medium leading-tight text-slate-950/70">
          {ANNOTATE.MAKE_HIGHLIGHT_CARD}
        </span>
      )}
    </button>
  );
}

// T14770 design table: the pill + row action are driven by STAGE alone (every
// list row already has a project, so there is no "Not started" row here --
// that status is reserved for a bare play with no highlight at all, which
// never reaches this list).
function rowPresentation(instance) {
  if (instance.stage === CLIP_STAGE.PUBLISHED) {
    return { pill: HIGHLIGHT_STATUS.FINISHED, action: ANNOTATE.WATCH_HIGHLIGHT };
  }
  if (instance.stage === CLIP_STAGE.FINAL) {
    return { pill: HIGHLIGHT_STATUS.IN_PROGRESS, action: ANNOTATE.WATCH_HIGHLIGHT };
  }
  if (instance.stage === CLIP_STAGE.SPOTLIGHT) {
    return {
      pill: HIGHLIGHT_STATUS.IN_PROGRESS,
      action: instance.slotAction === SLOT_ACTION.CONTINUE_SPOTLIGHT ? ANNOTATE.CONTINUE_SPOTLIGHT : ANNOTATE.ADD_SPOTLIGHT,
    };
  }
  // FOCUS (box placed or not — design decision: "Frame (box placed or not)").
  return { pill: HIGHLIGHT_STATUS.IN_PROGRESS, action: ANNOTATE.CONTINUE_HIGHLIGHT };
}

// In progress first (newest on top, by project id), then finished (portrait
// before landscape, then by number).
function compareRows(a, b) {
  const aFinished = a.stage === CLIP_STAGE.PUBLISHED ? 1 : 0;
  const bFinished = b.stage === CLIP_STAGE.PUBLISHED ? 1 : 0;
  if (aFinished !== bFinished) return aFinished - bFinished;
  if (aFinished) {
    if (a.orientation !== b.orientation) return a.orientation === ORIENTATION.PORTRAIT ? -1 : 1;
    return (a.ordinal ?? 1) - (b.ordinal ?? 1);
  }
  return (b.projectId ?? 0) - (a.projectId ?? 0);
}

const SHOWN_COLLAPSED = 3;

function HighlightRow({ instance, onOpen, pulsing }) {
  const { pill, action } = rowPresentation(instance);
  const orientationLabel = ORIENTATION_LABEL[instance.orientation] ?? instance.orientation;
  const OrientationIcon = ORIENTATION_ICON[instance.orientation] ?? Sparkles;
  const rowName = ANNOTATE.highlightRowName(orientationLabel, instance.ordinal ?? 1);
  const pulseClass = useGuidePulse(GUIDE_PULSE.HIGHLIGHT_ROW, { suppress: !pulsing });
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(instance)}
        data-testid={`highlight-row-${instance.projectId}`}
        aria-label={`${rowName}, ${pill}: ${action}`}
        className={`w-full flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/80 hover:bg-slate-800 hover:border-cyan-300/30 active:bg-slate-700 px-3 py-2.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${pulseClass}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-cyan-200">
          <OrientationIcon size={16} aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-white">{rowName}</span>
          <span className="block text-xs text-white/60">
            <span data-testid="highlight-row-pill" className="mr-1.5 inline-block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              {pill}
            </span>
            {action}
          </span>
          {instance.stale && (
            <span data-testid="highlight-row-stale" className="block text-xs text-amber-300">{ANNOTATE.STALE_HIGHLIGHT_SUBLINE}</span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0 text-cyan-300" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * HighlightList — "Highlights from this play": count chips, then one row per
 * highlight (newest in-progress first, then finished), each opening at its
 * stage via onOpen. Hidden (returns null) when the play has none.
 * `highlightedProjectId` pulses exactly one row (the single instance the
 * guide's progress rules track, catalog.annotateFacts) -- never more than one.
 */
export function HighlightList({ instances, onOpen, highlightedProjectId = null }) {
  const [expanded, setExpanded] = useState(false);
  if (!instances || instances.length === 0) return null;

  const counts = { [ORIENTATION.PORTRAIT]: 0, [ORIENTATION.LANDSCAPE]: 0 };
  for (const i of instances) if (i.orientation) counts[i.orientation] += 1;

  const sorted = [...instances].sort(compareRows);
  const visible = expanded ? sorted : sorted.slice(0, SHOWN_COLLAPSED);

  return (
    <div data-testid="annotate-highlight-list" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-white">{ANNOTATE.HIGHLIGHTS_FROM_PLAY}</h3>
        {counts[ORIENTATION.PORTRAIT] > 0 && (
          <span data-testid="highlight-count-portrait" className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-white/70">
            {ANNOTATE.highlightCountChip(ANNOTATE.PORTRAIT, counts[ORIENTATION.PORTRAIT])}
          </span>
        )}
        {counts[ORIENTATION.LANDSCAPE] > 0 && (
          <span data-testid="highlight-count-landscape" className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-white/70">
            {ANNOTATE.highlightCountChip(ANNOTATE.LANDSCAPE, counts[ORIENTATION.LANDSCAPE])}
          </span>
        )}
      </div>
      {/* Desktop (1280px, design decision): two columns of rows from lg. */}
      <ul className="grid gap-2 lg:grid-cols-2">
        {visible.map((instance) => (
          <HighlightRow
            key={instance.projectId}
            instance={instance}
            onOpen={onOpen}
            pulsing={instance.projectId === highlightedProjectId}
          />
        ))}
      </ul>
      {sorted.length > SHOWN_COLLAPSED && (
        <button
          type="button"
          data-testid="highlight-list-toggle"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
        >
          {expanded ? ANNOTATE.SHOW_FEWER_HIGHLIGHTS : ANNOTATE.showAllHighlights(sorted.length)}
        </button>
      )}
    </div>
  );
}
