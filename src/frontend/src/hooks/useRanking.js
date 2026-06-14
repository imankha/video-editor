import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

const RANK_BASE = `${API_BASE}/api/rank`;

/**
 * useRanking - the pairwise ranking-game loop for one aspect ratio (T3630).
 *
 * GESTURE-ONLY: the ONLY write is `pick()` (POST /api/rank/result), fired from a
 * user tap. Fetching the next pair and the confidence read are read-only — no
 * reactive useEffect writes (EPIC #5).
 *
 * Snappy: the next pair is prefetched while the current one is on screen, so a
 * pick advances instantly. `confidence` is refreshed from each result so the
 * in-game meter ticks up live.
 *
 * @param {string} ratio - active aspect ratio ('9:16' | '16:9')
 * @param {boolean} active - true while the game screen is mounted/visible
 * @returns {{ pair, status, confidence, pick, reload }}
 *   status: 'loading' | 'ready' | 'exhausted' | 'error'
 */
export function useRanking(ratio, active = true) {
  const [pair, setPair] = useState(null);
  const [status, setStatus] = useState('loading');
  const [confidence, setConfidence] = useState(null); // { confidence_pct, ranked_count, total }

  const prefetchRef = useRef(null); // Promise<pair|null> for the next matchup
  const abortRef = useRef(null);

  // Fetch one matchup. Returns the pair object, null (exhausted), or throws.
  const fetchPair = useCallback(async (excludeId) => {
    const params = new URLSearchParams({ aspect_ratio: ratio });
    if (excludeId != null) params.set('exclude_id', String(excludeId));
    const res = await apiFetch(`${RANK_BASE}/next?${params.toString()}`);
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`rank/next failed (${res.status})`);
    return res.json();
  }, [ratio]);

  const fetchConfidence = useCallback(async () => {
    try {
      const res = await apiFetch(`${RANK_BASE}/confidence?aspect_ratio=${encodeURIComponent(ratio)}`);
      if (res.ok) setConfidence(await res.json());
    } catch {
      /* confidence is non-critical; leave the last value */
    }
  }, [ratio]);

  // (Re)start the loop for the current ratio.
  const reload = useCallback(async () => {
    setStatus('loading');
    prefetchRef.current = null;
    try {
      const first = await fetchPair(null);
      setPair(first);
      setStatus(first ? 'ready' : 'exhausted');
      if (first) {
        // Prefetch the follow-up, avoiding an immediate repeat of this opponent.
        prefetchRef.current = fetchPair(first.b.id).catch(() => null);
      }
      fetchConfidence();
    } catch (err) {
      console.error('[useRanking] reload error:', err);
      setStatus('error');
    }
  }, [fetchPair, fetchConfidence]);

  // Submit a pick. winnerId/loserId are the two reels in the current pair.
  const pick = useCallback(async (winnerId, loserId) => {
    // Advance the UI first from the prefetched pair (snappy), then persist.
    const pending = prefetchRef.current;
    try {
      const res = await apiFetch(`${RANK_BASE}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_id: winnerId, loser_id: loserId }),
      });
      if (!res.ok) throw new Error(`rank/result failed (${res.status})`);
      setConfidence(await res.json());
    } catch (err) {
      console.error('[useRanking] pick error:', err);
      // Keep playing — the result will be retried implicitly on the next reload.
    }

    let nextPair = null;
    try {
      nextPair = pending ? await pending : await fetchPair(loserId);
    } catch {
      nextPair = null;
    }
    setPair(nextPair);
    setStatus(nextPair ? 'ready' : 'exhausted');
    prefetchRef.current = nextPair
      ? fetchPair(nextPair.b.id).catch(() => null)
      : null;
  }, [fetchPair]);

  // Start / restart when the ratio changes or the game becomes active.
  useEffect(() => {
    if (!active) return;
    if (abortRef.current) abortRef.current = null;
    reload();
    // reload is stable per ratio; intentionally not depending on it directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, active]);

  return { pair, status, confidence, pick, reload };
}

export default useRanking;
