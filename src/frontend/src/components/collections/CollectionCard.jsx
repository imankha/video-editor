import React, { useState } from 'react';
import { CollectionHeader } from './CollectionHeader';
import { budgetCap, defaultBudget, selectWithinBudget } from './budget';

/**
 * CollectionCard - Container for ONE eligible (scope, ratio) collection (T3610
 * §0B.5). Owns the transient duration-budget state and computes the budgeted
 * Play-all subset (greedy-with-skip over the members for this ratio). Shared by
 * smart, game, and mixes collections; renders only the header (the game/mixes
 * clip list is rendered by the group around it).
 *
 * @param {string}   name            - composed name (includes ratio word)
 * @param {string=}  subtitle
 * @param {string}   ratio           - identity ratio
 * @param {number}   reelCount
 * @param {number}   ratioDuration   - this ratio's total (slider cap source)
 * @param {boolean}  hasNullDurations
 * @param {Function} requestMembers  - () => Promise<member[]> (cached group fetch)
 * @param {Function} onPlay          - (members[], title) => void
 * @param {React.ReactNode=} actions
 */
export function CollectionCard({
  name,
  subtitle,
  ratio,
  reelCount,
  ratioDuration,
  hasNullDurations,
  requestMembers,
  onPlay,
  actions,
}) {
  const cap = budgetCap(ratioDuration);
  const [budget, setBudget] = useState(() => defaultBudget(cap));
  const [loading, setLoading] = useState(false);

  const handlePlayAll = async () => {
    setLoading(true);
    try {
      const all = await requestMembers();
      const inRatio = all.filter((m) => m.aspect_ratio === ratio);
      const subset = selectWithinBudget(inRatio, budget);
      if (subset.length) onPlay(subset, name);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CollectionHeader
      name={name}
      subtitle={subtitle}
      ratio={ratio}
      reelCount={reelCount}
      duration={ratioDuration}
      hasNullDurations={hasNullDurations}
      budgetCap={cap}
      budget={budget}
      onBudgetChange={setBudget}
      onPlayAll={handlePlayAll}
      playLoading={loading}
      actions={actions}
    />
  );
}

export default CollectionCard;
