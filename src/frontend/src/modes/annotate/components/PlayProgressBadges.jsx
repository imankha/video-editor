import { Star, Pencil, AlignLeft, Clapperboard, Check, Loader2 } from 'lucide-react';
import { BADGE_STATE, CLIP_BADGE } from '../playProgress';
import { ANNOTATE } from '../../../config/displayNames';

/**
 * PlayProgressBadges (T10410) — four small badges that turn the play editor's
 * optional work into a visible checklist: rated, named, note added, clip
 * created. Option C of the 2026-09-18 decision artifact: they sit on the
 * header line beside the play name (desktop strip) or above the footer
 * buttons (the formBody layouts), replacing the loose "Clip created" text.
 *
 * Visual states (one treatment per state, never mixed):
 *   - undone:  dashed gray outline; clicking jumps to the control that
 *              completes it (the button is the affordance).
 *   - done:    green fill + a small check mark in the corner.
 *   - nudge:   amber, pulsing (clip badge only: 5 stars and no clip yet).
 *   - pending: spinner (clip badge only: the project is being created).
 *   - dormant: faded (clip badge only: below 5 stars) — kept in the row so
 *              the row's shape never shifts when it wakes.
 *
 * The clip badge is the only one with a visible text label, because it is the
 * one status that changes what the user can do next; the other three name
 * themselves via title/aria-label. Every badge is a pure read of props — this
 * component holds no state and persists nothing.
 */

const DISC_BASE =
  'relative grid place-items-center rounded-full border-[1.5px] transition-colors shrink-0';
const DISC_SIZE = { sm: 'w-[22px] h-[22px]', md: 'w-7 h-7' };
const ICON_SIZE = { sm: 11, md: 14 };

const DISC_STATE = {
  [BADGE_STATE.UNDONE]: 'border-dashed border-gray-500 text-gray-500 hover:border-gray-300 hover:text-gray-300',
  [BADGE_STATE.DONE]: 'border-solid border-green-500 bg-green-500/15 text-green-400',
  [BADGE_STATE.NUDGE]: 'border-solid border-amber-500 bg-amber-500/15 text-amber-300 motion-safe:animate-pulse',
  [BADGE_STATE.PENDING]: 'border-solid border-cyan-600 bg-cyan-600/10 text-cyan-300',
  [BADGE_STATE.DORMANT]: 'border-dotted border-gray-600 text-gray-600 opacity-40',
};

function Disc({ state, size, Icon }) {
  const iconSize = ICON_SIZE[size];
  return (
    <span className={`${DISC_BASE} ${DISC_SIZE[size]} ${DISC_STATE[state]}`}>
      {state === BADGE_STATE.PENDING ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <Icon size={iconSize} />
      )}
      {state === BADGE_STATE.DONE && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -bottom-1 grid place-items-center w-[13px] h-[13px] rounded-full bg-green-500 ring-2 ring-gray-900"
        >
          <Check size={8} strokeWidth={4} className="text-green-950" />
        </span>
      )}
    </span>
  );
}

function Badge({ testId, state, size, Icon, title, label, onClick }) {
  const actionable =
    typeof onClick === 'function' && (state === BADGE_STATE.UNDONE || state === BADGE_STATE.NUDGE);
  const labelClass =
    state === BADGE_STATE.DONE ? 'text-green-300'
    : state === BADGE_STATE.NUDGE ? 'text-amber-300'
    : 'text-gray-500';
  const content = (
    <>
      <Disc state={state} size={size} Icon={Icon} />
      {label && <span className={`text-[11px] leading-none whitespace-nowrap ${labelClass}`}>{label}</span>}
    </>
  );
  const shared = {
    'data-testid': testId,
    'data-state': state,
    title,
    className: 'flex items-center gap-1.5',
  };
  if (actionable) {
    return (
      <button type="button" aria-label={title} onClick={onClick} {...shared}>
        {content}
      </button>
    );
  }
  return (
    <span role="img" aria-label={title} {...shared}>
      {content}
    </span>
  );
}

/**
 * @param {object} p
 * @param {{rated: boolean, named: boolean, noted: boolean, clip: string}} p.progress  from getPlayProgress
 * @param {'sm'|'md'} [p.size]
 * @param {() => void} p.onRate      jump to the rating control
 * @param {() => void} p.onName      jump to the name control
 * @param {() => void} p.onNote      jump to the note control
 * @param {() => void} p.onCreateClip  create the clip (nudge state only)
 * @param {string} [p.createClipTitle]  hover copy for the nudge (mode-specific)
 * @param {string} [p.className]
 */
export function PlayProgressBadges({
  progress,
  size = 'md',
  onRate,
  onName,
  onNote,
  onCreateClip,
  createClipTitle = ANNOTATE.CREATE_CLIP_NUDGE_HINT,
  className = '',
}) {
  const clipState = progress.clip;
  const clipLabel =
    clipState === CLIP_BADGE.DONE ? ANNOTATE.CLIP_CREATED
    : clipState === CLIP_BADGE.NUDGE ? ANNOTATE.CREATE_CLIP
    : clipState === CLIP_BADGE.PENDING ? ANNOTATE.PREPARING_CLIP
    : null;
  const clipTitle =
    clipState === CLIP_BADGE.DONE ? ANNOTATE.CLIP_CREATED
    : clipState === CLIP_BADGE.NUDGE ? createClipTitle
    : clipState === CLIP_BADGE.PENDING ? ANNOTATE.PREPARING_CLIP
    : ANNOTATE.CLIP_BADGE_DORMANT_HINT;

  return (
    // aria-live: the clip badge walks dormant -> nudge -> pending -> done without
    // any other announcement, so let screen readers hear the label change.
    <div data-testid="play-progress-badges" aria-live="polite" className={`flex items-center gap-2 ${className}`}>
      <Badge
        testId="badge-rated"
        state={progress.rated ? BADGE_STATE.DONE : BADGE_STATE.UNDONE}
        size={size}
        Icon={Star}
        title={progress.rated ? ANNOTATE.PLAY_RATED : ANNOTATE.RATE_PLAY}
        onClick={onRate}
      />
      <Badge
        testId="badge-named"
        state={progress.named ? BADGE_STATE.DONE : BADGE_STATE.UNDONE}
        size={size}
        Icon={Pencil}
        title={progress.named ? ANNOTATE.PLAY_NAMED : ANNOTATE.NAME_PLAY}
        onClick={onName}
      />
      <Badge
        testId="badge-noted"
        state={progress.noted ? BADGE_STATE.DONE : BADGE_STATE.UNDONE}
        size={size}
        Icon={AlignLeft}
        title={progress.noted ? ANNOTATE.NOTE_ADDED : ANNOTATE.ADD_NOTE}
        onClick={onNote}
      />
      <Badge
        testId="badge-clip"
        state={clipState}
        size={size}
        Icon={Clapperboard}
        title={clipTitle}
        label={clipLabel}
        onClick={onCreateClip}
      />
    </div>
  );
}

export default PlayProgressBadges;
