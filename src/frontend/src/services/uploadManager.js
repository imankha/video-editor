/**
 * Upload Manager - Handles deduplicated game uploads with multipart support
 *
 * This service orchestrates the 4-phase upload process:
 * 1. Hash: Compute BLAKE3 hash of file (in web worker)
 * 2. Prepare: Check if file exists, get presigned URLs if needed
 * 3. Upload: Upload parts directly to R2 (parallel)
 * 4. Finalize: Complete multipart upload
 *
 * Deduplication: If the file already exists globally, we just link it
 * to the user's account without re-uploading.
 */

import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { GameCreateStatus } from '../constants/gameConstants';
import { useQuestStore } from '../stores/questStore';
import { useEditorStore } from '../stores/editorStore';
import { analyzeMp4Faststart, getReorderedSlice } from '../utils/mp4Faststart';
import { getWarmingDiag } from '../utils/cacheWarming';

// Upload phases for progress tracking
export const UPLOAD_PHASE = {
  IDLE: 'idle',
  HASHING: 'hashing',
  PREPARING: 'preparing',
  UPLOADING: 'uploading',
  FINALIZING: 'finalizing',
  COMPLETE: 'complete',
  ERROR: 'error',
  INSUFFICIENT_CREDITS: 'insufficient_credits',
};

/**
 * T8935: extract a human-readable message from a JSON error body, regardless of which
 * shape `detail` comes back in — a plain string (most HTTPException raises), a FastAPI/
 * Pydantic validation-error array (`[{loc, msg, type}, ...]`, e.g. a 422 on a malformed
 * request body), or an object (the activateGame 402 shape, `{message, required, balance}`).
 * Without this, `new Error(detail)` on a non-string detail silently stringifies to
 * "[object Object]" — an unreadable failure toast with no clue what actually went wrong
 * (root cause of a live-testing report where the actual validation error was lost).
 */
function extractErrorMessage(errorBody, fallback) {
  const detail = errorBody?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map(e => (e && typeof e === 'object' && e.msg)
        ? `${(e.loc || []).join('.')}: ${e.msg}`
        : String(e))
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string') return detail.message;
    try {
      return JSON.stringify(detail);
    } catch {
      // fall through to fallback
    }
  }
  return fallback;
}

/**
 * T8180: is the user right now annotating the game whose upload just failed?
 *
 * The failure-cleanup path fires DELETE /api/games/{id}?only_if_empty=true to remove a
 * pending game that acquired no content. But annotate-during-upload (T1540) is the
 * NORMAL case: the user is inside Annotate on this very game, playing it from a local
 * blob, and has not committed a clip yet — so only_if_empty happily deletes the game
 * out from under them (bug 47p: a user annotated a deleted game for 26 minutes). Skip
 * the cleanup when the editor is still bound to this game; the errored upload entry is
 * retained (uploadStore) so Retry re-uses the game row and Discard deletes it.
 *
 * Gated on isAnnotateMode() so "the user navigated away from Annotate" reverts to the
 * normal cleanup — the game is then genuinely abandoned-and-empty.
 */
function isUserAnnotatingGame(gameId) {
  if (gameId == null) return false;
  const editor = useEditorStore.getState();
  return editor.isAnnotateMode() && editor.activeAnnotateGameId === gameId;
}

// R2 upload status returned from prepare-upload / finalize-upload
export const UPLOAD_STATUS = {
  EXISTS: 'exists',
  UPLOAD_REQUIRED: 'upload_required',
  // Re-export game create statuses for backward compatibility
  ALREADY_OWNED: GameCreateStatus.ALREADY_OWNED,
  CREATED: GameCreateStatus.CREATED,
};

import { createBLAKE3 } from 'hash-wasm';

// Sample size for fast hashing - 1MB per sample position
const SAMPLE_SIZE = 1 * 1024 * 1024;

// bug26p: wall-clock ceiling so a stalled hash fails LOUDLY instead of hanging
// forever. A sampled hash reads only 5x1MB, so this is a "something is wrong"
// ceiling, not a normal-path limit.
const HASH_TIMEOUT_MS = 120_000;        // hash + faststart analyze of one file

// T7480: progress-aware ("stall watchdog") per-part timeout, replacing the old flat
// PART_UPLOAD_TIMEOUT_MS = 180_000. The flat cap killed HEALTHY transfers on slow
// uplinks: a 17.8MB file was a single 25MB part, and at 0.3-0.7Mbps it reached ~66%
// then hit 180s and RESTARTED FROM BYTE 0 every retry (prod outage since 2026-08-20).
// Now we abort a part ONLY after PART_STALL_TIMEOUT_MS with ZERO upload progress (the
// GCS TransferStallTimeoutOption pattern — any progress event resets the timer), with
// an absolute ceiling as a backstop against a pathological 1-byte-a-minute dribble.
const PART_STALL_TIMEOUT_MS = 30_000;      // abort after this long with no progress
const PART_ABSOLUTE_TIMEOUT_MS = 600_000;  // hard ceiling per part (10 min)
const STALL_CHECK_INTERVAL_MS = 5_000;     // how often the watchdog checks

/**
 * Reject `promise` if it doesn't settle within `ms`. Runs `onTimeout` (e.g. to
 * abort in-flight work) before rejecting. Always clears the timer.
 */
