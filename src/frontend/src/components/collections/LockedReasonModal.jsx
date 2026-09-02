import React from 'react';
import { Lock, X } from 'lucide-react';
import { Button } from '../shared/Button';
import { Z } from '../../constants/zLayers';
import { ratioDisplay, ratioLabel, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { formatDurationHuman } from './format';

/**
 * The four amber "locked" surfaces in My Reels (T7650) look identical, so the
 * modal must say WHY each specific one is locked. `kind` selects per-surface copy:
 *   ranking    - profile-wide Ranking Progress (ConfidenceBanner)
 *   smart      - a smart collection like "Top Plays" (SmartLockedCard)
 *   game       - a game's "Game Highlights" (RatioUnlockGroup)
 *   mixes      - cross-game "Mixes & compilations" (RatioUnlockGroup)
 *   collection - generic fallback
 * Each entry returns the two explanatory paragraphs, given the live numbers.
 */
export const LOCKED_KINDS = {
  RANKING: 'ranking',
  SMART: 'smart',
  GAME: 'game',
  MIXES: 'mixes',
  COLLECTION: 'collection',
};

function lockedCopy(kind, { name, ratio, thresholdText, remainingText, remaining }) {
  const rc = ratioLabel(ratio); // "portrait"/"landscape" content label
  switch (kind) {
    case LOCKED_KINDS.RANKING:
      return {
        intro: (
          <>
            Ranking lets you sort your clips head-to-head so your best ones show first.
            It unlocks once you have <span className="font-semibold text-amber-300">{thresholdText}</span> of clips to compare.
          </>
        ),
        footer: remaining > 0
          ? (<>Add about <span className="font-semibold text-white">{remainingText}</span> more, then you can rank your clips head-to-head to find your best.</>)
          : (<>You have enough clips &mdash; reopen Highlight Reels to start ranking.</>),
      };
    case LOCKED_KINDS.SMART:
      return {
        intro: (
          <>
            <span className="font-semibold text-white">{name}</span> automatically gathers your top-rated reels into one
            highlight reel. It unlocks once you have <span className="font-semibold text-amber-300">{thresholdText}</span> of {rc} reels.
          </>
        ),
        footer: remaining > 0
          ? (<>Add about <span className="font-semibold text-white">{remainingText}</span> more {rc} content, then <span className="font-semibold text-white">{name}</span> plays as one highlight reel.</>)
          : (<>This collection has enough content &mdash; reopen Highlight Reels to play it.</>),
      };
    case LOCKED_KINDS.GAME:
      return {
        intro: (
          <>
            Game Highlights stitches all your {rc} reels from this game into one reel.
            It unlocks once this game has <span className="font-semibold text-amber-300">{thresholdText}</span> of {rc} reels.
          </>
        ),
        footer: remaining > 0
          ? (<>Add about <span className="font-semibold text-white">{remainingText}</span> more {rc} reels from this game, then its highlights play as one reel.</>)
          : (<>This game has enough content &mdash; reopen Highlight Reels to play its highlights.</>),
      };
    case LOCKED_KINDS.MIXES:
      return {
        intro: (
          <>
            <span className="font-semibold text-white">{name}</span> combine {rc} reels from across your games into one reel.
            They unlock once you have <span className="font-semibold text-amber-300">{thresholdText}</span> of {rc} reels.
          </>
        ),
        footer: remaining > 0
          ? (<>Add about <span className="font-semibold text-white">{remainingText}</span> more {rc} content, then your mixes play as one reel.</>)
          : (<>You have enough content &mdash; reopen Highlight Reels to play your mixes.</>),
      };
    default:
      return {
        intro: (
          <>
            Collections unlock once a ratio has <span className="font-semibold text-amber-300">{thresholdText}</span> of reels.
          </>
        ),
        footer: remaining > 0
          ? (<>Add about <span className="font-semibold text-white">{remainingText}</span> more {rc} content, then you can play and share <span className="font-semibold text-white">{name}</span> as one highlight reel.</>)
          : (<>This collection has enough content &mdash; reopen Highlight Reels to play it.</>),
      };
  }
}

/**
 * LockedReasonModal - explains exactly why a collection is locked (T3610/T3630/T7650).
 *
 * A collection (smart or game) becomes playable/shareable only once that ratio
 * reaches COLLECTION_MIN_DURATION_SEC of reels. This popup states the threshold,
 * the current amount, and how much more is needed. Copy is tailored per `kind`
 * so the four look-alike amber locked cards are distinguishable (T7650). No
 * backdrop close (project rule); the X / "Got it" button is the only dismiss.
 *
 * @param {string}   name       - collection display name (e.g. "Top Plays", "Vs g1 Jan 22 Highlights")
 * @param {string}   ratio      - '9:16' | '16:9'
 * @param {number}   currentSec - this ratio's duration so far
 * @param {Function} onClose    - REQUIRED
 * @param {string=}  kind       - one of LOCKED_KINDS (default 'collection')
 */
export function LockedReasonModal({ name, ratio, currentSec, onClose, kind = LOCKED_KINDS.COLLECTION }) {
  const cur = currentSec || 0;
  const remaining = Math.max(0, COLLECTION_MIN_DURATION_SEC - cur);
  const pct = Math.max(0, Math.min(100, Math.round((cur / COLLECTION_MIN_DURATION_SEC) * 100)));
  const { intro, footer } = lockedCopy(kind, {
    name,
    ratio,
    remaining,
    thresholdText: formatDurationHuman(COLLECTION_MIN_DURATION_SEC),
    remainingText: formatDurationHuman(remaining),
  });

  return (
    <div className={`fixed inset-0 ${Z.ALERT} flex items-center justify-center p-4`}>
      {/* Visual scrim only — no click-to-close (misclicks must not dismiss). */}
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative w-full max-w-sm rounded-xl border border-amber-500/40 bg-gray-800 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-900/30 flex items-center justify-center shrink-0">
              <Lock size={18} className="text-amber-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-semibold leading-tight truncate">{name}</h3>
              <p className="text-xs text-gray-400">{ratio ? `${ratioDisplay(ratio)} · ` : ''}Locked</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
        </div>

        <p className="text-sm text-gray-300">{intro}</p>

        <div className="my-3">
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-amber-300/80 tabular-nums">
            <span>{formatDurationHuman(cur) || '0s'} so far</span>
            <span>{formatDurationHuman(COLLECTION_MIN_DURATION_SEC)}</span>
          </div>
        </div>

        <p className="text-sm text-gray-300">{footer}</p>

        <Button variant="primary" size="md" onClick={onClose} className="w-full mt-4">Got it</Button>
      </div>
    </div>
  );
}

export default LockedReasonModal;
