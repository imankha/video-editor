import { describe, it, expect, beforeEach } from 'vitest';
import { useVideoStore } from './videoStore';

describe('videoStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useVideoStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with null videoFile', () => {
      expect(useVideoStore.getState().videoFile).toBe(null);
    });

    it('starts with null videoUrl', () => {
      expect(useVideoStore.getState().videoUrl).toBe(null);
    });

    it('starts with null metadata', () => {
      expect(useVideoStore.getState().metadata).toBe(null);
    });

    it('starts with duration 0', () => {
      expect(useVideoStore.getState().duration).toBe(0);
    });

    it('starts not playing', () => {
      expect(useVideoStore.getState().isPlaying).toBe(false);
    });

    it('starts with currentTime 0', () => {
      expect(useVideoStore.getState().currentTime).toBe(0);
    });

    it('starts not seeking', () => {
      expect(useVideoStore.getState().isSeeking).toBe(false);
    });

    it('starts not loading', () => {
      expect(useVideoStore.getState().isLoading).toBe(false);
    });

    it('starts with null error', () => {
      expect(useVideoStore.getState().error).toBe(null);
    });
  });

  describe('state setters', () => {
    it('setVideoFile updates videoFile', () => {
      const mockFile = { name: 'test.mp4' };
      useVideoStore.getState().setVideoFile(mockFile);
      expect(useVideoStore.getState().videoFile).toEqual(mockFile);
    });

    it('setVideoUrl updates videoUrl', () => {
      useVideoStore.getState().setVideoUrl('blob:test-url');
      expect(useVideoStore.getState().videoUrl).toBe('blob:test-url');
    });

    it('setMetadata updates metadata', () => {
      const metadata = { width: 1920, height: 1080, framerate: 30 };
      useVideoStore.getState().setMetadata(metadata);
      expect(useVideoStore.getState().metadata).toEqual(metadata);
    });

    it('setDuration updates duration', () => {
      useVideoStore.getState().setDuration(120.5);
      expect(useVideoStore.getState().duration).toBe(120.5);
    });

    it('setIsPlaying updates isPlaying', () => {
      useVideoStore.getState().setIsPlaying(true);
      expect(useVideoStore.getState().isPlaying).toBe(true);
    });

    it('setCurrentTime updates currentTime', () => {
      useVideoStore.getState().setCurrentTime(45.2);
      expect(useVideoStore.getState().currentTime).toBe(45.2);
    });

    it('setIsSeeking updates isSeeking', () => {
      useVideoStore.getState().setIsSeeking(true);
      expect(useVideoStore.getState().isSeeking).toBe(true);
    });

    it('setIsLoading updates isLoading', () => {
      useVideoStore.getState().setIsLoading(true);
      expect(useVideoStore.getState().isLoading).toBe(true);
    });

    it('setError updates error', () => {
      useVideoStore.getState().setError('Test error');
      expect(useVideoStore.getState().error).toBe('Test error');
    });
  });

  describe('batch updates', () => {
    it('setVideoLoaded sets all video properties at once', () => {
      const mockFile = { name: 'video.mp4' };
      const metadata = { width: 1920, height: 1080, framerate: 60 };

      useVideoStore.getState().setVideoLoaded({
        file: mockFile,
        url: 'blob:video-url',
        metadata,
        duration: 300,
      });

      const state = useVideoStore.getState();
      expect(state.videoFile).toEqual(mockFile);
      expect(state.videoUrl).toBe('blob:video-url');
      expect(state.metadata).toEqual(metadata);
      expect(state.duration).toBe(300);
      expect(state.currentTime).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.error).toBe(null);
      expect(state.isLoading).toBe(false);
    });

    it('setVideoLoaded resets playback state', () => {
      // Set up some prior state
      useVideoStore.getState().setCurrentTime(50);
      useVideoStore.getState().setIsPlaying(true);
      useVideoStore.getState().setError('old error');
      useVideoStore.getState().setIsLoading(true);

      // Load new video
      useVideoStore.getState().setVideoLoaded({
        file: { name: 'new.mp4' },
        url: 'blob:new',
        metadata: {},
        duration: 100,
      });

      const state = useVideoStore.getState();
      expect(state.currentTime).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.error).toBe(null);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('reset', () => {
    it('reset clears all state to initial values', () => {
      // Set up state
      useVideoStore.getState().setVideoFile({ name: 'test.mp4' });
      useVideoStore.getState().setVideoUrl('blob:test');
      useVideoStore.getState().setMetadata({ framerate: 30 });
      useVideoStore.getState().setDuration(100);
      useVideoStore.getState().setIsPlaying(true);
      useVideoStore.getState().setCurrentTime(50);
      useVideoStore.getState().setIsSeeking(true);
      useVideoStore.getState().setIsLoading(true);
      useVideoStore.getState().setError('error');

      // Reset
      useVideoStore.getState().reset();

      // Verify all values are reset
      const state = useVideoStore.getState();
      expect(state.videoFile).toBe(null);
      expect(state.videoUrl).toBe(null);
      expect(state.metadata).toBe(null);
      expect(state.duration).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.isSeeking).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe(null);
    });
  });

  describe('computed values', () => {
    it('hasVideo returns false when no videoUrl', () => {
      expect(useVideoStore.getState().hasVideo()).toBe(false);
    });

    it('hasVideo returns true when videoUrl exists', () => {
      useVideoStore.getState().setVideoUrl('blob:test');
      expect(useVideoStore.getState().hasVideo()).toBe(true);
    });

    it('getFramerate returns metadata framerate', () => {
      useVideoStore.getState().setMetadata({ framerate: 60 });
      expect(useVideoStore.getState().getFramerate()).toBe(60);
    });

    it('getFramerate returns 30 as default when no metadata', () => {
      expect(useVideoStore.getState().getFramerate()).toBe(30);
    });

    it('getFramerate returns 30 when metadata has no framerate', () => {
      useVideoStore.getState().setMetadata({ width: 1920 });
      expect(useVideoStore.getState().getFramerate()).toBe(30);
    });
  });
});
