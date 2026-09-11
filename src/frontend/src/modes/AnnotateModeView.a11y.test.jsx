import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9510: a transient "Unable to play media" was announced to assistive
 * technology during a NORMAL Playback Annotations load. The cause is the
 * browser-native accessible NAME Chromium computes for an unlabeled <video>
 * whose `video.error` is momentarily set during init (source swap +
 * currentTime-before-data in useAnnotationPlayback.enterPlaybackMode). The fix
 * gives the playback <video> elements an author-supplied aria-label (which
 * sits above the native fallback in the accessible-name computation, so the
 * native error name can never leak) plus an honest aria-busy during loading,
 * and marks the loading overlay as a polite status region so init announces
 * "Preparing..." rather than an error. The inactive crossfade element is
 * aria-hidden so only the on-screen video is exposed (no double-announcement).
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div data-testid="timeline" />,
  AnnotateControls: () => <div data-testid="controls" />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="overlay" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div data-testid="playback-controls" /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleTapVideo: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

import { AnnotateModeView } from './AnnotateModeView';

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

const playbackBase = {
  isPlaybackMode: true,
  activeVideoLabel: 'A',
  isLoading: false,
  isPlaying: false,
  activeClipId: 'c1',
  virtualTime: 0,
  playbackRate: 1,
  videoARef: { current: null },
  videoBRef: { current: null },
  timeline: { totalVirtualDuration: 20, segments: [] },
  getCurrentSegment: () => null,
  togglePlay: vi.fn(),
  restart: vi.fn(),
  seekVirtual: vi.fn(),
  seekWithinSegment: vi.fn(),
  startScrub: vi.fn(),
  endScrub: vi.fn(),
  changePlaybackRate: vi.fn(),
  videoController: { _renderRefs: {} },
};

function renderView(overrides = {}) {
  const props = {
    videoController: { _renderRefs: { videoARef: { current: null }, videoBRef: { current: null } } },
    annotateVideoUrl: '/api/games/1/video',
    annotateVideoMetadata: { width: 1920, height: 1080, duration: 100, format: 'mp4', size: 0 },
    annotateContainerRef: { current: null },
    currentTime: 0,
    duration: 100,
    isPlaying: false,
    handlers: {},
    annotateFullscreen: false,
    showAnnotateOverlay: false,
    togglePlay: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    onTimelineSeek: vi.fn(),
    annotatePlaybackSpeed: 1,
    onSpeedChange: vi.fn(),
    annotateRegionsWithLayout: [],
    annotateSelectedRegionId: null,
    hasAnnotateClips: true,
    clipRegions,
    isEditMode: false,
    onSelectRegion: vi.fn(),
    onDeleteRegion: vi.fn(),
    onAddClip: vi.fn(),
    getAnnotateRegionAtTime: () => null,
    annotateSelectedLayer: 'clips',
    onLayerSelect: vi.fn(),
    playback: { isPlaybackMode: false, enterPlaybackMode: vi.fn() },
    multiVideo: null,
    boundaryOffsets: undefined,
    isSourceExpired: false,
    onShare: vi.fn(),
    hasUnsentShares: false,
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('T9510 — Playback Annotations does not announce a transient media error', () => {
  it('during load: the active playback video is labeled + busy and NEVER exposes the native error name', () => {
    const { container } = renderView({ playback: { ...playbackBase, isLoading: true, activeVideoLabel: 'A' } });
    const videos = Array.from(container.querySelectorAll('video'));
    expect(videos.length).toBe(2);

    // No playback <video> may fall back to the browser-native "Unable to play
    // media" accessible name — every element must carry an author label.
    for (const v of videos) {
      const label = v.getAttribute('aria-label') || '';
      expect(label).not.toMatch(/unable to play media/i);
      expect(label.length).toBeGreaterThan(0);
    }

    // Active video (A) announces a LOADING state, not an error.
    const active = videos[0];
    expect(active.getAttribute('aria-busy')).toBe('true');
    expect(active.getAttribute('aria-label')).toMatch(/preparing/i);
  });

  it('during load: the loading overlay is a polite status region (announces "Preparing", not an error)', () => {
    renderView({ playback: { ...playbackBase, isLoading: true } });
    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/preparing/i);
  });

  it('once ready: the active video drops busy and reads as normal playback', () => {
    const { container } = renderView({ playback: { ...playbackBase, isLoading: false, activeVideoLabel: 'A' } });
    const active = container.querySelectorAll('video')[0];
    expect(active.getAttribute('aria-busy')).toBe('false');
    expect(active.getAttribute('aria-label')).toMatch(/annotation playback/i);
  });

  it('only the on-screen (active) video is exposed to AT; the crossfaded-out one is hidden', () => {
    const { container } = renderView({ playback: { ...playbackBase, isLoading: false, activeVideoLabel: 'A' } });
    const [videoA, videoB] = container.querySelectorAll('video');
    expect(videoA.getAttribute('aria-hidden')).toBe('false');
    expect(videoB.getAttribute('aria-hidden')).toBe('true');
  });
});

const multiVideoBase = {
  activeVideoLabel: 'A',
  isLoading: false,
  error: null,
  retry: vi.fn(),
  videoHandlers: { onError: vi.fn(), onWaiting: vi.fn(), onCanPlay: vi.fn() },
};

describe('T9510 — multi-video scrub (editing) path shares the same ARIA contract', () => {
  it('during a scrub load: both scrub videos are labeled + busy and never expose the native error name', () => {
    const { container } = renderView({ multiVideo: { ...multiVideoBase, isLoading: true, activeVideoLabel: 'A' } });
    const videos = Array.from(container.querySelectorAll('video'));
    expect(videos.length).toBe(2);
    for (const v of videos) {
      const label = v.getAttribute('aria-label') || '';
      expect(label).not.toMatch(/unable to play media/i);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(videos[0].getAttribute('aria-busy')).toBe('true');
    expect(videos[0].getAttribute('aria-hidden')).toBe('false');
    expect(videos[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('a genuine scrub failure announces once via a role=alert region with a recovery action', () => {
    renderView({ multiVideo: { ...multiVideoBase, error: 'Video failed to load' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/failed to load/i);
    expect(alert.querySelector('button')).toBeTruthy();
  });
});