function withTimeout(promise, ms, message, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * T7480 failure beacon. Fire-and-forget POST of a terminal upload failure so the
 * browser-side reason lands in SERVER logs — the only server-visible evidence
 * channel, because prod builds strip console.log. Writes to logs only (no DB).
 *
 * Contract: MUST NEVER throw or block the failure path. Not awaited by callers;
 * uses keepalive so it survives a navigation away. Any error is swallowed.
 *
 * @param {Object} payload - { phase, reason, session_id, blake3_hash, file_size, attempts, elapsed_ms, ... }
 */
export function sendUploadFailureBeacon(payload) {
  try {
    apiFetch(`${API_BASE}/api/games/upload-failure-beacon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      keepalive: true,
    }).catch(() => { /* never let the beacon break the failure path */ });
  } catch {
    /* never let the beacon break the failure path */
  }
}

/**
 * Hash a file using BLAKE3 with sampling for speed (T81)
 *
 * Instead of hashing the entire file, we hash:
 * - File size (8 bytes, for collision resistance)
 * - 5 samples at positions: 0%, 25%, 50%, 75%, and end
 *
 * This reduces a 4GB file from 60+ seconds to ~1 second while
 * maintaining uniqueness for video files.
 *
 * @param {File} file - File to hash
 * @param {function} onProgress - Progress callback: (percent) => void
 * @returns {Promise<string>} - BLAKE3 hash as hex string
 */
export async function hashFile(file, onProgress, signal = null) {
  const hasher = await createBLAKE3();

  // Calculate sample positions (0%, 25%, 50%, 75%, end)
  const positions = [
    0,
    Math.floor(file.size * 0.25),
    Math.floor(file.size * 0.50),
    Math.floor(file.size * 0.75),
    Math.max(0, file.size - SAMPLE_SIZE),
  ];
  // Include file size in hash for extra collision resistance
  // Two files with same samples but different sizes will hash differently
  const sizeBytes = new Uint8Array(8);
  new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(file.size), false);
  hasher.update(sizeBytes);

  // Hash each sample
  for (let i = 0; i < positions.length; i++) {
    // bug26p: bail promptly if the surrounding timeout aborted us.
    if (signal?.aborted) {
      throw new Error('Hashing aborted (timed out)');
    }
    const start = positions[i];
    const end = Math.min(start + SAMPLE_SIZE, file.size);
    const chunk = file.slice(start, end);

    // Read chunk as ArrayBuffer (use Response for better compatibility)
    const buffer = await new Response(chunk).arrayBuffer();

    hasher.update(new Uint8Array(buffer));

    // Report progress (each sample is 20%)
    if (onProgress) {
      onProgress(Math.round(((i + 1) / positions.length) * 100));
    }

    // Yield to event loop to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const hash = hasher.digest('hex');
  return hash;
}

/**
 * Upload a single part to R2
 * @param {File} file - Source file
 * @param {Object} part - Part info with presigned_url, start_byte, end_byte
 * @param {function} onProgress - Progress callback: (loaded, total) => void
 * @returns {Promise<Object>} - { part_number, etag }
 */
// Exported for unit tests (stall watchdog + honest progress).
export async function uploadPart(file, part, onProgress, faststartInfo = null) {
  const { part_number, presigned_url, start_byte, end_byte } = part;

  // [DIAG upload-freeze] measure main-thread time to assemble the part blob.
  // getReorderedSlice builds a Blob across 3 regions; if it blocks for tens of
  // ms per part, parallel part uploads will stutter the UI.
  const __diagSliceStart = performance.now();
  const blob = faststartInfo?.needsRelocation
    ? getReorderedSlice(file, faststartInfo, start_byte, end_byte + 1)
    : file.slice(start_byte, end_byte + 1);
  const __diagSliceMs = performance.now() - __diagSliceStart;
  if (__diagSliceMs > 5) {
    console.log(`[DIAG upload-freeze] part=${part_number} slice_ms=${__diagSliceMs.toFixed(1)} size=${(end_byte - start_byte + 1) >> 20}MB reordered=${!!faststartInfo?.needsRelocation}`);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presigned_url);

    // T7480: stall watchdog instead of a flat xhr.timeout. Reset lastProgressAt on
    // every upload progress event; abort only if no progress flows for
    // PART_STALL_TIMEOUT_MS (dead socket) or the part exceeds the absolute ceiling.
    let settled = false;
    let lastProgressAt = performance.now();
    const startedAt = lastProgressAt;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      fn();
    };

    const watchdog = setInterval(() => {
      if (settled) return;
      const now = performance.now();
      if (now - lastProgressAt > PART_STALL_TIMEOUT_MS) {
        finish(() => {
          try { xhr.abort(); } catch { /* already dead */ }
          const secs = Math.round(PART_STALL_TIMEOUT_MS / 1000);
          reject(new Error(`Part ${part_number} stalled (no progress for ${secs}s)`));
        });
      } else if (now - startedAt > PART_ABSOLUTE_TIMEOUT_MS) {
        finish(() => {
          try { xhr.abort(); } catch { /* already dead */ }
          reject(new Error(`Part ${part_number} timed out`));
        });
      }
    }, STALL_CHECK_INTERVAL_MS);

    xhr.upload.onprogress = (e) => {
      lastProgressAt = performance.now();
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // R2 returns ETag in response headers
          const etag = xhr.getResponseHeader('ETag');
          resolve({ part_number, etag });
        } else {
          reject(new Error(`Part ${part_number} upload failed: ${xhr.status}`));
        }
      });
    };

    xhr.onerror = () => {
      finish(() => reject(new Error(`Part ${part_number} network error`)));
    };

    xhr.onabort = () => {
      // Only reached for an abort the watchdog didn't already handle.
      finish(() => reject(new Error(`Part ${part_number} aborted`)));
    };

    xhr.send(blob);
  });
}

async function uploadPartWithRetry(file, part, onProgress, faststartInfo, sessionId, completedResults) {
  const MAX_RETRIES = 3;
  const BACKOFF_MS = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await uploadPart(file, part, onProgress, faststartInfo);
    } catch (error) {
      const msg = error.message || '';
      // bug26p/T7480: part timeouts and stalls are transient — retry them like
      // network errors. With 5MB parts a retry re-sends only that one part, so a
      // stalled/slow part costs at most 5MB of rework, not the whole file.
      const isRetryable = msg.includes('network error') || msg.includes('timed out')
        || msg.includes('stalled') || /upload failed: 5\d\d/.test(msg);

      if (!isRetryable || attempt === MAX_RETRIES) {
        if (sessionId && completedResults.length > 0) {
          // saveCompletedParts surfaces its own failures (returns false, logs a
          // RESUME-STATE marker) and never rejects — no swallowing catch needed.
          await saveCompletedParts(sessionId, completedResults.splice(0));
        }
        throw error;
      }

      console.warn(`[Upload] Part ${part.part_number} attempt ${attempt + 1} failed: ${msg}, retrying in ${BACKOFF_MS[attempt]}ms`);
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
}

/**
 * Save completed parts to backend for resume support.
 *
 * Non-fatal to the current upload, but NOT silent: if this fails, a browser
 * crash mid-upload can't resume from these parts (they'll re-upload). The old
 * version swallowed everything with a bare console.warn AND — because apiFetch
 * doesn't reject on a non-ok response — never even noticed an HTTP 4xx/5xx. We
 * now check res.ok, log a clear RESUME-STATE marker, and return whether resume
 * state was actually persisted so the caller can flag unreliable resume.
 *
 * @param {string} sessionId - Upload session ID
 * @param {Array} parts - Array of { part_number, etag }
 * @returns {Promise<boolean>} - true if progress was persisted, false otherwise
 */
async function saveCompletedParts(sessionId, parts) {
  try {
    const res = await apiFetch(`${API_BASE}/api/games/upload/${sessionId}/parts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
    if (!res.ok) {
      console.error(
        `[Upload] RESUME-STATE SAVE FAILED: session ${sessionId} returned ${res.status} ` +
        `(${parts.length} part(s)). Resume will re-upload these parts if interrupted.`
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error(
      `[Upload] RESUME-STATE SAVE FAILED: session ${sessionId} network error ` +
      `(${parts.length} part(s)). Resume will re-upload these parts if interrupted:`,
      e
    );
    return false;
  }
}

/**
 * Upload all parts with parallel execution and resume support
 * @param {File} file - Source file
 * @param {Array} parts - Array of part info from prepare-upload (remaining parts only)
 * @param {function} onProgress - Progress callback: (percent) => void
 * @param {string} sessionId - Upload session ID for saving progress
 * @param {Array} completedParts - Already completed parts (for resume)
 * @param {number} totalBytes - Total bytes including completed parts
 * @param {number} concurrency - Initial concurrent uploads (default 2, adapts based on throughput)
 * @returns {Promise<Array>} - Array of { part_number, etag } (all parts including completed)
 */
export async function uploadParts(
  file,
  parts,
  onProgress,
  sessionId = null,
  completedParts = [],
  totalBytes = null,
  concurrency = 2,
  faststartInfo = null
) {
  const results = [...completedParts]; // Start with already completed parts

  // Calculate total bytes for progress (including already completed)
  const remainingBytes = parts.reduce(
    (sum, p) => sum + (p.end_byte - p.start_byte + 1),
    0
  );
  const completedBytesAtStart = (totalBytes || remainingBytes) - remainingBytes;
  const total = totalBytes || remainingBytes + completedBytesAtStart;

  // T7480 honest progress: the bar is driven by COMPLETED parts — a part's bytes
  // count only once its PUT returns 2xx — NOT by upload.onprogress buffered bytes.
  // Buffered bytes kept climbing while the socket was effectively dead, so users
  // saw healthy progress right up to the reset loop. onprogress still feeds the
  // per-part stall watchdog inside uploadPart; it just no longer moves the bar.
  let deliveredBytes = completedBytesAtStart;

  const updateTotalProgress = () => {
    const percent = Math.min(100, Math.round((deliveredBytes / total) * 100));
    if (onProgress) onProgress(percent);
  };

  // Report initial progress if resuming
  if (completedParts.length > 0) {
    updateTotalProgress();
  }

  const partsToSave = [];
  const SAVE_BATCH_SIZE = 1;

  // Track whether every resume-state save succeeded. If any failed, resume for
  // this session is unreliable and we say so loudly at the end (see below).
  // pendingSaves holds the fire-and-forget batch saves so the end-of-upload
  // aggregate check can await them and be deterministic.
  let resumeStateReliable = true;
  const pendingSaves = [];
  const recordSave = (ok) => { if (!ok) resumeStateReliable = false; };

  // Adaptive concurrency: track throughput per completed part
  const throughputSamples = [];
  const MAX_SAMPLES = 5;
  const MAX_CONCURRENCY = 6;
  let partsCompletedSinceAdjust = 0;
  const partStartTimes = new Map();

  const adjustConcurrency = () => {
    if (throughputSamples.length < 3) return;
    const avg = throughputSamples.reduce((a, b) => a + b, 0) / throughputSamples.length;
    const mbPerSec = avg / (1024 * 1024);
    const prevConcurrency = concurrency;
    if (mbPerSec > 10) {
      concurrency = Math.min(4, MAX_CONCURRENCY);
    } else if (mbPerSec < 2) {
      concurrency = 1;
    } else {
      concurrency = 2;
    }
    console.log(`[Upload] throughput=${mbPerSec.toFixed(1)}MB/s concurrency=${prevConcurrency}->${concurrency} samples=${throughputSamples.length}`);
  };

  const queue = [...parts];
  const executing = new Set();

  while (queue.length > 0 || executing.size > 0) {
    while (queue.length > 0 && executing.size < concurrency) {
      const part = queue.shift();
      partStartTimes.set(part.part_number, performance.now());

      // onProgress is intentionally null: the reported bar is completed-parts-based
      // (honest progress). Per-part upload.onprogress still fires inside uploadPart
      // to feed the stall watchdog; it just doesn't move the bar.
      const promise = uploadPartWithRetry(file, part, null, faststartInfo, sessionId, partsToSave)
        .then((result) => {
          results.push(result);
          partsToSave.push(result);

          const partBytes = part.end_byte - part.start_byte + 1;
          deliveredBytes += partBytes;
          updateTotalProgress();
          executing.delete(promise);

          const startTime = partStartTimes.get(part.part_number);
          if (startTime) {
            const elapsed = (performance.now() - startTime) / 1000;
            if (elapsed > 0) {
              const partMbps = (partBytes / elapsed) / (1024 * 1024);
              console.log(`[Upload] part=${part.part_number} size=${(partBytes >> 20)}MB time=${elapsed.toFixed(1)}s speed=${partMbps.toFixed(1)}MB/s`);
              throughputSamples.push(partBytes / elapsed);
              if (throughputSamples.length > MAX_SAMPLES) throughputSamples.shift();
            }
            partStartTimes.delete(part.part_number);
          }

          partsCompletedSinceAdjust++;
          if (partsCompletedSinceAdjust >= 5) {
            adjustConcurrency();
            partsCompletedSinceAdjust = 0;
          }

          if (sessionId && partsToSave.length >= SAVE_BATCH_SIZE) {
            const batch = partsToSave.splice(0, partsToSave.length);
            // Fire-and-forget so a slow save doesn't stall the upload, but record
            // the outcome (and retain the promise) so we can flag unreliable
            // resume once the upload ends.
            pendingSaves.push(saveCompletedParts(sessionId, batch).then(recordSave));
          }
        })
        .catch((error) => {
          executing.delete(promise);
          throw error;
        });

      executing.add(promise);
    }

    if (executing.size > 0) {
      await Promise.race(executing);
    }
  }

  // Save any remaining parts
  if (sessionId && partsToSave.length > 0) {
    recordSave(await saveCompletedParts(sessionId, partsToSave));
  }

  // Let the fire-and-forget batch saves settle so the aggregate flag is
  // deterministic (each also logs on its own failure). saveCompletedParts
  // never rejects, so Promise.all can't reject here.
  await Promise.all(pendingSaves);

  // If any resume-state save failed, don't pretend resume is intact.
  if (sessionId && !resumeStateReliable) {
    console.warn(
      `[Upload] Resume state for session ${sessionId} is INCOMPLETE — one or more ` +
      `part-progress saves failed. If interrupted, resume will re-upload the affected parts.`
    );
  }

  return results;
}

/**
 * Ensure a video is in R2 (hash, dedup check, upload if needed).
 * This is the R2 upload layer - it does NOT create games.
 *
 * @param {File} file - Video file to upload to R2
 * @param {function} onProgress - Progress callback: ({ phase, percent, message }) => void
 * @param {Object} options - Video metadata for R2 object
 * @returns {Promise<Object>} - { blake3_hash, file_size, uploaded }
 */
/**
 * Hash + analyze a file. Extracted so callers (uploadGame) can create
 * the games row with a known blake3_hash BEFORE the R2 upload starts —
 * otherwise the row would be committed with video_filename=NULL and get
 * orphaned if the upload fails (T1180).
 *
 * @returns {Promise<{blake3_hash: string, faststartInfo: object, file_size: number}>}
 */
export async function hashAndAnalyze(file, onProgress) {
  // bug26p: cap the whole hash+analyze phase. If a file handle dies or the read
  // stalls, abort the hash loop and reject loudly instead of hanging forever.
  const controller = new AbortController();
  return withTimeout(
    _hashAndAnalyze(file, onProgress, controller.signal),
    HASH_TIMEOUT_MS,
    'Preparing the video timed out. Please try again.',
    () => controller.abort(),
  );
}

async function _hashAndAnalyze(file, onProgress, signal) {
  const notify = (phase, percent, message) => {
    if (onProgress) onProgress({ phase, percent, message });
  };

  // [DIAG upload-freeze] wall-clock each phase to correlate with UI stutter.
  const __diagFileMB = (file.size / (1 << 20)).toFixed(1);
  const __diagWarmAtStart = getWarmingDiag();
  console.log(`[DIAG upload-freeze] ensureVideoInR2 START file=${file.name} size=${__diagFileMB}MB warmer=${JSON.stringify(__diagWarmAtStart)}`);
  const __diagT0 = performance.now();

  // Phase 0: Analyze MP4 structure for faststart (T1380)
  notify(UPLOAD_PHASE.HASHING, 0, 'Analyzing video...');
  const __diagAnalyzeStart = performance.now();
  const faststartInfo = await analyzeMp4Faststart(file);
  console.log(`[DIAG upload-freeze] analyzeMp4Faststart ${(performance.now() - __diagAnalyzeStart).toFixed(0)}ms needsRelocation=${faststartInfo.needsRelocation}`);
  if (faststartInfo.needsRelocation) {
    console.log(
      `[Upload] Moov atom at end (offset ${faststartInfo.moovOffset}), ` +
      `will relocate to front (${(faststartInfo.moovSize / 1024).toFixed(0)}KB moov, ` +
      `analysis took ${faststartInfo.analysisTimeMs}ms)`
    );
  }

  notify(UPLOAD_PHASE.HASHING, 0, 'Computing file hash...');
  const __diagHashStart = performance.now();
  const hash = await hashFile(file, (p) => {
    notify(UPLOAD_PHASE.HASHING, p, `Computing hash... ${p}%`);
  }, signal);
  console.log(`[DIAG upload-freeze] hashFile ${(performance.now() - __diagHashStart).toFixed(0)}ms`);
  notify(UPLOAD_PHASE.HASHING, 100, 'Hash complete');

  const file_size = faststartInfo.needsRelocation ? faststartInfo.newSize : file.size;
  return { blake3_hash: hash, faststartInfo, file_size };
}

export async function ensureVideoInR2(file, onProgress, options = {}) {
  const notify = (phase, percent, message) => {
    if (onProgress) {
      onProgress({ phase, percent, message });
    }
  };

  // Allow caller to pass precomputed hash/analysis to skip rehashing.
  let hash, faststartInfo;
  if (options.precomputed) {
    hash = options.precomputed.blake3_hash;
    faststartInfo = options.precomputed.faststartInfo;
  } else {
    const h = await hashAndAnalyze(file, onProgress);
    hash = h.blake3_hash;
    faststartInfo = h.faststartInfo;
  }

  // Phase 2: Prepare (check R2 for dedup, create multipart upload, generate URLs)
  // Use the new file size if faststart relocation changes it
  const uploadSize = faststartInfo.needsRelocation ? faststartInfo.newSize : file.size;
  notify(UPLOAD_PHASE.PREPARING, 0, 'Preparing upload...');
  const prepareBody = {
    blake3_hash: hash,
    file_size: uploadSize,
    original_filename: file.name,
  };
  if (options.label) {
    prepareBody.label = options.label;
  }
  // T8370: 'game' (default, omitted) or 'clip' — routes the upload's R2
  // namespace + finalize-time milestone (games_upload.py upload_object_key).
  if (options.kind) {
    prepareBody.kind = options.kind;
  }
  const prepareRes = await apiFetch(`${API_BASE}/api/games/prepare-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prepareBody),
  });

  if (!prepareRes.ok) {
    const error = await prepareRes.json().catch(() => ({}));
    console.error(`[ensureVideoInR2] prepare-upload FAILED: ${prepareRes.status}`, error);
    sendUploadFailureBeacon({
      phase: 'preparing',
      reason: error.detail || `prepare_failed_${prepareRes.status}`,
      blake3_hash: hash,
      file_size: uploadSize,
      kind: options.kind,
    });
    throw new Error(extractErrorMessage(error, `Prepare failed: ${prepareRes.status}`));
  }

  const prepareData = await prepareRes.json();

  // T1580: Check if user can afford the upload before transferring bytes
  if (prepareData.can_afford === false) {
    const err = new Error(`Insufficient credits: need ${prepareData.upload_cost}, have ${prepareData.balance}`);
    err.insufficientCredits = true;
    err.uploadCost = prepareData.upload_cost;
    err.balance = prepareData.balance;
    throw err;
  }

  // Video already exists in R2 - skip upload.
  // Dedup is instant: don't fake a multi-second "upload". Show honest messaging
  // and go straight to complete.
  if (prepareData.status === UPLOAD_STATUS.EXISTS) {
    console.log('[ensureVideoInR2] Dedup: video already in R2, skipping upload');
    notify(UPLOAD_PHASE.FINALIZING, 100, 'Already uploaded - finishing up');
    notify(UPLOAD_PHASE.COMPLETE, 100, 'Upload complete');
    return {
      // Prefer the server-confirmed hash for the object actually in R2 (matches
      // the upload-required path, which returns finalizeData.blake3_hash). In
      // production this equals the locally-computed `hash` we prepared with;
      // sourcing it from the server keeps R2 authoritative on what's stored.
      blake3_hash: prepareData.blake3_hash || hash,
      file_size: prepareData.file_size || file.size,
      uploaded: false,
    };
  }

  // Phase 3: Upload parts
  if (prepareData.status !== UPLOAD_STATUS.UPLOAD_REQUIRED) {
    throw new Error(`Unexpected status: ${prepareData.status}`);
  }
  const isResume = prepareData.is_resume === true;
  const completedParts = prepareData.completed_parts || [];

  if (isResume && completedParts.length > 0) {
    notify(
      UPLOAD_PHASE.UPLOADING,
      0,
      `Resuming upload... (${completedParts.length} parts already uploaded)`
    );
  } else {
    notify(UPLOAD_PHASE.UPLOADING, 0, 'Uploading...');
  }

  const __diagUploadStart = performance.now();
  console.log(`[DIAG upload-freeze] uploadParts BEGIN warmer=${JSON.stringify(getWarmingDiag())}`);
  let parts;
  try {
    parts = await uploadParts(
      file,
      prepareData.parts,
      (p) => {
        notify(UPLOAD_PHASE.UPLOADING, p, 'Uploading...');
      },
      prepareData.upload_session_id,
      completedParts,
      uploadSize,
      2,
      faststartInfo
    );
  } catch (uploadErr) {
    // T7480: the transfer exhausted its retries. Beacon the reason server-side —
    // this is the exact failure the prod outage produced with zero server traffic.
    sendUploadFailureBeacon({
      phase: 'uploading',
      reason: uploadErr?.message || 'upload_failed',
      session_id: prepareData.upload_session_id,
      blake3_hash: hash,
      file_size: uploadSize,
      total_parts: prepareData.parts.length,
      elapsed_ms: Math.round(performance.now() - __diagUploadStart),
      kind: options.kind,
    });
    throw uploadErr;
  }
  console.log(`[DIAG upload-freeze] uploadParts ${((performance.now() - __diagUploadStart) / 1000).toFixed(1)}s parts=${prepareData.parts.length}`);
  notify(UPLOAD_PHASE.UPLOADING, 100, 'Upload complete');

  // Phase 4: Finalize R2 multipart
  notify(UPLOAD_PHASE.FINALIZING, 0, 'Finalizing upload...');
  const finalizeRes = await apiFetch(`${API_BASE}/api/games/finalize-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_session_id: prepareData.upload_session_id,
      parts: parts.map((p) => ({
        part_number: p.part_number,
        etag: p.etag,
      })),
      video_duration: options.videoDuration || null,
      video_width: options.videoWidth || null,
      video_height: options.videoHeight || null,
    }),
  });

  if (!finalizeRes.ok) {
    const error = await finalizeRes.json().catch(() => ({}));
    // Log enough to diagnose an R2 multipart-completion failure: which session,
    // how many parts we sent, and the raw backend body.
    console.error(
      `[ensureVideoInR2] finalize-upload FAILED: ${finalizeRes.status}`,
      { session: prepareData.upload_session_id, partCount: parts.length, body: error }
    );
    // Prefer the backend's actionable detail; otherwise give the user a concrete
    // next step instead of a bare "Finalize failed: 500".
    const message = error.detail
      || `Couldn't finish saving your video (finalize failed, status ${finalizeRes.status}). `
        + `The bytes uploaded but the final step didn't complete — please try uploading again.`;
    sendUploadFailureBeacon({
      phase: 'finalizing',
      reason: error.detail || `finalize_failed_${finalizeRes.status}`,
      session_id: prepareData.upload_session_id,
      blake3_hash: hash,
      file_size: uploadSize,
      total_parts: parts.length,
      kind: options.kind,
    });
    throw new Error(message);
  }

  const finalizeData = await finalizeRes.json();
  notify(UPLOAD_PHASE.COMPLETE, 100, 'Upload complete');

  return {
    blake3_hash: finalizeData.blake3_hash,
    file_size: finalizeData.file_size,
    uploaded: true,
  };
}

/**
 * T8370: batch-create clips from already-durable R2 sources (each item's
 * bytes must already be uploaded via ensureVideoInR2(file, onProgress,
 * {kind: 'clip'}) — prepare-upload/finalize-upload with kind='clip'). ONE
 * credit charge for the whole batch; idempotent on the accepted-hash set.
 *
 * @param {Array<{blake3_hash: string, file_size: number, original_filename: string,
 *   name?: string, rating?: number, tags?: string[], notes?: string, my_athlete?: boolean}>} items
 * @returns {Promise<{results: Array, charged: number, balance: number|null}>}
 */
export async function uploadClipsBatch(items) {
  const response = await apiFetch(`${API_BASE}/api/clips/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Clip batch upload failed: ${response.status}`));
  }

  return await response.json();
}

