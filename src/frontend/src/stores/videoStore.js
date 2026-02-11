import { create } from 'zustand';

/**
 * Video Store - Core video playback state
 *
 * This store holds the shared video state that multiple components need to access.
 * The useVideo hook uses this store internally and adds ref/effect management.
 *
 * Components can:
 * 1. Use useVideo() for full functionality (refs, effects, loading)
 * 2. Use useVideoStore() for read-only state access (currentTime, isPlaying)
 *
 * This enables containers to access video state without prop drilling through App.jsx.
 *
 * @see APP_REFACTOR_PLAN.md for refactoring context
 */
export const useVideoStore = create((set, get) => ({
  // Video file and URL
  videoFile: null,
  videoUrl: null,

  // Metadata
  metadata: null,
  duration: 0,

  // Playback state
  isPlaying: false,
  currentTime: 0,
  isSeeking: false,
  isBuffering: false,

  // Loading/error state
  isLoading: false,
  error: null,

  // Video element loading state (tracks actual video buffering)
  isVideoElementLoading: false,  // true from URL change until onLoadedData
  loadingProgress: null,         // 0-100 during load, null when not loading
  loadStartTime: null,           // performance.now() when load started
  loadingElapsedSeconds: 0,      // T55: Elapsed seconds for slow load feedback

  // State setters (used by useVideo hook)
  setVideoFile: (file) => set({ videoFile: file }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setMetadata: (metadata) => set({ metadata }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsSeeking: (isSeeking) => set({ isSeeking }),
  setIsBuffering: (isBuffering) => set({ isBuffering }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setIsVideoElementLoading: (isVideoElementLoading) => set({ isVideoElementLoading }),
  setLoadingProgress: (loadingProgress) => set({ loadingProgress }),
  setLoadStartTime: (loadStartTime) => set({ loadStartTime }),
  setLoadingElapsedSeconds: (loadingElapsedSeconds) => set({ loadingElapsedSeconds }),

  // Batch update for video load (URL is set, but video element may still be buffering)
  // Note: Loading state is now set by handleLoadStart when video element starts loading
  setVideoLoaded: ({ file, url, metadata, duration }) => set({
    videoFile: file,
    videoUrl: url,
    metadata,
    duration,
    currentTime: 0,
    isPlaying: false,
    error: null,
    isLoading: false,
  }),

  // Called when video element has loaded enough data to play
  // Note: Timing log is now in handleLoadedData which has access to video duration
  setVideoElementReady: () => set({
    isVideoElementLoading: false,
    loadingProgress: 100,
    loadStartTime: null,
    loadingElapsedSeconds: 0,
  }),

  // Reset state
  reset: () => set({
    videoFile: null,
    videoUrl: null,
    metadata: null,
    duration: 0,
    isPlaying: false,
    currentTime: 0,
    isSeeking: false,
    isBuffering: false,
    isLoading: false,
    error: null,
    isVideoElementLoading: false,
    loadingProgress: null,
    loadStartTime: null,
    loadingElapsedSeconds: 0,
  }),

  // Computed values
  hasVideo: () => get().videoUrl !== null,
  getFramerate: () => get().metadata?.framerate || 30,
}));

export default useVideoStore;
