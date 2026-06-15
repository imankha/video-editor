import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { RATIO_ORDER } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';

/**
 * ConfidenceBanner - "Collection Confidence" meter + "Rank reels" CTA (T3630).
 *
 * Sits at the top of My Reels. Ranking is only OFFERED once a ratio has >= 30s of
 * unranked content; the banner reads GET /api/rank/confidence for BOTH ratios and
 * renders only when at least one is `eligible`, aggregating the eligible ratios'
 * numbers. Read-only (no writes). Hidden entirely when neither ratio qualifies.
 *
 * @param {Function} onRank      - open the ranking game
 * @param {number=}  refreshKey  - bump to refetch (e.g. after a game closes)
 */
export function ConfidenceBanner({ onRank, refreshKey = 0 }) {
  const [agg, setAgg] = useState(null); // { confidence_pct, ranked_count, total } | null

  const fetchEligibility = useCallback(async () => {
    try {
      const results = await Promise.all(
        RATIO_ORDER.map(async (r) => {
          const res = await apiFetch(
            `${API_BASE}/api/rank/confidence?aspect_ratio=${encodeURIComponent(r)}`,
          );
          return res.ok ? res.json() : null;
        }),
      );
      const eligible = results.filter((d) => d && d.eligible);
      if (eligible.length === 0) {
        setAgg(null);
        return;
      }
      // Aggregate across eligible ratios: counts sum, confidence is the
      // clip-count-weighted mean of the per-ratio percentages.
      const total = eligible.reduce((s, d) => s + d.total, 0);
      const ranked = eligible.reduce((s, d) => s + d.ranked_count, 0);
      const pct = total
        ? Math.round(eligible.reduce((s, d) => s + d.confidence_pct * d.total, 0) / total)
        : 0;
      setAgg({ confidence_pct: pct, ranked_count: ranked, total });
    } catch {
      setAgg(null); // non-critical; banner just hides on failure
    }
  }, []);

  useEffect(() => { fetchEligibility(); }, [fetchEligibility, refreshKey]);

  if (!agg) return null;

  const pct = agg.confidence_pct;
  let subtext = 'Winners lead every highlight collection.';
  if (pct < 20) subtext = 'Your highlights are picking themselves. Play a few rounds to take control.';
  else if (pct >= 90) subtext = 'Dialed in. New clips will ask for a few matchups when you publish them.';

  return (
    <button
      type="button"
      onClick={onRank}
      className={`w-full text-left rounded-xl border ${REEL.borderSubtle} ${REEL.bgSubtle}
        hover:bg-cyan-900/40 transition-colors p-3 mb-3`}
    >
      <div className="flex items-center gap-3">
        <Trophy size={22} className={`${REEL.accent} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-semibold text-sm">Collection Confidence</span>
            <span className={`font-bold ${REEL.accent}`}>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden my-1">
            <div className={`h-full ${REEL.bg} transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs text-gray-400">
            {agg.ranked_count} of {agg.total} clips ranked
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{subtext}</div>
        </div>
      </div>
      <div className={`flex items-center justify-end gap-1 mt-2 text-sm font-medium ${REEL.accent}`}>
        Rank reels <ChevronRight size={16} />
      </div>
    </button>
  );
}

export default ConfidenceBanner;
