#!/usr/bin/env node
/**
 * Apply MP4 faststart to a file on disk using Node fs streams.
 * Mirrors the algorithm in src/frontend/src/utils/mp4Faststart.js,
 * adapted to Node (no File/Blob APIs).
 *
 * Usage: node scripts/apply-faststart.js <input.mp4> <output.mp4>
 */
const fs = require('fs');
const path = require('path');

const BOX_HEADER_SIZE = 8;
const EXTENDED_HEADER_SIZE = 16;

function readUint32BE(buf, off) { return buf.readUInt32BE(off); }
function readType(buf, off) { return buf.slice(off, off + 4).toString('ascii'); }

function readRangeSync(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, offset + read);
    if (n === 0) break;
    read += n;
  }
  return buf.slice(0, read);
}

function scanTopLevelBoxes(fd, fileSize) {
  const boxes = [];
  let offset = 0;
  while (offset < fileSize) {
    const remaining = fileSize - offset;
    if (remaining < BOX_HEADER_SIZE) break;
    const header = readRangeSync(fd, offset, Math.min(EXTENDED_HEADER_SIZE, remaining));
    let size = readUint32BE(header, 0);
    const type = readType(header, 4);
    if (size === 1 && header.length >= EXTENDED_HEADER_SIZE) {
      const hi = readUint32BE(header, 8);
      const lo = readUint32BE(header, 12);
      size = hi * 0x100000000 + lo;
    }
    if (size === 0) size = fileSize - offset;
    if (size < BOX_HEADER_SIZE) break;
    boxes.push({ type, offset, size });
    offset += size;
  }
  return boxes;
}

function patchChunkOffsets(moovBuf, delta) {
  function walk(start, end) {
    let off = start;
    while (off < end - BOX_HEADER_SIZE) {
      let size = readUint32BE(moovBuf, off);
      const type = readType(moovBuf, off + 4);
      if (size === 1 && off + EXTENDED_HEADER_SIZE <= end) {
        const hi = readUint32BE(moovBuf, off + 8);
        const lo = readUint32BE(moovBuf, off + 12);
        size = hi * 0x100000000 + lo;
      }
      if (size === 0) size = end - off;
      if (size < BOX_HEADER_SIZE || off + size > end) break;
      const headerLen = (readUint32BE(moovBuf, off) === 1) ? EXTENDED_HEADER_SIZE : BOX_HEADER_SIZE;
      const payloadStart = off + headerLen;

      if (type === 'stco') {
        const entryCount = readUint32BE(moovBuf, payloadStart + 4);
        for (let i = 0; i < entryCount; i++) {
          const eo = payloadStart + 8 + i * 4;
          const oldVal = readUint32BE(moovBuf, eo);
          const newVal = oldVal + delta;
          if (newVal > 0xFFFFFFFF) throw new Error(`stco overflow: ${oldVal}+${delta}>4GB`);
          moovBuf.writeUInt32BE(newVal, eo);
        }
      } else if (type === 'co64') {
        const entryCount = readUint32BE(moovBuf, payloadStart + 4);
        for (let i = 0; i < entryCount; i++) {
          const eo = payloadStart + 8 + i * 8;
          const hi = readUint32BE(moovBuf, eo);
          const lo = readUint32BE(moovBuf, eo + 4);
          let newLo = lo + delta;
          let newHi = hi;
          if (newLo > 0xFFFFFFFF) {
            newHi += Math.floor(newLo / 0x100000000);
            newLo = newLo >>> 0;
          }
          moovBuf.writeUInt32BE(newHi, eo);
          moovBuf.writeUInt32BE(newLo, eo + 4);
        }
      } else if (['trak','mdia','minf','stbl','moov','edts','udta','dinf'].includes(type)) {
        walk(payloadStart, off + size);
      }
      off += size;
    }
  }
  walk(BOX_HEADER_SIZE, moovBuf.length);
}

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('Usage: node apply-faststart.js <input.mp4> <output.mp4>');
    process.exit(1);
  }
  const t0 = Date.now();
  const stat = fs.statSync(input);
  const fileSize = stat.size;
  console.log(`Input: ${input} (${fileSize.toLocaleString()} bytes)`);

  const fd = fs.openSync(input, 'r');
  const boxes = scanTopLevelBoxes(fd, fileSize);
  console.log(`Boxes:`, boxes.map(b => `${b.type}@${b.offset}(${b.size})`).join(' '));

  const ftyp = boxes.find(b => b.type === 'ftyp');
  const moov = boxes.find(b => b.type === 'moov');
  const mdat = boxes.find(b => b.type === 'mdat');
  const hasMoof = boxes.some(b => b.type === 'moof');
  if (!ftyp || !moov || !mdat || hasMoof) throw new Error('Not relocatable');
  if (moov.offset < mdat.offset) {
    console.log('moov already at start — copying unchanged.');
    fs.closeSync(fd);
    fs.copyFileSync(input, output);
    return;
  }

  console.log(`Reading moov (${moov.size.toLocaleString()} bytes)...`);
  const moovBuf = readRangeSync(fd, moov.offset, moov.size);
  console.log('Patching chunk offsets...');
  patchChunkOffsets(moovBuf, moov.size);

  const mdatRegionStart = ftyp.offset + ftyp.size;
  const mdatRegionEnd = moov.offset;
  const mdatRegionSize = mdatRegionEnd - mdatRegionStart;

  console.log(`Writing output: ftyp(${ftyp.size}) + moov(${moov.size}) + mdatRegion(${mdatRegionSize.toLocaleString()})`);
  const outFd = fs.openSync(output, 'w');

  // ftyp
  const ftypBuf = readRangeSync(fd, ftyp.offset, ftyp.size);
  fs.writeSync(outFd, ftypBuf, 0, ftyp.size, 0);

  // patched moov
  fs.writeSync(outFd, moovBuf, 0, moov.size, ftyp.size);

  // mdat region — stream copy in 16MB chunks
  const CHUNK = 16 * 1024 * 1024;
  let remaining = mdatRegionSize;
  let srcOff = mdatRegionStart;
  let dstOff = ftyp.size + moov.size;
  const chunkBuf = Buffer.alloc(CHUNK);
  let lastPct = -1;
  while (remaining > 0) {
    const n = Math.min(CHUNK, remaining);
    const read = fs.readSync(fd, chunkBuf, 0, n, srcOff);
    if (read === 0) break;
    fs.writeSync(outFd, chunkBuf, 0, read, dstOff);
    srcOff += read;
    dstOff += read;
    remaining -= read;
    const pct = Math.floor((mdatRegionSize - remaining) * 100 / mdatRegionSize);
    if (pct !== lastPct && pct % 5 === 0) {
      process.stdout.write(`\r  mdat copy: ${pct}%`);
      lastPct = pct;
    }
  }
  process.stdout.write('\n');
  fs.closeSync(fd);
  fs.closeSync(outFd);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s → ${output}`);
}

main().catch(e => { console.error(e); process.exit(1); });
