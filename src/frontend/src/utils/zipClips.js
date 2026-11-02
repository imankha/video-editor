/**
 * T13247 - any zip of clips handed to an upload. One shared step at every zip-accepting intake
 * (Add footage, Upload game, Add Clip), before that intake's own handling:
 *
 *   Veo highlights zip  -> `veoZips` (the intake's Veo path, unchanged)
 *   any other zip       -> its video entries, unzipped ONE AT A TIME into Files named by the
 *                          entry's base name, merged with the selection's loose files
 *
 * Every zip that yields nothing, and every entry skipped, gets a line in `messages` (no silent drop).
 * The zip reader comes through the veoHighlights index so component tests can stub it (jsdom's
 * Blob cannot be sliced into bytes).
 */
import { readZipEntries, extractEntry, isVeoHighlightsZip } from './veoHighlights';
import { ZIP_CLIPS } from '../config/displayNames';

// extractEntry inflates a whole entry into memory, so one bigger than this is not unzipped here.
export const ZIP_ENTRY_MAX_BYTES = 2 * 1024 ** 3;

const VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

export const isZipFile = (f) => /\.zip$/i.test(f.name);

const baseName = (path) => path.split('/').pop();

function videoType(entry) {
  if (entry.name.endsWith('/') || entry.name.startsWith('__MACOSX/')) return null;
  const base = baseName(entry.name);
  if (!base || base.startsWith('.')) return null;
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return VIDEO_TYPES[ext] || null;
}

/**
 * @param {File[]} list a raw selection (loose files and zips, any order)
 * @returns {Promise<{files: File[], veoZips: File[], messages: string[]}>} files = the loose
 *   non-zip files first, then each plain zip's videos in entry order
 */
export async function expandClipZips(list, { maxEntryBytes = ZIP_ENTRY_MAX_BYTES } = {}) {
  const files = list.filter((f) => !isZipFile(f));
  const veoZips = [];
  const messages = [];
  for (const zip of list.filter(isZipFile)) {
    let entries;
    try {
      entries = await readZipEntries(zip);
    } catch (err) {
      console.warn('[zipClips] zip not readable:', zip.name, err);
      messages.push(ZIP_CLIPS.unreadable(zip.name));
      continue;
    }
    if (isVeoHighlightsZip(entries)) {
      veoZips.push(zip);
      continue;
    }
    const videos = entries.map((e) => ({ entry: e, type: videoType(e) })).filter((v) => v.type);
    if (!videos.length) {
      messages.push(ZIP_CLIPS.NO_VIDEOS);
      continue;
    }
    for (const { entry, type } of videos) {
      const name = baseName(entry.name);
      if (entry.size > maxEntryBytes) {
        messages.push(ZIP_CLIPS.tooBig(name));
        continue;
      }
      const extracted = await extractEntry(zip, entry, type);
      files.push(new File([extracted], name, { type }));
    }
  }
  return { files, veoZips, messages: [...new Set(messages)] };
}
