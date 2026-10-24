/**
 * T13200 - MP4 duration from `mvhd`, streaming.
 *
 * Walks top-level boxes without retaining `mdat` (skips by count), buffers only `moov`.
 * Faststart files finish within the first KB; moov-at-end files need the whole entry
 * inflated but hold at most one `moov` in memory. Durations vary 5-56 s: never assume one.
 */
import { inflateEntry } from './zipReader.js';

const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

function mvhdSeconds(moov) {
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  let p = 8;
  while (p + 8 <= moov.length) {
    const size = v.getUint32(p);
    if (size < 8) break;
    if (fourcc(moov, p + 4) === 'mvhd') {
      const q = p + 8;
      const version = moov[q];
      const timescale = version === 1 ? v.getUint32(q + 20) : v.getUint32(q + 12);
      const duration = version === 1 ? Number(v.getBigUint64(q + 24)) : v.getUint32(q + 16);
      if (!timescale) throw new Error('mvhd has zero timescale');
      return duration / timescale;
    }
    p += size;
  }
  throw new Error('moov has no mvhd');
}

export class Mp4DurationScanner {
  constructor() {
    this.done = false;
    this.duration = null;
    this._head = new Uint8Array(16); // box header accumulator
    this._headLen = 0;
    this._skip = 0;
    this._moov = null; // { buf, len }
  }

  feed(chunk) {
    let i = 0;
    while (i < chunk.length && !this.done) {
      if (this._moov) {
        const take = Math.min(chunk.length - i, this._moov.buf.length - this._moov.len);
        this._moov.buf.set(chunk.subarray(i, i + take), this._moov.len);
        this._moov.len += take;
        i += take;
        if (this._moov.len === this._moov.buf.length) {
          this.duration = mvhdSeconds(this._moov.buf);
          this.done = true;
        }
      } else if (this._skip > 0) {
        const take = Math.min(chunk.length - i, this._skip);
        this._skip -= take;
        i += take;
      } else {
        // need 8 bytes of header (16 if size==1, the 64-bit largesize form)
        const need = this._headLen >= 8 && new DataView(this._head.buffer).getUint32(0) === 1 ? 16 : 8;
        const take = Math.min(chunk.length - i, need - this._headLen);
        this._head.set(chunk.subarray(i, i + take), this._headLen);
        this._headLen += take;
        i += take;
        if (this._headLen < 8) continue;
        const h = new DataView(this._head.buffer);
        const size32 = h.getUint32(0);
        const hdr = size32 === 1 ? 16 : 8;
        if (this._headLen < hdr) continue;
        const size = size32 === 1 ? Number(h.getBigUint64(8)) : size32;
        const type = fourcc(this._head, 4);
        if (size32 === 0) throw new Error(`MP4 box '${type}' extends to end of file; unsupported`);
        this._headLen = 0;
        if (type === 'moov') {
          this._moov = { buf: new Uint8Array(size), len: hdr };
          this._moov.buf.set(this._head.subarray(0, hdr), 0);
          if (size === hdr) throw new Error('empty moov');
        } else {
          this._skip = size - hdr;
        }
      }
    }
  }

  finish() {
    if (!this.done) throw new Error('MP4 ended before a complete moov box');
    return this.duration;
  }
}

/** Duration (seconds) of one mp4 zip entry; stops inflating as soon as moov is read. */
export async function entryDuration(file, entry, onBytes) {
  const scanner = new Mp4DurationScanner();
  await inflateEntry(file, entry, (chunk) => {
    scanner.feed(chunk);
    if (onBytes) onBytes(chunk.length);
    return scanner.done;
  });
  return scanner.finish();
}
