import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/shared/Button';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';
import {
  readZipEntries, isVeoHighlightsZip, parseEntries, readDurations, withDurations,
  mergeMoments, halfMarker,
} from '../../../utils/veoHighlights';

const PLURAL_STEM = { Goal: 'goal', 'Shot on goal': 'shot', Attack: 'attack', Defence: 'defence', Highlight: 'highlight' };

/** "4 goals, 27 shots, 3 attacks, 1 highlight" from each moment's primary (display-first) label. */
export function summarizeMoments(moments) {
  const counts = new Map();
  for (const m of moments) counts.set(m.labels[0], (counts.get(m.labels[0]) || 0) + 1);
  return [...counts.entries()]
    .map(([label, n]) => {
      const stem = PLURAL_STEM[label] ?? label.toLowerCase();
      return `${n} ${n === 1 ? stem : `${stem}s`}`;
    })
    .join(', ');
}

/** Moments -> the T13210 import body (the video's own timeline: start = stamp, end = stamp + clip length). */
export function toImportMoments(moments) {
  return moments.map((m) => ({ start: m.stamp_s, end: m.stamp_s + m.duration_s, labels: m.labels }));
}

/**
 * T13220: the import sheet (no backdrop close). Reads the zip locally with T13200 (nothing is
 * uploaded), shows the moment summary, asks which video the stamps belong to when the game has
 * 2+ videos (preselecting the `(1st Half)` / `(2nd Half)` match), and ONE tap on Import calls
 * `onImport(videoSequence, importMoments)` (-> one POST).
 *
 * @param {{zipFile: File, videos: {sequence:number,name:string}[], onImport: Function, onClose: Function}} props
 */
export function VeoImportSheet({ zipFile, videos, onImport, onClose }) {
  const [state, setState] = useState({ status: 'reading', progress: null });
  const [moments, setMoments] = useState([]);
  const [sequence, setSequence] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const entries = await readZipEntries(zipFile);
        if (!isVeoHighlightsZip(entries)) {
          setState({ status: 'error', message: T.NOT_VEO });
          return;
        }
        const { parsed } = parseEntries(entries);
        const wanted = new Set(parsed.map((p) => p.name));
        const durations = await readDurations(zipFile, entries.filter((e) => wanted.has(e.name)), {
          signal: controller.signal,
          onProgress: (done, total) => setState({ status: 'reading', progress: { done, total } }),
        });
        setMoments(mergeMoments(withDurations(parsed, durations)).moments);
        setState({ status: 'ready' });
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[VeoImportSheet] read failed:', err);
        setState({ status: 'error', message: T.READ_FAILED });
      }
    })();
    return () => controller.abort();
  }, [zipFile]);

  // The half marker in the zip name preselects its video; one video needs no question.
  const defaultSequence = useMemo(() => {
    if (videos.length === 1) return videos[0].sequence;
    const half = halfMarker(zipFile.name);
    return half && videos.some((v) => v.sequence === half) ? half : null;
  }, [videos, zipFile]);
  const chosen = sequence ?? defaultSequence;

  const handleImport = async () => {
    setBusy(true);
    setImportError(false);
    try {
      await onImport(chosen, toImportMoments(moments));
    } catch (err) {
      console.error('[VeoImportSheet] import failed:', err);
      setImportError(true);
      setBusy(false);
    }
  };

  const ready = state.status === 'ready';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="veo-import-title"
        data-testid="veo-import-sheet"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700"
      >
        <h2 id="veo-import-title" className="text-lg font-semibold text-white p-5 border-b border-gray-700">{T.SHEET_TITLE}</h2>
        <div className="p-5 space-y-4">
          {state.status === 'reading' && (
            <div data-testid="veo-import-reading">
              <p className="text-sm text-gray-300">{T.reading(state.progress?.done ?? 0, state.progress?.total ?? 0)}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full bg-fuchsia-500 transition-[width] duration-200"
                  style={{ width: `${state.progress ? Math.round((100 * state.progress.done) / state.progress.total) : 0}%` }}
                />
              </div>
            </div>
          )}
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-300" data-testid="veo-import-error">{state.message}</p>
          )}
          {ready && (
            <>
              <p className="text-sm text-gray-100" data-testid="veo-import-summary">
                {T.summary(moments.length, summarizeMoments(moments))}
              </p>
              {videos.length > 1 && (
                <fieldset>
                  <legend className="text-sm text-gray-300 mb-1">{T.WHICH_VIDEO}</legend>
                  {videos.map((v) => (
                    <label key={v.sequence} className="flex items-center gap-3 min-h-11 text-sm text-gray-100 cursor-pointer">
                      <input
                        type="radio"
                        name="veo-video"
                        checked={chosen === v.sequence}
                        onChange={() => setSequence(v.sequence)}
                      />
                      <span>{v.name || T.videoOption(v.sequence)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {importError && <p role="alert" className="text-sm text-red-300">{T.IMPORT_FAILED}</p>}
            </>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>{T.CANCEL}</Button>
          {ready && (
            <Button
              variant="success"
              size="md"
              data-testid="veo-import-submit"
              disabled={busy || chosen == null || moments.length === 0}
              onClick={handleImport}
            >
              {busy ? T.IMPORTING : T.IMPORT}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default VeoImportSheet;
