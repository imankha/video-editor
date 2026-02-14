/**
 * Hash Worker - BLAKE3 file hashing in a Web Worker
 *
 * This worker computes BLAKE3 hashes of large files without blocking the main thread.
 * Used for game deduplication: same hash = same file = no need to re-upload.
 *
 * Usage from main thread:
 *   const worker = new Worker(new URL('./workers/hashWorker.js', import.meta.url), { type: 'module' });
 *   worker.postMessage({ file: fileObject });
 *   worker.onmessage = (e) => {
 *     if (e.data.type === 'progress') console.log(e.data.percent + '%');
 *     if (e.data.type === 'complete') console.log('Hash:', e.data.hash);
 *     if (e.data.type === 'error') console.error(e.data.error);
 *   };
 */

import { blake3 } from '@noble/hashes/blake3';

// 8MB chunks for good progress granularity
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Hash a file using BLAKE3 with progress updates
 * @param {File} file - File to hash
 */
async function hashFile(file) {
  const hasher = blake3.create({});
  let offset = 0;
  let lastProgressSent = -1;

  while (offset < file.size) {
    // Read chunk
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);
    const buffer = await chunk.arrayBuffer();

    // Update hash
    hasher.update(new Uint8Array(buffer));

    // Calculate progress
    offset = end;
    const percent = Math.round((offset / file.size) * 100);

    // Send progress update (every 1% change)
    if (percent !== lastProgressSent) {
      lastProgressSent = percent;
      self.postMessage({
        type: 'progress',
        percent,
        bytesProcessed: offset,
        totalBytes: file.size,
      });
    }
  }

  // Compute final hash
  const hash = hasher.digest();

  // Convert to hex string
  const hashHex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
}

// Handle messages from main thread
self.onmessage = async (e) => {
  const { file } = e.data;

  if (!file) {
    self.postMessage({
      type: 'error',
      error: 'No file provided',
    });
    return;
  }

  try {
    const hash = await hashFile(file);

    self.postMessage({
      type: 'complete',
      hash,
      fileName: file.name,
      fileSize: file.size,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error.message || 'Unknown error during hashing',
    });
  }
};
