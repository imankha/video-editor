import { readZipEntries } from './zipReader.js';
import { isVeoHighlightsZip, parseEntries } from './parser.js';
import { readDurations } from './readDurations.js';

/**
 * T13240 - cheap intake probe for a dropped zip. Reads only the central directory plus the
 * LAST moment's clip length (not every entry), which is all game matching needs.
 * @returns {Promise<null | {minLengthS:number}>} null when it is not a Veo highlights zip
 */
export async function inspectVeoZip(file) {
  const entries = await readZipEntries(file);
  if (!isVeoHighlightsZip(entries)) return null;
  const { parsed } = parseEntries(entries);
  if (!parsed.length) return null;
  const last = parsed.reduce((a, b) => (b.stamp_s > a.stamp_s ? b : a));
  const durations = await readDurations(file, entries.filter((e) => e.name === last.name));
  const d = durations[last.name];
  if (!(d > 0)) throw new Error(`No duration read for ${last.name}`);
  return { minLengthS: last.stamp_s + d };
}
