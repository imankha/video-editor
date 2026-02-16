/**
 * Hash Worker - BLAKE3 file hashing in a Web Worker (WASM-accelerated)
 *
 * This worker computes BLAKE3 hashes of large files without blocking the main thread.
 * Uses hash-wasm for ~20x faster hashing than pure JavaScript.
 *
 * The worker itself is lazy-loaded (created only when hashing is needed),
 * so the WASM module only loads when the first hash is requested.
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

import { createBLAKE3 } from 'hash-wasm';

// 8MB chunks for good progress granularity and efficient WASM processing
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Hash a file using BLAKE3 (WASM) with progress updates
 * @param {File} file - File to hash
 */
async function hashFile(file) {
  // Initialize WASM hasher
  const hasher = await createBLAKE3();

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
  const hashHex = hasher.digest('hex');

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
