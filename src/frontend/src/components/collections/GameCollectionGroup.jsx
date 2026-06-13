import React, { useEffect } from 'react';
import { Loader } from 'lucide-react';
import { CollapsibleGroup } from '../shared/CollapsibleGroup';
import { CollectionHeader } from './CollectionHeader';
import { RatioUnlockGroup } from './RatioUnlockGroup';
import { REEL } from '../../config/themeColors';
import {
  RATIO_ORDER,
  COLLECTION_MIN_DURATION_SEC,
  ratioLabel,
} from '../../constants/aspectRatios';

const UNLOCK_CAPTION = 'Build more reels to unlock game highlights';

/**
 * GameCollectionGroup - Container for one scope's collections (T3610).
 *
 * Works for both a game bucket and the Mixes bucket (the parent passes name +
 * callbacks; this component is scope-agnostic). Renders ONE CollectionHeader per
 * eligible ratio (ratio is identity, no toggle), each followed by that ratio's
 * browsable member cards; sub-threshold ratios render as RatioUnlockGroups with
 * an unlock progress bar. Aggregates come from the summary; member cards are
 * fetched lazily on first expand.
 *
 * @param {string}   name          - scope name (game name / "Mixes & compilations")
 * @param {string=}  subtitle      - secondary line (game date); omitted for mixes
 * @param {Object}   collection     - RatioBucketed: reel_count, ratio_counts,
 *                                    ratio_durations, ratio_eligible, has_null_durations
 * @param {boolean}  defaultExpanded
 * @param {Array=}   members        - cached member cards for this group (or undefined)
 * @param {string=}  memberState    - idle|loading|ready|error
 * @param {Function} onExpand       - trigger lazy member fetch
 * @param {Function} onPlayRatio    - (ratio, title) => void
 * @param {Function} renderCard     - (download) => ReactNode
 */
export function GameCollectionGroup({
  name,
  subtitle,
  collection,
  defaultExpanded = false,
  members,
  memberState,
  onExpand,
  onPlayRatio,
  renderCard,
}) {
  const ratioCounts = collection.ratio_counts || {};
  const ratioDurations = collection.ratio_durations || {};
  const ratioEligible = collection.ratio_eligible || {};

  const eligibleRatios = RATIO_ORDER.filter((r) => ratioEligible[r]);
  const subThresholdRatios = RATIO_ORDER.filter(
    (r) => !ratioEligible[r] && (ratioCounts[r] || 0) > 0,
  );

  // The default-expanded group never fires onToggle for its initial open state,
  // so trigger its first member fetch on mount (a fetch, not persistence).
  useEffect(() => {
    if (defaultExpanded) onExpand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const membersFor = (ratio) =>
    (members || []).filter((m) => m.aspect_ratio === ratio);

  const loadingMembers = memberState === 'loading' || (memberState === undefined);

  const titleFor = (ratio) => `${name} - ${ratioLabel(ratio)}`;

  return (
    <CollapsibleGroup
      title={name}
      count={collection.reel_count}
      defaultExpanded={defaultExpanded}
      onToggle={(open) => { if (open) onExpand(); }}
    >
      {eligibleRatios.map((ratio) => (
        <div key={`elig-${ratio}`} className="mb-2">
          <CollectionHeader
            name={titleFor(ratio)}
            subtitle={subtitle}
            ratio={ratio}
            reelCount={ratioCounts[ratio]}
            duration={ratioDurations[ratio]}
            hasNullDurations={collection.has_null_durations}
            onPlayAll={() => onPlayRatio(ratio, titleFor(ratio))}
          />
          <div className="space-y-2">
            {members
              ? membersFor(ratio).map((d) => renderCard(d))
              : loadingMembers && (
                  <div className="flex justify-center py-3">
                    <Loader size={16} className={`${REEL.accent} animate-spin`} />
                  </div>
                )}
          </div>
        </div>
      ))}

      {subThresholdRatios.map((ratio) => (
        <RatioUnlockGroup
          key={`sub-${ratio}`}
          ratio={ratio}
          progressPct={(ratioDurations[ratio] || 0) / COLLECTION_MIN_DURATION_SEC * 100}
          captionText={UNLOCK_CAPTION}
          reels={members ? membersFor(ratio) : []}
          renderCard={renderCard}
        />
      ))}
    </CollapsibleGroup>
  );
}

export default GameCollectionGroup;
