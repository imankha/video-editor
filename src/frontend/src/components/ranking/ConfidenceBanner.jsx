import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { RATIO_ORDER, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { LockedCollectionCard } from '../collections/LockedCollectionCard';
import { ConfidenceGauge } from './ConfidenceGauge';

// The first sentence always explains the purpose; the second is tailored to the
// user's progress (per 20% band) to encourage the next step.
const SORT_PURPOSE = 'Sort your clips head-to-head so the best ones show first.';

/** {tier, explain} for the banner, by sort-coverage % and whether ranking is
 *  still available (active). 100% / caught-up gets its own done-state copy. */
function progressMessage(pct, active) {
  if (!active) {
    return {
      tier: 'Fully sorted',
      explain: 'Every clip in this collection is sorted. New clips will ask for a few matchups when you publish them.',
    };
  }
  let tier, note;
  if (pct === 0) { tier = 'Not started yet'; note = "You haven't started yet -- but you should, it's fun!"; }
  else if (pct < 20) { tier = 'Just getting started'; note = "You're just getting started."; }
  else if (pct < 40) { tier = 'Warming up'; note = "You're warming up -- keep going!"; }
  else if (pct < 60) { tier = 'Well on your way'; note = "You're well on your way."; }
  else if (pct < 80) { tier = 'Most of the way'; note = "You're most of the way there."; }
  else { tier = 'Almost there'; note = 'Almost there -- just a few more!'; }
  return { tier, explain: `${SORT_PURPOSE} ${note}` };
}

/**
 * ConfidenceBanner - "Ranking Progress" + "Rank reels" entry point (T3630).
 *
 * The meter is sort COVERAGE: 0% = nothing sorted, 100% = fully sorted. Reads
 * GET /api/rank/confidence for both ratios (read-only) and always renders an
 * explanatory card -- it is never silently hidden when there are reels:
 *
 *  - active   : rankable AND not fully sorted -> gauge + "Rank reels".
 *  - caught_up: fully sorted (100%) -> nothing left to rank now.
 *  - locked   : < 30s of content -> amber "build more to unlock ranking" card.
 *
 * Hidden only when there are no rankable single-clip reels at all.
 *
 * @param {Function} onRank      - open the ranking game (active state only)
 * @param {number=}  refreshKey  - bump to refetch (e.g. after a game closes)
 */
export function ConfidenceBanner({ onRank, refreshKey = 0 }) {
  const [state, setState] = useState(null); // { kind, pct, contentSec }

  const fetchState = useCallback(async () => {
    try {
      const results = await Promise.all(
        RATIO_ORDER.map(async (r) => {
          const res = await apiFetch(
            `${API_BASE}/api/rank/confidence?aspect_ratio=${encodeURIComponent(r)}`,
          );
          return res.ok ? res.json() : null;
        }),
      );
      const valid = results.filter((d) => d && d.total > 0);
      if (valid.length === 0) { setState(null); return; } // nothing rankable -> hide

      const totalReels = valid.reduce((s, d) => s + d.total, 0);
      const pct = Math.round(
        valid.reduce((s, d) => s + d.confidence_pct * d.total, 0) / totalReels,
      );
      const contentSec = Math.max(...valid.map((d) => d.total_sec || 0));

      if (valid.some((d) => d.eligible)) setState({ kind: 'active', pct });
      else if (valid.some((d) => (d.total_sec || 0) >= COLLECTION_MIN_DURATION_SEC))
        setState({ kind: 'caught_up', pct });
      else setState({ kind: 'locked', contentSec });
    } catch {
      setState(null); // non-critical; banner just hides on failure
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState, refreshKey]);

  if (!state) return null;

  if (state.kind === 'locked') {
    return (
      <LockedCollectionCard
        name="Rank reels"
        subtitle="Build more highlights to unlock ranking"
        currentSec={state.contentSec}
        stacked={false}
      />
    );
  }

  const { pct } = state;
  const active = state.kind === 'active';
  const tierColor = pct < 50 ? 'text-amber-400' : REEL.accent; // matches the gauge's amber threshold
  const { tier, explain } = progressMessage(pct, active);

  const Tag = active ? 'button' : 'div';
  return (
    <Tag
      type={active ? 'button' : undefined}
      onClick={active ? onRank : undefined}
      className={`w-full text-left rounded-xl border ${REEL.borderSubtle} ${REEL.bgSubtle}
        ${active ? 'hover:bg-cyan-900/40 transition-colors' : ''} p-3 mb-3`}
    >
      <div className="flex items-center gap-3">
        <ConfidenceGauge pct={pct} width={120} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Trophy size={16} className={`${REEL.accent} shrink-0`} />
            <span className="text-white font-semibold text-sm">Ranking Progress</span>
            <span className={`text-xs font-semibold ${tierColor}`}>{tier}</span>
          </div>
          <div className="text-xs text-gray-400 mt-1 leading-snug">{explain}</div>
          {active && (
            <div className={`flex items-center gap-1 mt-2 text-sm font-medium ${REEL.accent}`}>
              Rank reels <ChevronRight size={16} />
            </div>
          )}
        </div>
      </div>
    </Tag>
  );
}

export default ConfidenceBanner;
