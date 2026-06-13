import React from 'react';
import { Play, Loader } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';
import { ratioDisplay } from '../../constants/aspectRatios';
import { formatDuration } from './format';
import { DurationBudgetSlider } from './DurationBudgetSlider';

/**
 * CollectionHeader - Presentational header for ONE (scope, ratio) collection
 * (T3610). Reused by smart, game, and mixes collections.
 *
 * Ratio is collection identity: one header per ratio (no ratio toggle). Includes
 * the duration-budget slider that scopes Play-all (T3610 §0B.5). Assumes data is
 * present; aggregates come from the server summary.
 *
 * @param {string}    name             - collection name (includes the ratio word)
 * @param {string=}   subtitle         - secondary line (e.g. game date)
 * @param {string}    ratio            - '9:16' | '16:9' (identity ratio, for the glyph)
 * @param {number}    reelCount        - reels in this (scope, ratio)
 * @param {number|null} duration       - ratio-scoped NULL-excluded duration sum
 * @param {boolean}   hasNullDurations - show a "~" marker + tooltip when true
 * @param {number=}   budgetCap        - slider cap; omit to hide the slider
 * @param {number=}   budget           - current budget (seconds)
 * @param {Function=} onBudgetChange   - (seconds) => void
 * @param {Function}  onPlayAll        - play the budgeted subset as a story
 * @param {boolean=}  playLoading      - spinner on Play all while members load
 * @param {React.ReactNode=} actions   - verbs slot: Share (T3620) / Video (T3680)
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
  onPlayAll,
  playLoading,
  actions,
}) {
  const durationStr = formatDuration(duration);

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

      {/* Duration budget slider */}
      {budgetCap != null && onBudgetChange && (
        <DurationBudgetSlider cap={budgetCap} value={budget} onChange={onBudgetChange} />
      )}

      {/* Verbs */}
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
        {actions}
      </div>
    </div>
  );
}

export default CollectionHeader;
