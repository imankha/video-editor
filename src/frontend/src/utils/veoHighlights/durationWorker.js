/**
 * T13200 - Web Worker: reads every entry's duration off the main thread.
 * In:  { file: File, entries: zipEntry[] }
 * Out: { type:'progress', done, total } per entry, then { type:'done', durations:{[name]:seconds} }
 *      or { type:'error', name, message } (first failure aborts: no guessed durations).
 */
import { entryDuration } from './mp4Duration.js';

self.onmessage = async ({ data: { file, entries } }) => {
  const durations = {};
  let name = null;
  try {
    for (let i = 0; i < entries.length; i++) {
      name = entries[i].name;
      durations[name] = await entryDuration(file, entries[i]);
      self.postMessage({ type: 'progress', done: i + 1, total: entries.length });
    }
    self.postMessage({ type: 'done', durations });
  } catch (err) {
    self.postMessage({ type: 'error', name, message: err.message });
  }
};