/**
 * Create a game via POST /api/games
 *
 * @param {Object} options - Game details
 * @param {Array<Object>} videos - Video references [{ blake3_hash, sequence, duration, width, height, file_size }]
 * @param {string} [status] - 'pending' for pre-upload creation, omit for ready (default)
 * @returns {Promise<Object>} - { status, game_id, name, video_url, videos }
 */
async function createGame(options, videos, status) {
  const body = {
    opponent_name: options.opponentName || null,
    game_date: options.gameDate || null,
    game_type: options.gameType || null,
    tournament_name: options.tournamentName || null,
    videos,
  };
  if (status) {
    body.status = status;
  }
  const res = await apiFetch(`${API_BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Create game failed: ${res.status}`));
  }

  return await res.json();
}

/**
 * Attach video(s) to an existing game via POST /api/games/{id}/videos
 */
async function addVideosToGame(gameId, videos) {
  const res = await apiFetch(`${API_BASE}/api/games/${gameId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videos }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Add videos failed: ${res.status}`));
  }
  return await res.json();
}

/**
 * Activate a pending game after upload completes.
 * Validates videos exist in R2, backfills FPS, flips status to 'ready'.
 *
 * @param {number} gameId - Game ID to activate
 * @returns {Promise<Object>} - { game_id, status }
 */
