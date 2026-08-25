import React, { useState } from 'react';
import { LockedCollectionCard } from './LockedCollectionCard';
import { LockedReasonModal, LOCKED_KINDS } from './LockedReasonModal';

// T7650: the four amber locked cards used to be indistinguishable. Each now
// carries a subtitle that says WHY it's locked; this is the smart-collection one.
const SMART_UNLOCK_CAPTION = 'Your top-rated reels, once you have enough';

/**
 * SmartLockedCard - a sub-30s smart collection rendered as the shared amber
 * "not ready" card (T3610 §0B.3, EPIC #6). Tapping it explains why it's locked.
 *
 * @param {string} name       - smart collection name (e.g. "Top Goals & Assists")
 * @param {string} ratio      - '9:16' | '16:9' (glyph)
 * @param {number} currentSec - this ratio's duration so far
 */
export function SmartLockedCard({ name, ratio, currentSec }) {
  const [showReason, setShowReason] = useState(false);

  return (
    <>
      <LockedCollectionCard
        name={name}
        subtitle={SMART_UNLOCK_CAPTION}
        ratio={ratio}
        currentSec={currentSec}
        onClick={() => setShowReason(true)}
      />
      {showReason && (
        <LockedReasonModal
          kind={LOCKED_KINDS.SMART}
          name={name}
          ratio={ratio}
          currentSec={currentSec}
          onClose={() => setShowReason(false)}
        />
      )}
    </>
  );
}

export default SmartLockedCard;
