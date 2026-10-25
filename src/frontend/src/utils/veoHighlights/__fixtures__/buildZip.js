// Test helper: builds zips in memory so the reader can be tested without media.
// `zip64: true` writes every size/offset into ZIP64 extra fields + EOCD64 records.
import { deflateSync } from 'fflate';

const enc = new TextEncoder();

function crc32(bytes) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** files: [{name, data: Uint8Array, method?: 0|8}] -> Uint8Array */
export function buildZip(files, { zip64 = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (u8) => { parts.push(u8); offset += u8.length; };
  for (const f of files) {
    const method = f.method ?? 8;
    const body = method === 8 ? deflateSync(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, zip64 ? 0xffffffff : body.length, true);
    local.setUint32(22, zip64 ? 0xffffffff : f.data.length, true);
    local.setUint16(26, name.length, true);
    const localExtra = zip64 ? new Uint8Array(20) : new Uint8Array(0);
    local.setUint16(28, localExtra.length, true);
    const localOffset = offset;
    push(new Uint8Array(local.buffer)); push(name); push(localExtra); push(body);
    central.push({ name, method, crc, csize: body.length, size: f.data.length, localOffset });
  }
  const cdStart = offset;
  for (const c of central) {
    const extra = new DataView(new ArrayBuffer(zip64 ? 28 : 0));
    if (zip64) {
      extra.setUint16(0, 1, true); extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(c.size), true);
      extra.setBigUint64(12, BigInt(c.csize), true);
      extra.setBigUint64(20, BigInt(c.localOffset), true);
    }
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 45, true); h.setUint16(6, 45, true);
    h.setUint16(10, c.method, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, zip64 ? 0xffffffff : c.csize, true);
    h.setUint32(24, zip64 ? 0xffffffff : c.size, true);
    h.setUint16(28, c.name.length, true);
    h.setUint16(30, extra.byteLength, true);
    h.setUint32(42, zip64 ? 0xffffffff : c.localOffset, true);
    push(new Uint8Array(h.buffer)); push(c.name); push(new Uint8Array(extra.buffer));
  }
  const cdSize = offset - cdStart;
  if (zip64) {
    const rec = new DataView(new ArrayBuffer(56));
    rec.setUint32(0, 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);
    rec.setUint16(12, 45, true); rec.setUint16(14, 45, true);
    rec.setBigUint64(24, BigInt(central.length), true);
    rec.setBigUint64(32, BigInt(central.length), true);
    rec.setBigUint64(40, BigInt(cdSize), true);
    rec.setBigUint64(48, BigInt(cdStart), true);
    const recOffset = offset;
    push(new Uint8Array(rec.buffer));
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(recOffset), true);
    loc.setUint32(16, 1, true);
    push(new Uint8Array(loc.buffer));
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, zip64 ? 0xffff : central.length, true);
  eocd.setUint16(10, zip64 ? 0xffff : central.length, true);
  eocd.setUint32(12, zip64 ? 0xffffffff : cdSize, true);
  eocd.setUint32(16, zip64 ? 0xffffffff : cdStart, true);
  push(new Uint8Array(eocd.buffer));
  const out = new Uint8Array(offset);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