async function activateGame(gameId) {
  const res = await apiFetch(`${API_BASE}/api/games/${gameId}/activate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    if (res.status === 402) {
      const detail = typeof error.detail === 'object' ? error.detail : {};
      const err = new Error(detail.message || 'Insufficient credits for game upload');
      err.insufficientCredits = true;
      err.uploadCost = detail.required;
      err.balance = detail.balance;
      throw err;
    }
    throw new Error(extractErrorMessage(error, `Activate game failed: ${res.status}`));
  }
  return await res.json();
}

/**
 * Upload a game with deduplication support (single video).
 *
 * Flow (T1540 — two-phase creation):
 * 1. Hash file (shows progress bar).
 * 2. Create game as 'pending' (provides game_id for clip persistence).
 * 3. Upload bytes to R2 (reuses the precomputed hash).
 * 4. Activate game (flip status to 'ready').
 *
 * The game_id is available within seconds of hashing, so clips added
 * during upload persist immediately. Downstream consumers only see
 * 'ready' games.
 *
 * @param {File} file - Video file to upload
 * @param {function} onProgress - Progress callback: ({ phase, percent, message }) => void
 * @param {Object} options - Game details and video metadata
 * @returns {Promise<Object>} - Result with status, game_id, name, video_url, etc.
 */
export async function uploadGame(file, onProgress, options = {}) {
  const notify = (phase, percent, message) => {
    if (onProgress) {
      onProgress({ phase, percent, message });
    }
  };

  let gameResult = null;
  // T7870: once the server has validated the game (dedup 'already_owned' or
  // activateGame's 200), it is a real, credited asset — the cleanup delete below must
  // never target it, even if a LATER step in this same try block throws (e.g. a lost
  // response, a slow request). The backend's own only_if_empty status check is the
  // real invariant; this flag just avoids firing an already-doomed cleanup call.
  let activated = false;

  try {
    // Step 1: Hash the file (accurate progress from sampled hash).
    const hashResult = await hashAndAnalyze(file, onProgress);

    const videoRef = {
      blake3_hash: hashResult.blake3_hash,
      sequence: 1,
      duration: options.videoDuration || null,
      width: options.videoWidth || null,
      height: options.videoHeight || null,
      file_size: hashResult.file_size,
    };

    // Step 2: Create game as 'pending' — game_id available for clip persistence.
    console.log('[T1540] Creating pending game BEFORE upload');
    gameResult = await createGame(options, [videoRef], 'pending');

    // Dedup: if user already owns this video, game is already ready — skip upload.
    // Dedup is instant: don't fake a multi-second "upload". Show honest messaging
    // and go straight to complete.
    if (gameResult.status === 'already_owned') {
      console.log('[uploadGame] Dedup: user already owns this video, skipping upload');
      activated = true;
      if (options.onGameCreated) {
        options.onGameCreated({ game_id: gameResult.game_id, name: gameResult.name });
      }
      notify(UPLOAD_PHASE.FINALIZING, 100, 'Already uploaded - finishing up');
      notify(UPLOAD_PHASE.COMPLETE, 100, 'Upload complete');
      return {
        status: gameResult.status,
        game_id: gameResult.game_id,
        name: gameResult.name,
        video_url: gameResult.video_url,
        blake3_hash: hashResult.blake3_hash,
        file_size: hashResult.file_size,
        deduplicated: true,
      };
    }

    // Notify caller of game_id so clip saves work immediately.
    console.log('[T1540] Game created, firing onGameCreated:', gameResult.game_id);
    if (options.onGameCreated) {
      options.onGameCreated({ game_id: gameResult.game_id, name: gameResult.name });
    }

    // Step 3: Upload bytes to R2.
    const r2Result = await ensureVideoInR2(file, onProgress, {
      ...options,
      precomputed: hashResult,
    });

    // Step 4: Activate game (validates R2, backfills FPS, flips to 'ready').
    await activateGame(gameResult.game_id);
    activated = true;

    useQuestStore.getState().fetchProgress({ force: true });
    import('../stores/gamesDataStore').then(({ useGamesDataStore }) =>
      useGamesDataStore.getState().invalidateGames()
    );

    notify(UPLOAD_PHASE.COMPLETE, 100, r2Result.uploaded ? 'Upload complete' : 'Game linked');

    return {
      status: gameResult.status,
      game_id: gameResult.game_id,
      name: gameResult.name,
      video_url: gameResult.video_url,
      blake3_hash: r2Result.blake3_hash,
      file_size: r2Result.file_size,
      deduplicated: !r2Result.uploaded,
    };
  } catch (error) {
    // T7470: only-if-empty cleanup. Delete the pending game ONLY if it acquired no
    // user content — a user may have annotated clips against it during upload (T1540).
    // The backend refuses (no-op) when content exists, leaving the game pending; the
    // failure toast (uploadStore.onUploadError) is the user-visible surface until T7490
    // builds the pending/retry UI.
    // T7870: never fire the cleanup at all once the game is validated (dedup or
    // activateGame succeeded) — a later throw in this try block (a lost response, a
    // slow request) must not race a paid, ready game into the cleanup path. The
    // backend's own status check is the real invariant; this is defense in depth.
    // T8180: also never fire it while the user is still annotating this game — see
    // isUserAnnotatingGame. The entry stays errored (uploadStore) for Retry/Discard.
    if (gameResult?.game_id && !activated && !isUserAnnotatingGame(gameResult.game_id)) {
      try {
        await apiFetch(`${API_BASE}/api/games/${gameResult.game_id}?only_if_empty=true`, { method: 'DELETE' });
      } catch (cleanupErr) {
        // Best-effort cleanup — log but don't mask the original error.
        console.warn('[uploadGame] Failed to clean up pending game:', cleanupErr);
      }
    } else if (gameResult?.game_id && !activated) {
      console.warn(`[uploadGame] Upload failed but user is annotating game ${gameResult.game_id} — skipping cleanup delete; game retained for Retry/Discard`);
    }
    notify(UPLOAD_PHASE.ERROR, 0, error.message);
    throw error;
  }
}

/**
 * Upload multiple videos for one game (e.g., first half + second half)
 *
 * Each video goes through full BLAKE3 hash + R2 dedup independently.
 * After all videos are in R2, creates game with all video references.
 *
 * @param {File[]} files - Array of video files (in order)
 * @param {function} onProgress - Progress callback
 * @param {Object} options - Game details and per-video metadata
 * @param {Array<Object>} options.videoMetadataList - Per-video metadata [{ duration, width, height }]
 * @returns {Promise<Object>} - Result with game_id, videos array
 */
export async function uploadMultiVideoGame(files, onProgress, options = {}) {
  const notify = (phase, percent, message) => {
    if (onProgress) {
      onProgress({ phase, percent, message });
    }
  };

  let gameResult = null;
  // T7870: see uploadGame's identical flag — never let a later throw in this try
  // block race the cleanup delete against a game the server already activated.
  let activated = false;

  try {
    const fileCount = files.length;
    const fileWeight = 1 / fileCount;
    let lastAttach = null;

    // T1540: Hash first file → create game as pending → upload all → activate.
    // game_id is available within seconds so clips persist during upload.
    for (let i = 0; i < fileCount; i++) {
      const file = files[i];
      const sequence = i + 1;
      const metadata = options.videoMetadataList?.[i] || {};
      const basePercent = i * fileWeight * 100;
      // T8810: uniform per-video label (was 'First Half'/'Second Half'/'Part N') now
      // that a game is an ordered N-video list, not a two-half pair.
      const label = `Video ${sequence} of ${fileCount}`;

      const perFileProgress = (progress) => {
        const overallPercent = Math.round(basePercent + progress.percent * fileWeight);
        notify(progress.phase, overallPercent, `${label}: ${progress.message}`);
      };

      // Step A: Hash this file.
      const hashResult = await hashAndAnalyze(file, perFileProgress);

      const videoRef = {
        blake3_hash: hashResult.blake3_hash,
        sequence,
        duration: metadata.duration || null,
        width: metadata.width || null,
        height: metadata.height || null,
        file_size: hashResult.file_size,
      };

      // Step B: First file — create game as pending before upload.
      if (i === 0) {
        gameResult = await createGame(options, [videoRef], 'pending');
        if (options.onGameCreated) {
          options.onGameCreated({ game_id: gameResult.game_id, name: gameResult.name });
        }
      }

      // Step C: Upload bytes to R2.
      await ensureVideoInR2(file, perFileProgress, {
        videoDuration: metadata.duration || null,
        videoWidth: metadata.width || null,
        videoHeight: metadata.height || null,
        label,
        precomputed: hashResult,
      });

      // Step D: activate right after the FIRST video lands, before attaching
      // any subsequent one. T8940 fix: add_game_videos (T8700) 409s
      // ("Videos can only be added to a ready game") unless the game is
      // already 'ready' — activating only once, after the WHOLE loop, meant
      // every video 2..N always hit that guard while the game was still
      // 'pending' (a deterministic bug, not a timing race — it failed 100% of
      // the time for any 2+ file create). Activating here instead also makes
      // the game usable immediately after video 1 (T1540's annotate-during-
      // upload intent), with videos 2..N streaming in via the SAME append
      // mechanism T8700 already uses for post-creation attach.
      if (i === 0) {
        await activateGame(gameResult.game_id);
        activated = true;
      } else {
        // Step E: Subsequent files — attach to the now-ready game after upload.
        lastAttach = await addVideosToGame(gameResult.game_id, [videoRef]);
      }
    }

    useQuestStore.getState().fetchProgress({ force: true });
    import('../stores/gamesDataStore').then(({ useGamesDataStore }) =>
      useGamesDataStore.getState().invalidateGames()
    );

    notify(UPLOAD_PHASE.COMPLETE, 100, 'Upload complete');

    return {
      status: gameResult.status,
      game_id: gameResult.game_id,
      name: gameResult.name,
      video_url: lastAttach?.videos?.[0]?.video_url || gameResult.video_url || null,
      videos: lastAttach?.videos || gameResult.videos,
      deduplicated: false,
    };
  } catch (error) {
    // T7470: only-if-empty cleanup (see uploadGame). Never cascade-delete a game the
    // user annotated against during a multi-video upload; the backend refuses when
    // content exists and leaves the game pending.
    // T7870: also never fire it once activateGame already succeeded (see uploadGame).
    // T8180: also never fire it while the user is still annotating this game.
    if (gameResult?.game_id && !activated && !isUserAnnotatingGame(gameResult.game_id)) {
      try {
        await apiFetch(`${API_BASE}/api/games/${gameResult.game_id}?only_if_empty=true`, { method: 'DELETE' });
      } catch (cleanupErr) {
        console.warn('[uploadMultiVideoGame] Failed to clean up pending game:', cleanupErr);
      }
    } else if (gameResult?.game_id && !activated) {
      console.warn(`[uploadMultiVideoGame] Upload failed but user is annotating game ${gameResult.game_id} — skipping cleanup delete; game retained for Retry/Discard`);
    }
    notify(UPLOAD_PHASE.ERROR, 0, error.message);
    throw error;
  }
}

/**
 * T8700: Attach ONE additional video to an existing, already-`ready` game.
 *
 * Reuses the exact create-time transport uploadMultiVideoGame runs for halves
 * >= 2 — hashAndAnalyze -> ensureVideoInR2 (dedup-aware R2 multipart upload) ->
 * addVideosToGame (POST /api/games/{id}/videos) — so create-time and attach-time
 * share ONE upload path (DRY). The hardened endpoint (design Phase 1) charges
 * credits, writes a storage ref, and assigns the append-only sequence
 * server-side; this helper drives the client transport and, ONLY on success,
 * re-loads the game so Annotate re-derives its virtual timeline (single->multi
 * transition, design GAP 3). The re-load is a READ — no reactive write-back.
 *
 * The `blake3_hash` sent is the server-confirmed hash of the object in R2; the
 * server assigns the sequence (append-only), so we do not send one.
 *
 * @param {number} gameId - Existing ready game to attach the video to
 * @param {File} file - Video file (e.g. a second half)
 * @param {function} [onProgress] - ({ phase, percent, message }) => void
 * @returns {Promise<Object>} - addVideosToGame result incl. upload_cost_charged
 */
export async function attachVideoToExistingGame(gameId, file, onProgress) {
  const notify = (phase, percent, message) => {
    if (onProgress) onProgress({ phase, percent, message });
  };

  // Step 1: hash + faststart analysis (emits 'hashing' progress).
  const hashResult = await hashAndAnalyze(file, onProgress);

  // Step 2: ensure the bytes are durable in R2 (dedup-aware multipart upload).
  const r2Result = await ensureVideoInR2(file, onProgress, {
    precomputed: hashResult,
  });

  // Step 3: attach to the game. The endpoint assigns the append-only sequence
  // (MAX(sequence)+1) server-side, so we intentionally omit `sequence`.
  const videoRef = {
    blake3_hash: r2Result.blake3_hash,
    file_size: r2Result.file_size,
    duration: null,
    width: null,
    height: null,
  };
  const result = await addVideosToGame(gameId, [videoRef]);

  // Step 4 (success only): re-load the game via /load so AnnotateContainer
  // re-derives gameVideos and buildFullVideoTimeline runs (single->multi). Also
  // refresh the games list so its aggregate duration/size pick up the new half,
  // and the quest progress in case a milestone fired. A throw in step 1-3 skips
  // this entirely — no reload on failure.
  const { useGamesDataStore } = await import('../stores/gamesDataStore');
  await useGamesDataStore.getState().loadGame(gameId);
  useGamesDataStore.getState().invalidateGames();
  useQuestStore.getState().fetchProgress({ force: true });

  notify(UPLOAD_PHASE.COMPLETE, 100, 'Video added');

  return result;
}

/**
 * Cancel an in-progress upload
 * @param {string} sessionId - Upload session ID from prepare-upload
 */
export async function cancelUpload(sessionId) {
  const response = await apiFetch(`${API_BASE}/api/games/upload/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Cancel failed: ${response.status}`));
  }

  return await response.json();
}

/**
 * Get presigned URL for a deduplicated game
 * @param {number} gameId - Game ID from user_games table
 * @returns {Promise<string>} - Presigned URL
 */
export async function getDedupeGameUrl(gameId) {
  const response = await apiFetch(`${API_BASE}/api/games/dedupe/${gameId}/url`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Failed to get URL: ${response.status}`));
  }

  const data = await response.json();
  return data.url;
}

