import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { RATIO_ORDER, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { LockedCollectionCard } from '../collections/LockedCollectionCard';
import { ConfidenceGauge } from './ConfidenceGauge';

/**
 * ConfidenceBanner - "Collection Confidence" + "Rank reels" entry point (T3630).
 *
 * Reads GET /api/rank/confidence for both ratios (read-only) and always renders
 * an explanatory card -- it is never silently hidden when there are reels:
 *
 *  - active   : a ratio has >= 30s unranked content -> fuel-gauge + "Rank reels".
 *  - caught_up: enough content but nothing left to rank now -> "dialed in".
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
      />
    );
  }

  const { pct } = state;
  const active = state.kind === 'active';

  let subtext;
  if (!active) subtext = "You're dialed in. New clips will ask for a few matchups when you publish them.";
  else if (pct < 50) subtext = 'Your highlights are picking themselves. Play a few rounds to take control.';
  else subtext = 'Sort more clips to improve highlights';

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
          <div className="flex items-center gap-2">
            <Trophy size={16} className={`${REEL.accent} shrink-0`} />
            <span className="text-white font-semibold text-sm">Collection Confidence</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">{subtext}</div>
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
