import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader, MoreVertical, Clock, Share2, Link2, Download } from 'lucide-react';
import { Button } from '../shared/Button';
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
        disabled
          ? 'text-gray-500 cursor-not-allowed'
          : 'text-gray-200 hover:bg-gray-700'
      }`}
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {disabled && <span className="text-[10px] text-gray-500">Soon</span>}
    </button>
  );
}

/**
 * CollectionHeader - Presentational header for ONE (scope, ratio) collection
 * (T3610 §0B). Play all + a "..." menu (Set Duration now; Share / Copy link /
 * Download disabled until T3620/T3680). The duration slider is hidden until
 * "Set Duration" is chosen. Assumes data is present.
 *
 * @param {string}    name             - collection name (includes the ratio word)
 * @param {string=}   subtitle
 * @param {string}    ratio            - '9:16' | '16:9'
 * @param {number}    reelCount
 * @param {number|null} duration       - the ACTUAL selected duration (defaults to all clips)
 * @param {boolean}   hasNullDurations
 * @param {number}    budgetCap        - slider max (full collection duration)
 * @param {number}    budget           - current budget (seconds)
 * @param {Function}  onBudgetChange   - (seconds) => void
 * @param {boolean}   sliderOpen       - reveal the Set Duration slider
 * @param {Function}  onToggleSlider   - () => void (from the "Set Duration" item)
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
    <div className="flex flex-col gap-2 py-2">
      {/* Identity line */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs font-medium ${REEL.accent} shrink-0`}>
            {ratioDisplay(ratio)}
          </span>
          <h3 className="text-sm font-semibold text-white truncate">{name}</h3>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
          {subtitle && <span className="truncate">{subtitle}</span>}
          {subtitle && <span aria-hidden>·</span>}
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
      </div>

      {/* Verbs: Play all + overflow menu */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={playLoading ? Loader : Play}
          disabled={playLoading}
          onClick={onPlayAll}
          className={playLoading ? '[&_svg]:animate-spin' : ''}
        >
          Play all
        </Button>

        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="sm"
            icon={MoreVertical}
            iconOnly
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More actions"
          />
          {menuOpen && (
            <div className="absolute right-0 mt-1 z-10 w-44 rounded-lg bg-gray-800 border border-gray-700 shadow-xl py-1">
              <MenuItem icon={Play} label="Play all"
                onClick={() => { setMenuOpen(false); onPlayAll(); }} />
              <MenuItem icon={Clock} label="Set Duration"
                onClick={() => { setMenuOpen(false); onToggleSlider(); }} />
              <div className="my-1 border-t border-gray-700" />
              {DEFERRED_ACTIONS.map((a) => (
                <MenuItem key={a.key} icon={a.icon} label={a.label} disabled title="Coming soon" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Set Duration slider (hidden until chosen) */}
      {sliderOpen && (
        <DurationBudgetSlider cap={budgetCap} value={budget} onChange={onBudgetChange} />
      )}
    </div>
  );
}

export default CollectionHeader;
