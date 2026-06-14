import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useProfileStore } from '../stores/profileStore';
import { sortReels } from '../utils/reelOrder';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * useCollections - Collections tab data (T3610).
 *
 * Two independent state machines, deliberately separate from useDownloads
 * (which owns the All tab's single full-list fetch):
 *   - summary: GET /api/collections/summary, fetched once when the tab becomes
 *     active. The ONLY source of aggregates (counts/durations/eligibility) —
 *     the client never reduces over the reel list (EPIC #13).
 *   - members: GET /api/downloads?game_id=N | ?mixes=true, fetched lazily on
 *     first expand and cached per group key. Ratio pills filter these cached
 *     cards client-side, so NO refetch on ratio change.
 *
 * JSON over the wire like every endpoint. Panel-scoped useState, cleared on
 * profile switch (same accepted pattern as useDownloads).
 *
 * @param {boolean} isActive - true when the panel is open AND the Collections
 *   tab is selected; the summary fetch fires on the false->true transition.
 */
export function useCollections(isActive = false) {
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState('idle'); // idle|loading|ready|error
  const [members, setMembers] = useState({});               // { 'game:12': DownloadItem[], 'mixes': [...] }
  const [memberStates, setMemberStates] = useState({});     // per-key idle|loading|ready|error

  const summaryAbortRef = useRef(null);
  const memberAbortsRef = useRef({});

  const fetchSummary = useCallback(async () => {
    if (summaryAbortRef.current) summaryAbortRef.current.abort();
    summaryAbortRef.current = new AbortController();
    const controller = summaryAbortRef.current;

    setSummaryState('loading');
    try {
      const res = await apiFetch(`${API_BASE_URL}/collections/summary`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Failed to fetch collections summary');
      const data = await res.json();
      if (!controller.signal.aborted) {
        setSummary(data);
        setSummaryState('ready');
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.error('[useCollections] fetchSummary error:', err);
      setSummaryState('error');
      return null;
    }
  }, []);

  /**
   * Lazy member fetch, cached per group key. No-op if already loading/ready.
   * @param {{ key: string, query?: string }} opts - cache key + URL query string
   *   (no leading '?'); empty query => GET /api/downloads (the full list, used by
   *   the Top Plays smart collection).
   * @returns {Promise<DownloadItem[]>} the cached/fetched members for the key
   */
  const fetchMembers = useCallback(async ({ key, query = '' } = {}) => {
    const state = memberStates[key];
    if (state === 'loading' || state === 'ready') {
      return members[key] || [];
    }

    if (memberAbortsRef.current[key]) memberAbortsRef.current[key].abort();
    const controller = new AbortController();
    memberAbortsRef.current[key] = controller;

    setMemberStates((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const url = query
        ? `${API_BASE_URL}/downloads?${query}`
        : `${API_BASE_URL}/downloads`;
      const res = await apiFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch members');
      const data = await res.json();
      const items = data.downloads || [];
      if (!controller.signal.aborted) {
        setMembers((prev) => ({ ...prev, [key]: items }));
        setMemberStates((prev) => ({ ...prev, [key]: 'ready' }));
      }
      return items;
    } catch (err) {
      if (err.name === 'AbortError') return [];
      console.error('[useCollections] fetchMembers error:', err);
      setMemberStates((prev) => ({ ...prev, [key]: 'error' }));
      return [];
    }
  }, [members, memberStates]);

  // Member-card mutation sync (T3610 §0B.6): keep cached member lists honest when
  // a reel is renamed / watched / deleted from a card. The summary is the source
  // of truth for aggregates, so deletes also refetch it (counts/eligibility move).
  const removeMember = useCallback((id) => {
    setMembers((prev) => {
      const next = {};
      for (const k of Object.keys(prev)) next[k] = prev[k].filter((m) => m.id !== id);
      return next;
    });
  }, []);

  const patchMember = useCallback((id, patch) => {
    setMembers((prev) => {
      const next = {};
      for (const k of Object.keys(prev)) {
        next[k] = prev[k].map((m) => (m.id === id ? { ...m, ...patch } : m));
      }
      return next;
    });
  }, []);

  // Rank a reel (T3630). GESTURE-ONLY (confirm / nudge / drag) — never reactive.
  // Optimistically patches season_rank in the cached member lists and re-sorts
  // them (compareReels), then POSTs; reconciles with the server-computed rank.
  // `body` = { rank } | { prev_id, next_id }; optimisticRank is the predicted value.
  const rankMember = useCallback(async (id, body, optimisticRank) => {
    const apply = (rank) => setMembers((prev) => {
      const next = {};
      for (const k of Object.keys(prev)) {
        next[k] = sortReels(
          prev[k].map((m) => (m.id === id ? { ...m, season_rank: rank } : m)),
        );
      }
      return next;
    });
    if (optimisticRank !== undefined) apply(optimisticRank);
    try {
      const res = await apiFetch(`${API_BASE_URL}/downloads/${id}/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to rank');
      const data = await res.json();
      if (data.rank !== optimisticRank) apply(data.rank);
      return data.rank;
    } catch (err) {
      console.error('[useCollections] rankMember error:', err);
      fetchSummary();  // recover ordering from the server on failure
      return null;
    }
  }, [fetchSummary]);

  // Clear all collections state on profile switch (useState, not Zustand).
  // Declared BEFORE the fetch effect so on mount the reset runs first and does
  // not abort the summary fetch the next effect starts (mirrors useDownloads).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  useEffect(() => {
    setSummary(null);
    setSummaryState('idle');
    setMembers({});
    setMemberStates({});
    if (summaryAbortRef.current) summaryAbortRef.current.abort();
    Object.values(memberAbortsRef.current).forEach((c) => c.abort());
    memberAbortsRef.current = {};
  }, [currentProfileId]);

  // Fetch the summary when the tab becomes active.
  useEffect(() => {
    if (isActive && summaryState === 'idle') {
      fetchSummary();
    }
  }, [isActive, summaryState, fetchSummary]);

  // Abort everything on unmount.
  useEffect(() => {
    return () => {
      if (summaryAbortRef.current) summaryAbortRef.current.abort();
      Object.values(memberAbortsRef.current).forEach((c) => c.abort());
    };
  }, []);

  return {
    summary, summaryState, members, memberStates,
    fetchSummary, fetchMembers, removeMember, patchMember, rankMember,
  };
}

export default useCollections;
