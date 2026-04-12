/**
 * MP4 Faststart — Client-side moov atom relocation (T1380)
 *
 * Moves the moov atom from the end of an MP4 file to the beginning,
 * enabling instant seek indexing on playback. Operates entirely in
 * the browser using File.slice() — no server, no cost.
 *
 * Memory: ~2MB (moov buffer only; mdat streams via File.slice())
 * Speed: <1s for 3GB files
 */

const BOX_HEADER_SIZE = 8;
const EXTENDED_HEADER_SIZE = 16;

/**
 * Read a 4-byte big-endian uint from a DataView.
 */
function readUint32(view, offset) {
  return view.getUint32(offset, false);
}

/**
 * Read a 4-character box type string from a DataView.
 */
function readBoxType(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Read bytes from a File at a given offset.
 * @param {File} file
 * @param {number} offset
 * @param {number} length
 * @returns {Promise<ArrayBuffer>}
 */
async function readFileRange(file, offset, length) {
  const slice = file.slice(offset, offset + length);
  // Use FileReader for jsdom compatibility (Blob.arrayBuffer() not available in all environments)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Scan top-level MP4 boxes to find ftyp, moov, and mdat positions.
 * Reads only box headers (8-16 bytes each), not payloads.
 *
 * @param {File} file
 * @returns {Promise<Array<{type: string, offset: number, size: number}>>}
 */
async function scanTopLevelBoxes(file) {
  const boxes = [];
  let offset = 0;

  while (offset < file.size) {
    // Need at least 8 bytes for a box header
    const remaining = file.size - offset;
    if (remaining < BOX_HEADER_SIZE) break;

    const headerBuf = await readFileRange(file, offset, Math.min(EXTENDED_HEADER_SIZE, remaining));
    const view = new DataView(headerBuf);

    let size = readUint32(view, 0);
    const type = readBoxType(view, 4);

    // Extended size (64-bit) when size field is 1
    if (size === 1 && headerBuf.byteLength >= EXTENDED_HEADER_SIZE) {
      const hi = readUint32(view, 8);
      const lo = readUint32(view, 12);
      size = hi * 0x100000000 + lo;
    }

    // size 0 means "rest of file"
    if (size === 0) {
      size = file.size - offset;
    }

    if (size < BOX_HEADER_SIZE) break; // Invalid box

    boxes.push({ type, offset, size });
    offset += size;
  }

  return boxes;
}

/**
 * Recursively patch stco and co64 chunk offset tables in a moov buffer.
 * Adds `delta` to every chunk offset so mdat references remain valid
 * after moov is moved before mdat.
 *
 * @param {ArrayBuffer} moovBuffer - The moov atom data
 * @param {number} delta - Bytes to add to each offset (= moov size)
 */
function patchChunkOffsets(moovBuffer, delta) {
  const view = new DataView(moovBuffer);

  function walkBoxes(start, end) {
    let offset = start;

    while (offset < end - BOX_HEADER_SIZE) {
      let size = readUint32(view, offset);
      const type = readBoxType(view, offset + 4);

      if (size === 1 && offset + EXTENDED_HEADER_SIZE <= end) {
        const hi = readUint32(view, offset + 8);
        const lo = readUint32(view, offset + 12);
        size = hi * 0x100000000 + lo;
      }

      if (size === 0) size = end - offset;
      if (size < BOX_HEADER_SIZE || offset + size > end) break;

      const headerLen = (readUint32(view, offset) === 1) ? EXTENDED_HEADER_SIZE : BOX_HEADER_SIZE;
      const payloadStart = offset + headerLen;

      if (type === 'stco') {
        // stco: version(1) + flags(3) + entry_count(4) + entries(4 each)
        const fullboxStart = payloadStart;
        const entryCount = readUint32(view, fullboxStart + 4);

        for (let i = 0; i < entryCount; i++) {
          const entryOffset = fullboxStart + 8 + i * 4;
          const oldVal = readUint32(view, entryOffset);
          const newVal = oldVal + delta;

          // Check for 32-bit overflow
          if (newVal > 0xFFFFFFFF) {
            throw new Error(
              `stco offset overflow: ${oldVal} + ${delta} > 4GB. ` +
              `File needs co64 upgrade (not yet supported).`
            );
          }

          view.setUint32(entryOffset, newVal, false);
        }
      } else if (type === 'co64') {
        // co64: version(1) + flags(3) + entry_count(4) + entries(8 each)
        const fullboxStart = payloadStart;
        const entryCount = readUint32(view, fullboxStart + 4);

        for (let i = 0; i < entryCount; i++) {
          const entryOffset = fullboxStart + 8 + i * 8;
          const hi = readUint32(view, entryOffset);
          const lo = readUint32(view, entryOffset + 4);

          // 64-bit addition via two 32-bit ops
          let newLo = lo + delta;
          let newHi = hi;
          if (newLo > 0xFFFFFFFF) {
            newHi += Math.floor(newLo / 0x100000000);
            newLo = newLo >>> 0;
          }

          view.setUint32(entryOffset, newHi, false);
          view.setUint32(entryOffset + 4, newLo, false);
        }
      } else if (type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl' ||
                 type === 'moov' || type === 'edts' || type === 'udta' || type === 'dinf') {
        // Container boxes — recurse into children
        walkBoxes(payloadStart, offset + size);
      }

      offset += size;
    }
  }

  // Start after the moov box header itself (8 bytes for type+size)
  walkBoxes(BOX_HEADER_SIZE, moovBuffer.byteLength);
}

/**
 * Analyze an MP4 file and prepare faststart info.
 * Does NOT create a new file — returns metadata for the upload pipeline
 * to reorder slices during upload.
 *
 * @param {File} file - MP4 file to analyze
 * @returns {Promise<FaststartInfo>}
 */
export async function analyzeMp4Faststart(file) {
  const result = {
    needsRelocation: false,
    originalSize: file.size,
    newSize: file.size,
    ftypOffset: 0,
    ftypSize: 0,
    moovOffset: 0,
    moovSize: 0,
    mdatOffset: 0,
    mdatSize: 0,
    patchedMoov: null,
    analysisTimeMs: 0,
  };

  const startTime = performance.now();
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

  // Skip tiny files
  if (file.size < 1024 * 1024) {
    result.analysisTimeMs = Math.round(performance.now() - startTime);
    console.log(`[Faststart] skip reason=tiny-file size=${sizeMB}MB analysis=${result.analysisTimeMs}ms`);
    return result;
  }

  const boxes = await scanTopLevelBoxes(file);
  const boxSummary = boxes.map(b => `${b.type}@${b.offset}(${b.size})`).join(' ');

  // Find key boxes
  let ftyp = null;
  let moov = null;
  let mdat = null;
  let hasMoof = false;

  for (const box of boxes) {
    if (box.type === 'ftyp') ftyp = box;
    else if (box.type === 'moov') moov = box;
    else if (box.type === 'mdat' && !mdat) mdat = box; // First mdat
    else if (box.type === 'moof') hasMoof = true;
  }

  // Can't relocate fragmented MP4 or missing atoms
  if (!ftyp || !moov || !mdat || hasMoof) {
    result.analysisTimeMs = Math.round(performance.now() - startTime);
    const reason = hasMoof ? 'fragmented-mp4' : (!ftyp ? 'no-ftyp' : !moov ? 'no-moov' : 'no-mdat');
    console.log(`[Faststart] skip reason=${reason} size=${sizeMB}MB boxes=[${boxSummary}] analysis=${result.analysisTimeMs}ms`);
    return result;
  }

  result.ftypOffset = ftyp.offset;
  result.ftypSize = ftyp.size;
  result.moovOffset = moov.offset;
  result.moovSize = moov.size;
  result.mdatOffset = mdat.offset;
  result.mdatSize = mdat.size;

  // Check if moov is already before mdat — no relocation needed
  if (moov.offset < mdat.offset) {
    result.analysisTimeMs = Math.round(performance.now() - startTime);
    console.log(`[Faststart] skip reason=already-faststart size=${sizeMB}MB moov@${moov.offset} mdat@${mdat.offset} moovSize=${(moov.size/1024).toFixed(0)}KB analysis=${result.analysisTimeMs}ms`);
    return result;
  }

  // Moov is after mdat — needs relocation
  result.needsRelocation = true;

  // New layout: ftyp + moov + mdat (+ any other boxes after mdat, before moov)
  // For simplicity, we handle: ftyp...mdat...moov (the common case)
  // The new file size is: ftypSize + moovSize + mdatSize
  // Any small boxes between ftyp and mdat (like 'free') are included in the mdat region
  const mdatRegionStart = ftyp.offset + ftyp.size; // Everything after ftyp
  const mdatRegionEnd = moov.offset; // Up to moov
  const mdatRegionSize = mdatRegionEnd - mdatRegionStart;

  result.newSize = ftyp.size + moov.size + mdatRegionSize;

  // Read and patch the moov atom
  const moovBuffer = await readFileRange(file, moov.offset, moov.size);

  // Delta = how far mdat shifts right (moov is inserted before it)
  const delta = moov.size;
  patchChunkOffsets(moovBuffer, delta);

  result.patchedMoov = moovBuffer;
  result.mdatOffset = mdatRegionStart; // The start of the mdat region in the original file
  result.mdatSize = mdatRegionSize;
  result.analysisTimeMs = Math.round(performance.now() - startTime);

  console.log(
    `[Faststart] relocating size=${sizeMB}MB moov@${moov.offset}→32 mdat@${mdat.offset} ` +
    `moovSize=${(moov.size/1024).toFixed(0)}KB delta=${delta} ` +
    `newSize=${result.newSize} (same=${result.newSize === file.size}) analysis=${result.analysisTimeMs}ms`
  );
  return result;
}

/**
 * Get a Blob slice from the reordered layout.
 * Maps logical byte ranges in the new file to source data.
 *
 * New layout:
 *   [0 .. ftypSize-1]                              → original ftyp
 *   [ftypSize .. ftypSize+moovSize-1]               → patched moov buffer
 *   [ftypSize+moovSize .. newSize-1]                → original mdat region
 *
 * @param {File} file - Original file
 * @param {object} info - FaststartInfo from analyzeMp4Faststart
 * @param {number} start - Logical start byte (inclusive)
 * @param {number} end - Logical end byte (exclusive)
 * @returns {Blob}
 */
export function getReorderedSlice(file, info, start, end) {
  const ftypEnd = info.ftypSize;
  const moovEnd = ftypEnd + info.patchedMoov.byteLength;
  const parts = [];

  // Region 1: ftyp (from original file)
  if (start < ftypEnd) {
    const regionStart = info.ftypOffset + start;
    const regionEnd = info.ftypOffset + Math.min(end, ftypEnd);
    parts.push(file.slice(regionStart, regionEnd));
  }

  // Region 2: patched moov (from ArrayBuffer)
  if (start < moovEnd && end > ftypEnd) {
    const bufStart = Math.max(0, start - ftypEnd);
    const bufEnd = Math.min(info.patchedMoov.byteLength, end - ftypEnd);
    parts.push(new Blob([info.patchedMoov.slice(bufStart, bufEnd)]));
  }

  // Region 3: mdat region (from original file, after ftyp up to moov)
  if (end > moovEnd) {
    const mdatLocalStart = Math.max(0, start - moovEnd);
    const mdatLocalEnd = end - moovEnd;
    parts.push(file.slice(
      info.mdatOffset + mdatLocalStart,
      info.mdatOffset + mdatLocalEnd,
    ));
  }

  return new Blob(parts);
}
