import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader, MoreVertical, Clock, Share2, Link2, Download, Film } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ratioGlyph, ratioLabel } from '../../constants/aspectRatios';
import { formatDuration } from './format';
import { DurationBudgetSlider } from './DurationBudgetSlider';
import { MediaCard, CardMedia, CardIconButton } from '../shared/MediaCard';

// Collection-level overflow actions that need T3620 / T3680. Disabled until then
// (Copy link is also surfaced as a standalone button, like the reel cards).
const DEFERRED_MENU_ACTIONS = [
  { key: 'share', icon: Share2, label: 'Share' },
  { key: 'download', icon: Download, label: 'Download' },
];

function MenuItem({ icon: Icon, label, onClick, disabled, title }) {
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
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {disabled && <span className="text-[10px] text-gray-500">Soon</span>}
    </button>
  );
}

/**
 * CollectionHeader - One (scope, ratio) collection, rendered with the SAME shared
 * card shell as the reel cards (MediaCard/CardIconButton, T3610 §0B). Play +
 * disabled Copy link + a "..." menu (Set Duration now; Share/Download disabled
 * until T3620/T3680). The duration slider is hidden until "Set Duration".
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
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const durationStr = formatDuration(duration);

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
      <CardIconButton icon={Link2} disabled title="Copy link (coming soon)" />
      <div className="relative" ref={menuRef}>
        <CardIconButton icon={MoreVertical} onClick={() => setMenuOpen((o) => !o)} title="More actions" />
        {menuOpen && (
          <div className="absolute right-0 mt-1 z-10 w-44 rounded-lg bg-gray-700 border border-gray-600 shadow-xl py-1">
            <MenuItem icon={Play} label="Play all"
              onClick={() => { setMenuOpen(false); onPlayAll(); }} />
            <MenuItem icon={Clock} label="Set Duration"
              onClick={() => { setMenuOpen(false); onToggleSlider(); }} />
            <div className="my-1 border-t border-gray-600" />
            {DEFERRED_MENU_ACTIONS.map((a) => (
              <MenuItem key={a.key} icon={a.icon} label={a.label} disabled title="Coming soon" />
            ))}
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

  return (
    <MediaCard
      media={<CardMedia icon={Film} iconClassName={REEL.accent} wrapClassName={REEL.bgMuted} />}
      actions={actions}
      footer={footer}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-base leading-none ${REEL.accent} shrink-0`} title={ratioLabel(ratio)}>
          {ratioGlyph(ratio)}
        </span>
        <h3 className="text-white font-medium truncate">{title}</h3>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
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
