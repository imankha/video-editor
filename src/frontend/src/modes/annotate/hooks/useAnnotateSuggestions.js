import { useCallback, useMemo, useState } from 'react';
import { toast } from '../../../components/shared/Toast';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';
import { useSuggestedPlays } from './useSuggestedPlays';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches;

/**
 * T13220: wires suggested plays into the Annotate screen. Owns no persistence of its own:
 * server state is `useSuggestedPlays`; a kept play is mirrored into region state through
 * `addKeptPlay`, and post-keep edits go through the existing synced `updateClipRegion`.
 * Everything the view needs comes back as one bundle (`null` until a game id exists).
 *
 * @param {object} p
 * @param {number|null} p.gameId
 * @param {object[]} p.clipRegions        raw (file-time) regions
 * @param {object[]} p.gameVideos         [{ sequence, name }]
 * @param {(seq:number, t:number)=>number} p.toVirtualTime  file time -> timeline time
 * @param {(t:number)=>void} p.seek
 * @param {()=>void} p.togglePlay
 * @param {boolean} p.isPlaying
 * @param {Function} p.addKeptPlay
 * @param {Function} p.removeKeptPlay
 * @param {Function} p.updateClipRegion   synced (PUT /clips/raw/{id})
 * @param {(regionId:string)=>void} p.onEditPlay
 */
export function useAnnotateSuggestions({
  gameId, clipRegions, gameVideos, toVirtualTime, seek, togglePlay, isPlaying,
  addKeptPlay, removeKeptPlay, updateClipRegion, onEditPlay,
}) {
  const [zipFile, setZipFile] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const data = useSuggestedPlays({ gameId, onKept: addKeptPlay, onUnkept: removeKeptPlay });
  const { suggestions, lastImport } = data;

  const regionFor = useCallback(
    (s) => clipRegions.find((r) => r.rawClipId != null && r.rawClipId === s.raw_clip_id) ?? null,
    [clipRegions],
  );

  const keptDetails = useMemo(() => {
    const out = {};
    for (const s of suggestions) {
      const r = s.state === 'accepted' ? regionFor(s) : null;
      if (r) out[s.id] = { rating: r.rating, name: r.name || '', tags: r.tags || [], notes: r.notes || '' };
    }
    return out;
  }, [suggestions, regionFor]);

  const seekTo = useCallback((s, { autoplay = false } = {}) => {
    seek(toVirtualTime(s.video_sequence, s.start_time));
    setActiveId(s.id);
    if (autoplay && !prefersReducedMotion() && !isPlaying) togglePlay();
  }, [seek, toVirtualTime, togglePlay, isPlaying]);

  const handleImport = useCallback(async (videoSequence, moments) => {
    const result = await data.importMoments(videoSequence, moments);
    setZipFile(null);
    if (result.first) seekTo(result.first); // alignment check starts at the first suggestion
  }, [data, seekTo]);

  const handleKeep = useCallback(async (s, draft) => {
    const result = await data.keep(s, draft);
    if (!result) return;
    toast.success(T.KEPT_TOAST, {
      action: { label: T.UNDO, onClick: () => data.undoKeep({ ...s, state: 'accepted', raw_clip_id: result.raw_clip_id }) },
    });
  }, [data]);

  const handleDismiss = useCallback(async (s) => {
    if (!(await data.dismiss(s))) return;
    toast.info(T.DISMISSED_TOAST, { action: { label: T.UNDO, onClick: () => data.reopen(s) } });
  }, [data]);

  const handleEditKept = useCallback((s, updates) => {
    const region = regionFor(s);
    if (!region) {
      console.error('[useAnnotateSuggestions] kept suggestion has no play in region state', s.id);
      return;
    }
    updateClipRegion(region.id, updates);
  }, [regionFor, updateClipRegion]);

  const handleEditPlay = useCallback((s) => {
    const region = regionFor(s);
    if (region) onEditPlay(region.id);
  }, [regionFor, onEditPlay]);

  const ticks = useMemo(
    () => suggestions
      .filter((s) => s.state === 'open')
      .map((s) => ({ id: s.id, time: toVirtualTime(s.video_sequence, s.start_time), label: s.labels[0] })),
    [suggestions, toVirtualTime],
  );

  if (!gameId) return null;
  return {
    openZip: setZipFile,
    sheet: zipFile ? { zipFile, videos: gameVideos, onImport: handleImport, onClose: () => setZipFile(null) } : null,
    align: lastImport ? {
      onShift: (d) => data.shift(lastImport.importId, d),
      onDone: data.clearLastImport,
      onRemove: () => data.removeImport(lastImport.importId),
    } : null,
    ticks,
    onTickClick: (id) => {
      const s = suggestions.find((x) => x.id === id);
      if (s) seekTo(s);
    },
    list: {
      suggestions,
      keptDetails,
      activeId,
      onSelect: seekTo,
      onKeep: handleKeep,
      onDismiss: handleDismiss,
      onReopen: data.reopen,
      onEditKept: handleEditKept,
      onEditPlay: handleEditPlay,
    },
  };
}
