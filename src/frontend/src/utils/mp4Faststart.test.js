/**
 * Tests for MP4 Faststart utility (T1380)
 */
import { describe, it, expect } from 'vitest';
import { analyzeMp4Faststart, getReorderedSlice } from './mp4Faststart';

/**
 * Build a minimal MP4 file as a File object.
 * Each box: [4-byte size][4-byte type][payload]
 */
function buildMp4File(boxes) {
  const parts = [];
  for (const { type, payload } of boxes) {
    const size = 8 + (payload ? payload.byteLength : 0);
    const header = new ArrayBuffer(8);
    const view = new DataView(header);
    view.setUint32(0, size, false);
    // Write type as 4 ASCII chars
    for (let i = 0; i < 4; i++) {
      view.setUint8(4 + i, type.charCodeAt(i));
    }
    parts.push(new Blob([header]));
    if (payload) parts.push(new Blob([payload]));
  }
  const blob = new Blob(parts, { type: 'video/mp4' });
  return new File([blob], 'test.mp4', { type: 'video/mp4' });
}

/**
 * Build a moov box containing a single stco with the given offsets.
 * Structure: moov > trak > mdia > minf > stbl > stco
 */
function buildMoovWithStco(offsets) {
  // stco: version(1) + flags(3) + entry_count(4) + entries(4 each)
  const stcoPayload = new ArrayBuffer(4 + 4 + offsets.length * 4);
  const stcoView = new DataView(stcoPayload);
  stcoView.setUint32(0, 0, false); // version + flags
  stcoView.setUint32(4, offsets.length, false); // entry count
  offsets.forEach((offset, i) => {
    stcoView.setUint32(8 + i * 4, offset, false);
  });
  const stcoBox = wrapBox('stco', stcoPayload);

  // Nest: stbl > stco
  const stblBox = wrapBox('stbl', stcoBox);
  const minfBox = wrapBox('minf', stblBox);
  const mdiaBox = wrapBox('mdia', minfBox);
  const trakBox = wrapBox('trak', mdiaBox);
  const moovBox = wrapBox('moov', trakBox);

  return moovBox;
}

/**
 * Wrap payload in an MP4 box with the given type.
 */
function wrapBox(type, payload) {
  const payloadBytes = payload instanceof ArrayBuffer ? payload : payload;
  const payloadBuf = payload instanceof ArrayBuffer
    ? new Uint8Array(payload)
    : new Uint8Array(payload);
  const size = 8 + payloadBuf.byteLength;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint32(0, size, false);
  for (let i = 0; i < 4; i++) {
    view.setUint8(4 + i, type.charCodeAt(i));
  }
  new Uint8Array(buf).set(payloadBuf, 8);
  return buf;
}

function readUint32(buffer, offset) {
  return new DataView(buffer).getUint32(offset, false);
}

