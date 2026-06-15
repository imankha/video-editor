import React, { useEffect } from 'react';
import { Loader } from 'lucide-react';
import { CollapsibleGroup } from '../shared/CollapsibleGroup';
import { CollectionCard } from './CollectionCard';
import { RatioUnlockGroup } from './RatioUnlockGroup';
import { REEL } from '../../config/themeColors';
import { RATIO_ORDER } from '../../constants/aspectRatios';

/**
 * GameCollectionGroup - Container for one scope's collections (T3610 §0B).
 *
 * Works for a game bucket and the Mixes bucket (parent passes name + callbacks).
 * Renders one CollectionCard per eligible ratio (budget slider + Play-all),
 * each followed by that ratio's browsable clips; sub-30s ratios render as
 * RatioUnlockGroups. Members load lazily on first expand.
 *
 * @param {string}   name           - group header name (game name / "Mixes & compilations")
 * @param {Object}   collection     - RatioBucketed bucket from the summary
 * @param {boolean}  defaultExpanded
 * @param {Array=}   members        - cached member cards for this group (or undefined)
 * @param {string=}  memberState    - idle|loading|ready|error
 * @param {Function} requestMembers - () => Promise<member[]> (cached fetch; also Play-all source)
 * @param {Function} onPlay         - (members[], title) => void
 * @param {Function} renderCard     - (download) => ReactNode
 * @param {Object=}  shareScope     - {type:'game', game_id} | {type:'mixes'} for share links (T3620)
 * @param {Function=} onShare       - (definition, title) => void
 * @param {Function=} onCopyLink    - (definition) => void
 */
export function GameCollectionGroup({
  name,
  collection,
  defaultExpanded = false,
  members,
  memberState,
  requestMembers,
  onPlay,
  renderCard,
  shareScope,
  onShare,
  onCopyLink,
}) {
  const ratioCounts = collection.ratio_counts || {};
  const ratioDurations = collection.ratio_durations || {};
  const ratioEligible = collection.ratio_eligible || {};

  const eligibleRatios = RATIO_ORDER.filter((r) => ratioEligible[r]);
  const subThresholdRatios = RATIO_ORDER.filter(
    (r) => !ratioEligible[r] && (ratioCounts[r] || 0) > 0,
  );

  // The default-expanded group never fires onToggle for its initial open state,
  // so trigger its first member fetch on mount.
  useEffect(() => {
    if (defaultExpanded) requestMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const membersFor = (ratio) => (members || []).filter((m) => m.aspect_ratio === ratio);
  const loadingMembers = memberState === 'loading' || memberState === undefined;

  return (
    <CollapsibleGroup
      title={name}
      count={collection.reel_count}
      defaultExpanded={defaultExpanded}
      onToggle={(open) => { if (open) requestMembers(); }}
    >
      {eligibleRatios.map((ratio) => (
        <div key={`elig-${ratio}`} className="space-y-2 mb-2">
          <CollectionCard
            title="Highlights"
            playTitle={`${name} Highlights`}
            ratio={ratio}
            reelCount={ratioCounts[ratio]}
            ratioDuration={ratioDurations[ratio]}
            hasNullDurations={collection.has_null_durations}
            requestMembers={requestMembers}
            onPlay={onPlay}
            shareDefinition={shareScope ? { scope: shareScope, filter: {}, aspect_ratio: ratio } : undefined}
            onShare={onShare}
            onCopyLink={onCopyLink}
          />
          {members
            ? membersFor(ratio).map((d) => renderCard(d))
            : loadingMembers && (
                <div className="flex justify-center py-3">
                  <Loader size={16} className={`${REEL.accent} animate-spin`} />
                </div>
              )}
        </div>
      ))}

      {subThresholdRatios.map((ratio) => (
        <RatioUnlockGroup
          key={`sub-${ratio}`}
          name={name}
          ratio={ratio}
          currentSec={ratioDurations[ratio]}
          reels={members ? membersFor(ratio) : []}
          renderCard={renderCard}
        />
      ))}
    </CollapsibleGroup>
  );
}

export default GameCollectionGroup;
