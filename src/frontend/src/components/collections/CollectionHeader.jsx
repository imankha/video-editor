import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader, MoreVertical, Clock, Share2, Link2, Download, Film } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ratioGlyph, ratioLabel } from '../../constants/aspectRatios';
import { formatDurationHuman } from './format';
import { DurationBudgetSlider } from './DurationBudgetSlider';
import { MediaCard, CardMedia, CardIconButton } from '../shared/MediaCard';
import { INTRO_BADGE, INTRO_BADGE_ICON as IntroIcon } from '../../constants/introBadge';
import { Z } from '../../constants/zLayers';

// Collection-level Download (stitched mp4) is wired in T4945 (onDownload prop).
// Share / Copy link are wired in T3620 (onShare / onCopyLink props).

function MenuItem({ icon: Icon, label, onClick, disabled, title, spinning, comingSoon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full flex items-center gap-2 px-3 min-h-9 text-sm text-left transition-colors ${
        disabled ? 'text-gray-500 cursor-not-allowed' : 'text-gray-200 hover:bg-gray-600'
      }`}
    >
      <Icon size={15} className={`shrink-0 ${spinning ? 'animate-spin' : ''}`} />
      <span className="flex-1">{label}</span>
      {comingSoon && <span className="text-[10px] text-gray-500">Soon</span>}
    </button>
  );
}

/**
 * CollectionHeader - One (scope, ratio) collection, rendered with the SAME shared
 * card shell as the reel cards (MediaCard/CardIconButton, T3610 §0B). Play +
 * Copy link + a "..." menu (Play all, Max Duration, Share). Share/Copy-link are
 * wired in T3620 (onShare/onCopyLink); Download (stitched MP4) is wired in T4945
 * (onDownload). The max-duration slider is hidden until "Max Duration".
 *
 * @param {string}    title            - bold title (e.g. "Top Plays", "Highlights")
 * @param {string}    ratio            - '9:16' | '16:9' (shown as a glyph, no word)
 * @param {number}    reelCount
 * @param {number|null} duration       - ACTUAL selected duration (defaults to all clips)
 * @param {boolean}   hasNullDurations
 * @param {number}    budgetCap
 * @param {number}    budget
 * @param {Function}  onBudgetChange
 * @param {boolean}   sliderOpen
 * @param {Function}  onToggleSlider
 * @param {Function}  onPlayAll
 * @param {boolean=}  playLoading
 * @param {Function=} onShare        - open the share modal (T3620); omitted => disabled
 * @param {Function=} onCopyLink     - create + copy a public link (T3620); omitted => disabled
 * @param {Function=} onIntro        - open the collection's OWN intro picker (T5215 round 2); omitted => disabled
 * @param {Function=} onDownload     - download the collection as a stitched MP4 (T4945); omitted => disabled
 * @param {boolean=}  downloadLoading - stitched-download in flight (spins the Download item)
 * @param {Object=}   introBadge     - {intro_card_id, intro_card_name}, batch-resolved (T5215 round 6);
 *                                     shows the shared badge in the media slot's corner when intro_card_name is set
 */
export function CollectionHeader({
  title,
  ratio,
  reelCount,
  duration,
  hasNullDurations,
  budgetCap,
  budget,
  onBudgetChange,
  sliderOpen,
  onToggleSlider,
  onPlayAll,
  playLoading,
  onShare,
  onCopyLink,
  onIntro,
  onDownload,
  downloadLoading,
  introBadge,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const durationStr = formatDurationHuman(duration);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [menuOpen]);

  const actions = (
    <>
      <CardIconButton
        icon={playLoading ? Loader : Play}
        spinning={playLoading}
        disabled={playLoading}
        onClick={onPlayAll}
        title="Play all"
        iconClassName={`${REEL.accent} hover:text-cyan-300`}
        hoverClassName={`hover:${REEL.bgMuted}`}
      />
      <CardIconButton
        icon={Link2}
        disabled={!onCopyLink}
        onClick={onCopyLink}
        title={onCopyLink ? 'Copy link' : 'Copy link (coming soon)'}
      />
      <div className="relative" ref={menuRef}>
        <CardIconButton icon={MoreVertical} onClick={() => setMenuOpen((o) => !o)} title="More actions" />
        {menuOpen && (
          <div className={`absolute right-0 mt-1 ${Z.DROPDOWN} w-44 rounded-lg bg-gray-700 border border-gray-600 shadow-xl py-1`}>
            <MenuItem icon={Play} label="Play all"
              onClick={() => { setMenuOpen(false); onPlayAll(); }} />
            <MenuItem icon={Clock} label="Max Duration"
              onClick={() => { setMenuOpen(false); onToggleSlider(); }} />
            <MenuItem icon={IntroIcon} label="Intro"
              disabled={!onIntro} comingSoon={!onIntro} title={onIntro ? undefined : 'Coming soon'}
              onClick={onIntro ? () => { setMenuOpen(false); onIntro(); } : undefined} />
            <div className="my-1 border-t border-gray-600" />
            <MenuItem icon={Share2} label="Share"
              disabled={!onShare} comingSoon={!onShare} title={onShare ? undefined : 'Coming soon'}
              onClick={onShare ? () => { setMenuOpen(false); onShare(); } : undefined} />
            <MenuItem icon={downloadLoading ? Loader : Download}
              label={downloadLoading ? 'Downloading…' : 'Download'}
              spinning={downloadLoading}
              disabled={!onDownload || downloadLoading} comingSoon={!onDownload}
              title={onDownload ? undefined : 'Coming soon'}
              onClick={onDownload ? () => onDownload() : undefined} />
          </div>
        )}
      </div>
    </>
  );

  const footer = sliderOpen ? (
    <div className="mt-2">
      <DurationBudgetSlider cap={budgetCap} value={budget} onChange={onBudgetChange} />
    </div>
  ) : null;

  // T5215 round 6 item 3 (user, 2026-08-07): "I don't see an intro card
  // badge on the collections which I do want" -- round 5 removed the
  // title-row badge (too small to read there), but the user still wants
  // SOME indicator. Mirrors the reel-tile treatment (round 5 item 3): a
  // small corner badge on the collection's own VISUAL area (this media
  // slot), not inline with the title text. Collections have no rank-number
  // chip to sit next to, so it always takes the media slot's upper-left
  // corner -- the same fallback spot the reel tile uses when there's no rank.
  const introBadgeEl = introBadge?.intro_card_name ? (
    <div
      data-testid="intro-badge"
      className="absolute top-0.5 left-0.5 px-0.5 py-0.5 bg-black/60 backdrop-blur-sm rounded flex items-center justify-center"
      title="An intro plays before this collection"
    >
      <IntroIcon size={10} fill="currentColor" aria-hidden="true" className={INTRO_BADGE.text} />
    </div>
  ) : null;

  return (
    <MediaCard
      media={
        <CardMedia icon={Film} iconClassName={REEL.accent} wrapClassName={REEL.bgMuted}>
          {introBadgeEl}
        </CardMedia>
      }
      actions={actions}
      footer={footer}
      stacked
    >
      {/* T5215 round 5 (user, 2026-08-07): "no little image near game
          highlights since it's too small to help visually" -- the round-3
          title-row badge is removed entirely (not resized); item 3's
          replacement badge lives in the media slot above instead. */}
      <h3 className="text-white text-sm font-medium truncate">
        {title}
      </h3>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`${REEL.accent} text-sm leading-none`} title={ratioLabel(ratio)}>
          {ratioGlyph(ratio)}
        </span>
        <span>{reelCount} {reelCount === 1 ? 'reel' : 'reels'}</span>
        {durationStr && (
          <>
            <span aria-hidden>·</span>
            <span title={hasNullDurations ? 'Some reels have no recorded duration' : undefined}>
              {hasNullDurations ? '~' : ''}{durationStr}
            </span>
          </>
        )}
      </div>
    </MediaCard>
  );
}

export default CollectionHeader;
