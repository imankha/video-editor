import React from 'react';
import { UnlockProgress } from './UnlockProgress';

const GAME_UNLOCK_CAPTION = 'Build more reels to unlock game highlights';

/**
 * RatioUnlockGroup - A game's sub-30s ratio sub-list (T3610, §0.10).
 *
 * Below-threshold ratio under a game: lists its reels (browsable + individually
 * playable) with an unlock progress bar. No collection-level verbs.
 *
 * @param {string}   ratio       - '9:16' | '16:9'
 * @param {number}   currentSec  - this ratio's duration so far
 * @param {Array}    reels       - this ratio's members
 * @param {Function} renderCard  - (download) => ReactNode
 */
export function RatioUnlockGroup({ ratio, currentSec, reels, renderCard }) {
  return (
    <div className="mt-3">
      <UnlockProgress ratio={ratio} currentSec={currentSec} caption={GAME_UNLOCK_CAPTION} />
      <div className="mt-2 space-y-2">
        {reels.map((d) => renderCard(d))}
      </div>
    </div>
  );
}

export default RatioUnlockGroup;
