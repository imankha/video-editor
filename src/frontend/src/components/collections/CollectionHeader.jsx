import React from 'react';
import { Play } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';
import { ratioDisplay } from '../../constants/aspectRatios';
import { formatDuration } from './format';

/**
 * CollectionHeader - Presentational header for ONE (scope, ratio) collection
 * (T3610). Reused by Season (T3640) and Smart (T3670) collections.
 *
 * Ratio is collection identity: this header represents a single ratio's
 * collection (no ratio toggle). The container renders one header per eligible
 * ratio. Assumes data is present (no null guards); aggregates come from the
 * server summary, never client math.
 *
 * @param {string}    name             - collection name (e.g. game name)
 * @param {string=}   subtitle         - secondary line (e.g. game date)
 * @param {string}    ratio            - '9:16' | '16:9' (identity ratio)
 * @param {number}    reelCount        - reels in this (scope, ratio)
 * @param {number|null} duration       - ratio-scoped NULL-excluded duration sum
 * @param {boolean}   hasNullDurations - show a "~" marker + tooltip when true
 * @param {Function}  onPlayAll        - play this collection as a story
 * @param {React.ReactNode=} actions   - verbs slot: Share (T3620) / Video (T3680)
 */
export function CollectionHeader({
  name,
  subtitle,
  ratio,
  reelCount,
  duration,
  hasNullDurations,
  onPlayAll,
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

      {/* Verbs */}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" icon={Play} onClick={onPlayAll}>
          Play all
        </Button>
        {actions}
      </div>
    </div>
  );
}

export default CollectionHeader;
