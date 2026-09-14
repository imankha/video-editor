import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9810 — game-invitation entry points.
 *
 * The normal-view "Share plays" buttons (promoted + compact) must open the
 * game-scoped SharePlaybackDialog via onSharePlayback — NOT onShare, which opens
 * the tagged-player modal (ShareWithTeammatesModal) that renders nothing when there
 * are no tagged clips (the reported "three clicks, no response" bug). Tagged-player
 * sharing keeps its own affordance, shown only when tagged clips exist so it can
 * never silently no-op.
 */

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({
  VideoLoadingOverlay: () => <div />,
}));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));
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
    clipRegions: [],
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
    onSharePlayback: vi.fn(),
    hasUnsentShares: false,
    hasTaggedClips: false,
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView share wiring (T9810)', () => {
  it('promoted "Share plays" button opens game invitations (onSharePlayback), not the tagged modal (onShare)', () => {
    const onShare = vi.fn();
    const onSharePlayback = vi.fn();
    renderView({ hasAnnotateClips: true, onShare, onSharePlayback });

    screen.getByRole('button', { name: /share plays/i }).click();

    expect(onSharePlayback).toHaveBeenCalledTimes(1);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('compact (no-clips) share button opens game invitations (onSharePlayback), not the tagged modal', () => {
    const onShare = vi.fn();
    const onSharePlayback = vi.fn();
    renderView({ hasAnnotateClips: false, onShare, onSharePlayback });

    // The zero-clips state renders a single small "Share" button.
    const shareBtn = screen
      .getAllByRole('button')
      .find((b) => /^share$/i.test(b.textContent.trim()));
    expect(shareBtn).toBeTruthy();
    shareBtn.click();

    expect(onSharePlayback).toHaveBeenCalledTimes(1);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('with zero tagged clips there is NO affordance that fires onShare (no silent no-op)', () => {
    const onShare = vi.fn();
    renderView({ hasAnnotateClips: true, hasTaggedClips: false, onShare });

    // Tagged-player affordance is hidden entirely.
    expect(screen.queryByRole('button', { name: /tagged players/i })).toBeNull();

    // Every visible button that could be clicked must not silently invoke onShare.
    screen.getAllByRole('button').forEach((b) => b.click());
    expect(onShare).not.toHaveBeenCalled();
  });

  it('shows the tagged-player affordance only when tagged clips exist, wired to onShare', () => {
    const onShare = vi.fn();
    const onSharePlayback = vi.fn();
    renderView({ hasAnnotateClips: true, hasTaggedClips: true, onShare, onSharePlayback });

    const taggedBtn = screen.getByRole('button', { name: /tagged players/i });
    taggedBtn.click();

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onSharePlayback).not.toHaveBeenCalled();
  });
});
