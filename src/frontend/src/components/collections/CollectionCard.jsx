import React, { useState } from 'react';
import { CollectionHeader } from './CollectionHeader';
import { budgetCap, defaultBudget, selectWithinBudget, sumDuration } from './budget';

/**
 * CollectionCard - Container for ONE eligible (scope, ratio) collection (T3610
 * §0B.5). Defaults to ALL clips; "Set Duration" reveals a 15s-precision slider
 * that trims the budget, and the displayed duration updates to the ACTUAL
 * playable length of the selected clips. Owns the transient budget + slider
 * state and computes the budgeted Play-all subset (greedy-with-skip).
 *
 * @param {string}   name            - composed name (includes ratio word)
 * @param {string=}  subtitle
 * @param {string}   ratio           - identity ratio
 * @param {number}   reelCount
 * @param {number}   ratioDuration   - this ratio's full duration (cap + default)
 * @param {boolean}  hasNullDurations
 * @param {Function} requestMembers  - () => Promise<member[]> (cached group fetch)
 * @param {Function} onPlay          - (members[], title) => void
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
}) {
  const cap = budgetCap(ratioDuration);
  const [budget, setBudget] = useState(() => defaultBudget(cap)); // all clips
  const [sliderOpen, setSliderOpen] = useState(false);
  const [ratioMembers, setRatioMembers] = useState(null); // this ratio's members (once fetched)
  const [playLoading, setPlayLoading] = useState(false);

  const ensureMembers = async () => {
    if (ratioMembers) return ratioMembers;
    const all = await requestMembers();
    const inRatio = all.filter((m) => m.aspect_ratio === ratio);
    setRatioMembers(inRatio);
    return inRatio;
  };

  // Displayed duration = the ACTUAL selected length once members are known,
  // otherwise the full ratio duration from the summary (all clips).
  const subset = ratioMembers ? selectWithinBudget(ratioMembers, budget) : null;
  const displayedDuration = subset ? sumDuration(subset) : ratioDuration;

  const handleToggleSlider = () => {
    const next = !sliderOpen;
    setSliderOpen(next);
    if (next) ensureMembers(); // load so the duration reflects real clips live
  };

  const handleBudgetChange = (seconds) => {
    setBudget(seconds);
    ensureMembers();
  };

  const handlePlayAll = async () => {
    setPlayLoading(true);
    try {
      const members = await ensureMembers();
      const sel = selectWithinBudget(members, budget);
      if (sel.length) onPlay(sel, name);
    } finally {
      setPlayLoading(false);
    }
  };

  return (
    <CollectionHeader
      name={name}
      subtitle={subtitle}
      ratio={ratio}
      reelCount={reelCount}
      duration={displayedDuration}
      hasNullDurations={hasNullDurations}
      budgetCap={cap}
      budget={budget}
      onBudgetChange={handleBudgetChange}
      sliderOpen={sliderOpen}
      onToggleSlider={handleToggleSlider}
      onPlayAll={handlePlayAll}
      playLoading={playLoading}
    />
  );
}

export default CollectionCard;
