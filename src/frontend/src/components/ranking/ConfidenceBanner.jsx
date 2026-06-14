import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { RATIO } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';

/**
 * ConfidenceBanner - "Collection Confidence" meter + "Rank reels" CTA (T3630).
 *
 * Sits at the top of My Reels. Reads GET /api/rank/confidence for the active
 * ratio (read-only) and renders one of three tones by confidence. Hidden when
 * the ratio has no rankable single-clip reels (nothing to rank yet).
 *
 * @param {Function} onRank      - open the ranking game
 * @param {number=}  refreshKey  - bump to refetch (e.g. after a game closes)
 * @param {string=}  ratio       - which ratio's confidence to show (default Portrait)
 */
export function ConfidenceBanner({ onRank, refreshKey = 0, ratio = RATIO.PORTRAIT }) {
  const [data, setData] = useState(null); // { confidence_pct, ranked_count, total }

  const fetchConfidence = useCallback(async () => {
    try {
      const res = await apiFetch(
        `${API_BASE}/api/rank/confidence?aspect_ratio=${encodeURIComponent(ratio)}`,
      );
      if (res.ok) setData(await res.json());
    } catch {
      /* non-critical; banner just hides on failure */
    }
  }, [ratio]);

  useEffect(() => { fetchConfidence(); }, [fetchConfidence, refreshKey]);

  if (!data || data.total === 0) return null;

  const pct = data.confidence_pct;
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
            {data.ranked_count} of {data.total} clips ranked
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
