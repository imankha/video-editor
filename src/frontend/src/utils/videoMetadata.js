/**
 * Scan a byte range for the MP4 `moov` atom marker.
 * Returns true if `moov` is found, false otherwise.
 */
function _hasMoov(bytes) {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (
      bytes[i] === 0x6d && // m
      bytes[i + 1] === 0x6f && // o
      bytes[i + 2] === 0x6f && // o
      bytes[i + 3] === 0x76    // v
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Probe the file structure of a video URL to diagnose why playback stalled.
 *
 * Fetches HEAD + head-bytes (first 512 KB) + tail-bytes (last 512 KB) and
 * reports: reachability, size, content-type, and moov atom placement
 * (head = fast-start, tail = non-fast-start slow load, missing = corrupt).
 *
 * Best-effort: any fetch failure is reported in the result, never thrown.
 *
 * @param {string} url
 * @returns {Promise<Object>} diagnostic payload
 */
export async function probeVideoStructure(url) {
  const diag = {
    url: url?.substring(0, 120),
    head: null,
    headBytesFetched: null,
    tailBytesFetched: null,
    moovLocation: null,   // 'head' | 'tail' | 'missing' | 'unknown'
    ftypAtHead: null,
    contentLength: null,
    contentType: null,
    acceptRanges: null,
    errors: [],
  };
  const isSameOrigin =
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
  const fetchOpts = isSameOrigin ? { credentials: 'include' } : {};

  try {
    const headResp = await fetch(url, { method: 'HEAD', ...fetchOpts });
    diag.head = { status: headResp.status, ok: headResp.ok };
    diag.contentLength = Number(headResp.headers.get('content-length')) || null;
    diag.contentType = headResp.headers.get('content-type');
    diag.acceptRanges = headResp.headers.get('accept-ranges');
  } catch (e) {
    diag.errors.push(`HEAD failed: ${e.message}`);
  }

  const probeSize = 512 * 1024;
  try {
    const headResp = await fetch(url, {
      headers: { Range: `bytes=0-${probeSize - 1}` },
      ...fetchOpts,
    });
    if (headResp.ok || headResp.status === 206) {
      const buf = new Uint8Array(await headResp.arrayBuffer());
      diag.headBytesFetched = buf.length;
      if (buf.length >= 8) {
        diag.ftypAtHead =
          buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
      }
      if (_hasMoov(buf)) diag.moovLocation = 'head';
    } else {
      diag.errors.push(`head range ${headResp.status}`);
    }
  } catch (e) {
    diag.errors.push(`head range failed: ${e.message}`);
  }

  if (diag.moovLocation !== 'head' && diag.contentLength) {
    try {
      const start = Math.max(0, diag.contentLength - probeSize);
      const tailResp = await fetch(url, {
        headers: { Range: `bytes=${start}-${diag.contentLength - 1}` },
        ...fetchOpts,
      });
      if (tailResp.ok || tailResp.status === 206) {
        const buf = new Uint8Array(await tailResp.arrayBuffer());
        diag.tailBytesFetched = buf.length;
        diag.moovLocation = _hasMoov(buf) ? 'tail' : 'missing';
      } else {
        diag.errors.push(`tail range ${tailResp.status}`);
      }
    } catch (e) {
      diag.errors.push(`tail range failed: ${e.message}`);
    }
  }

  if (diag.moovLocation === null) diag.moovLocation = 'unknown';
  return diag;
}

/**
 * Walk top-level MP4 boxes in a buffer.
 * Yields {type, start, end, headerLen} for each box.
 * Stops at buffer end or malformed box.
 */
function* _walkBoxes(view, start = 0, end = null) {
  const limit = end ?? view.byteLength;
  let offset = start;
  while (offset + 8 <= limit) {
    let size = view.getUint32(offset, false);
    const typeBytes = [
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    ];
    const type = String.fromCharCode(...typeBytes);
    let headerLen = 8;
    if (size === 1) {
      if (offset + 16 > limit) return;
      const hi = view.getUint32(offset + 8, false);
      const lo = view.getUint32(offset + 12, false);
      size = hi * 0x100000000 + lo;
      headerLen = 16;
    }
    if (size < 8 || offset + size > limit + 1) return; // +1 tolerates trailing box that exactly fits
    yield { type, start: offset, end: offset + size, headerLen, payloadStart: offset + headerLen };
    offset += size;
  }
}

/**
 * Parse mvhd (movie header) for duration.
 * Returns { durationSec } or null if parse fails.
 */
function _parseMvhd(view, payloadStart) {
  const version = view.getUint8(payloadStart);
  // skip version(1) + flags(3)
  let o = payloadStart + 4;
  if (version === 1) {
    o += 8 + 8; // creation + modification
    const timescale = view.getUint32(o, false); o += 4;
    const hi = view.getUint32(o, false);
    const lo = view.getUint32(o + 4, false);
    const duration = hi * 0x100000000 + lo;
    return { durationSec: duration / timescale };
  }
  o += 4 + 4; // creation + modification
  const timescale = view.getUint32(o, false); o += 4;
  const duration = view.getUint32(o, false);
  return { durationSec: duration / timescale };
}

/**
 * Parse tkhd for width/height (16.16 fixed-point).
 * Returns { width, height } or null if parse fails.
 */
function _parseTkhd(view, payloadStart) {
  const version = view.getUint8(payloadStart);
  let o = payloadStart + 4; // version + flags
  o += version === 1 ? 8 + 8 : 4 + 4; // creation + modification
  o += 4; // track_id
  o += 4; // reserved
  o += version === 1 ? 8 : 4; // duration
  o += 8; // reserved
  o += 2 + 2 + 2 + 2; // layer + alt_group + volume + reserved
  o += 36; // matrix
  const width = view.getUint32(o, false) / 65536;
  const height = view.getUint32(o + 4, false) / 65536;
  return { width, height };
}

/**
 * Find first video track (non-zero width/height) inside moov payload.
 */
function _parseMoov(view, moovStart, moovEnd) {
  let durationSec = null;
  let width = 0;
  let height = 0;
  for (const box of _walkBoxes(view, moovStart, moovEnd)) {
    if (box.type === 'mvhd') {
      const m = _parseMvhd(view, box.payloadStart);
      if (m) durationSec = m.durationSec;
    } else if (box.type === 'trak') {
      for (const trakBox of _walkBoxes(view, box.payloadStart, box.end)) {
        if (trakBox.type === 'tkhd') {
          const t = _parseTkhd(view, trakBox.payloadStart);
          if (t && t.width > 0 && t.height > 0) {
            width = t.width;
            height = t.height;
          }
        }
      }
    }
  }
  return { durationSec, width, height };
}

/**
 * Locate moov within a buffer. Returns {start, end} or null.
 * Caller passes the absolute offset the buffer starts at (for tail-range reads).
 */
function _findMoov(view, bufferAbsStart = 0) {
  for (const box of _walkBoxes(view)) {
    if (box.type === 'moov') {
      return { start: box.start, end: box.end, payloadStart: box.payloadStart, absStart: bufferAbsStart + box.start };
    }
  }
  return null;
}

const HEAD_PROBE_BYTES = 1024 * 1024; // 1 MB

/**
 * Extract metadata from a video URL using fetch() + MP4 box parsing.
 *
 * Why not use a `<video>` element? Chrome defers cross-origin `<video>` element
 * fetches as "Low priority media" — we measured 15-20s of `_blocked_queueing`
 * before the request even dispatches. fetch() is script-priority (High), so
 * the network call starts immediately.
 *
 * Strategy:
 *   1. fetch first 1 MB (Range: bytes=0-1048575). If moov is there, parse it.
 *   2. If not (moov-at-end), fetch tail 1 MB and parse from there.
 *   3. If still not found, fall through to diagnostic logging.
 *
 * @param {string} url - URL to the video file
 * @param {string} fileName - Optional filename for the video
 * @returns {Promise<Object>} Video metadata { width, height, duration, aspectRatio, fileName, format, framerate }
 */
export async function extractVideoMetadataFromUrl(url, fileName = 'clip.mp4') {
  const isSameOrigin =
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
  const fetchOpts = isSameOrigin ? { credentials: 'include' } : {};

  // T1535: perf timing for mobile verification
  const __perfActive = typeof window !== 'undefined' && window.__videoPerfTimings;
  if (__perfActive) window.__videoPerfTimings.push({ event: 'metadata-fetch-start', t: performance.now(), url: url?.substring(0, 80) });

  const __diagStart = performance.now();
  let __diagWarmState = null;
  try {
    import('../utils/cacheWarming').then(({ getWarmedState }) => {
      __diagWarmState = getWarmedState(url);
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }

  const failWithDiagnostic = async (reason, extra) => {
    const elapsedMs = Math.round(performance.now() - __diagStart);
    let structure;
    try {
      structure = await probeVideoStructure(url);
    } catch (e) {
      structure = { errors: [`probe threw: ${e.message}`] };
    }
    const conn = (typeof navigator !== 'undefined' && navigator.connection) || null;
    const payload = {
      reason,
      url: url?.substring(0, 120),
      elapsedMs,
      warmState: __diagWarmState,
      connection: conn ? { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt } : null,
      structure,
      ...extra,
    };
    if (structure.moovLocation === 'tail') {
      console.error('[videoMetadata] FAIL: moov atom at EOF and tail-range parse failed — producer should emit +faststart.', payload);
    } else if (structure.moovLocation === 'missing') {
      console.error('[videoMetadata] FAIL: moov atom NOT FOUND — file corrupt or truncated.', payload);
    } else if (structure.head && !structure.head.ok) {
      console.error(`[videoMetadata] FAIL: HEAD returned ${structure.head.status} — URL unreachable (expired presign? 404? CORS?).`, payload);
    } else if (!structure.ftypAtHead) {
      console.error('[videoMetadata] FAIL: No ftyp box at byte 4 — not a valid MP4 (wrong content-type or HTML error page?).', payload);
    } else {
      console.error('[videoMetadata] FAIL: structure looks valid but moov parse failed — box layout unexpected.', payload);
    }
    throw new Error(`${reason} (${structure.moovLocation || 'unknown'})`);
  };

  // Step 1: fetch head 1 MB
  let headBuf;
  let contentLength = null;
  try {
    const resp = await fetch(url, {
      headers: { Range: `bytes=0-${HEAD_PROBE_BYTES - 1}` },
      ...fetchOpts,
    });
    if (!resp.ok && resp.status !== 206) {
      return failWithDiagnostic(`HEAD fetch returned ${resp.status}`, { status: resp.status });
    }
    const cr = resp.headers.get('content-range');
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) contentLength = Number(m[1]);
    }
    if (!contentLength) {
      contentLength = Number(resp.headers.get('content-length')) || null;
    }
    headBuf = new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    return failWithDiagnostic(`head fetch threw: ${e.message}`, { error: e.message });
  }

  // Parse from head
  const headView = new DataView(headBuf.buffer, headBuf.byteOffset, headBuf.byteLength);
  let moovLoc = _findMoov(headView);
  let parsed = null;
  let moovLocation = 'head';

  if (moovLoc && moovLoc.end <= headBuf.byteLength) {
    parsed = _parseMoov(headView, moovLoc.payloadStart, moovLoc.end);
  }

  // Step 2: if moov not in head, fetch tail 1 MB
  if ((!parsed || !parsed.durationSec) && contentLength && contentLength > HEAD_PROBE_BYTES) {
    moovLocation = 'tail';
    try {
      const tailStart = Math.max(HEAD_PROBE_BYTES, contentLength - HEAD_PROBE_BYTES);
      const resp = await fetch(url, {
        headers: { Range: `bytes=${tailStart}-${contentLength - 1}` },
        ...fetchOpts,
      });
      if (resp.ok || resp.status === 206) {
        const tailBuf = new Uint8Array(await resp.arrayBuffer());
        const tailView = new DataView(tailBuf.buffer, tailBuf.byteOffset, tailBuf.byteLength);
        const tailMoov = _findMoov(tailView, tailStart);
        if (tailMoov) {
          parsed = _parseMoov(tailView, tailMoov.payloadStart, tailMoov.end);
        }
      }
    } catch {
      /* fall through to diagnostic */
    }
  }

  if (!parsed || !parsed.durationSec || !parsed.width || !parsed.height) {
    return failWithDiagnostic('moov parse failed', { contentLength, moovLocation });
  }

  const metadata = {
    width: Math.round(parsed.width),
    height: Math.round(parsed.height),
    duration: parsed.durationSec,
    aspectRatio: parsed.width / parsed.height,
    fileName,
    format: fileName.split('.').pop().toLowerCase() || 'mp4',
    framerate: 30,
  };

  if (__perfActive) window.__videoPerfTimings.push({ event: 'metadata-fetch-done', t: performance.now(), moovLocation, elapsedMs: Math.round(performance.now() - __diagStart) });

  const elapsedMs = Math.round(performance.now() - __diagStart);
  if (elapsedMs > 3000) {
    console.warn(`[videoMetadata] SLOW fetch-based metadata load: ${elapsedMs}ms moovLocation=${moovLocation} contentLength=${contentLength}`, {
      url: url?.substring(0, 120),
      elapsedMs,
      resolution: `${metadata.width}x${metadata.height}`,
    });
  } else {
    console.log('[videoMetadata] Extracted metadata from URL:', {
      ...metadata,
      url,
      elapsedMs,
      moovLocation,
      contentLength,
      durationFormatted: `${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toFixed(2)}`,
      resolution: `${metadata.width}x${metadata.height}`,
    });
  }

  return metadata;
}

/**
 * Extract metadata from a video File or Blob.
 * Used by both Framing (original upload) and Overlay (rendered video).
 *
 * This function creates a temporary URL, extracts metadata, and cleans up.
 * The caller should create their own URL if they need to display the video.
 *
 * @param {File|Blob} videoSource - Video file or blob to extract metadata from
 * @returns {Promise<Object>} Video metadata
 */
export async function extractVideoMetadata(videoSource) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true; // Helps with autoplay policies

    const url = URL.createObjectURL(videoSource);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    // Set timeout for loading - longer timeout for large blobs
    const timeoutMs = Math.max(30000, (videoSource.size || 0) / 500000 * 1000); // 30s min, +1s per 500KB
    const timeoutId = setTimeout(() => {
      if (video.readyState === 0) {
        console.warn('[videoMetadata] Timeout waiting for metadata, readyState:', video.readyState, 'size:', videoSource.size);
        cleanup();
        reject(new Error('Video metadata loading timed out'));
      }
    }, timeoutMs);

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);

      // Extract all available metadata from the video element
      const metadata = {
        // Basic dimensions
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,

        // File info
        fileName: videoSource.name || 'rendered_video.mp4',
        size: videoSource.size,
        type: videoSource.type,
        format: videoSource.type?.split('/')[1] ||
                (videoSource.name ? videoSource.name.split('.').pop().toLowerCase() : 'mp4'),

        // Video element state
        readyState: video.readyState,
        networkState: video.networkState,

        // Tracks info (if available)
        audioTracksCount: video.audioTracks?.length || 0,
        videoTracksCount: video.videoTracks?.length || 0,
        textTracksCount: video.textTracks?.length || 0,

        // Playback info
        defaultPlaybackRate: video.defaultPlaybackRate,
        preload: video.preload,

        // Additional file details
        lastModified: videoSource.lastModified,
        lastModifiedDate: videoSource.lastModified ? new Date(videoSource.lastModified).toISOString() : null,
      };

      // Log comprehensive metadata
      console.log('[videoMetadata] Extracted video metadata:', {
        ...metadata,
        sizeFormatted: `${(metadata.size / (1024 * 1024)).toFixed(2)} MB`,
        durationFormatted: `${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toFixed(2)}`,
        resolution: `${metadata.width}x${metadata.height}`,
      });

      cleanup();
      resolve(metadata);
    };

    video.onerror = (e) => {
      clearTimeout(timeoutId);
      console.error('[videoMetadata] Video load error:', e);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
    video.load(); // Force the browser to start loading
  });
}
