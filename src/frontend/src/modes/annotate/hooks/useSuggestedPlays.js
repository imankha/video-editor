import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../../config';
import apiFetch from '../../../utils/apiFetch';
import { toast } from '../../../components/shared/Toast';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function call(path, { method = 'GET', body } = {}) {
  const res = await apiFetch(`${API_BASE}${path}`, {
    method,
    ...(body !== undefined && { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.body = await res.json().catch(() => ({}));
    throw err;
  }
  return res.json();
}

const sortByTime = (list) =>
  [...list].sort((a, b) => a.video_sequence - b.video_sequence || a.start_time - b.start_time);

/**
 * T13220: server-owned suggested plays for one game (T13210 endpoints).
 *
 * The only effect is the READ on game open. Every write is a named gesture's handler:
 * importMoments (Import), shift (-1 s / +1 s), removeImport, keep (rating tap), dismiss,
 * reopen, undoKeep. A kept suggestion becomes a real play server-side (accept); the parent
 * mirrors that into its region state through `onKept` / `onUnkept`.
 */
export function useSuggestedPlays({ gameId, onKept, onUnkept }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [lastImport, setLastImport] = useState(null); // { importId, firstId } for the alignment card
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;

  const refresh = useCallback(async (id) => {
    const data = await call(`/api/games/${id}/suggestions`);
    if (gameIdRef.current !== id) return null; // game changed while in flight
    setSuggestions(sortByTime(data.suggestions));
    setLoaded(true);
    return data.suggestions;
  }, []);

  useEffect(() => {
    setSuggestions((prev) => (prev.length ? [] : prev)); // no re-render when already empty
    setLoaded(false);
    setLastImport(null);
    if (!gameId) return;
    refresh(gameId).catch((err) => console.error('[useSuggestedPlays] load failed:', err));
  }, [gameId, refresh]);

  const replaceOne = useCallback((next) => {
    setSuggestions((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  }, []);

  const importMoments = useCallback(async (videoSequence, moments) => {
    const result = await call(`/api/games/${gameId}/suggestions`, {
      method: 'POST',
      body: { source: 'veo_zip', video_sequence: videoSequence, moments },
    });
    const list = await refresh(gameId);
    const mine = (list || []).filter((s) => s.import_id === result.import_id);
    const first = sortByTime(mine)[0] ?? null;
    setLastImport({ importId: result.import_id, firstId: first?.id ?? null });
    return { ...result, first };
  }, [gameId, refresh]);

  const shift = useCallback(async (importId, deltaS) => {
    const data = await call(`/api/games/${gameId}/suggestions/shift`, {
      method: 'PATCH', body: { import_id: importId, delta_s: deltaS },
    });
    setSuggestions((prev) => sortByTime(prev.map((s) => data.suggestions.find((n) => n.id === s.id) ?? s)));
    return data.suggestions;
  }, [gameId]);

  const removeImport = useCallback(async (importId) => {
    await call(`/api/games/${gameId}/suggestions?import_id=${encodeURIComponent(importId)}`, { method: 'DELETE' });
    setLastImport(null);
    await refresh(gameId);
  }, [gameId, refresh]);

  const keep = useCallback(async (s, draft) => {
    try {
      const data = await call(`/api/suggestions/${s.id}/accept`, { method: 'POST', body: draft });
      replaceOne(data.suggestion);
      onKept?.(data.suggestion, data.raw_clip_id, draft);
      return data;
    } catch (err) {
      console.error('[useSuggestedPlays] keep failed:', err);
      toast.error(T.SAVE_FAILED);
      return null;
    }
  }, [replaceOne, onKept]);

  const setState = useCallback(async (s, state) => {
    try {
      const data = await call(`/api/suggestions/${s.id}`, { method: 'PATCH', body: { state } });
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, state: data.state } : x)));
      return true;
    } catch (err) {
      console.error('[useSuggestedPlays] state change failed:', err);
      toast.error(T.SAVE_FAILED);
      return false;
    }
  }, [replaceOne]);

  const dismiss = useCallback((s) => setState(s, 'dismissed'), [setState]);
  const reopen = useCallback((s) => setState(s, 'open'), [setState]);

  // Undo of a keep is the existing play delete; the backend reopens the suggestion in the same txn.
  const undoKeep = useCallback(async (s) => {
    const rawId = s.raw_clip_id;
    try {
      await call(`/api/clips/raw/${rawId}`, { method: 'DELETE' });
      setSuggestions((prev) => prev.map((x) => (x.id === s.id ? { ...x, state: 'open', raw_clip_id: null } : x)));
      onUnkept?.(rawId);
      return true;
    } catch (err) {
      console.error('[useSuggestedPlays] undo failed:', err);
      toast.error(T.SAVE_FAILED);
      return false;
    }
  }, [replaceOne, onUnkept]);

  return {
    suggestions, loaded, lastImport,
    importMoments, shift, removeImport, keep, dismiss, reopen, undoKeep,
    clearLastImport: () => setLastImport(null),
  };
}
