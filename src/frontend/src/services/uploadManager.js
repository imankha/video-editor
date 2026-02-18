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
import { GameCreateStatus } from '../constants/gameConstants';

// Upload phases for progress tracking
export const UPLOAD_PHASE = {
  IDLE: 'idle',
  HASHING: 'hashing',
  PREPARING: 'preparing',
  UPLOADING: 'uploading',
  FINALIZING: 'finalizing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

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
export async function hashFile(file, onProgress) {
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

  return hasher.digest('hex');
}

/**
 * Upload a single part to R2
 * @param {File} file - Source file
 * @param {Object} part - Part info with presigned_url, start_byte, end_byte
 * @param {function} onProgress - Progress callback: (loaded, total) => void
 * @returns {Promise<Object>} - { part_number, etag }
 */
async function uploadPart(file, part, onProgress) {
  const { part_number, presigned_url, start_byte, end_byte } = part;
  const blob = file.slice(start_byte, end_byte + 1);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presigned_url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // R2 returns ETag in response headers
        const etag = xhr.getResponseHeader('ETag');
        resolve({ part_number, etag });
      } else {
        reject(new Error(`Part ${part_number} upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error(`Part ${part_number} network error`));
    };

    xhr.send(blob);
  });
}

/**
 * Save completed parts to backend for resume support
 * @param {string} sessionId - Upload session ID
 * @param {Array} parts - Array of { part_number, etag }
 */
async function saveCompletedParts(sessionId, parts) {
  try {
    await fetch(`${API_BASE}/api/games/upload/${sessionId}/parts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    });
  } catch (e) {
    // Non-fatal - just means resume won't work if browser crashes
    console.warn('Failed to save completed parts:', e);
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
 * @param {number} concurrency - Max concurrent uploads (default 3)
 * @returns {Promise<Array>} - Array of { part_number, etag } (all parts including completed)
 */
async function uploadParts(
  file,
  parts,
  onProgress,
  sessionId = null,
  completedParts = [],
  totalBytes = null,
  concurrency = 3
) {
  const results = [...completedParts]; // Start with already completed parts
  const partProgress = new Map(); // Track progress per part

  // Calculate total bytes for progress (including already completed)
  const remainingBytes = parts.reduce(
    (sum, p) => sum + (p.end_byte - p.start_byte + 1),
    0
  );
  const completedBytes = completedParts.reduce((sum, p) => {
    // Estimate completed part sizes (100MB each except possibly last)
    return sum + 100 * 1024 * 1024;
  }, 0);
  const total = totalBytes || remainingBytes + completedBytes;

  // Initialize progress with completed parts
  let baseProgress = completedBytes;

  const updateTotalProgress = () => {
    const uploadedBytes =
      baseProgress +
      Array.from(partProgress.values()).reduce((sum, p) => sum + p, 0);
    const percent = Math.min(100, Math.round((uploadedBytes / total) * 100));
    if (onProgress) onProgress(percent);
  };

  // Report initial progress if resuming
  if (completedParts.length > 0) {
    updateTotalProgress();
  }

  // Parts to save in batches (save every 3 parts to reduce requests)
  const partsToSave = [];
  const SAVE_BATCH_SIZE = 3;

  // Upload parts with concurrency limit
  const queue = [...parts];
  const executing = new Set();

  while (queue.length > 0 || executing.size > 0) {
    // Start new uploads up to concurrency limit
    while (queue.length > 0 && executing.size < concurrency) {
      const part = queue.shift();

      const promise = uploadPart(file, part, (loaded) => {
        partProgress.set(part.part_number, loaded);
        updateTotalProgress();
      })
        .then((result) => {
          results.push(result);
          partsToSave.push(result);
          partProgress.set(
            part.part_number,
            part.end_byte - part.start_byte + 1
          );
          updateTotalProgress();
          executing.delete(promise);

          // Save completed parts in batches for resume support
          if (sessionId && partsToSave.length >= SAVE_BATCH_SIZE) {
            const batch = partsToSave.splice(0, partsToSave.length);
            saveCompletedParts(sessionId, batch);
          }
        })
        .catch((error) => {
          executing.delete(promise);
          throw error;
        });

      executing.add(promise);
    }

    // Wait for at least one to complete
    if (executing.size > 0) {
      await Promise.race(executing);
    }
  }

  // Save any remaining parts
  if (sessionId && partsToSave.length > 0) {
    await saveCompletedParts(sessionId, partsToSave);
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
export async function ensureVideoInR2(file, onProgress, options = {}) {
  const notify = (phase, percent, message) => {
    if (onProgress) {
      onProgress({ phase, percent, message });
    }
  };

  // Phase 1: Hash
  notify(UPLOAD_PHASE.HASHING, 0, 'Computing file hash...');
  const hash = await hashFile(file, (p) => {
    notify(UPLOAD_PHASE.HASHING, p, `Computing hash... ${p}%`);
  });
  notify(UPLOAD_PHASE.HASHING, 100, 'Hash complete');

  // Phase 2: Prepare (check R2 for dedup)
  notify(UPLOAD_PHASE.PREPARING, 0, 'Checking for existing file...');
  const prepareRes = await fetch(`${API_BASE}/api/games/prepare-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blake3_hash: hash,
      file_size: file.size,
      original_filename: file.name,
    }),
  });

  if (!prepareRes.ok) {
    const error = await prepareRes.json().catch(() => ({}));
    throw new Error(error.detail || `Prepare failed: ${prepareRes.status}`);
  }

  const prepareData = await prepareRes.json();

  // Video already exists in R2 - skip upload
  if (prepareData.status === UPLOAD_STATUS.EXISTS) {
    notify(UPLOAD_PHASE.COMPLETE, 100, 'Video already uploaded');
    return {
      blake3_hash: hash,
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

  const parts = await uploadParts(
    file,
    prepareData.parts,
    (p) => {
      notify(UPLOAD_PHASE.UPLOADING, p, `Uploading... ${p}%`);
    },
    prepareData.upload_session_id,
    completedParts,
    file.size
  );
  notify(UPLOAD_PHASE.UPLOADING, 100, 'Upload complete');

  // Phase 4: Finalize R2 multipart
  notify(UPLOAD_PHASE.FINALIZING, 0, 'Finalizing upload...');
  const finalizeRes = await fetch(`${API_BASE}/api/games/finalize-upload`, {
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
    throw new Error(error.detail || `Finalize failed: ${finalizeRes.status}`);
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
 * Create a game via POST /api/games
 *
 * @param {Object} options - Game details
 * @param {Array<Object>} videos - Video references [{ blake3_hash, sequence, duration, width, height, file_size }]
 * @returns {Promise<Object>} - { status, game_id, name, video_url, videos }
 */
async function createGame(options, videos) {
  const res = await fetch(`${API_BASE}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      opponent_name: options.opponentName || null,
      game_date: options.gameDate || null,
      game_type: options.gameType || null,
      tournament_name: options.tournamentName || null,
      videos,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || `Create game failed: ${res.status}`);
  }

  return await res.json();
}

/**
 * Upload a game with deduplication support (single video)
 *
 * Flow:
 * 1. Hash file → check R2 → upload if needed (ensureVideoInR2)
 * 2. Create game via POST /api/games with video reference
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

  try {
    // Step 1: Ensure video is in R2 (hash + dedup + upload)
    const r2Result = await ensureVideoInR2(file, onProgress, options);

    // Step 2: Create game with video reference
    notify(UPLOAD_PHASE.FINALIZING, 90, 'Creating game...');
    const gameResult = await createGame(options, [{
      blake3_hash: r2Result.blake3_hash,
      sequence: 1,
      duration: options.videoDuration || null,
      width: options.videoWidth || null,
      height: options.videoHeight || null,
      file_size: r2Result.file_size || file.size,
    }]);

    const deduplicated = !r2Result.uploaded || gameResult.status === UPLOAD_STATUS.ALREADY_OWNED;

    notify(UPLOAD_PHASE.COMPLETE, 100, deduplicated ? 'Game linked' : 'Upload complete');

    return {
      status: gameResult.status,
      game_id: gameResult.game_id,
      name: gameResult.name,
      video_url: gameResult.video_url,
      blake3_hash: r2Result.blake3_hash,
      file_size: r2Result.file_size,
      deduplicated,
    };
  } catch (error) {
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

  try {
    const videoRefs = [];
    const fileCount = files.length;

    // Step 1: Upload each video to R2 sequentially
    for (let i = 0; i < fileCount; i++) {
      const file = files[i];
      const sequence = i + 1;
      const metadata = options.videoMetadataList?.[i] || {};
      const fileWeight = 1 / fileCount;
      const basePercent = i * fileWeight * 100;

      const r2Result = await ensureVideoInR2(file, (progress) => {
        // Map per-file progress to overall progress
        const overallPercent = Math.round(basePercent + progress.percent * fileWeight);
        notify(
          progress.phase,
          overallPercent,
          `Half ${sequence}: ${progress.message}`
        );
      }, {
        videoDuration: metadata.duration || null,
        videoWidth: metadata.width || null,
        videoHeight: metadata.height || null,
      });

      videoRefs.push({
        blake3_hash: r2Result.blake3_hash,
        sequence,
        duration: metadata.duration || null,
        width: metadata.width || null,
        height: metadata.height || null,
        file_size: r2Result.file_size || file.size,
      });
    }

    // Step 2: Create game with all video references
    notify(UPLOAD_PHASE.FINALIZING, 95, 'Creating game...');
    const gameResult = await createGame(options, videoRefs);

    notify(UPLOAD_PHASE.COMPLETE, 100, 'Upload complete');

    return {
      status: gameResult.status,
      game_id: gameResult.game_id,
      name: gameResult.name,
      video_url: gameResult.video_url,
      videos: gameResult.videos,
      deduplicated: false,
    };
  } catch (error) {
    notify(UPLOAD_PHASE.ERROR, 0, error.message);
    throw error;
  }
}

/**
 * Cancel an in-progress upload
 * @param {string} sessionId - Upload session ID from prepare-upload
 */
export async function cancelUpload(sessionId) {
  const response = await fetch(`${API_BASE}/api/games/upload/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Cancel failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Get presigned URL for a deduplicated game
 * @param {number} gameId - Game ID from user_games table
 * @returns {Promise<string>} - Presigned URL
 */
export async function getDedupeGameUrl(gameId) {
  const response = await fetch(`${API_BASE}/api/games/dedupe/${gameId}/url`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to get URL: ${response.status}`);
  }

  const data = await response.json();
  return data.url;
}

/**
 * Delete a deduplicated game from user's library
 * @param {number} gameId - Game ID from user_games table
 */
export async function deleteDedupeGame(gameId) {
  const response = await fetch(`${API_BASE}/api/games/dedupe/${gameId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Delete failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * List all deduplicated games in user's library
 * @returns {Promise<Array>} - Array of game objects
 */
export async function listDedupeGames() {
  const response = await fetch(`${API_BASE}/api/games/dedupe`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `List failed: ${response.status}`);
  }

  const data = await response.json();
  return data.games;
}

/**
 * List pending uploads that can be resumed
 * @returns {Promise<Array>} - Array of pending upload objects
 */
export async function listPendingUploads() {
  const response = await fetch(`${API_BASE}/api/games/pending-uploads`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `List failed: ${response.status}`);
  }

  const data = await response.json();
  return data.pending_uploads;
}
