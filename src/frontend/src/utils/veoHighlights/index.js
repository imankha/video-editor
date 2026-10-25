/**
 * T13200 - Veo highlights zip -> moments (client only, nothing uploaded).
 *
 *   const entries = await readZipEntries(zipFile);
 *   if (!isVeoHighlightsZip(entries)) ...
 *   const { parsed, skipped } = parseEntries(entries);
 *   const durations = await readDurations(zipFile, entries, { onProgress });  // worker
 *   const { moments } = mergeMoments(withDurations(parsed, durations));
 *   const clip = await extractEntry(zipFile, entry);      // Path B only
 *
 * Loose mp4s (a `File[]`) parse with `parseEntries`; their durations come from
 * `entryDuration`-equivalent reads of the files themselves (T13230).
 */
export { readZipEntries, extractEntry } from './zipReader.js';
export { parseVeoName, parseEntries, isVeoHighlightsZip, halfMarker } from './parser.js';
export { mergeMoments } from './merge.js';
export { formatStamp, clipMetaForMoment, veoGameNaming, clipMetaForLooseFile, filterChips } from './clipImport.js';
export { readDurations, withDurations } from './readDurations.js';
export { zipOpponent, minGameLengthS, rankCandidateGames } from './routing.js';
export { inspectVeoZip } from './inspectZip.js';
