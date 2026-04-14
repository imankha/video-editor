/**
 * Probe an MP4 URL via HTTP Range requests to determine whether moov is at
 * the start (faststart) or end. Used for post-load verification so we can
 * confirm whether the file the browser is actually playing is faststart-ordered.
 *
 * Emits a single structured log line and returns the result. Safe to call
 * once per video load — cost is ~2 small Range requests.
 */

function readBoxHeader(buffer, offset) {
  const view = new DataView(buffer);
  let size = view.getUint32(offset, false);
  const type = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7),
  );
  let headerLen = 8;
  if (size === 1 && buffer.byteLength >= offset + 16) {
    const hi = view.getUint32(offset + 8, false);
    const lo = view.getUint32(offset + 12, false);
    size = hi * 0x100000000 + lo;
    headerLen = 16;
  }
  return { type, size, headerLen };
}

/**
 * Probe a URL for moov/mdat ordering. Reads up to 4 top-level boxes from the head.
 * @param {string} url
 * @param {string} [label] - short tag for the log line (e.g., 'annotate')
 * @returns {Promise<{moovAtStart: boolean|null, boxes: Array, error?: string}>}
 */
export async function probeVideoUrlMoovPosition(url, label = '') {
  const t0 = performance.now();
  try {
    // Read first 64 bytes to get ftyp + first box header (usually enough)
    const r1 = await fetch(url, { headers: { Range: 'bytes=0-63' } });
    if (!r1.ok && r1.status !== 206) {
      throw new Error(`HTTP ${r1.status}`);
    }
    // T1400: capture range-indicative headers so we can tell post-hoc whether
    // R2 honored the range (206 + Content-Range) or degraded to a full 200.
    const contentRange = r1.headers.get('content-range');
    const acceptRanges = r1.headers.get('accept-ranges');
    const contentLength = r1.headers.get('content-length');
    const status = r1.status;
    console.log(`[VIDEO_LOAD] headers status=${status} contentRange=${contentRange} acceptRanges=${acceptRanges} contentLength=${contentLength}`);
    const buf = await r1.arrayBuffer();
    if (buf.byteLength < 16) throw new Error(`too few bytes: ${buf.byteLength}`);

    const boxes = [];
    let offset = 0;
    while (offset + 16 <= buf.byteLength && boxes.length < 4) {
      const hdr = readBoxHeader(buf, offset);
      if (hdr.size < 8) break;
      boxes.push({ type: hdr.type, offset, size: hdr.size });
      offset += hdr.size;
    }

    const firstPayloadBox = boxes.find(b => b.type === 'moov' || b.type === 'mdat' || b.type === 'moof');
    const moovAtStart = firstPayloadBox?.type === 'moov';
    const elapsed = Math.round(performance.now() - t0);
    const summary = boxes.map(b => `${b.type}@${b.offset}`).join(' ');
    const verdict = moovAtStart === true ? 'FASTSTART' : moovAtStart === false ? 'MOOV-AT-END' : 'UNKNOWN';
    console.log(`[FaststartCheck]${label ? ' '+label : ''} verdict=${verdict} head=[${summary}] probe=${elapsed}ms url=${url.substring(0, 80)}`);
    return { moovAtStart, boxes, contentRange, acceptRanges, contentLength, status };
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0);
    console.warn(`[FaststartCheck]${label ? ' '+label : ''} verdict=ERROR error=${err.message} probe=${elapsed}ms`);
    return { moovAtStart: null, boxes: [], error: err.message };
  }
}
