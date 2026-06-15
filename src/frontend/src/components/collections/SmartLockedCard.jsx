import React, { useState } from 'react';
import { LockedCollectionCard } from './LockedCollectionCard';
import { LockedReasonModal } from './LockedReasonModal';

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
        ratio={ratio}
        currentSec={currentSec}
        onClick={() => setShowReason(true)}
      />
      {showReason && (
        <LockedReasonModal
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
