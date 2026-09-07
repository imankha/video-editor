/**
 * T8838 — Shrink capability census.
 *
 * Reads a video's REAL codec string + coded size from its moov (via mp4box), runs
 * the two WebCodecs capability checks the shrink feature will gate on
 * (`VideoDecoder`/`VideoEncoder.isConfigSupported`), and maps the answers to a
 * bounded beacon vocabulary. Fired once per uploaded file so a couple of weeks of
 * real uploads reveal what fraction of our users could ever see the shrink offer.
 *
 * PLAIN ESM by contract: this module imports NOTHING from `config`, `apiFetch`, or
 * any Zustand store, so a later standalone tool (T8840) can `import` the pure
 * `probeShrinkCapability` / codec-derivation logic without dragging the whole app
 * in. Reporting is therefore INJECTED: `probeAndReport` takes a `report(name)`
 * callback (the app passes one that routes to `recordUiImpression('capability', …)`)
 * rather than calling the telemetry transport directly.
 *
 * No PII: only codec family + resolution bucket ever leave this module — never a
 * filename, size, or duration.
 */

// Bounded beacon names — the slug becomes the `user_actions` aggregate key, so the
// vocabulary stays CLOSED (never invent new names ad hoc).
export const BEACON_PROBE_TOTAL = 'shrink_probe_total';
export const BEACON_PROBE_FAILED = 'shrink_probe_failed';

// The Recommended shrink preset: encode target is fixed at 2688-wide AVC High@L5.1
// regardless of the source, so encoder support is one independent yes/no/unavailable.
const ENCODE_CODEC = 'avc1.640033';
const ENCODE_WIDTH = 2688;
const ENCODE_BITRATE = 12_000_000;
const ENCODE_FRAMERATE = 30;

/**
 * Map an RFC 6381 codec string to a bounded family bucket.
 * `{avc, hevc8, hevc10, av1, vp9, other}` — derived from the prefix, and for HEVC
 * the profile field (`hvc1.2.*` = Main10 = hevc10; `hvc1.1.*` = Main = hevc8). A
 * mislabeled profile would silently skew the whole census, so trust mp4box's exact
 * string, never a hand-rolled hvcC parse.
 */
export function deriveCodecFamily(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('avc1') || c.startsWith('avc3')) return 'avc';
  if (c.startsWith('hvc1') || c.startsWith('hev1')) {
    const profile = c.split('.')[1];
    if (profile === '2') return 'hevc10'; // Main 10
    if (profile === '1') return 'hevc8'; // Main (8-bit)
    return 'other'; // any other HEVC profile stays out of the two counted buckets
  }
  if (c.startsWith('av01')) return 'av1';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'vp9';
  return 'other';
}

/**
 * Bucket coded height: `<=1080` -> le1080, `<=2160` -> le4k, `>2160` -> gt4k.
 */
export function deriveResBucket(height) {
  const h = Number(height) || 0;
  if (h <= 1080) return 'le1080';
  if (h <= 2160) return 'le4k';
  return 'gt4k';
}

/** Aspect-correct, even encode height for the fixed 2688-wide preset. */
function encodeHeightFor(srcWidth, srcHeight) {
  const w = Number(srcWidth) || 0;
  const h = Number(srcHeight) || 0;
  if (!w || !h) return 1512; // 16:9 fallback for the 2688 width
  const even = 2 * Math.round((ENCODE_WIDTH * h) / w / 2);
  return Math.max(2, even);
}

/**
 * Decode capability for the file's REAL codec + coded size.
 * `unavailable` when WebCodecs is absent (Firefox, old Safari) — counted, never
 * skipped. A thrown/rejected check (invalid config) counts as `no` (unsupported).
 */
