import React, { useState } from 'react';
import { CardCarousel } from '../shared/CardCarousel';
import { LockedCollectionCard } from './LockedCollectionCard';
import { LockedReasonModal, LOCKED_KINDS } from './LockedReasonModal';

// T7650: distinct per-surface subtitle so a locked game group and a locked mixes
// group don't read identically (the mixes card previously claimed "game
// highlights", which is wrong — mixes span games).
const GAME_UNLOCK_CAPTION = 'Build more reels to unlock game highlights';
const MIXES_UNLOCK_CAPTION = 'Build more reels to unlock cross-game mixes';

/**
 * RatioUnlockGroup - a sub-30s ratio sub-list for a game OR the mixes group
 * (T3610, §0.10). The locked collection renders as the shared amber
 * LockedCollectionCard (tap for the reason), followed by the ratio's
 * individually-playable reels.
 *
 * @param {string}   name        - the locked collection's display name (already
 *                                 final: "Game Highlights" for a game, the mix
 *                                 name for Mixes) — shown on the card + popup
 * @param {string}   ratio       - '9:16' | '16:9'
 * @param {number}   currentSec  - this ratio's duration so far
 * @param {Array}    reels       - this ratio's members
 * @param {Function} renderCard  - (download) => ReactNode
 * @param {string=}  kind        - LOCKED_KINDS.GAME (default) | LOCKED_KINDS.MIXES (T7650)
 */
export function RatioUnlockGroup({ name, ratio, currentSec, reels, renderCard, kind = LOCKED_KINDS.GAME }) {
  const [showReason, setShowReason] = useState(false);
  const isMixes = kind === LOCKED_KINDS.MIXES;
  const cardName = name || 'Game Highlights';
  const subtitle = isMixes ? MIXES_UNLOCK_CAPTION : GAME_UNLOCK_CAPTION;

  return (
    <div className="mt-3">
      <LockedCollectionCard
        name={cardName}
        subtitle={subtitle}
        ratio={ratio}
        currentSec={currentSec}
        onClick={() => setShowReason(true)}
      />
      {reels.length > 0 && (
        <CardCarousel ariaLabel={`${cardName} ${ratio} reels`}>
          {reels.map((d) => renderCard(d))}
        </CardCarousel>
      )}

      {showReason && (
        <LockedReasonModal
          kind={kind}
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
