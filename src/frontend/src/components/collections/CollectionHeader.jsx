import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader, MoreVertical, Clock, Share2, Link2, Download, Film } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { ratioDisplay } from '../../constants/aspectRatios';
import { formatDuration } from './format';
import { DurationBudgetSlider } from './DurationBudgetSlider';

// Collection-level actions that need T3620 (share/copy link) / T3680 (download).
// Shown disabled until those ship (T3610 §0B.7).
const DEFERRED_ACTIONS = [
  { key: 'share', icon: Share2, label: 'Share' },
  { key: 'copy', icon: Link2, label: 'Copy link' },
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
 * CollectionHeader - One (scope, ratio) collection, styled like a reel card
 * (T3610 §0B). Same card chrome + Play icon as the reel cards; a "..." menu adds
 * Set Duration now and Share / Copy link / Download (disabled until T3620/T3680).
 * The duration slider is hidden until "Set Duration" is chosen.
 *
 * @param {string}    name             - collection name (includes the ratio word)
 * @param {string=}   subtitle         - e.g. game date
 * @param {string}    ratio            - '9:16' | '16:9'
 * @param {number}    reelCount
 * @param {number|null} duration       - ACTUAL selected duration (defaults to all clips)
 * @param {boolean}   hasNullDurations
 * @param {number}    budgetCap        - slider max (full collection duration)
 * @param {number}    budget
 * @param {Function}  onBudgetChange
 * @param {boolean}   sliderOpen
 * @param {Function}  onToggleSlider
 * @param {Function}  onPlayAll
 * @param {boolean=}  playLoading
 */
export function CollectionHeader({
  name,
  subtitle,
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

  return (
    <div className="p-3 bg-gray-700 rounded-lg border border-gray-600 hover:border-gray-500 transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon box (mirrors the reel card; Film glyph marks a collection) */}
        <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${REEL.bgMuted}`}>
          <Film size={20} className={REEL.accent} />
        </div>

        {/* Info + actions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-xs font-medium ${REEL.accent} shrink-0`}>{ratioDisplay(ratio)}</span>
            <h3 className="text-white font-medium truncate">{name}</h3>
          </div>
          {subtitle && <div className="text-sm text-gray-400 truncate">{subtitle}</div>}
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{reelCount} {reelCount === 1 ? 'reel' : 'reels'}</span>
            {durationStr && (
              <span title={hasNullDurations ? 'Some reels have no recorded duration' : undefined}>
                {hasNullDurations ? '~' : ''}{durationStr}
              </span>
            )}
          </div>

          <div className="flex items-center mt-2">
            <div className="flex items-center gap-4 ml-auto flex-shrink-0">
              {/* Play — same icon button as the reel cards */}
              <button
                onClick={onPlayAll}
                disabled={playLoading}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center hover:${REEL.bgMuted} rounded-lg transition-colors`}
                title="Play all"
              >
                {playLoading
                  ? <Loader size={20} className={`${REEL.accent} animate-spin`} />
                  : <Play size={20} className={`${REEL.accent} hover:text-cyan-300`} />}
              </button>

              {/* Overflow menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-gray-600 rounded-lg transition-colors"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreVertical size={20} className="text-gray-400 hover:text-cyan-400" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 z-10 w-44 rounded-lg bg-gray-700 border border-gray-600 shadow-xl py-1">
                    <MenuItem icon={Play} label="Play all"
                      onClick={() => { setMenuOpen(false); onPlayAll(); }} />
                    <MenuItem icon={Clock} label="Set Duration"
                      onClick={() => { setMenuOpen(false); onToggleSlider(); }} />
                    <div className="my-1 border-t border-gray-600" />
                    {DEFERRED_ACTIONS.map((a) => (
                      <MenuItem key={a.key} icon={a.icon} label={a.label} disabled title="Coming soon" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Set Duration slider (hidden until chosen) */}
      {sliderOpen && (
        <div className="mt-2">
          <DurationBudgetSlider cap={budgetCap} value={budget} onChange={onBudgetChange} />
        </div>
      )}
    </div>
  );
}

export default CollectionHeader;
