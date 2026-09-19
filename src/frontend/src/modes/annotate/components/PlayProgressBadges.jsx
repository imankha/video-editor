import { useEffect, useRef, useState } from 'react';
import { Star, Pencil, AlignLeft, Clapperboard, Check, Loader2 } from 'lucide-react';
import { BADGE_STATE, CLIP_BADGE } from '../playProgress';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_ADJECTIVES } from '../../../components/shared/clipConstants';

/**
 * PlayProgressBadges (T10410) — four small badges that turn the play editor's
 * optional work into a visible checklist: named, rated, note added, clip
 * created. Option C of the 2026-09-18 decision artifact: they sit on the
 * header line beside the play name (desktop strip) or above the footer
 * buttons (the formBody layouts), replacing the loose "Clip created" text.
 * T10450 (user request): the named badge leads the row (it sits right next
 * to the name it completes); the rated badge opens its own vertical picker
 * (see RatingBadge) instead of jumping to the Rate and Tag disclosure.
 *
 * Visual states (one treatment per state, never mixed):
 *   - undone:  dashed amber outline (T10440: was gray, read as disabled);
 *              clicking jumps to the control that completes it (the button
 *              is the affordance). Never pulses — pulse stays reserved for
 *              the clip badge's nudge, which is more urgent.
 *   - done:    green fill + a small check mark in the corner.
 *   - nudge:   amber, pulsing (clip badge only: 5 stars and no clip yet).
 *   - pending: spinner (clip badge only: the project is being created).
 *   - dormant: faded (clip badge only: below 5 stars) — kept in the row so
 *              the row's shape never shifts when it wakes.
 *
 * The clip badge is the only one with a visible text label, because it is the
 * one status that changes what the user can do next; the other three name
 * themselves via title/aria-label. Every badge is a pure read of props and
 * persists nothing itself — RatingBadge holds a transient open/closed UI
 * state for its popover only, never the rating value (that stays owned by
 * the caller via `rating`/`onRatingChange`, the same setter every other
 * rating control in the editor uses).
 */

const DISC_BASE =
  'relative grid place-items-center rounded-full border-[1.5px] transition-colors shrink-0';
const DISC_SIZE = { sm: 'w-[22px] h-[22px]', md: 'w-7 h-7' };
const ICON_SIZE = { sm: 11, md: 14 };

const DISC_STATE = {
  [BADGE_STATE.UNDONE]: 'border-dashed border-amber-500 bg-amber-500/10 text-amber-400 hover:border-amber-300 hover:text-amber-300',
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

const RATING_VALUES = [5, 4, 3, 2, 1];

/**
 * RatingBadge (T10450) — the rated badge, specialized: clicking it opens a
 * small vertical popover of all five ratings (5 at top, matching "best
 * first") instead of jumping to the horizontal star row in the Rate and Tag
 * disclosure. Picking a rating calls the SAME `onRatingChange` every other
 * rating control in the editor uses, then closes. Closes on outside click,
 * Escape, or a selection; the open/closed flag is the only state this file
 * holds — the rating value itself is never held here.
 */
function RatingBadge({ state, size, rating, onRatingChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const actionable = state === BADGE_STATE.UNDONE;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const title = state === BADGE_STATE.DONE ? ANNOTATE.PLAY_RATED : ANNOTATE.RATE_PLAY;
  const shared = { 'data-testid': 'badge-rated', 'data-state': state, title, className: 'flex items-center gap-1.5' };
  const disc = <Disc state={state} size={size} Icon={Star} />;

  return (
    <div ref={rootRef} className="relative">
      {actionable ? (
        <button
          type="button"
          aria-label={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          {...shared}
        >
          {disc}
        </button>
      ) : (
        <span role="img" aria-label={title} {...shared}>
          {disc}
        </span>
      )}
      {open && (
        <div
          role="menu"
          aria-label={ANNOTATE.RATE_PLAY}
          data-testid="rating-picker"
          className="absolute z-50 top-full left-0 mt-1 flex flex-col gap-0.5 p-1.5 rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
        >
          {RATING_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={rating === value}
              onClick={() => {
                onRatingChange(value);
                setOpen(false);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                rating === value ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-0.5 shrink-0">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star
                    key={i}
                    size={11}
                    fill={i <= value ? '#fbbf24' : 'transparent'}
                    color={i <= value ? '#fbbf24' : '#6b7280'}
                    strokeWidth={1.5}
                  />
                ))}
              </span>
              {RATING_ADJECTIVES[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} p
 * @param {{rated: boolean, named: boolean, noted: boolean, clip: string}} p.progress  from getPlayProgress
 * @param {'sm'|'md'} [p.size]
 * @param {number} p.rating  current rating value, for the picker's selected row
 * @param {(value: number) => void} p.onRatingChange  the editor's existing rating setter
 * @param {() => void} p.onName      jump to the name control
 * @param {() => void} p.onNote      jump to the note control
 * @param {() => void} p.onCreateClip  create the clip (nudge state only)
 * @param {string} [p.createClipTitle]  hover copy for the nudge (mode-specific)
 * @param {string} [p.className]
 */
export function PlayProgressBadges({
  progress,
  size = 'md',
  rating,
  onRatingChange,
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
        testId="badge-named"
        state={progress.named ? BADGE_STATE.DONE : BADGE_STATE.UNDONE}
        size={size}
        Icon={Pencil}
        title={progress.named ? ANNOTATE.PLAY_NAMED : ANNOTATE.NAME_PLAY}
        onClick={onName}
      />
      <RatingBadge
        state={progress.rated ? BADGE_STATE.DONE : BADGE_STATE.UNDONE}
        size={size}
        rating={rating}
        onRatingChange={onRatingChange}
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
