import { useRef, useEffect, useCallback } from 'react';
import { extractVideoMetadata, createVideoURL, revokeVideoURL, getFramerate } from '../utils/videoUtils';
import { validateVideoFile } from '../utils/fileValidation';
import { useVideoStore } from '../stores';
import { invalidateUrl } from '../utils/storageUrls';
import { probeVideoUrlMoovPosition } from '../utils/probeVideoUrl';
import { classifyVideoError, VideoErrorKind } from '../utils/videoErrorClassifier';
import { setWarmupPriority, clearForegroundActive, WARMUP_PRIORITY, getWarmedState } from '../utils/cacheWarming';
import { checkRangeFallback } from '../utils/videoLoadWatchdog';
import { chooseLoadRoute, isDirectForced } from '../utils/videoLoadRoute';

// T1400: watchdog delay before checking buffered vs clip duration.
const RANGE_FALLBACK_WATCHDOG_MS = 5000;

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

  // T1360: when loadVideoFromUrl creates a blob from a streaming URL, stash
  // the original streaming URL so we can recover if the blob becomes stale.
  // Memory-only — NOT persisted (gesture-based persistence rule).
  const streamingFallbackUrlRef = useRef(null);

  // T1360: true while swapping video.src back to the streaming URL after a
  // stale-blob error. VideoPlayer uses this to suppress the error overlay
  // during the swap so the user never sees "format not supported".
  const isRecoveringRef = useRef(false);

  // T1400: monotonic load id + watchdog timer handle so range-fallback
  // warnings can be correlated across concurrent/serial loads and cleared
  // on loadeddata/error/unmount.
  const loadIdRef = useRef(0);
  const watchdogTimerRef = useRef(null);
  const loadStartRef = useRef(0);
  const clipDurationForLoadRef = useRef(null);
  // T1430 Step 2: flag loads that go through the backend clip-stream proxy.
  // The watchdog's buffered-vs-clip-duration heuristic is a false positive on
  // that path (the proxy intentionally exposes a clip-sized byte window but
  // the moov still reports full-video time, so v.buffered.end reads much
  // larger than clipDuration even though only the clip body was transferred).
  const isProxyLoadRef = useRef(false);

  // Get state and setters from the store
  const {
    videoFile,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    clipOffset,
    clipDuration,
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

  // Clip offset translation — converts between 0-based clip time (what the app sees)
  // and absolute video element time (what the <video> element uses).
  // When clipOffset=0, these are identity functions (no-op for uploaded/extracted clips).
  const clipToVideo = useCallback((clipTime) => clipTime + clipOffset, [clipOffset]);
  const videoToClip = useCallback((videoTime) => videoTime - clipOffset, [clipOffset]);

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
  const loadVideoFromUrl = useCallback(async (url, filename = 'video.mp4') => {
    console.log('[useVideo] loadVideoFromUrl (FULL DOWNLOAD) called with:', url);
    setError(null);
    setIsLoading(true);

    try {
      // Clean up previous blob URL (only if it's a blob URL we created)
      const currentUrl = useVideoStore.getState().videoUrl;
      if (currentUrl && currentUrl.startsWith('blob:')) {
        console.log('[useVideo] Revoking previous blob URL:', currentUrl);
        revokeVideoURL(currentUrl);
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

      // T1360: remember the original streaming URL so handleError can swap
      // back if the blob is later revoked/GC'd out from under the <video>.
      streamingFallbackUrlRef.current = url;

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
  }, [setError, setIsLoading, setVideoLoaded]); // eslint-disable-line react-hooks/exhaustive-deps -- reads videoUrl via getState() to keep callback stable

  /**
   * Load a video from a streaming URL (no blob download)
   * Use this for presigned R2 URLs where streaming is preferred.
   * @param {string} url - Streaming URL (e.g., presigned R2 URL)
   * @param {Object} preloadedMetadata - Optional pre-extracted metadata
   * @param {Object} clipRange - Optional {clipOffset, clipDuration} for playing a subset of the video
   */
  const loadVideoFromStreamingUrl = useCallback((url, preloadedMetadata = null, clipRange = null, options = {}) => {
    const newClipOffset = clipRange?.clipOffset || 0;
    const newClipDuration = clipRange?.clipDuration || null;
    const effectiveDuration = newClipDuration || preloadedMetadata?.duration || 0;

    // T1460: decide direct-vs-proxy at load time (not at clip-select time) so
    // the freshest warm state wins. Also gives us the raw R2 URL to use for
    // warm_status telemetry, even when we still end up going through proxy.
    const route = chooseLoadRoute({
      url,
      gameUrl: options.gameUrl || null,
      clipOffset: newClipOffset,
      clipDuration: newClipDuration,
      forceDirect: isDirectForced(),
      getWarmedStateFn: getWarmedState,
    });
    const loadUrl = route.loadUrl;

    // Same video URL — just update clip range and seek, no reload needed
    const currentUrl = useVideoStore.getState().videoUrl;
    if (loadUrl === currentUrl && videoRef.current) {
      console.log(`[useVideo] Same URL, seeking to clip offset=${newClipOffset}s`);
      const currentMeta = useVideoStore.getState().metadata;
      const baseMeta = preloadedMetadata || currentMeta;
      // Override metadata.duration with clip-effective duration so consumers
      // (e.g., useCrop endFrame computation) see the clip length, not the full video.
      const meta = baseMeta && effectiveDuration ? { ...baseMeta, duration: effectiveDuration } : baseMeta;
      setVideoLoaded({
        file: null,
        url: loadUrl,
        metadata: meta,
        duration: effectiveDuration,
        clipOffset: newClipOffset,
        clipDuration: newClipDuration,
      });
      videoRef.current.currentTime = newClipOffset;
      setCurrentTime(0);
      return;
    }

    // T1400: structured load logs. `loadId` correlates start -> first_frame ->
    // playable across concurrent loads. Prefix `[VIDEO_LOAD]` is greppable in
    // prod logs.
    const loadId = ++loadIdRef.current;
    loadStartRef.current = performance.now();
    clipDurationForLoadRef.current = newClipDuration;
    isProxyLoadRef.current = !!loadUrl && /\/api\/clips\/[^?]*\/stream(\?|$)/.test(loadUrl);
    console.log(`[VIDEO_LOAD] start id=${loadId} route=${route.route} clipDurSec=${newClipDuration ?? 'null'} url=${loadUrl?.substring(0, 60)}`);

    // T1460: warm_status lookup uses the R2 URL the warmer recorded against
    // (warmLookupUrl), not the chosen load URL. Before this change, picking
    // the proxy URL meant warm_status always reported clipWarmed=false even
    // when the R2 bytes had been warmed.
    {
      const ws = getWarmedState(route.warmLookupUrl);
      const clipWarmed = !!(ws && (ws.urlWarmed || ws.clipRanges.length > 0));
      console.log(`[VIDEO_LOAD] warm_status id=${loadId} clipWarmed=${clipWarmed} rangeCovered=${route.rangeCovered} urlWarmed=${ws?.urlWarmed ?? false} clipRanges=${ws?.clipRanges.length ?? 0} route=${route.route}`);
    }

    // T1410: pause warmup & abort in-flight warm fetches so foreground video
    // wins the race for R2 connections. Cleared on loadeddata/error below.
    const { abortedCount } = setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    if (abortedCount > 0) {
      console.log(`[VIDEO_LOAD] warmer_abort id=${loadId} count=${abortedCount}`);
    }

    // T1400: range-fallback watchdog — if we're still not playable after
    // RANGE_FALLBACK_WATCHDOG_MS and the player has buffered >3x the clip
    // duration, the range request silently degraded. Fire one warning.
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(() => {
      watchdogTimerRef.current = null;
      const v = videoRef.current;
      if (!v) return;
      const bufferedSec = v.buffered?.length
        ? v.buffered.end(v.buffered.length - 1)
        : 0;
      const verdict = isProxyLoadRef.current ? null : checkRangeFallback({
        bufferedSec,
        clipDurationSec: clipDurationForLoadRef.current,
        readyState: v.readyState,
      });
      if (verdict) {
        const elapsedMs = Math.round(performance.now() - loadStartRef.current);
        console.warn(
          `[VIDEO_LOAD] range_fallback_suspected id=${loadId} trigger=watchdog bufferedSec=${verdict.bufferedSec.toFixed(1)} clipDurSec=${verdict.clipDurationSec} ratio=${verdict.ratio.toFixed(1)} elapsedMs=${elapsedMs} networkState=${v.networkState} readyState=${v.readyState}`
        );
      }
    }, RANGE_FALLBACK_WATCHDOG_MS);
    setError(null);
    retryAttemptRef.current = 0; // Reset retry counter on new video load
    // T1360: streaming load — no blob to recover, clear any previous stash.
    streamingFallbackUrlRef.current = null;
    isRecoveringRef.current = false;

    // Clean up previous blob URL (only if it's a blob URL we created)
    const prevUrl = useVideoStore.getState().videoUrl;
    if (prevUrl && prevUrl.startsWith('blob:')) {
      revokeVideoURL(prevUrl);
    }

    // Override metadata.duration with clip-effective duration so consumers
    // see the clip length, not the full video length (game clips are subsets).
    const meta = preloadedMetadata && effectiveDuration
      ? { ...preloadedMetadata, duration: effectiveDuration }
      : preloadedMetadata;
    setVideoLoaded({
      file: null,
      url: loadUrl,
      metadata: meta,
      duration: effectiveDuration,
      clipOffset: newClipOffset,
      clipDuration: newClipDuration,
    });
  }, [setError, setCurrentTime, setVideoLoaded]); // eslint-disable-line react-hooks/exhaustive-deps -- reads videoUrl/metadata via getState() to keep callback stable

  /**
   * Play video - handles promise to prevent race conditions
   * Note: Check videoRef.current.src instead of videoUrl to support overlay mode
   * where the video src is set externally (not via loadVideo)
   */
  const play = async () => {
    if (videoRef.current && videoRef.current.src) {
      try {
        await videoRef.current.play();
      } catch (error) {
        // Ignore AbortError - happens when play() is interrupted by pause()/seek
        if (error.name !== 'AbortError') {
          console.error('[useVideo] play() rejected:', error.name, error.message);
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
      const effectiveDuration = duration || (clipDuration ?? videoRef.current.duration) || 0;
      // Use centralized validation to prevent seeking to trimmed frames
      const validTime = clampToVisibleRange
        ? clampToVisibleRange(time)
        : Math.max(0, Math.min(time, effectiveDuration));

      const target = clipToVideo(validTime);
      setIsSeeking(true);
      setCurrentTime(validTime); // Optimistic update: UI responds instantly (playhead, timestamps, selection)
      videoRef.current.currentTime = target; // Translate clip time → video element time
      // The seeked event (handleSeeked) will refine with the actual displayed frame time
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

  /**
   * Seek forward by a specified number of seconds
   * Used for keyboard navigation (arrow keys)
   * @param {number} seconds - Number of seconds to seek forward (default 5)
   */
  const seekForward = (seconds = 5) => {
    if (videoRef.current && videoRef.current.src) {
      const newTime = currentTime + seconds;
      seek(newTime); // seek() handles clamping to valid range
    }
  };

  /**
   * Seek backward by a specified number of seconds
   * Used for keyboard navigation (arrow keys)
   * @param {number} seconds - Number of seconds to seek backward (default 5)
   */
  const seekBackward = (seconds = 5) => {
    if (videoRef.current && videoRef.current.src) {
      const newTime = currentTime - seconds;
      seek(newTime); // seek() handles clamping to valid range
    }
  };

  // Video element event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current && !isSeeking) {
      setCurrentTime(videoToClip(videoRef.current.currentTime));
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleStalled = () => {
    // No-op handler kept for diagnostic attachment symmetry.
  };

  const handleSuspend = () => {
    // No-op handler kept for diagnostic attachment symmetry.
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
          const newTime = videoToClip(videoRef.current.currentTime);
          // Clamp playback at clip end
          if (clipDuration && newTime >= clipDuration) {
            videoRef.current.pause();
            videoRef.current.currentTime = clipToVideo(clipDuration);
            setCurrentTime(clipDuration);
          } else {
            setCurrentTime(newTime);
          }
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
  }, [isPlaying, isSeeking, isBuffering, clipDuration, clipToVideo, videoToClip]);

  const handleSeeking = () => {
    setIsSeeking(true);
  };

  const handleSeeked = () => {
    setIsSeeking(false);
    if (videoRef.current) {
      setCurrentTime(videoToClip(videoRef.current.currentTime));
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      // T1400: first-frame-available signal for cold-load measurement.
      if (loadStartRef.current) {
        const elapsedMs = Math.round(performance.now() - loadStartRef.current);
        console.log(`[VIDEO_LOAD] first_frame id=${loadIdRef.current} elapsedMs=${elapsedMs}`);
      }
      // Use clipDuration if set (playing subset of game video), else full video duration
      const effectiveDuration = clipDuration ?? video.duration;
      setDuration(effectiveDuration);

      // If metadata is not set (streaming URL case), extract from video element
      if (!metadata) {
        const extractedMetadata = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: effectiveDuration,
          framerate: getFramerate(video) || 30,
          format: 'mp4', // Assume mp4 for streaming
          size: 0, // Unknown for streaming
        };
        setMetadata(extractedMetadata);
      }

      // If clip offset is set, seek the video element to the clip start
      if (clipOffset > 0) {
        video.currentTime = clipOffset;
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
      // T1380: one-shot moov-position probe so logs confirm whether the
      // currently-playing URL is faststart-ordered. Blob URLs skipped.
      if (!isBlob && video.src) {
        probeVideoUrlMoovPosition(video.src, 'on-load').catch(() => {});
      }
      // Set loading state - this catches cases where URL is set directly (e.g., Annotate mode)
      useVideoStore.getState().setIsVideoElementLoading(true);
      useVideoStore.getState().setLoadingProgress(0);
      useVideoStore.getState().setLoadStartTime(performance.now());

      // T1410: if a non-blob streaming src was set outside loadVideoFromStreamingUrl
      // (e.g., Annotate mode sets store.videoUrl directly), still throttle the
      // warmer so it doesn't race the foreground <video>. Blob srcs are already
      // fully downloaded — no network race to worry about.
      if (!isBlob && video.src) {
        const { abortedCount } = setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_ACTIVE);
        if (abortedCount > 0) {
          console.log(`[VIDEO_LOAD] warmer_abort id=${loadIdRef.current} count=${abortedCount} trigger=loadstart`);
        }
      }

      // Note: HEAD request to check file size/range support removed
      // It was causing CORS errors in the console even though video loads fine
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
      // T1400: playable signal — cold-load measurement endpoint. Also
      // check for range overbuffer here: a fast load can still buffer far
      // more than the clip needs (T1430). ignoreReadyState=true because
      // the video is by definition playable at this point.
      if (loadStartRef.current) {
        const bufferedSec = video.buffered?.length
          ? video.buffered.end(video.buffered.length - 1)
          : 0;
        console.log(`[VIDEO_LOAD] playable id=${loadIdRef.current} elapsedMs=${elapsed} readyState=${video.readyState} bufferedSec=${bufferedSec.toFixed(1)}`);
        const verdict = isProxyLoadRef.current ? null : checkRangeFallback({
          bufferedSec,
          clipDurationSec: clipDurationForLoadRef.current,
          readyState: video.readyState,
          ignoreReadyState: true,
        });
        if (verdict) {
          console.warn(
            `[VIDEO_LOAD] range_fallback_suspected id=${loadIdRef.current} trigger=playable bufferedSec=${verdict.bufferedSec.toFixed(1)} clipDurSec=${verdict.clipDurationSec} ratio=${verdict.ratio.toFixed(1)} elapsedMs=${elapsed} readyState=${video.readyState}`
          );
        }
      }
      // T1400: clear watchdog — load completed in time, no fallback to flag.
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      // T1410: foreground video is now playable — let the warmer resume.
      clearForegroundActive();
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
    if (!videoRef.current) return;
    const video = videoRef.current;
    const mediaError = video.error;
    const errorCode = mediaError?.code;
    const errorMessage = mediaError?.message || 'Unknown error';

    // T1360: classify before deciding whether to surface the error to the user.
    // A revoked blob URL surfaces as MEDIA_ERR_SRC_NOT_SUPPORTED but is NOT a
    // real format failure — recover in-memory by swapping to the stashed
    // streaming URL.
    const kind = classifyVideoError({ code: errorCode, videoSrc: video.src });

    if (kind === VideoErrorKind.STALE_BLOB && streamingFallbackUrlRef.current) {
      const resumeAt = video.currentTime;
      const fallback = streamingFallbackUrlRef.current;
      console.warn('[VIDEO] Recovered from stale blob URL, swapping to streaming URL', {
        resumeAt,
        fallbackPreview: fallback.substring(0, 80),
      });
      isRecoveringRef.current = true;
      // Stash is one-shot — once we swap to streaming, there is no more blob.
      streamingFallbackUrlRef.current = null;
      // Update store so VideoPlayer renders the streaming URL as src.
      setVideoUrl(fallback);
      // Clear any transient error (shouldn't be one yet — we're recovering
      // before surfacing — but be defensive against reordering).
      setError(null);
      // Resume position after the new src loads.
      const restoreTime = () => {
        if (videoRef.current && !Number.isNaN(resumeAt)) {
          try {
            videoRef.current.currentTime = resumeAt;
          } catch (_) { /* readyState not ready yet; canplay will retry */ }
        }
        isRecoveringRef.current = false;
      };
      // Use loadeddata so we know the element has data for the new src.
      videoRef.current.addEventListener('loadeddata', restoreTime, { once: true });
      return;
    }

    // Build user-friendly error message
    let userMessage;
    if (kind === VideoErrorKind.NETWORK_ERROR) {
      userMessage = 'Video connection lost. The link may have expired.';
      // Invalidate the URL cache so next load gets a fresh URL
      if (videoUrl && !videoUrl.startsWith('blob:')) {
        invalidateUrl(videoUrl);
      }
    } else if (kind === VideoErrorKind.DECODE_ERROR) {
      userMessage = 'Video could not be decoded. The file may be corrupted.';
    } else if (kind === VideoErrorKind.FORMAT_ERROR) {
      userMessage = 'Video format not supported.';
    } else if (kind === VideoErrorKind.STALE_BLOB) {
      // Stale blob but no stashed streaming URL — nothing we can do.
      userMessage = 'Video source expired. Please reload the page.';
    } else {
      userMessage = `Failed to load video: ${errorMessage}`;
    }

    console.error(`[VIDEO] Error: ${userMessage}`, {
      code: errorCode,
      kind,
      rawMessage: errorMessage,
      url: videoUrl?.substring(0, 80),
      isBlob: videoUrl?.startsWith('blob:'),
      retryAttempt: retryAttemptRef.current,
    });
    setError(userMessage);
    retryAttemptRef.current += 1;
    // T1400: structured error log + clear watchdog.
    if (loadStartRef.current) {
      const elapsedMs = Math.round(performance.now() - loadStartRef.current);
      console.warn(`[VIDEO_LOAD] error id=${loadIdRef.current} elapsedMs=${elapsedMs} code=${errorCode} kind=${kind}`);
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    // T1410: foreground load failed — release the warmer throttle.
    clearForegroundActive();
  }, [videoUrl, setError, setVideoUrl]);

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
      // T1410: safety net — if we unmount while still in foreground-loading
      // mode (StrictMode synthetic unmount, route change mid-load), release
      // the warmer so it isn't stuck paused forever.
      clearForegroundActive();
      // T1400: drop pending watchdog so it doesn't fire after unmount.
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
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
    seekForward,
    seekBackward,
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
      onStalled: handleStalled,
      onSuspend: handleSuspend,
    }
  };
}
