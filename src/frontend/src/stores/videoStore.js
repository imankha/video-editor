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

  // Loading/error state
  isLoading: false,
  error: null,

  // State setters (used by useVideo hook)
  setVideoFile: (file) => set({ videoFile: file }),
  setVideoUrl: (url) => set({ videoUrl: url }),
  setMetadata: (metadata) => set({ metadata }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsSeeking: (isSeeking) => set({ isSeeking }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // Batch update for video load
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

  // Reset state
  reset: () => set({
    videoFile: null,
    videoUrl: null,
    metadata: null,
    duration: 0,
    isPlaying: false,
    currentTime: 0,
    isSeeking: false,
    isLoading: false,
    error: null,
  }),

  // Computed values
  hasVideo: () => get().videoUrl !== null,
  getFramerate: () => get().metadata?.framerate || 30,
}));

export default useVideoStore;
