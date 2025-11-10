/**
 * Video utility functions for metadata extraction and video handling
 */

/**
 * Extract metadata from video file
 * @param {File} file - Video file
 * @returns {Promise<Object>} Video metadata
 */
export async function extractVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      video.remove();
      // Don't revoke URL here, we'll use it in the player
    };

    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight,
        format: file.name.split('.').pop().toLowerCase(),
        size: file.size,
        fileName: file.name
      };

      cleanup();
      resolve(metadata);
    };

    video.onerror = () => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };

    // Set timeout for loading
    setTimeout(() => {
      if (video.readyState === 0) {
        cleanup();
        URL.revokeObjectURL(url);
        reject(new Error('Video loading timed out'));
      }
    }, 10000); // 10 second timeout

    video.src = url;
  });
}

/**
 * Create revokable blob URL for video
 * @param {File} file - Video file
 * @returns {string} Blob URL
 */
export function createVideoURL(file) {
  return URL.createObjectURL(file);
}

/**
 * Revoke blob URL to free memory
 * @param {string} url - Blob URL to revoke
 */
export function revokeVideoURL(url) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Get estimated framerate from video element
 * Note: This is a fallback. Actual framerate detection requires more complex analysis
 * @param {HTMLVideoElement} videoElement - Video element
 * @returns {number} Estimated framerate (defaults to 30)
 */
export function getFramerate(videoElement) {
  // For now, default to 30fps.
  // True framerate detection would require frame counting or metadata parsing
  return 30;
}

/**
 * Convert time (seconds) to frame number
 * @param {number} time - Time in seconds
 * @param {number} framerate - Video framerate
 * @returns {number} Frame number (integer)
 */
export function timeToFrame(time, framerate = 30) {
  return Math.round(time * framerate);
}

/**
 * Convert frame number to time (seconds)
 * @param {number} frame - Frame number
 * @param {number} framerate - Video framerate
 * @returns {number} Time in seconds
 */
export function frameToTime(frame, framerate = 30) {
  return frame / framerate;
}
