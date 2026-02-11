import { useRef, useEffect, useCallback } from 'react';
import { extractVideoMetadata, createVideoURL, revokeVideoURL, getFramerate } from '../utils/videoUtils';
import { validateVideoFile } from '../utils/fileValidation';
import { useVideoStore } from '../stores';
import { invalidateUrl } from '../utils/storageUrls';

/**
 * Custom hook for managing video state and playback
 *
 * Uses useVideoStore internally for shared state management.
 * This enables other components to access video state without prop drilling.
 *
 * @param {Function} getSegmentAtTime - Optional function to get segment info at a given time
 * @param {Function} clampToVisibleRange - Optional function to clamp time to visible (non-trimmed) range
 * @returns {Object} Video state and control functions
 *
 * @see stores/videoStore.js for the underlying state store
 * @see APP_REFACTOR_PLAN.md for refactoring context
 */
export function useVideo(getSegmentAtTime = null, clampToVisibleRange = null) {
  const videoRef = useRef(null);

  // Track retry attempts to prevent infinite loops
  const retryAttemptRef = useRef(0);
  const MAX_RETRY_ATTEMPTS = 2;

  // Get state and setters from the store
  const {
    videoFile,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    isSeeking,
    isBuffering,
    error,
    isLoading,
    isVideoElementLoading,
    loadingProgress,
    loadingElapsedSeconds,
    setVideoFile,
    setVideoUrl,
    setMetadata,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setIsSeeking,
    setIsBuffering,
    setError,
    setIsLoading,
    setVideoLoaded,
    setVideoElementReady,
    setLoadingProgress,
  } = useVideoStore();

  /**
   * Load a video file
   * @param {File} file - Video file to load
   */
  const loadVideo = async (file) => {
    setError(null);
    setIsLoading(true);

    // Validate file
    const validation = validateVideoFile(file);
    if (!validation.isValid) {
      setError(validation.error);
      setIsLoading(false);
      return;
    }

    try {
      // Clean up previous video
      if (videoUrl) {
        revokeVideoURL(videoUrl);
      }

      // Extract metadata
      const videoMetadata = await extractVideoMetadata(file);

      // Create blob URL
      const url = createVideoURL(file);

      // Batch update all video state
      setVideoLoaded({
        file,
        url,
        metadata: videoMetadata,
        duration: videoMetadata.duration,
      });
    } catch (err) {
      setError(err.message || 'Failed to load video');
      setIsLoading(false);
    }
  };

  /**
   * Load a video from URL (for server-side clips)
   * @param {string} url - URL to fetch video from
   * @param {string} filename - Optional filename for the created file
   * @returns {Promise<File|null>} - The loaded file or null on error
   */
  const loadVideoFromUrl = async (url, filename = 'video.mp4') => {
    console.log('[useVideo] loadVideoFromUrl (FULL DOWNLOAD) called with:', url);
    setError(null);
    setIsLoading(true);

    try {
      // Clean up previous blob URL (only if it's a blob URL we created)
      if (videoUrl && videoUrl.startsWith('blob:')) {
        console.log('[useVideo] Revoking previous blob URL:', videoUrl);
        revokeVideoURL(videoUrl);
      }

      // Fetch the video from URL
      console.log('[useVideo] Fetching video from:', url);
      const response = await fetch(url);
      console.log('[useVideo] Fetch response:', response.status, response.ok, 'final URL:', response.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }

      const blob = await response.blob();
      console.log('[useVideo] Blob received, size:', blob.size, 'type:', blob.type);
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });

      // Extract metadata
      const videoMetadata = await extractVideoMetadata(file);
      console.log('[useVideo] Video metadata extracted:', videoMetadata);

      // Create blob URL
      const blobUrl = createVideoURL(file);
      console.log('[useVideo] Created blob URL:', blobUrl);

      // Batch update all video state
      setVideoLoaded({
        file,
        url: blobUrl,
        metadata: videoMetadata,
        duration: videoMetadata.duration,
      });

      return file; // Return the file so caller can use it
    } catch (err) {
      console.error('[useVideo] loadVideoFromUrl error:', err);
      setError(err.message || 'Failed to load video from URL');
      setIsLoading(false);
      return null;
    }
  };

  /**
   * Load a video from a streaming URL (no blob download)
   * Use this for presigned R2 URLs where streaming is preferred.
   * @param {string} url - Streaming URL (e.g., presigned R2 URL)
   * @param {Object} preloadedMetadata - Optional pre-extracted metadata
   */
  const loadVideoFromStreamingUrl = (url, preloadedMetadata = null) => {
    console.log('[useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with:', url?.substring(0, 60));
    setError(null);
    retryAttemptRef.current = 0; // Reset retry counter on new video load

    // Clean up previous blob URL (only if it's a blob URL we created)
    if (videoUrl && videoUrl.startsWith('blob:')) {
      console.log('[useVideo] Revoking previous blob URL:', videoUrl);
      revokeVideoURL(videoUrl);
    }

    // Use URL directly - no blob download!
    // The browser will stream the video using HTTP Range requests
    setVideoLoaded({
      file: null, // No file for streaming URLs
      url: url,
      metadata: preloadedMetadata,
      duration: preloadedMetadata?.duration || 0,
    });

    console.log('[useVideo] Set streaming URL directly (instant)');
  };

  /**
   * Play video - handles promise to prevent race conditions
   * Note: Check videoRef.current.src instead of videoUrl to support overlay mode
   * where the video src is set externally (not via loadVideo)
   */
  const play = async () => {
    if (videoRef.current && videoRef.current.src) {
      try {
        // video.play() returns a promise - must handle it
        await videoRef.current.play();
      } catch (error) {
        // Ignore AbortError - happens when play() is interrupted by pause()
        if (error.name !== 'AbortError') {
          console.error('Video play error:', error);
        }
      }
    }
  };

  /**
   * Pause video
   */
  const pause = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  /**
   * Toggle play/pause - async to handle play() promise
   */
  const togglePlay = async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  };

  /**
   * Seek to specific time
   * @param {number} time - Target time in seconds
   *
   * ARCHITECTURE: All seeks go through clampToVisibleRange to prevent
   * seeking to trimmed frames. This is the single validation point.
   * Note: Check videoRef.current.src to support overlay mode where video
   * is loaded externally.
   *
   * SYNC FIX: We do NOT update currentTime immediately. Instead, we wait
   * for the 'seeked' event (handleSeeked) to update state after the video
   * frame actually changes. This prevents tracking squares from desyncing
   * during scrubbing.
   */
  const seek = (time) => {
    if (videoRef.current && videoRef.current.src) {
      // Get duration from video element if not set (overlay mode)
      const effectiveDuration = duration || videoRef.current.duration || 0;
      // Use centralized validation to prevent seeking to trimmed frames
      const validTime = clampToVisibleRange
        ? clampToVisibleRange(time)
        : Math.max(0, Math.min(time, effectiveDuration));

      setIsSeeking(true);
      videoRef.current.currentTime = validTime;
      // DON'T update currentTime here - wait for seeked event (handleSeeked)
      // to ensure tracking squares sync with the actual displayed frame
    }
  };

  /**
   * Step forward one frame
   * Uses frame-based calculation to avoid floating point accumulation errors.
   * Note: Check videoRef.current.src to support overlay mode
   */
  const stepForward = () => {
    if (videoRef.current && videoRef.current.src) {
      const framerate = getFramerate(videoRef.current);
      const effectiveDuration = duration || videoRef.current.duration || 0;
      // Convert current time to frame, add 1, convert back to time
      // This avoids floating point errors from repeatedly adding 1/framerate
      const currentFrame = Math.round(currentTime * framerate);
      const nextFrame = currentFrame + 1;
      const maxFrame = Math.floor(effectiveDuration * framerate);
      const targetFrame = Math.min(nextFrame, maxFrame);
      const newTime = targetFrame / framerate;
      seek(newTime);
    }
  };

  /**
   * Step backward one frame
   * Uses frame-based calculation to avoid floating point accumulation errors.
   * Note: Check videoRef.current.src to support overlay mode
   */
  const stepBackward = () => {
    if (videoRef.current && videoRef.current.src) {
      const framerate = getFramerate(videoRef.current);
      // Convert current time to frame, subtract 1, convert back to time
      // This avoids floating point errors from repeatedly subtracting 1/framerate
      const currentFrame = Math.round(currentTime * framerate);
      const prevFrame = currentFrame - 1;
      const targetFrame = Math.max(prevFrame, 0);
      const newTime = targetFrame / framerate;
      seek(newTime);
    }
  };

  /**
   * Restart video - resets playhead to beginning (or first visible frame if start is trimmed)
   * Note: Check videoRef.current.src to support overlay mode
   */
  const restart = () => {
    if (videoRef.current && videoRef.current.src) {
      pause();
      // seek(0) will automatically clamp to first visible frame if start is trimmed
      seek(0);
    }
  };

  // Video element event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current && !isSeeking) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  // Buffering event handlers - pause time updates when video is waiting for data
  const handleWaiting = () => {
    setIsBuffering(true);
  };

  const handlePlaying = () => {
    setIsBuffering(false);
  };

  const handleCanPlay = () => {
    if (isBuffering) {
      setIsBuffering(false);
    }
  };

  // T55: Update elapsed seconds during video loading for better progress feedback
  // This provides user feedback even when progress events aren't firing (cold cache)
  useEffect(() => {
    if (!isVideoElementLoading) return;

    const intervalId = setInterval(() => {
      const { loadStartTime } = useVideoStore.getState();
      if (loadStartTime) {
        const elapsed = Math.floor((performance.now() - loadStartTime) / 1000);
        useVideoStore.getState().setLoadingElapsedSeconds(elapsed);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isVideoElementLoading]);

  // Use requestAnimationFrame for smooth time updates during playback
  // The native timeupdate event only fires ~4 times/second which causes
  // visible lag in overlay positioning. RAF gives us ~60fps updates.
  //
  // SYNC FIX: Skip updates during buffering or seeking to prevent
  // playhead/tracking from advancing while video is stalled.
  useEffect(() => {
    if (!isPlaying || !videoRef.current) return;

    let rafId;
    const updateTime = () => {
      // Skip updates if buffering or seeking
      if (videoRef.current && !isSeeking && !isBuffering) {
        // Additional check: video has current frame data available
        const readyState = videoRef.current.readyState;
        if (readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const newTime = videoRef.current.currentTime;
          setCurrentTime(newTime);
        }
      }
      rafId = requestAnimationFrame(updateTime);
    };

    rafId = requestAnimationFrame(updateTime);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isPlaying, isSeeking, isBuffering]);

  const handleSeeking = () => {
    setIsSeeking(true);
  };

  const handleSeeked = () => {
    setIsSeeking(false);
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      setDuration(video.duration);

      // If metadata is not set (streaming URL case), extract from video element
      if (!metadata) {
        const extractedMetadata = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          framerate: getFramerate(video) || 30,
          format: 'mp4', // Assume mp4 for streaming
          size: 0, // Unknown for streaming
        };
        setMetadata(extractedMetadata);
      }
    }
  };

  // Video element started loading (new src set)
  const handleLoadStart = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const urlPreview = video.src?.length > 60 ? `${video.src.substring(0, 60)}...` : video.src;
      const isBlob = video.src?.startsWith('blob:');
      const loadMode = isBlob ? 'BLOB (pre-downloaded)' : 'STREAMING (range requests)';
      console.log(`[VIDEO] Loading: ${urlPreview}`);
      console.log(`[VIDEO] Mode: ${loadMode}`);
      console.log(`[VIDEO] networkState: ${video.networkState}, readyState: ${video.readyState}`);
      // Set loading state - this catches cases where URL is set directly (e.g., Annotate mode)
      useVideoStore.getState().setIsVideoElementLoading(true);
      useVideoStore.getState().setLoadingProgress(0);
      useVideoStore.getState().setLoadStartTime(performance.now());

      // T55: Diagnostic - check if R2 supports range requests (only logs on success)
      // Note: This will fail with CORS error until R2 CORS is configured
      if (video.src && !video.src.startsWith('blob:')) {
        fetch(video.src, { method: 'HEAD', mode: 'cors' })
          .then(response => {
            const contentLength = response.headers.get('Content-Length');
            const acceptRanges = response.headers.get('Accept-Ranges');
            if (contentLength) {
              const sizeMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(1);
              console.log(`[VIDEO] File size: ${sizeMB} MB, Range requests: ${acceptRanges || 'unknown'}`);
            }
          })
          .catch(() => {
            // CORS error expected if R2 CORS not configured - silently ignore
          });
      }
    }
  };

  // Video element has enough data to display first frame
  const handleLoadedData = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const durationStr = video.duration ? video.duration.toFixed(1) : 'unknown';
      const loadStartTime = useVideoStore.getState().loadStartTime;
      const elapsed = loadStartTime ? Math.round(performance.now() - loadStartTime) : 0;
      // T55: Enhanced logging - flag slow loads for investigation
      if (elapsed > 5000) {
        console.warn(`[VIDEO] SLOW LOAD: ${elapsed}ms for ${durationStr}s video - check network tab for download size`);
      } else {
        console.log(`[VIDEO] Loaded in ${elapsed}ms (${durationStr}s video)`);
      }
      setVideoElementReady();
    }
  };

  // Track buffering progress during initial load
  const handleProgress = () => {
    const { isVideoElementLoading: isLoading, loadingProgress: currentProgress, loadStartTime } = useVideoStore.getState();
    if (videoRef.current && isLoading) {
      const video = videoRef.current;
      const elapsed = loadStartTime ? Math.round((performance.now() - loadStartTime) / 1000) : 0;

      if (video.buffered.length > 0) {
        // Calculate how much of the first few seconds is buffered
        // For streaming, we just need enough to start playing
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const targetBuffer = Math.min(5, video.duration || 5); // Buffer 5 seconds or full duration
        const progress = Math.min(99, Math.round((bufferedEnd / targetBuffer) * 100)); // Cap at 99 until loadeddata
        console.log(`[VIDEO] Buffering: ${progress}% (${bufferedEnd.toFixed(1)}s / ${targetBuffer}s target, ${elapsed}s elapsed)`);
        useVideoStore.getState().setLoadingProgress(progress);
      } else {
        // No buffered data yet - for large videos without faststart, browser is fetching metadata
        // T55: Enhanced diagnostics - log network state to understand what browser is doing
        const networkStates = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'];
        const readyStates = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
        console.log(`[VIDEO] Waiting... (${elapsed}s elapsed, network: ${networkStates[video.networkState]}, ready: ${readyStates[video.readyState]})`);
        // Keep progress at 0 but show elapsed time in UI
        // The UI will show "Loading video metadata..." instead of "Buffering 0%"
      }
    }
  };

  // Handle video load error
  // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
  const handleError = useCallback(() => {
    if (videoRef.current) {
      const video = videoRef.current;
      const mediaError = video.error;

      // Detect network errors (often caused by expired presigned URLs)
      const isNetworkError = mediaError?.code === MediaError.MEDIA_ERR_NETWORK;
      const errorCode = mediaError?.code;
      const errorMessage = mediaError?.message || 'Unknown error';

      // Build user-friendly error message
      let userMessage;
      if (isNetworkError) {
        userMessage = 'Video connection lost. The link may have expired.';
        // Invalidate the URL cache so next load gets a fresh URL
        if (videoUrl && !videoUrl.startsWith('blob:')) {
          invalidateUrl(videoUrl);
        }
      } else if (errorCode === MediaError.MEDIA_ERR_DECODE) {
        userMessage = 'Video could not be decoded. The file may be corrupted.';
      } else if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        userMessage = 'Video format not supported.';
      } else {
        userMessage = `Failed to load video: ${errorMessage}`;
      }

      console.log(`[VIDEO] Error: ${userMessage} (code: ${errorCode}, raw: ${errorMessage})`);
      setError(userMessage);
      retryAttemptRef.current += 1;
    }
  }, [videoUrl, setError]);

  /**
   * Clear the current error state
   * Call this before attempting to reload the video
   */
  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  /**
   * Check if the current error is likely due to an expired URL
   * (network error on a non-blob URL)
   */
  const isUrlExpiredError = useCallback(() => {
    if (!error) return false;
    return error.includes('connection lost') || error.includes('expired');
  }, [error]);

  // Adjust playback rate based on current segment speed
  // ARCHITECTURE: We need BOTH proactive and reactive validation:
  // - Proactive (clampToVisibleRange): Prevents manual seeks to trimmed frames
  // - Reactive (below): Stops playback when naturally hitting trim boundaries
  useEffect(() => {
    if (!videoRef.current || !getSegmentAtTime) return;

    const segment = getSegmentAtTime(currentTime);
    if (segment) {
      // Set playback rate based on segment speed
      videoRef.current.playbackRate = segment.speed;

      // If playing and in a trimmed segment, pause at the boundary
      // This handles continuous playback reaching the end of visible content
      if (isPlaying && segment.isTrimmed) {
        // BUG FIX: Don't pause if we're at a valid boundary position (e.g., trimRange.start)
        // This prevents the bug where playback fails when starting from Frame 0 after front trimming
        const clampedTime = clampToVisibleRange ? clampToVisibleRange(currentTime) : currentTime;
        const epsilon = 0.01; // 10ms tolerance for floating point precision

        console.log('[useVideo] Trimmed segment detected:', {
          currentTime,
          clampedTime,
          segment,
          diff: Math.abs(clampedTime - currentTime)
        });

        if (Math.abs(clampedTime - currentTime) > epsilon) {
          // We're truly in a trimmed area (not at a valid boundary), pause and seek to valid position
          console.log('[useVideo] Pausing due to trimmed segment, seeking to:', clampedTime);
          pause();
          seek(clampedTime);
        }
        // Otherwise, we're at a valid boundary position, allow playback to continue
      }
    } else {
      // No segment info, use normal playback
      videoRef.current.playbackRate = 1;
    }
  }, [currentTime, getSegmentAtTime, isPlaying, clampToVisibleRange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) {
        revokeVideoURL(videoUrl);
      }
    };
  }, [videoUrl]);

  return {
    // Refs
    videoRef,

    // State
    videoFile,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    isSeeking,
    isBuffering,
    error,
    isLoading,
    isVideoElementLoading,
    loadingProgress,
    loadingElapsedSeconds,

    // Actions
    loadVideo,
    loadVideoFromUrl,
    loadVideoFromStreamingUrl,
    play,
    pause,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,

    // Error handling
    clearError,
    isUrlExpiredError,

    // Event handlers for video element
    handlers: {
      onLoadStart: handleLoadStart,
      onTimeUpdate: handleTimeUpdate,
      onPlay: handlePlay,
      onPause: handlePause,
      onSeeking: handleSeeking,
      onSeeked: handleSeeked,
      onLoadedMetadata: handleLoadedMetadata,
      onLoadedData: handleLoadedData,
      onProgress: handleProgress,
      onError: handleError,
      onWaiting: handleWaiting,
      onPlaying: handlePlaying,
      onCanPlay: handleCanPlay,
    }
  };
}
