/**
 * T13200 test fixture: a minimal MP4 byte builder (ftyp, moov{mvhd}, mdat) so tests need no
 * binary files (the repo .gitignore has `*.mp4`) and no ffmpeg. `faststart` puts moov before
 * mdat; otherwise moov is last. Durations are exact: seconds * timescale (1000).
 */
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s) => [...s].map((c) => c.charCodeAt(0));
const box = (type, body) => [...u32(8 + body.length), ...tag(type), ...body];

export function buildMp4({ durationS, faststart, mdatBytes = 1200 }) {
  const timescale = 1000;
  const mvhd = box('mvhd', [
    0, 0, 0, 0, // version 0 + flags
    ...u32(0), ...u32(0), // creation, modification
    ...u32(timescale), ...u32(Math.round(durationS * timescale)),
    ...new Array(80).fill(0), // rate .. next_track_id
  ]);
  const ftyp = box('ftyp', [...tag('isom'), ...u32(512), ...tag('isom'), ...tag('mp41')]);
  const moov = box('moov', mvhd);
  const free = box('free', []);
  const mdat = box('mdat', new Array(mdatBytes).fill(1));
  return new Uint8Array(faststart ? [...ftyp, ...moov, ...free, ...mdat] : [...ftyp, ...free, ...mdat, ...moov]);
}

// Durations as ffprobe reported them for the original ffmpeg-made fixtures.
export const FASTSTART_S = 3.5;
export const MOOVEND_S = 5.2;
export const faststartMp4 = () => buildMp4({ durationS: FASTSTART_S, faststart: true });
export const moovendMp4 = () => buildMp4({ durationS: MOOVEND_S, faststart: false });
