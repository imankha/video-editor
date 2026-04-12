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
 * @returns {string}  One of VideoErrorKind
 */
export function classifyVideoError({ code, videoSrc }) {
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
      return isBlob ? VideoErrorKind.STALE_BLOB : VideoErrorKind.FORMAT_ERROR;
    default:
      return VideoErrorKind.UNKNOWN;
  }
}
