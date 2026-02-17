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

// Upload status returned from prepare-upload
export const UPLOAD_STATUS = {
  ALREADY_OWNED: 'already_owned',
  LINKED: 'linked',
  UPLOAD_REQUIRED: 'upload_required',
};

import { createBLAKE3 } from 'hash-wasm';

// 8MB chunks - good balance of progress updates and efficiency
const HASH_CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Hash a file using BLAKE3 (WASM-accelerated)
 * Processes in chunks with async yielding to keep UI responsive.
 *
 * @param {File} file - File to hash
 * @param {function} onProgress - Progress callback: (percent) => void
 * @returns {Promise<string>} - BLAKE3 hash as hex string
 */
export async function hashFile(file, onProgress) {
  const hasher = await createBLAKE3();

  let offset = 0;
  let lastProgressSent = -1;

  while (offset < file.size) {
    // Read chunk
    const end = Math.min(offset + HASH_CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const buffer = await chunk.arrayBuffer();

    // Update hash
    hasher.update(new Uint8Array(buffer));

    // Calculate and report progress
    offset = end;
    const percent = Math.round((offset / file.size) * 100);

    if (percent !== lastProgressSent) {
      lastProgressSent = percent;
      if (onProgress) onProgress(percent);
    }

    // Yield to event loop every chunk to keep UI responsive
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
 * Upload a game with deduplication support
 *
 * @param {File} file - Video file to upload
 * @param {function} onProgress - Progress callback: ({ phase, percent, message }) => void
 * @param {Object} options - Optional game details and metadata
 * @param {string} options.opponentName - Opponent team name
 * @param {string} options.gameDate - Game date (YYYY-MM-DD)
 * @param {string} options.gameType - 'home', 'away', or 'tournament'
 * @param {string} options.tournamentName - Tournament name
 * @param {number} options.videoDuration - Video duration in seconds
 * @param {number} options.videoWidth - Video width in pixels
 * @param {number} options.videoHeight - Video height in pixels
 * @returns {Promise<Object>} - Result with status, game_id, name, video_url, etc.
 */
export async function uploadGame(file, onProgress, options = {}) {
  const notify = (phase, percent, message) => {
    if (onProgress) {
      onProgress({ phase, percent, message });
    }
  };

  try {
    // Phase 1: Hash
    notify(UPLOAD_PHASE.HASHING, 0, 'Computing file hash...');
    const hash = await hashFile(file, (p) => {
      notify(UPLOAD_PHASE.HASHING, p, `Computing hash... ${p}%`);
    });
    notify(UPLOAD_PHASE.HASHING, 100, 'Hash complete');

    // Phase 2: Prepare
    notify(UPLOAD_PHASE.PREPARING, 0, 'Checking for existing file...');
    const prepareRes = await fetch(`${API_BASE}/api/games/prepare-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blake3_hash: hash,
        file_size: file.size,
        original_filename: file.name,
        // Game details for display name
        opponent_name: options.opponentName || null,
        game_date: options.gameDate || null,
        game_type: options.gameType || null,
        tournament_name: options.tournamentName || null,
        // Video metadata
        video_duration: options.videoDuration || null,
        video_width: options.videoWidth || null,
        video_height: options.videoHeight || null,
      }),
    });

    if (!prepareRes.ok) {
      const error = await prepareRes.json().catch(() => ({}));
      throw new Error(error.detail || `Prepare failed: ${prepareRes.status}`);
    }

    const prepareData = await prepareRes.json();

    // Check if we can skip upload (deduplication)
    if (prepareData.status === UPLOAD_STATUS.ALREADY_OWNED) {
      notify(UPLOAD_PHASE.COMPLETE, 100, 'You already have this game');
      return {
        status: 'already_owned',
        game_id: prepareData.game_id,
        name: prepareData.name,
        video_url: prepareData.video_url,
        deduplicated: true,
      };
    }

    if (prepareData.status === UPLOAD_STATUS.LINKED) {
      notify(UPLOAD_PHASE.COMPLETE, 100, 'Game linked to your account');
      return {
        status: 'linked',
        game_id: prepareData.game_id,
        name: prepareData.name,
        video_url: prepareData.video_url,
        deduplicated: true,
        message: prepareData.message,
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

    // Phase 4: Finalize
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
        // Game details for display name
        opponent_name: options.opponentName || null,
        game_date: options.gameDate || null,
        game_type: options.gameType || null,
        tournament_name: options.tournamentName || null,
        // Video metadata
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
      status: 'uploaded',
      game_id: finalizeData.game_id,
      name: finalizeData.name,
      video_url: finalizeData.video_url,
      blake3_hash: finalizeData.blake3_hash,
      file_size: finalizeData.file_size,
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
