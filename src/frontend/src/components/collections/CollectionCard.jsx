import React, { useState } from 'react';
import { CollectionHeader } from './CollectionHeader';
import { budgetCap, defaultBudget, selectWithinBudget, sumDuration } from './budget';

/**
 * CollectionCard - Container for ONE eligible (scope, ratio) collection (T3610
 * §0B.5). Defaults to ALL clips; "Max Duration" reveals a 15s-precision slider
 * that caps the budget, and the displayed duration updates to the ACTUAL
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
 * @param {Function} onPlay          - (members[], title, shareDefinition?) => void; the definition is
 *                                     passed through so the panel can resolve the collection's OWN
 *                                     intro-playback (T6700), same {scope, filter, aspect_ratio} shape
 *                                     used for share/intro-badge lookups
 * @param {Object=}  shareDefinition - base {scope, filter, aspect_ratio} for share links (T3620)
 * @param {Function=} onShare        - (definition, title) => void
 * @param {Function=} onCopyLink     - (definition) => void
 * @param {Function=} onIntro        - (definition, title) => void, the collection's OWN intro (T5215 round 2)
 * @param {Function=} onDownload     - (definition) => Promise, download the stitched MP4 (T4945)
 * @param {Object=} introBadge      - {intro_card_id, intro_card_name}, batch-resolved (T5215 round 6)
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
  onIntro,
  onDownload,
  introBadge,
}) {
  const cap = budgetCap(ratioDuration);
  const [budget, setBudget] = useState(() => defaultBudget(cap)); // all clips
  const [sliderOpen, setSliderOpen] = useState(false);
  const [ratioMembers, setRatioMembers] = useState(null); // this ratio's members (once fetched)
  const [playLoading, setPlayLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);

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
      if (sel.length) onPlay(sel, playTitle || title, shareDefinition);
    } finally {
      setPlayLoading(false);
    }
  };

  // Fold the user's chosen budget into the shared definition only when they've
  // capped below the full collection (Max Duration with budget < cap). The
  // server re-freezes the title; the client never sends one.
  const buildDefinition = () => {
    const trimmed = sliderOpen && budget < cap;
    return trimmed ? { ...shareDefinition, budget_sec: budget } : { ...shareDefinition };
  };

  // T4945: download the whole collection as ONE stitched MP4. Gesture-scoped
  // busy flag (no useEffect) around the caller's blob-download promise, folding
  // the same budget the share/copy-link actions use.
  const handleDownload = async () => {
    setDownloadLoading(true);
    try {
      await onDownload(buildDefinition());
    } finally {
      setDownloadLoading(false);
    }
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
      onIntro={onIntro && shareDefinition ? () => onIntro(shareDefinition, playTitle || title) : undefined}
      onDownload={onDownload && shareDefinition ? handleDownload : undefined}
      downloadLoading={downloadLoading}
      introBadge={introBadge}
    />
  );
}

export default CollectionCard;
