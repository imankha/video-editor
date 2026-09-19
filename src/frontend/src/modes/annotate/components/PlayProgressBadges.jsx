import { useEffect, useRef, useState } from 'react';
import { Star, Pencil, AlignLeft, Clapperboard, Check, Loader2 } from 'lucide-react';
import { BADGE_STATE, CLIP_BADGE } from '../playProgress';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_ADJECTIVES, RATING_NOTATION } from '../../../components/shared/clipConstants';

/**
 * PlayProgressBadges (T10410) — four small badges that turn the play editor's
 * optional work into a visible checklist: named, rated, note added, clip
 * created. Option C of the 2026-09-18 decision artifact: they sit on the
 * header line beside the play name (desktop strip) or above the footer
 * buttons (the formBody layouts), replacing the loose "Clip created" text.
 * T10460: the named badge leads the row (it sits right next to the name it
 * completes). T10520 (round 3, after live testing found round 2's inline
 * expand-in-place too cramped and hard to hit on mobile): the rated badge
 * opens a proper popup box (RatingBadge) — bordered, padded, roomy touch
 * targets — anchored below the badge, instead of squeezing itself into the
 * badge row. It is also now the ONLY way to set a rating anywhere in the
 * editor (DetailsFields' old duplicate horizontal star row is gone) and
 * stays clickable in EVERY state, not just while undone — a rating is a
 * value you may revisit, not a one-time checkbox. "Rated" itself no longer
 * means "differs from the default 4"; it means the play has a real rating on
 * record (see playProgress.js).
 *
 * Visual states (one treatment per state, never mixed):
 *   - undone:  dashed amber outline (T10440: was gray, read as disabled);
 *              clicking opens the control that completes it. Never pulses —
 *              pulse stays reserved for the clip badge's nudge, more urgent.
 *   - done:    green fill + a small check mark in the corner. The rated
 *              badge STAYS clickable in this state (T10520) so the rating
 *              can be changed again; the other badges do not (an established
 *              open question, not addressed here).
 *   - nudge:   amber, pulsing (clip badge only: 5 stars and no clip yet).
 *   - pending: spinner (clip badge only: the project is being created).
 *   - dormant: faded (clip badge only: below 5 stars) — kept in the row so
 *              the row's shape never shifts when it wakes.
 *
 * The clip badge is the only one with a visible text label, because it is the
 * one status that changes what the user can do next; the other three name
 * themselves via title/aria-label. Every badge is a pure read of props and
 * persists nothing itself — RatingBadge holds a transient open/closed UI
 * flag only, never the rating value (that stays owned by the caller via
 * `rating`/`onRatingChange`, the same setter every other rating control in
 * the editor uses).
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

// glyph: an optional notation string (e.g. "!!") that replaces Icon — used by
// the rated badge once DONE, so the disc shows WHICH rating was given instead
// of a generic star. Two-character glyphs (!!, !?, ??) run a touch smaller so
// both characters clear the disc.
function Disc({ state, size, Icon, glyph }) {
  const iconSize = ICON_SIZE[size];
  return (
    <span className={`${DISC_BASE} ${DISC_SIZE[size]} ${DISC_STATE[state]}`}>
      {state === BADGE_STATE.PENDING ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : glyph ? (
        <span
          aria-hidden="true"
          className="font-black leading-none select-none"
          style={{ fontSize: glyph.length > 1 ? iconSize * 0.75 : iconSize }}
        >
          {glyph}
        </span>
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
 * RatingBadge (T10520, round 3) — the rated badge. ALWAYS a clickable
 * button, in every state (unlike the other three badges) — a rating is a
 * value you may want to revisit, not a one-time checkbox, so it never
 * becomes an inert span. Clicking it opens a roomy popup box anchored below
 * the badge: five rows, one per rating (5/"Brilliant" on top, best-first,
 * down to 1/"Mental Lapse"), each a real touch target
 * (`coarse-pointer:min-h-[44px]`) with its star count and adjective label —
 * round 2's bare inline star column tested cramped and hard to hit on
 * mobile, hence the box. Picking a row calls the SAME `onRatingChange`
 * every other rating control in the editor uses (this IS the only rating
 * control left — DetailsFields' old duplicate star row is gone), then
 * closes; so does an outside click or Escape. The open/closed flag is the
 * only state this file holds — the rating value itself is never held here.
 * T10530: once DONE, the disc's glyph is the rating's own chess-style
 * notation (`RATING_NOTATION`: !!/!/!?/?/??) instead of a generic star, so
 * the collapsed badge shows WHICH rating was given at a glance.
 * T10550: the popup also shows that same notation on every row (ties the row
 * to the eventual collapsed glyph), carries a visible layer-aware heading
 * ("Rate your athlete's play" / "...team's play", matching the existing
 * `mine` split `getRatingCaption` already uses), and on mobile becomes a
 * screen-centered dialog with a dim backdrop (tap to dismiss) instead of an
 * anchored dropdown — an anchored popup this size would run off a narrow
 * screen depending on where the badge sits in the row.
 */
function RatingBadge({ state, size, rating, onRatingChange, myAthlete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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
  const pickerTitle = myAthlete ? ANNOTATE.RATE_ATHLETES_PLAY : ANNOTATE.RATE_TEAMS_PLAY;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="badge-rated"
        data-state={state}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5"
      >
        <Disc state={state} size={size} Icon={Star} glyph={state === BADGE_STATE.DONE ? RATING_NOTATION[rating] : undefined} />
      </button>
      {open && (
        // max-sm: a full-screen centered dialog with a dim, tap-to-close
        // backdrop. sm+: the usual anchored dropdown (backdrop classes are
        // inert there — no fixed/inset/flex — so the onClick below never
        // fires from a stray desktop click; the document mousedown listener
        // handles outside-click on desktop instead).
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:flex max-sm:items-center max-sm:justify-center max-sm:bg-black/60 max-sm:p-4
                     sm:absolute sm:z-50 sm:top-full sm:left-0 sm:mt-2"
        >
          <div
            data-testid="rating-picker"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs sm:w-auto sm:max-w-none sm:min-w-[190px] p-2 rounded-xl border border-gray-700 bg-gray-800 shadow-xl"
          >
            <div className="px-1.5 pt-1 pb-2 text-xs font-semibold text-gray-300">{pickerTitle}</div>
            <div role="radiogroup" aria-label={pickerTitle} className="flex flex-col gap-1">
              {RATING_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value > 1 ? 's' : ''} - ${RATING_ADJECTIVES[value]}`}
                  onClick={() => {
                    onRatingChange(value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm whitespace-nowrap
                              coarse-pointer:min-h-[44px] coarse-pointer:py-3 transition-colors ${
                    rating === value
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700/70 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-0.5 shrink-0">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        size={14}
                        fill={i <= value ? '#fbbf24' : 'transparent'}
                        color={i <= value ? '#fbbf24' : '#6b7280'}
                        strokeWidth={1.5}
                      />
                    ))}
                  </span>
                  {RATING_ADJECTIVES[value]}
                  <span className="ml-auto font-black tabular-nums" aria-hidden="true">{RATING_NOTATION[value]}</span>
                </button>
              ))}
            </div>
          </div>
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
 * @param {boolean} p.myAthlete  the editor's layer toggle — picks the rating popup's heading
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
  myAthlete,
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
        myAthlete={myAthlete}
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
