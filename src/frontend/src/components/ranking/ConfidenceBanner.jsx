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
  const low = pct < 50; // matches the gauge's amber threshold

  // A qualitative level so the words ALWAYS agree with the needle -- no "dialed
  // in" while the gauge sits near empty. "Caught up" (nothing left to rank) is a
  // separate idea from "confident" (the ranking order is certain), so the level
  // tracks the gauge, not the queue.
  const tier = pct >= 80 ? 'Dialed in' : pct >= 50 ? 'Getting confident' : 'Just getting started';
  const tierColor = low ? 'text-amber-400' : REEL.accent;

  // One plain-language line that says WHAT the meter means and WHAT raises it.
  let explain;
  if (!active)
    explain = "You've sorted every clip available for now. Confidence climbs as you publish more clips to compare.";
  else if (low)
    explain = 'We sort your clips head-to-head so your best ones rise to the top. Play a few rounds to get going.';
  else
    explain = 'Your best clips are rising to the top. Keep sorting to lock in the order.';

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
            <span className="text-white font-semibold text-sm">Collection Confidence</span>
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
