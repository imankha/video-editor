/**
 * Video error classifier (T1360)
 *
 * Classifies HTMLVideoElement errors into actionable kinds so the app can
 * distinguish recoverable situations (e.g. a revoked blob URL, which looks
 * identical to a format error to the browser) from real user-facing
 * failures (decode, unsupported format, network).
 *
 * Pure function — no side effects, no DOM/fetch access. Designed to be
 * easy to unit-test and to import from both the useVideo hook and the
 * VideoPlayer overlay logic.
 */

export const VideoErrorKind = Object.freeze({
  /** blob: URL was revoked or GC'd. Recover by swapping to streaming URL. */
  STALE_BLOB: 'stale-blob',
  /** Presigned URL expired or network dropped. Show retry UI. */
  NETWORK_ERROR: 'network-error',
  /** Decoder failed mid-playback. Likely corrupt file. */
  DECODE_ERROR: 'decode-error',
  /** Real unsupported format on a non-blob URL. */
  FORMAT_ERROR: 'format-error',
  /**
   * T8310: the source object is gone (probe-confirmed HTTP 404 from R2, or a 410
   * from our own `source_expired` gate) — e.g. the game video's storage expired
   * and was reclaimed. A browser <video> reports this as SRC_NOT_SUPPORTED (code
   * 4), indistinguishable from a bad codec, so it needs the probe status to
   * disambiguate. Distinct kind because it must NOT enter the format-error retry
   * loop: neither status heals in 6 seconds.
   */
  VIDEO_UNAVAILABLE: 'video-unavailable',
  /** Caller aborted the load. */
  ABORTED: 'aborted',
  /** No error / unknown classification. */
  UNKNOWN: 'unknown',
});

// Matches the numeric values of MediaError.MEDIA_ERR_* without depending
// on DOM globals (keeps this module usable in any environment).
const CODE_ABORTED = 1;
const CODE_NETWORK = 2;
const CODE_DECODE = 3;
const CODE_SRC_NOT_SUPPORTED = 4;

/**
 * Classify a video-element error event.
 *
 * @param {Object} params
 * @param {number|null|undefined} params.code  MediaError.code
 * @param {string|null|undefined} params.videoSrc  video.src at the time of error
 * @param {number|null|undefined} [params.probeStatus]  HTTP status from a
 *   post-error Range probe of videoSrc, when available. A confirmed 404 (object
 *   gone from R2) or 410 (our `source_expired` gate) on a SRC_NOT_SUPPORTED
 *   error means the source is gone (T8310), not a bad codec.
 * @returns {string}  One of VideoErrorKind
 */
export function classifyVideoError({ code, videoSrc, probeStatus = null }) {
  if (code == null) return VideoErrorKind.UNKNOWN;

  const isBlob = typeof videoSrc === 'string' && videoSrc.startsWith('blob:');

  switch (code) {
    case CODE_ABORTED:
      return VideoErrorKind.ABORTED;
    case CODE_NETWORK:
      return VideoErrorKind.NETWORK_ERROR;
    case CODE_DECODE:
      return VideoErrorKind.DECODE_ERROR;
    case CODE_SRC_NOT_SUPPORTED:
      // A revoked/GC'd blob URL surfaces as SRC_NOT_SUPPORTED even though
      // the underlying bytes were valid. The `blob:` scheme is the tell.
      if (isBlob) return VideoErrorKind.STALE_BLOB;
      // T8310: a probe-confirmed 404 (R2 object gone) or 410 (our source_expired
      // gate, e.g. hit via the /stream proxy) means the source is gone (storage
      // expired/reclaimed) — its own kind so the retry loop is skipped.
      if (probeStatus === 404 || probeStatus === 410) return VideoErrorKind.VIDEO_UNAVAILABLE;
      return VideoErrorKind.FORMAT_ERROR;
    default:
      return VideoErrorKind.UNKNOWN;
  }
}
