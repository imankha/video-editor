import React, { useEffect } from 'react';
import { Loader } from 'lucide-react';
import { CollapsibleGroup } from '../shared/CollapsibleGroup';
import { CardCarousel } from '../shared/CardCarousel';
import { CollectionCard } from './CollectionCard';
import { RatioUnlockGroup } from './RatioUnlockGroup';
import { REEL } from '../../config/themeColors';
import { RATIO_ORDER, splitByAspect } from '../../constants/aspectRatios';
import { compareGameTime } from '../../utils/timeFormat';
import { collectionIntroKey } from './introBadgeKey';

/**
 * GameCollectionGroup - Container for one scope's collections (T3610 §0B).
 *
 * Works for a game bucket and the Mixes bucket (parent passes name + callbacks).
 * Renders one CollectionCard per eligible ratio (budget slider + Play-all),
 * each followed by that ratio's browsable clips; sub-30s ratios render as
 * RatioUnlockGroups. Members load lazily on first expand.
 *
 * A group whose reels mix aspects (both 9:16 and 16:9 present) already
 * renders as separate rows this way, one per ratio, portrait first -- but the
 * only ratio indicator was the CollectionCard/RatioUnlockGroup glyph (▯/▭,
 * legible via tooltip only). When more than one ratio is present, a small
 * "9:16"/"16:9" text chip is shown above each row so the split is legible at
 * a glance (T5672); a single-aspect group renders with no chip, unchanged.
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
 * @param {Function=} onIntro       - (definition, title) => void, the collection's OWN intro (T5215 round 2)
 * @param {Object=} introBadgesByKey - {key: {intro_card_id, intro_card_name}}, batch-resolved (T5215 round 6)
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
  onIntro,
  introBadgesByKey = {},
}) {
  const ratioCounts = collection.ratio_counts || {};
  const ratioDurations = collection.ratio_durations || {};
  const ratioEligible = collection.ratio_eligible || {};

  const eligibleRatios = RATIO_ORDER.filter((r) => ratioEligible[r]);
  const subThresholdRatios = RATIO_ORDER.filter(
    (r) => !ratioEligible[r] && (ratioCounts[r] || 0) > 0,
  );
  // Two rows already render whenever a game/mixes group mixes aspects (one
  // per ratio, portrait first) via the eligible/sub-threshold split above --
  // but the only ratio indicator on those rows was a glyph (▯/▭) with no
  // legible text, easy to miss (T5672). Show a small "9:16"/"16:9" chip per
  // row, but only when there's more than one row to distinguish -- a
  // single-aspect group keeps its current no-chrome look.
  const isMultiAspect = eligibleRatios.length + subThresholdRatios.length > 1;

  // Inside a GAME group the play-all collection reads "Game Highlights" (T4810);
  // the CollapsibleGroup header still shows the game name, so two games stay
  // distinguishable (the T4190 disambiguation lives in the header, not the card).
  // The player/share title keeps the game name (playTitle=name). Mixes keeps its
  // own name for both.
  const cardTitle = shareScope?.type === 'game' ? 'Game Highlights' : name;

  // The default-expanded group never fires onToggle for its initial open state,
  // so trigger its first member fetch on mount.
  useEffect(() => {
    if (defaultExpanded) requestMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Order each ratio's reels by their in-game time so My Reels matches the
  // annotation clip-list order (T4080); multi-clip reels (null start) sort
  // last -- then bucket by ratio (shared splitByAspect, portrait first).
  const sortedMembers = (members || [])
    .slice()
    .sort((a, b) => compareGameTime(a.clip_game_start_time, b.clip_game_start_time));
  const membersByRatio = Object.fromEntries(
    splitByAspect(sortedMembers).map((bucket) => [bucket.ratio, bucket.projects]),
  );
  const membersFor = (ratio) => membersByRatio[ratio] || [];
  const loadingMembers = memberState === 'loading' || memberState === undefined;

  return (
    <CollapsibleGroup
      title={name}
      count={collection.reel_count}
      newCount={collection.unwatched_count}
      defaultExpanded={defaultExpanded}
      onToggle={(open) => { if (open) requestMembers(); }}
    >
      {eligibleRatios.map((ratio) => (
        <div key={`elig-${ratio}`} className="space-y-2 mb-2">
          {isMultiAspect && (
            <span className="inline-block text-[10px] font-semibold text-gray-500 bg-gray-700/40 px-1.5 py-0.5 rounded">
              {ratio}
            </span>
          )}
          <CollectionCard
            title={cardTitle}
            playTitle={name}
            ratio={ratio}
            reelCount={ratioCounts[ratio]}
            ratioDuration={ratioDurations[ratio]}
            hasNullDurations={collection.has_null_durations}
            requestMembers={requestMembers}
            onPlay={onPlay}
            shareDefinition={shareScope ? { scope: shareScope, filter: {}, aspect_ratio: ratio } : undefined}
            onShare={onShare}
            onCopyLink={onCopyLink}
            leadingReelId={collection.leading_reel_id}
            onIntro={onIntro}
            introBadge={shareScope ? introBadgesByKey[collectionIntroKey({ scope: shareScope, filter: {}, aspect_ratio: ratio })] : undefined}
          />
          {members
            ? (
                <CardCarousel ariaLabel={`${cardTitle} ${ratio} reels`}>
                  {membersFor(ratio).map((d) => renderCard(d))}
                </CardCarousel>
              )
            : loadingMembers && (
                <div className="flex justify-center py-3">
                  <Loader size={16} className={`${REEL.accent} animate-spin`} />
                </div>
              )}
        </div>
      ))}

      {subThresholdRatios.map((ratio) => (
        <div key={`sub-${ratio}`}>
          {isMultiAspect && (
            <span className="inline-block text-[10px] font-semibold text-gray-500 bg-gray-700/40 px-1.5 py-0.5 rounded">
              {ratio}
            </span>
          )}
          <RatioUnlockGroup
            name={cardTitle}
            ratio={ratio}
            currentSec={ratioDurations[ratio]}
            reels={members ? membersFor(ratio) : []}
            renderCard={renderCard}
          />
        </div>
      ))}
    </CollapsibleGroup>
  );
}

export default GameCollectionGroup;