describe('analyzeMp4Faststart', () => {
  it('skips files smaller than 1MB', async () => {
    const smallFile = new File([new ArrayBuffer(100)], 'tiny.mp4');
    const result = await analyzeMp4Faststart(smallFile);
    expect(result.needsRelocation).toBe(false);
  });

  it('detects moov already at start (no relocation needed)', async () => {
    const ftypPayload = new ArrayBuffer(12); // ftyp with some data
    const moovData = buildMoovWithStco([1000, 2000, 3000]);
    // mdat big enough to push total over 1MB
    const mdatPayload = new ArrayBuffer(1024 * 1024);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) }, // skip outer moov header (buildMp4File adds its own)
    ]);

    // This file is too small (<1MB), so let's make a bigger one
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);
    const bigFile = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
      { type: 'mdat', payload: bigMdat },
    ]);

    const result = await analyzeMp4Faststart(bigFile);
    expect(result.needsRelocation).toBe(false);
    expect(result.moovOffset).toBeLessThan(result.mdatOffset);
  });

  it('detects moov at end (needs relocation)', async () => {
    const ftypPayload = new ArrayBuffer(12);
    const moovData = buildMoovWithStco([1000, 2000]);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'mdat', payload: bigMdat },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
    ]);

    const result = await analyzeMp4Faststart(file);
    expect(result.needsRelocation).toBe(true);
    expect(result.patchedMoov).toBeInstanceOf(ArrayBuffer);
    expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('patches stco offsets by moov size', async () => {
    const originalOffsets = [100, 500, 1000];
    const moovData = buildMoovWithStco(originalOffsets);
    const moovSize = moovData.byteLength;
    const ftypPayload = new ArrayBuffer(12);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'mdat', payload: bigMdat },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
    ]);

    const result = await analyzeMp4Faststart(file);
    expect(result.needsRelocation).toBe(true);

    // Find stco in the patched moov and verify offsets are shifted
    // The moov structure: moov(8) > trak(8) > mdia(8) > minf(8) > stbl(8) > stco(8+payload)
    // stco payload starts at: 8 + 8 + 8 + 8 + 8 + 8 = 48 bytes into moov
    // stco fullbox: version(4) + entry_count(4) + entries
    const patchedView = new DataView(result.patchedMoov);
    // Navigate to stco entries: skip 5 container headers (8 each) + stco header (8) + version(4) + count(4)
    const stcoEntriesOffset = 6 * 8 + 4 + 4; // 56

    for (let i = 0; i < originalOffsets.length; i++) {
      const patchedOffset = readUint32(result.patchedMoov, stcoEntriesOffset + i * 4);
      expect(patchedOffset).toBe(originalOffsets[i] + moovSize);
    }
  });

  it('skips fragmented MP4 (moof present)', async () => {
    const ftypPayload = new ArrayBuffer(12);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'moof', payload: new ArrayBuffer(20) },
      { type: 'mdat', payload: bigMdat },
    ]);

    const result = await analyzeMp4Faststart(file);
    expect(result.needsRelocation).toBe(false);
  });

  it('newSize equals originalSize when moov moves (no bytes added/removed)', async () => {
    const ftypPayload = new ArrayBuffer(12);
    const moovData = buildMoovWithStco([1000, 2000]);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'mdat', payload: bigMdat },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
    ]);

    const result = await analyzeMp4Faststart(file);
    expect(result.newSize).toBe(result.originalSize);
  });
});

describe('getReorderedSlice', () => {
  it('maps byte ranges correctly across all three regions', async () => {
    const ftypPayload = new ArrayBuffer(12);
    const moovData = buildMoovWithStco([1000]);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'mdat', payload: bigMdat },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
    ]);

    const info = await analyzeMp4Faststart(file);
    expect(info.needsRelocation).toBe(true);

    // Full file slice should equal newSize
    const fullBlob = getReorderedSlice(file, info, 0, info.newSize);
    expect(fullBlob.size).toBe(info.newSize);

    // First ftypSize bytes should be ftyp region
    const ftypBlob = getReorderedSlice(file, info, 0, info.ftypSize);
    expect(ftypBlob.size).toBe(info.ftypSize);

    // Moov region
    const moovBlob = getReorderedSlice(file, info, info.ftypSize, info.ftypSize + info.patchedMoov.byteLength);
    expect(moovBlob.size).toBe(info.patchedMoov.byteLength);
  });

  it('handles slices spanning region boundaries', async () => {
    const ftypPayload = new ArrayBuffer(12);
    const moovData = buildMoovWithStco([1000]);
    const bigMdat = new ArrayBuffer(1024 * 1024 + 100);

    const file = buildMp4File([
      { type: 'ftyp', payload: ftypPayload },
      { type: 'mdat', payload: bigMdat },
      { type: 'moov', payload: new Uint8Array(moovData).slice(8) },
    ]);

    const info = await analyzeMp4Faststart(file);

    // Slice spanning ftyp and moov
    const spanBlob = getReorderedSlice(file, info, info.ftypSize - 4, info.ftypSize + 4);
    expect(spanBlob.size).toBe(8);

    // Slice spanning moov and mdat
    const moovEnd = info.ftypSize + info.patchedMoov.byteLength;
    const spanBlob2 = getReorderedSlice(file, info, moovEnd - 4, moovEnd + 4);
    expect(spanBlob2.size).toBe(8);
  });
});
