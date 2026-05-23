import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiVideoScrub } from './useMultiVideoScrub';

const MOCK_GAME_VIDEOS = [
  { sequence: 1, url: 'https://r2.example.com/video0.mp4', duration: 300, width: 1920, height: 1080 },
  { sequence: 2, url: 'https://r2.example.com/video1.mp4', duration: 300, width: 1920, height: 1080 },
];

const REFRESHED_GAME_VIDEOS = [
  { sequence: 1, url: 'https://r2.example.com/video0-refreshed.mp4', duration: 300, width: 1920, height: 1080 },
  { sequence: 2, url: 'https://r2.example.com/video1-refreshed.mp4', duration: 300, width: 1920, height: 1080 },
];

function makeNetworkErrorEvent() {
  return {
    target: {
      error: { code: 2 },
      src: 'https://r2.example.com/video0.mp4',
    },
  };
}

function makeAbortedErrorEvent() {
  return {
    target: {
      error: { code: 1 },
      src: 'https://r2.example.com/video0.mp4',
    },
  };
}

describe('useMultiVideoScrub — retry and error behavior', () => {
  it('retry counter is NOT reset when gameVideos changes', () => {
    const onRefreshUrls = vi.fn();
    const { result, rerender } = renderHook(
      ({ gameVideos, onRefreshUrls: refresh }) =>
        useMultiVideoScrub({ gameVideos, onRefreshUrls: refresh }),
      { initialProps: { gameVideos: MOCK_GAME_VIDEOS, onRefreshUrls } },
    );

    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    expect(onRefreshUrls).toHaveBeenCalledTimes(2);

    rerender({ gameVideos: REFRESHED_GAME_VIDEOS, onRefreshUrls });

    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    expect(onRefreshUrls).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeTruthy();
  });

  it('retry counter resets on user-initiated retry', () => {
    const onRefreshUrls = vi.fn();
    const { result } = renderHook(
      ({ gameVideos, onRefreshUrls: refresh }) =>
        useMultiVideoScrub({ gameVideos, onRefreshUrls: refresh }),
      { initialProps: { gameVideos: MOCK_GAME_VIDEOS, onRefreshUrls } },
    );

    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    expect(onRefreshUrls).toHaveBeenCalledTimes(2);

    act(() => result.current.retry());

    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    expect(onRefreshUrls).toHaveBeenCalledTimes(4);
  });

  it('error display clears when gameVideos changes', () => {
    const onRefreshUrls = vi.fn();
    const { result, rerender } = renderHook(
      ({ gameVideos, onRefreshUrls: refresh }) =>
        useMultiVideoScrub({ gameVideos, onRefreshUrls: refresh }),
      { initialProps: { gameVideos: MOCK_GAME_VIDEOS, onRefreshUrls } },
    );

    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    act(() => result.current.videoHandlers.onError(makeNetworkErrorEvent()));
    expect(result.current.error).toBeTruthy();

    rerender({ gameVideos: REFRESHED_GAME_VIDEOS, onRefreshUrls });
    expect(result.current.error).toBeNull();
  });

  it('ABORTED errors are ignored', () => {
    const onRefreshUrls = vi.fn();
    const { result } = renderHook(
      ({ gameVideos, onRefreshUrls: refresh }) =>
        useMultiVideoScrub({ gameVideos, onRefreshUrls: refresh }),
      { initialProps: { gameVideos: MOCK_GAME_VIDEOS, onRefreshUrls } },
    );

    act(() => result.current.videoHandlers.onError(makeAbortedErrorEvent()));
    expect(onRefreshUrls).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
