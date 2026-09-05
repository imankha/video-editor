/**
 * T8800 — useFootageIntake: stateful wrapper around the footageIntake pure
 * functions. Owns the probe queue and the merge-on-add-more behaviour.
 *
 * Flow: addFiles -> filter (junk / proxies) -> probe each video SEQUENTIALLY
 * (extractVideoMetadata reads only ranged bytes, so a serial queue keeps memory
 * flat for tens-of-GB camera segments) -> inferOrder over the merged set.
 *
 * No network, no persistence — this is client-side intake planning only.
 */
import { useState, useCallback, useRef } from 'react';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { isJunkFile, pairProxies, inferOrder, dedupeKey } from '../utils/footageIntake';

const INITIAL = {
  status: 'empty', // 'empty' | 'checking' | 'ready'
  items: [],
  order: [],
  confidence: 'unknown', // 'time' | 'name' | 'unknown' | 'manual'
  gaps: [],
  skipped: [], // names of files silently excluded (disclosed in the gray line)
  proxies: {}, // videoName -> .LRF File, kept client-side for preview
};

export function useFootageIntake() {
  const [state, setState] = useState(INITIAL);
  // Refs hold the canonical merged sets so add-more/remove can recompute without
  // racing async setState between sequential probes.
  const itemsRef = useRef([]);
  const proxiesRef = useRef({});
  const skippedRef = useRef([]);

  const publish = useCallback((items, proxies, skipped) => {
    const probed = items.filter((it) => !it.probeError); // errors excluded from order
    const { order, confidence, gaps } = inferOrder(probed);
    const status = items.length || skipped.length ? 'ready' : 'empty';
    setState({ status, items, order, confidence, gaps, skipped, proxies });
  }, []);

  const addFiles = useCallback(async (fileList) => {
    const list = Array.from(fileList || []);
    // Pair proxies first (they see the full list — a paired .LRF is junk by
    // extension but kept for preview), then let isJunkFile be the single gate on
    // what is excluded: it also rejects zero-byte and dotfile/AppleDouble files
    // that would otherwise pass isVideoFile on their extension alone.
    const { videos: candidates, proxies: newProxies } = pairProxies(list);
    const videos = candidates.filter((f) => !isJunkFile(f));
    const accepted = new Set(videos);
    const proxyFiles = new Set(Object.values(newProxies));
    const newSkipped = list
      .filter((f) => !accepted.has(f) && !proxyFiles.has(f))
      .map((f) => f.name);

    setState((s) => ({ ...s, status: 'checking' }));

    const existing = itemsRef.current;
    const seen = new Set(existing.map(dedupeKey));
    const duplicates = [];
    const additions = [];

    for (const file of videos) {
      let item;
      try {
        const meta = await extractVideoMetadata(file);
        item = {
          name: file.name,
          size: file.size,
          duration: meta.duration,
          creationTime: meta.creationTime ?? null,
          file,
        };
      } catch {
        // A probe failure is kept (so the user sees it) but excluded from order.
        item = { name: file.name, size: file.size, duration: null, creationTime: null, file, probeError: true };
      }
      const key = dedupeKey(item);
      if (seen.has(key)) {
        duplicates.push(item.name); // caller toasts; do not re-add
        continue;
      }
      seen.add(key);
      additions.push(item);
    }

    const mergedItems = [...existing, ...additions];
    const mergedProxies = { ...proxiesRef.current, ...newProxies };
    const mergedSkipped = [...skippedRef.current, ...newSkipped];
    itemsRef.current = mergedItems;
    proxiesRef.current = mergedProxies;
    skippedRef.current = mergedSkipped;
    publish(mergedItems, mergedProxies, mergedSkipped);
    return { duplicates };
  }, [publish]);

  const removeItem = useCallback((name) => {
    const mergedItems = itemsRef.current.filter((it) => it.name !== name);
    itemsRef.current = mergedItems;
    publish(mergedItems, proxiesRef.current, skippedRef.current);
  }, [publish]);

  const setManualOrder = useCallback((names) => {
    const byName = new Map(itemsRef.current.map((it) => [it.name, it]));
    const order = names
      .map((n) => byName.get(n))
      .filter((it) => it && !it.probeError);
    // gaps were computed against the time-ordered chain (afterIndex points into
    // THAT order); once the user hand-orders, those indices are meaningless and
    // would draw break connectors — even the yellow "two games?" warning —
    // between segments the user just placed adjacent. Drop them.
    setState((s) => ({ ...s, order, confidence: 'manual', gaps: [] }));
  }, []);

  const reset = useCallback(() => {
    itemsRef.current = [];
    proxiesRef.current = {};
    skippedRef.current = [];
    setState(INITIAL);
  }, []);

  return { ...state, addFiles, removeItem, setManualOrder, reset };
}
