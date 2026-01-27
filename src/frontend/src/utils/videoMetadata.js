/**
 * Extract metadata from a video URL.
 * Used for loading project clips from backend.
 *
 * @param {string} url - URL to the video file
 * @param {string} fileName - Optional filename for the video
 * @returns {Promise<Object>} Video metadata
 */
export async function extractVideoMetadataFromUrl(url, fileName = 'clip.mp4') {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    // Note: Don't set crossOrigin for presigned R2 URLs - we only need metadata,
    // not canvas pixel access, so "opaque" mode (no CORS) is fine

    const cleanup = () => {
      video.remove();
    };

    // Set timeout for loading
    const timeoutId = setTimeout(() => {
      if (video.readyState === 0) {
        cleanup();
        reject(new Error('Video metadata loading timed out'));
      }
    }, 15000); // 15 second timeout for network videos

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);

      const metadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,
        fileName: fileName,
        format: fileName.split('.').pop().toLowerCase() || 'mp4',
        framerate: 30, // Default, could be extracted if needed
      };

      console.log('[videoMetadata] Extracted metadata from URL:', {
        ...metadata,
        url: url,
        durationFormatted: `${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toFixed(2)}`,
        resolution: `${metadata.width}x${metadata.height}`,
      });

      cleanup();
      resolve(metadata);
    };

    video.onerror = (e) => {
      clearTimeout(timeoutId);
      cleanup();
      console.error('[videoMetadata] Failed to load video from URL:', url, e);
      reject(new Error('Failed to load video metadata from URL'));
    };

    video.src = url;
  });
}

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
    video.muted = true; // Helps with autoplay policies

    const url = URL.createObjectURL(videoSource);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    // Set timeout for loading - longer timeout for large blobs
    const timeoutMs = Math.max(30000, (videoSource.size || 0) / 500000 * 1000); // 30s min, +1s per 500KB
    const timeoutId = setTimeout(() => {
      if (video.readyState === 0) {
        console.warn('[videoMetadata] Timeout waiting for metadata, readyState:', video.readyState, 'size:', videoSource.size);
        cleanup();
        reject(new Error('Video metadata loading timed out'));
      }
    }, timeoutMs);

    video.onloadedmetadata = () => {
      clearTimeout(timeoutId);

      // Extract all available metadata from the video element
      const metadata = {
        // Basic dimensions
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        aspectRatio: video.videoWidth / video.videoHeight,

        // File info
        fileName: videoSource.name || 'rendered_video.mp4',
        size: videoSource.size,
        type: videoSource.type,
        format: videoSource.type?.split('/')[1] ||
                (videoSource.name ? videoSource.name.split('.').pop().toLowerCase() : 'mp4'),

        // Video element state
        readyState: video.readyState,
        networkState: video.networkState,

        // Tracks info (if available)
        audioTracksCount: video.audioTracks?.length || 0,
        videoTracksCount: video.videoTracks?.length || 0,
        textTracksCount: video.textTracks?.length || 0,

        // Playback info
        defaultPlaybackRate: video.defaultPlaybackRate,
        preload: video.preload,

        // Additional file details
        lastModified: videoSource.lastModified,
        lastModifiedDate: videoSource.lastModified ? new Date(videoSource.lastModified).toISOString() : null,
      };

      // Log comprehensive metadata
      console.log('[videoMetadata] Extracted video metadata:', {
        ...metadata,
        sizeFormatted: `${(metadata.size / (1024 * 1024)).toFixed(2)} MB`,
        durationFormatted: `${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toFixed(2)}`,
        resolution: `${metadata.width}x${metadata.height}`,
      });

      cleanup();
      resolve(metadata);
    };

    video.onerror = (e) => {
      clearTimeout(timeoutId);
      console.error('[videoMetadata] Video load error:', e);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
    video.load(); // Force the browser to start loading
  });
}
