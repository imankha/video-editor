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

    video.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
  });
}
