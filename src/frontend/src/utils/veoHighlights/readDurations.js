/** T13200 - main-thread wrapper around durationWorker.js. */

/**
 * @param {File} file the zip
 * @param {object[]} entries zip entries (from readZipEntries) to read
 * @param {{onProgress?: (done:number,total:number)=>void, signal?: AbortSignal}} [opts]
 * @returns {Promise<Record<string, number>>} seconds by entry name
 */
export function readDurations(file, entries, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./durationWorker.js', import.meta.url), { type: 'module' });
    const finish = (fn, v) => { signal?.removeEventListener('abort', onAbort); worker.terminate(); fn(v); };
    const onAbort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.done, data.total);
      else if (data.type === 'done') finish(resolve, data.durations);
      else finish(reject, new Error(`Could not read ${data.name}: ${data.message}`));
    };
    worker.onerror = (e) => finish(reject, new Error(e.message || 'Duration worker failed'));
    worker.postMessage({ file, entries });
  });
}

/** Attach `durationS` to parsed entries; throws if one is missing (no fallback). */
export function withDurations(parsed, durations) {
  return parsed.map((p) => {
    const d = durations[p.name];
    if (!(d > 0)) throw new Error(`No duration read for ${p.name}`);
    return { ...p, durationS: d };
  });
}
