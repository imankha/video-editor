import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10310 (2026-09-18 user request):
 *  - Once a play is selected, the whole-game "Preview plays"/"Share plays"
 *    row is gone (only play-specific actions apply); the primary CTA splits
 *    into [Edit Play] + [Frame Clip].
 *  - "Frame Clip" replaces the editor's old "Create clip"/"Save and Frame":
 *    a project-less play creates its project then opens Framing; a play that
 *    already has one just opens its current stage (reusing getClipStage, the
 *    same logic the editor's own stage CTA already used).
 *  - The "You are bookmarking, not editing..." stage-reason line is gone.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
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

let projectsListMock = [];
vi.mock('../stores', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }),
  useProfileStore: (selector) => selector({ updateProfile: vi.fn() }),
  useProjectsList: () => projectsListMock,
}));

import { AnnotateModeView } from './AnnotateModeView';

const selectedRegion = { id: 'r1', startTime: 10, endTime: 20, autoProjectId: null };

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
    hasAnnotateClips: false,
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
    hasUnsentShares: false,
    onFullscreenUpdateClip: vi.fn(),
    onOpenClipInFocus: vi.fn(),
    onOpenClipInOverlay: vi.fn(),
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView — play-selected CTA row (T10310)', () => {
  it('splits into [Edit Play] + [Frame Clip] once a play is selected', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^frame clip$/i })).toBeTruthy();
  });

  it('hides Preview plays and Share plays once a play is selected, even with clips present', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
      onSharePlayback: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /preview plays/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /share plays/i })).toBeNull();
  });

  it('shows Preview plays and Share plays again once nothing is selected', () => {
    renderView({ isEditMode: false, hasAnnotateClips: true, onSharePlayback: vi.fn() });
    expect(screen.getByRole('button', { name: /preview plays/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /share plays/i })).toBeTruthy();
  });

  it('never renders the old "You are bookmarking, not editing" stage-reason line', () => {
    const { container } = renderView({ hasAnnotateClips: false });
    expect(container.textContent).not.toMatch(/bookmarking, not editing/i);
    // The capture-window mechanic sentence is still shown on the very first play.
    expect(screen.getByText(/captures 6 seconds before and 2 after/i)).toBeTruthy();
  });

  it('Frame Clip on a project-less play creates the project, then opens Framing with the new id', async () => {
    const onFullscreenUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true, projectId: 99 }));
    const onOpenClipInFocus = vi.fn();
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
      onFullscreenUpdateClip,
      onOpenClipInFocus,
    });

    fireEvent.click(screen.getByRole('button', { name: /^frame clip$/i }));

    expect(onFullscreenUpdateClip).toHaveBeenCalledWith('r1', { createProject: true });
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(99));
  });

  it('Frame Clip on a play that already has a project just opens its current stage (no re-create)', () => {
    const onFullscreenUpdateClip = vi.fn();
    const onOpenClipInFocus = vi.fn();
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ ...selectedRegion, autoProjectId: 42 }],
      annotateSelectedRegionId: 'r1',
      onFullscreenUpdateClip,
      onOpenClipInFocus,
    });

    // No linked project row in the store -> getClipStage reads it as a fresh
    // draft, action 'focus' -- the button opens Focus directly, no create call.
    fireEvent.click(screen.getByRole('button', { name: /frame this clip/i }));

    expect(onFullscreenUpdateClip).not.toHaveBeenCalled();
    expect(onOpenClipInFocus).toHaveBeenCalledWith(42);
  });
});
