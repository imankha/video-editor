import { API_BASE } from '../config';
import apiFetch from './apiFetch';

/**
 * In-flight dedup for GET /api/rank/confidence (T4775).
 *
 * Opening My Reels mounts the ConfidenceBanner, which reads confidence for BOTH
 * ratios (portrait + landscape) via Promise.all. Under React StrictMode (dev,
 * main.jsx) the mount effect double-invokes, firing each ratio's request twice
 * concurrently -- the "3x rank/confidence" seen in the T4770 HAR is that
 * duplication (2 ratios x 2 mounts). A shared in-flight promise keyed by ratio
 * collapses concurrent duplicates to ONE network request per ratio, and also
 * coalesces across callers (banner vs. RankingGame probe vs. in-game refresh)
 * when they overlap.
 *
 * This is an in-flight guard, NOT a result cache: the entry is dropped once the
 * request settles, so a later deliberate refetch (e.g. refreshKey bump after the
 * ranking game closes) still hits the network. Read-only, no persistence --
 * mirrors gamesDataStore.loadGame's `_getGameInflight` pattern.
 */
const _inflight = new Map(); // ratio -> Promise<confidence|null>

/**
 * Fetch confidence for one aspect ratio, deduping concurrent callers. Returns
 * the parsed confidence object, or null on failure (all callers treat
 * confidence as non-critical).
 *
 * @param {string} ratio - aspect ratio, e.g. '9:16'
 * @returns {Promise<object|null>}
 */
export function fetchRankConfidence(ratio) {
  const existing = _inflight.get(ratio);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await apiFetch(
        `${API_BASE}/api/rank/confidence?aspect_ratio=${encodeURIComponent(ratio)}`,
      );
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    } finally {
      _inflight.delete(ratio);
    }
  })();

  _inflight.set(ratio, p);
  return p;
}