async function checkDecodeSupport(codec, width, height) {
  if (typeof VideoDecoder === 'undefined' || !VideoDecoder.isConfigSupported) {
    return 'unavailable';
  }
  try {
    const res = await VideoDecoder.isConfigSupported({
      codec,
      codedWidth: width,
      codedHeight: height,
    });
    return res && res.supported ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

/** Encode capability for the fixed Recommended preset (independent of source). */
async function checkEncodeSupport(srcWidth, srcHeight) {
  if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) {
    return 'unavailable';
  }
  try {
    const res = await VideoEncoder.isConfigSupported({
      codec: ENCODE_CODEC,
      width: ENCODE_WIDTH,
      height: encodeHeightFor(srcWidth, srcHeight),
      bitrate: ENCODE_BITRATE,
      framerate: ENCODE_FRAMERATE,
    });
    return res && res.supported ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

/**
 * Parse ONLY the ftyp + moov (sliced via the faststart byte ranges) with mp4box and
 * return the first video track's codec + coded size. Never reads mdat — T8836 proved
 * this runs in 16-124 ms even on 17 GB files. Rejects on a missing/unparseable moov.
 */
async function parseVideoTrack(file, faststartInfo) {
  const { ftypOffset, ftypSize, moovOffset, moovSize } = faststartInfo || {};
  if (!ftypSize || !moovSize) {
    throw new Error('shrinkCapability: missing ftyp/moov byte range');
  }

  const mod = await import('mp4box');
  const MP4Box = mod.default || mod;

  const [ftypBuf, moovBuf] = await Promise.all([
    file.slice(ftypOffset, ftypOffset + ftypSize).arrayBuffer(),
    file.slice(moovOffset, moovOffset + moovSize).arrayBuffer(),
  ]);
  // mp4box needs a single contiguous stream starting at fileStart=0: [ftyp][moov].
  const combined = new Uint8Array(ftypSize + moovSize);
  combined.set(new Uint8Array(ftypBuf), 0);
  combined.set(new Uint8Array(moovBuf), ftypSize);
  const ab = combined.buffer;
  ab.fileStart = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const mp4boxfile = MP4Box.createFile();
    mp4boxfile.onError = (e) => {
      if (settled) return;
      settled = true;
      reject(new Error('mp4box parse error: ' + e));
    };
    mp4boxfile.onReady = (info) => {
      if (settled) return;
      settled = true;
      const v = info && info.videoTracks && info.videoTracks[0];
      if (!v || !v.codec) {
        reject(new Error('no video track in moov'));
        return;
      }
      const vid = v.video || {};
      resolve({
        codec: v.codec,
        width: vid.width || v.track_width || 0,
        height: vid.height || v.track_height || 0,
      });
    };
    try {
      mp4boxfile.appendBuffer(ab);
      mp4boxfile.flush();
      // onReady fires synchronously during append/flush once moov is complete; if it
      // didn't, the moov we fed was unparseable.
      if (!settled) {
        settled = true;
        reject(new Error('mp4box produced no moov info'));
      }
    } catch (e) {
      if (!settled) {
        settled = true;
        reject(e);
      }
    }
  });
}

/**
 * Pure probe: parse the track, run both capability checks, return the outcome. Used
 * directly by T8840's standalone tool; `probeAndReport` wraps it for the census.
 * @returns {Promise<{decode, encode, codecFamily, resBucket, codec, width, height}>}
 */
export async function probeShrinkCapability(file, faststartInfo) {
  const { codec, width, height } = await parseVideoTrack(file, faststartInfo);
  const [decode, encode] = await Promise.all([
    checkDecodeSupport(codec, width, height),
    checkEncodeSupport(width, height),
  ]);
  return {
    decode,
    encode,
    codecFamily: deriveCodecFamily(codec),
    resBucket: deriveResBucket(height),
    codec,
    width,
    height,
  };
}

/**
 * Fire the census beacons for one uploaded file. NEVER throws, NEVER delays or fails
 * the caller — call it fire-and-forget, concurrently with hashing. Emits exactly
 * `shrink_probe_total` + one decode outcome + one encode outcome on success, or a
 * single `shrink_probe_failed` when the moov can't be parsed — never more.
 *
 * @param {File} file
 * @param {object} faststartInfo - carries ftyp/moov byte ranges from analyzeMp4Faststart
 * @param {(name: string) => void} report - injected beacon sink (never imported here)
 */
export async function probeAndReport(file, faststartInfo, report) {
  const emit = (name) => {
    try {
      if (report) report(name);
    } catch {
      /* a beacon must never break the probe */
    }
  };
  try {
    const r = await probeShrinkCapability(file, faststartInfo);
    emit(BEACON_PROBE_TOTAL);
    emit(`shrink_decode_${r.decode}_${r.codecFamily}_${r.resBucket}`);
    emit(`shrink_encode_${r.encode}`);
  } catch {
    // Unparseable moov / missing byte range — counted, never thrown or logged loudly.
    emit(BEACON_PROBE_FAILED);
  }
}