/**
 * Delete a deduplicated game from user's library
 * @param {number} gameId - Game ID from user_games table
 */
export async function deleteDedupeGame(gameId) {
  const response = await apiFetch(`${API_BASE}/api/games/dedupe/${gameId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `Delete failed: ${response.status}`));
  }

  return await response.json();
}

/**
 * List all deduplicated games in user's library
 * @returns {Promise<Array>} - Array of game objects
 */
export async function listDedupeGames() {
  const response = await apiFetch(`${API_BASE}/api/games/dedupe`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(extractErrorMessage(error, `List failed: ${response.status}`));
  }

  const data = await response.json();
  return data.games;
}

/**
 * List pending uploads that can be resumed.
 * Deduped: concurrent callers share the same promise.
 * @returns {Promise<Array>} - Array of pending upload objects
 */
let _pendingUploadsPromise = null;
export async function listPendingUploads() {
  // T1330: no uploads to list pre-login.
  const { useAuthStore } = await import('../stores/authStore');
  if (!useAuthStore.getState().isAuthenticated) return [];
  if (_pendingUploadsPromise) return _pendingUploadsPromise;

  _pendingUploadsPromise = (async () => {
    try {
      const response = await apiFetch(`${API_BASE}/api/games/pending-uploads`);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(extractErrorMessage(error, `List failed: ${response.status}`));
      }

      const data = await response.json();
      return data.pending_uploads;
    } finally {
      _pendingUploadsPromise = null;
    }
  })();
  return _pendingUploadsPromise;
}
