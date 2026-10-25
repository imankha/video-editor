/**
 * T13200 - Veo highlights name parser. Strict: a name that does not match is reported as
 * skipped, never guessed. Entry name = `{NN} {HHMMSS}_-_{Tag_with_underscores}.mp4`, where
 * HHMMSS is the clip START in the Veo recording timeline (EPIC.md "The format").
 */
const NAME_RE = /^(\d+) (\d{2})(\d{2})(\d{2})_-_(.+)\.mp4$/;
const MARKER = '.veo-zip';
const VEO_THRESHOLD = 0.8;

const baseName = (n) => n.slice(n.lastIndexOf('/') + 1);
const isMp4 = (n) => /\.mp4$/i.test(n);

export function parseVeoName(name) {
  const m = NAME_RE.exec(baseName(name));
  if (!m) return null;
  return {
    index: Number(m[1]),
    stamp_s: Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]),
    label: m[5].replace(/_/g, ' '),
  };
}

/** Accepts zip entries ({name,...}) or loose Files. */
export function isVeoHighlightsZip(entries) {
  if (entries.some((e) => baseName(e.name) === MARKER)) return true;
  const mp4s = entries.filter((e) => isMp4(e.name));
  if (!mp4s.length) return false;
  return mp4s.filter((e) => parseVeoName(e.name)).length / mp4s.length >= VEO_THRESHOLD;
}

/**
 * @returns {{parsed: object[], skipped: object[], ignored: object[]}} parsed = entry fields + {index, stamp_s, label};
 * skipped = mp4 entries whose name did not match (non-mp4 entries such as the `.veo-zip` marker go to `ignored`).
 */
export function parseEntries(entries) {
  const parsed = [];
  const skipped = [];
  const ignored = [];
  for (const e of entries) {
    if (!isMp4(e.name)) { ignored.push({ name: e.name }); continue; }
    const p = parseVeoName(e.name);
    if (p) parsed.push({ name: e.name, crc32: e.crc32, size: e.size, compressedSize: e.compressedSize, ...p });
    else skipped.push({ name: e.name });
  }
  return { parsed, skipped, ignored };
}

/** 1 / 2 / null for "(1st Half)" / "(2nd Half)" / neither in a zip file name. */
export function halfMarker(zipName) {
  const m = /\((1st|2nd) half\)/i.exec(zipName);
  if (!m) return null;
  return m[1].toLowerCase() === '1st' ? 1 : 2;
}
