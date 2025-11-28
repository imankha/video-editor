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

    const url = URL.createObjectURL(videoSource);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    // Set timeout for loading
    const timeoutId = setTimeout(() => {
      if (video.readyState === 0) {
        cleanup();
        reject(new Error('Video metadata loading timed out'));
      }
    }, 10000); // 10 second timeout

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);
      const metadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,
        fileName: videoSource.name || 'rendered_video.mp4',
        size: videoSource.size,
        format: videoSource.type?.split('/')[1] ||
                (videoSource.name ? videoSource.name.split('.').pop().toLowerCase() : 'mp4'),
      };
      cleanup();
      resolve(metadata);
    };

    video.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
  });
}
