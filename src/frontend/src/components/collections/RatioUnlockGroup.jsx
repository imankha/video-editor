import React, { useState } from 'react';
import { LockedCollectionCard } from './LockedCollectionCard';
import { LockedReasonModal } from './LockedReasonModal';

const GAME_UNLOCK_CAPTION = 'Build more reels to unlock game highlights';

/**
 * RatioUnlockGroup - a game's sub-30s ratio sub-list (T3610, §0.10). The locked
 * "game highlights" now render as the shared amber LockedCollectionCard (tap for
 * the reason), followed by the ratio's individually-playable reels.
 *
 * @param {string}   name        - the locked collection's display name (already
 *                                 final: "Game Highlights" for a game, the mix
 *                                 name for Mixes) — shown on the card + popup
 * @param {string}   ratio       - '9:16' | '16:9'
 * @param {number}   currentSec  - this ratio's duration so far
 * @param {Array}    reels       - this ratio's members
 * @param {Function} renderCard  - (download) => ReactNode
 */
export function RatioUnlockGroup({ name, ratio, currentSec, reels, renderCard }) {
  const [showReason, setShowReason] = useState(false);
  const cardName = name || 'Game Highlights';

  return (
    <div className="mt-3">
      <LockedCollectionCard
        name={cardName}
        subtitle={GAME_UNLOCK_CAPTION}
        ratio={ratio}
        currentSec={currentSec}
        onClick={() => setShowReason(true)}
      />
      <div className="space-y-2">
        {reels.map((d) => renderCard(d))}
      </div>

      {showReason && (
        <LockedReasonModal
          name={cardName}
          ratio={ratio}
          currentSec={currentSec}
          onClose={() => setShowReason(false)}
        />
      )}
    </div>
  );
}

export default RatioUnlockGroup;
