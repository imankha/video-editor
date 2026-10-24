/**
 * T13200 - Random-access zip reader over a File (no upload, no full read).
 *
 * Why not fflate `Unzip` / zip.js: fflate's Unzip is a forward-only stream and would have to
 * read a 554 MB zip end to end just to list names; the central directory is a few KB at the
 * END of the file. So the directory is parsed here (small, covered by tests incl. ZIP64) and
 * fflate (pinned in package.json) does the DEFLATE inflating.
 *
 * CRC-32 of extracted bytes is not re-verified: the CRC in the directory is used only to
 * detect exact duplicates, and `<video>` / the upload hash catch corrupt media.
 */
import { Inflate } from 'fflate';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const CHUNK = 256 * 1024;

const readBytes = async (file, start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const big = (v) => Number(v);

async function locateDirectory(file) {
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = await readBytes(file, file.size - tailLen, file.size);
  const t = dv(tail);
  let p = tail.length - 22;
  while (p >= 0 && t.getUint32(p, true) !== SIG_EOCD) p--;
  if (p < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  let count = t.getUint16(p + 10, true);
  let size = t.getUint32(p + 12, true);
  let offset = t.getUint32(p + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    if (p < 20 || t.getUint32(p - 20, true) !== SIG_LOC64) throw new Error('Corrupt zip: missing ZIP64 locator');
    const recOffset = big(t.getBigUint64(p - 20 + 8, true));
    const rec = dv(await readBytes(file, recOffset, recOffset + 56));
    if (rec.getUint32(0, true) !== SIG_EOCD64) throw new Error('Corrupt zip: bad ZIP64 end record');
    count = big(rec.getBigUint64(32, true));
    size = big(rec.getBigUint64(40, true));
    offset = big(rec.getBigUint64(48, true));
  }
  return { count, size, offset };
}

/** @returns {Promise<{name:string, crc32:number, size:number, compressedSize:number, method:number, localOffset:number}[]>} */
export async function readZipEntries(file) {
  const { count, size, offset } = await locateDirectory(file);
  const cd = await readBytes(file, offset, offset + size);
  const v = dv(cd);
  const dec = new TextDecoder('utf-8');
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== SIG_CEN) throw new Error('Corrupt zip: bad central directory entry');
    const method = v.getUint16(p + 10, true);
    const crc32 = v.getUint32(p + 16, true);
    let compressedSize = v.getUint32(p + 20, true);
    let usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let localOffset = v.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = v.getUint16(x, true);
      const len = v.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = big(v.getBigUint64(q, true)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = big(v.getBigUint64(q, true)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = big(v.getBigUint64(q, true)); }
      }
      x += 4 + len;
    }
    entries.push({ name, crc32, size: usize, compressedSize, method, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function dataStart(file, entry) {
  const h = dv(await readBytes(file, entry.localOffset, entry.localOffset + 30));
  if (h.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Corrupt zip: bad local header for ${entry.name}`);
  return entry.localOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
}

/**
 * Stream an entry's decompressed bytes to `onChunk(Uint8Array)`. Return `true` from onChunk to
 * stop early (e.g. faststart duration needs only the first KB). Resolves to the number of
 * COMPRESSED bytes consumed.
 */
export async function inflateEntry(file, entry, onChunk) {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported zip method ${entry.method} for ${entry.name}`);
  const start = await dataStart(file, entry);
  const end = start + entry.compressedSize;
  let stopped = false;
  let inflater = null;
  if (entry.method === 8) {
    inflater = new Inflate((chunk) => { if (!stopped && onChunk(chunk)) stopped = true; });
  }
  let pos = start;
  while (pos < end && !stopped) {
    const next = Math.min(pos + CHUNK, end);
    const raw = await readBytes(file, pos, next);
    pos = next;
    if (inflater) inflater.push(raw, pos >= end);
    else if (onChunk(raw)) stopped = true;
  }
  return pos - start;
}

/** Inflate one entry into a File (peak memory = one entry). */
export async function extractEntry(file, entry, type = 'video/mp4') {
  const parts = [];
  await inflateEntry(file, entry, (chunk) => { parts.push(chunk.slice()); });
  return new File(parts, entry.name, { type });
}
