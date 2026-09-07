/**
 * T8800/T8824 — useFootageIntake: stateful wrapper around the footageIntake pure
 * functions. Owns the probe queue and the merge-on-add-more behaviour.
 *
 * Flow: addFiles -> filter (junk / proxies) -> probe each video SEQUENTIALLY
 * (extractVideoMetadata reads only ranged bytes, so a serial queue keeps memory
 * flat for tens-of-GB camera segments) -> inferPlacement over the merged set.
 *
 * State collapses to items + override + manualNames (T8824 design doc §3):
 * every other field (order, confidence, gaps, placement, lanes, spanSeconds,
 * question) is DERIVED, every time, by one publish() call through
 * inferPlacement — no hand-patched setState branch may exist for any of them.
 *
 * No network, no persistence — this is client-side intake planning only.
 */
import { useState, useCallback, useRef } from 'react';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { isJunkFile, pairProxies, inferPlacement, dedupeKey } from '../utils/footageIntake';

const INITIAL = {
  status: 'empty', // 'empty' | 'checking' | 'ready'
  items: [],
  order: [],
  confidence: 'unknown', // 'time' | 'name' | 'unknown' | 'manual'
  gaps: [],
  placement: 'sequence', // 'time' | 'sequence' -- the payload gate
  lanes: [], // [[{item,offsetSeconds,endSeconds,lane}, ...], ...] lanes[0] = backbone
  spanSeconds: 0,
  question: null, // null | {a: item, b: item}
  skipped: [], // names of files silently excluded (disclosed in the gray line)
  proxies: {}, // videoName -> .LRF File, kept client-side for preview
};

export function useFootageIntake() {
  const [state, setState] = useState(INITIAL);
  // Refs hold the canonical persistent state so every gesture (add/remove/drag/
  // override) can recompute through the SAME publish() without racing async
  // probes or losing a prior choice to the next unrelated update.
  const itemsRef = useRef([]);
  const proxiesRef = useRef({});
  const skippedRef = useRef([]);
  const overrideRef = useRef(null); // 'time' | 'sequence' | null (auto)
  const manualNamesRef = useRef(null); // string[] | null

  const publish = useCallback(() => {
    const items = itemsRef.current;
    const proxies = proxiesRef.current;
    const skipped = skippedRef.current;
    const probed = items.filter((it) => !it.probeError); // errors excluded from order
    const { order, confidence, gaps, placement, lanes, spanSeconds, question } = inferPlacement(probed, {
      override: overrideRef.current,
      manualNames: manualNamesRef.current,
    });
    const status = items.length || skipped.length ? 'ready' : 'empty';
    setState({ status, items, order, confidence, gaps, placement, lanes, spanSeconds, question, skipped, proxies });
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
          width: meta.width ?? null,
          height: meta.height ?? null,
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

    itemsRef.current = [...existing, ...additions];
    proxiesRef.current = { ...proxiesRef.current, ...newProxies };
    skippedRef.current = [...skippedRef.current, ...newSkipped];
    publish();
    return { duplicates };
  }, [publish]);

  const removeItem = useCallback((name) => {
    itemsRef.current = itemsRef.current.filter((it) => it.name !== name);
    publish();
  }, [publish]);

  // Drag reorder (lane 0, or the folded single lane once manual — T8824 §4 point
  // 4/6): `names` already carries every currently-visible item, angles included
  // (FootageList appends any angle names after the dragged lane-0 order), so
  // inferPlacement's manual branch can fold them into one sequential lane without
  // this hook knowing anything about lanes itself.
  const setManualOrder = useCallback((names) => {
    manualNamesRef.current = names;
    publish();
  }, [publish]);

  // The one override control (T8824 §4 point 6): explicitly choosing a placement
  // mode is a stronger signal than a prior drag, so it always clears manualNames
  // too — this is what makes "Use the recorded times instead" (after a drag)
  // and "Not two cameras?" / "Were they filmed at the same time?" (never dragged)
  // the same code path.
  const setPlacementMode = useCallback((mode) => {
    overrideRef.current = mode;
    manualNamesRef.current = null;
    publish();
  }, [publish]);

  const reset = useCallback(() => {
    itemsRef.current = [];
    proxiesRef.current = {};
    skippedRef.current = [];
    overrideRef.current = null;
    manualNamesRef.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, addFiles, removeItem, setManualOrder, setPlacementMode, reset };
}
