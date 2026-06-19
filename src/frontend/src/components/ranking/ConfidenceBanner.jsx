import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, ChevronRight, Lock } from 'lucide-react';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { RATIO_ORDER, COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { formatDurationHuman } from '../collections/format';
import { LockedReasonModal } from '../collections/LockedReasonModal';
import { ConfidenceGauge } from './ConfidenceGauge';

// The first sentence always explains the purpose; the second is tailored to the
// user's progress (per 20% band) to encourage the next step.
const SORT_PURPOSE = 'Sort your clips head-to-head so the best ones show first.';

/** {tier, explain} for the banner, by sort-coverage % and whether ranking is
 *  still available (active). 100% / caught-up gets its own done-state copy. */
function progressMessage(pct, active) {
  if (!active) {
    return {
      tier: 'All Clips Ranked',
      explain: 'Add more clips to keep comparing.',
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
  const [showLockedWhy, setShowLockedWhy] = useState(false); // locked -> "why?" popup

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

  // Locked: an AMBER version of the active ranking-launcher banner (same gauge +
  // trophy + "Ranking Progress" layout, NOT the collection card), with a lock
  // icon (consistent with other locked cards), a summary of what it is + why
  // it's locked, and an unlock progress bar. Tapping opens the "exactly why"
  // popup (the shared LockedReasonModal, ranking variant).
  if (state.kind === 'locked') {
    const unlockPct = Math.max(0, Math.min(100, Math.round((state.contentSec / COLLECTION_MIN_DURATION_SEC) * 100)));
    return (
      <>
        <button
          type="button"
          onClick={() => setShowLockedWhy(true)}
          title="Why is this locked?"
          className="w-full text-left rounded-xl border border-amber-500/40 bg-amber-900/10 hover:bg-amber-900/20 transition-colors p-3 mb-3"
        >
          <div className="flex items-center gap-3">
            <ConfidenceGauge pct={0} color="#f59e0b" width={120} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Trophy size={16} className="text-amber-400 shrink-0" />
                <span className="text-white font-semibold text-sm">Ranking Progress</span>
                <Lock size={13} className="text-amber-400 shrink-0" />
              </div>
              <div className="text-xs text-gray-400 mt-1 leading-snug">
                {SORT_PURPOSE} Locked until you have {formatDurationHuman(COLLECTION_MIN_DURATION_SEC)} of clips.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-gray-700 overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${unlockPct}%` }} />
                </div>
                <span className="text-xs text-amber-300/80 shrink-0 tabular-nums">
                  {formatDurationHuman(state.contentSec) || '0s'} / {formatDurationHuman(COLLECTION_MIN_DURATION_SEC)}
                </span>
              </div>
            </div>
          </div>
        </button>
        {showLockedWhy && (
          <LockedReasonModal
            kind="ranking"
            name="Ranking Progress"
            currentSec={state.contentSec}
            onClose={() => setShowLockedWhy(false)}
          />
        )}
      </>
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
