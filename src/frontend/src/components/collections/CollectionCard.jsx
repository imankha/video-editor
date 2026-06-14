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
 * @param {string}   title           - card title (e.g. "Top Plays", "Highlights")
 * @param {string=}  playTitle       - story-player title (defaults to title)
 * @param {string}   ratio           - identity ratio (shown as a glyph)
 * @param {number}   reelCount
 * @param {number}   ratioDuration   - this ratio's full duration (cap + default)
 * @param {boolean}  hasNullDurations
 * @param {Function} requestMembers  - () => Promise<member[]> (cached group fetch)
 * @param {Function} onPlay          - (members[], title) => void
 * @param {Object=}  shareDefinition - base {scope, filter, aspect_ratio} for share links (T3620)
 * @param {Function=} onShare        - (definition, title) => void
 * @param {Function=} onCopyLink     - (definition) => void
 */
export function CollectionCard({
  title,
  playTitle,
  ratio,
  reelCount,
  ratioDuration,
  hasNullDurations,
  requestMembers,
  onPlay,
  shareDefinition,
  onShare,
  onCopyLink,
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
      if (sel.length) onPlay(sel, playTitle || title);
    } finally {
      setPlayLoading(false);
    }
  };

  // Fold the user's chosen budget into the shared definition only when they've
  // trimmed below the full collection (Set Duration with budget < cap). The
  // server re-freezes the title; the client never sends one.
  const buildDefinition = () => {
    const trimmed = sliderOpen && budget < cap;
    return trimmed ? { ...shareDefinition, budget_sec: budget } : { ...shareDefinition };
  };

  return (
    <CollectionHeader
      title={title}
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
      onShare={onShare && shareDefinition ? () => onShare(buildDefinition(), playTitle || title) : undefined}
      onCopyLink={onCopyLink && shareDefinition ? () => onCopyLink(buildDefinition()) : undefined}
    />
  );
}

export default CollectionCard;
