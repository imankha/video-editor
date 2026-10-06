import { Check, Loader2 } from 'lucide-react';
import { BADGE_STATE } from '../playProgress';

/**
 * Disc (T10410, trimmed T11150) — the small state-disc primitive used by the
 * Framing header's framed/unframed status (`FramingHeaderStatus.jsx`), which
 * imports `Disc` directly from this module. The T10410 play-progress badges
 * ROW (`PlayProgressBadges`), the rated `RatingBadge`, and the plain `Badge`
 * helper were all Annotate-editor-only and were removed by T11150 (Play
 * editor hierarchy epic) — the rating control now lives in `PlayRatingRow.jsx`,
 * and the named/noted/clip badges were dropped entirely (see the T11150
 * design doc). `Disc` + `BADGE_STATE` (playProgress.js) are the only pieces
 * that survive this file; do not remove them without checking
 * FramingHeaderStatus's import first.
 */

// T10570: bumped from 22/28px discs (icon 11/14) — these read as too
// small/hard to tap at the old size.
const DISC_BASE =
  'relative grid place-items-center rounded-full border-[1.5px] transition-colors shrink-0';
const DISC_SIZE = { sm: 'w-8 h-8', md: 'w-11 h-11' };
const ICON_SIZE = { sm: 15, md: 20 };
const CHECK_SIZE = { sm: 'w-[18px] h-[18px]', md: 'w-5 h-5' };
const CHECK_ICON_SIZE = { sm: 10, md: 11 };

const DISC_STATE = {
  [BADGE_STATE.UNDONE]: 'border-dashed border-amber-500 bg-amber-500/10 text-amber-400 hover:border-amber-300 hover:text-amber-300',
  [BADGE_STATE.DONE]: 'border-solid border-green-500 bg-green-500/15 text-green-400',
  [BADGE_STATE.NUDGE]: 'border-solid border-amber-500 bg-amber-500/15 text-amber-300 motion-safe:animate-pulse',
  [BADGE_STATE.PENDING]: 'border-solid border-cyan-600 bg-cyan-600/10 text-cyan-300',
  [BADGE_STATE.DORMANT]: 'border-dotted border-gray-600 text-gray-600 opacity-40',
};

// glyph: an optional notation string that replaces Icon — unused by the
// remaining caller (FramingHeaderStatus), kept for signature compatibility.
export function Disc({ state, size, Icon, glyph }) {
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
          className={`absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-green-500 ring-2 ring-gray-900 ${CHECK_SIZE[size]}`}
        >
          <Check size={CHECK_ICON_SIZE[size]} strokeWidth={4} className="text-green-950" />
        </span>
      )}
    </span>
  );
}

export default Disc;
