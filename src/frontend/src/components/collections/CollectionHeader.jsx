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

// T7050: compact byte readout for the in-flight download progress row.
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
 * @param {Object=}   downloadProgress - {receivedBytes, totalBytes} in-flight bytes (T7050);
 *                                     totalBytes null => indeterminate bar (no server Content-Length)
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
  downloadProgress,
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

  // T7050: in-flight download feedback. The collection stream has no
  // Content-Length, AND T7040 moved the stitch/compose work OUT of the
  // StreamingResponse generator (so a failure raises a clean 500 instead of
  // aborting mid-stream) -- meaning the entire file is fully built server-side
  // BEFORE the first byte reaches the browser. receivedBytes genuinely stays 0
  // for the whole compose wait (can be ~1 minute); there is no event to report
  // during that phase. A bar-shaped element implies fill-tracking that isn't
  // happening, so the "no total" case is a SPINNER, not a bar (user feedback
  // 2026-08-15: a static full-width pulsing bar reads as stuck, not busy). If a
  // total ever IS known (Content-Length present), that case stays a real
  // determinate bar.
  const received = downloadProgress?.receivedBytes || 0;
  const total = downloadProgress?.totalBytes || null;
  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;

  const downloadProgressEl = downloadLoading ? (
    <div data-testid="collection-download-progress" aria-live="polite">
      {percent != null ? (
        <>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Downloading…</span>
            <span>{formatBytes(received)} / {formatBytes(total)}</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader size={14} className="animate-spin shrink-0 text-cyan-500" />
          <span>
            {received > 0
              ? `Downloading… ${formatBytes(received)}`
              : 'Preparing your download… this can take up to a minute'}
          </span>
        </div>
      )}
    </div>
  ) : null;

  const footer = (sliderOpen || downloadLoading) ? (
    <div className="mt-2 space-y-2">
      {sliderOpen && <DurationBudgetSlider cap={budgetCap} value={budget} onChange={onBudgetChange} />}
      {downloadProgressEl}
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
