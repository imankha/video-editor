import React, { useState } from 'react';
import { UnlockProgress } from './UnlockProgress';
import { LockedReasonModal } from './LockedReasonModal';

const GAME_UNLOCK_CAPTION = 'Build more reels to unlock game highlights';

/**
 * RatioUnlockGroup - A game's sub-30s ratio sub-list (T3610, §0.10).
 *
 * Below-threshold ratio under a game: lists its reels (browsable + individually
 * playable) with an unlock progress bar. Tapping the progress bar opens a popup
 * explaining exactly why this game's highlights are locked. No collection-level
 * verbs until it unlocks.
 *
 * @param {string}   name        - the group/game name (for the locked-reason popup)
 * @param {string}   ratio       - '9:16' | '16:9'
 * @param {number}   currentSec  - this ratio's duration so far
 * @param {Array}    reels       - this ratio's members
 * @param {Function} renderCard  - (download) => ReactNode
 */
export function RatioUnlockGroup({ name, ratio, currentSec, reels, renderCard }) {
  const [showReason, setShowReason] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setShowReason(true)}
        title="Why is this locked?"
        className="w-full text-left rounded-lg p-1 -m-1 hover:bg-gray-700/40 transition-colors"
      >
        <UnlockProgress ratio={ratio} currentSec={currentSec} caption={GAME_UNLOCK_CAPTION} />
      </button>
      <div className="mt-2 space-y-2">
        {reels.map((d) => renderCard(d))}
      </div>

      {showReason && (
        <LockedReasonModal
          name={`${name || 'Game'} highlights`}
          ratio={ratio}
          currentSec={currentSec}
          onClose={() => setShowReason(false)}
        />
      )}
    </div>
  );
}

export default RatioUnlockGroup;
