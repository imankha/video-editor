import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * T11130: the T10450 main-screen [Frame Now] / [Frame Later] create row is
 * removed. A project-less play no longer has any create CTA here — it becomes a
 * highlight through the rating + Done -> Highlight popup gesture (the popup is an
 * in-place mode-swap of the editor, exercised in the AnnotateFullscreenOverlay /
 * AnnotateContainer tests, not this main-screen view). What survives on this
 * play-selected row:
 *  - [Edit Play] always (project or not);
 *  - a SINGLE stage CTA beside it ONLY once the play already has a project (H8:
 *    the one main-screen stage button), reusing getClipStage — opens the clip's
 *    current stage, never re-creates.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div />,
  RateThisPlayModal: () => <div />,
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
beforeEach(() => { projectsListMock = []; });
vi.mock('../stores', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }),
  useProfileStore: (selector) => selector({ updateProfile: vi.fn() }),
  useProjectsList: () => projectsListMock,
}));

import { AnnotateModeView } from './AnnotateModeView';
import { ANNOTATE } from '../config/displayNames';

const selectedRegion = { id: 'r1', startTime: 10, endTime: 20, autoProjectId: null };

function buildProps(overrides = {}) {
  return {
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
    onOpenClipPreview: vi.fn(),
    ...overrides,
  };
}

function renderView(overrides = {}) {
  return render(<AnnotateModeView {...buildProps(overrides)} />);
}

describe('AnnotateModeView — play-selected CTA row (T11130)', () => {
  it('a not-started selected play shows [Edit Play] and a clear Make Highlight CTA', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^make highlight$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^frame now$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^frame later$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^create clip$/i })).toBeNull();
    expect(screen.queryByTestId('annotate-frame-now-cta')).toBeNull();
    expect(screen.queryByTestId('annotate-frame-later-cta')).toBeNull();
  });

  it('Make Highlight creates a highlight project for a not-started play and opens Framing', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 42 });
    const onOpenClipInFocus = vi.fn();
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
      onFullscreenUpdateClip,
      onOpenClipInFocus,
    });

    fireEvent.click(screen.getByRole('button', { name: /^make highlight$/i }));
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(42));
    expect(onFullscreenUpdateClip).toHaveBeenCalledWith('r1', { createProject: true, silent: true });
  });

  it('shows [Edit Play] + a single stage button once the play has a project (H8)', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ ...selectedRegion, autoProjectId: 42 }],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^make highlight$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^frame now$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^frame later$/i })).toBeNull();
  });

  it('hides Review plays and Share plays once a play is selected, even with clips present', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
      onSharePlayback: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: /review plays/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /share plays/i })).toBeNull();
  });

  it('shows Review plays and Share plays again once nothing is selected', () => {
    renderView({ isEditMode: false, hasAnnotateClips: true, onSharePlayback: vi.fn() });
    expect(screen.getByRole('button', { name: /review plays/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /share plays/i })).toBeTruthy();
  });

  it('never renders the old "You are bookmarking, not editing" stage-reason line', () => {
    const { container } = renderView({ hasAnnotateClips: false });
    expect(container.textContent).not.toMatch(/bookmarking, not editing/i);
    // The capture-window mechanic sentence is still shown on the very first play.
    expect(screen.getByText(ANNOTATE.MARK_PLAY_HELPER)).toBeTruthy();
  });

  it('the single stage button on a play that already has a project just opens its current stage (no re-create)', () => {
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
    // FOCUS-stage label is "Make Highlight" (ANNOTATE.FRAME_THIS_CLIP).
    fireEvent.click(screen.getByRole('button', { name: /^make highlight$/i }));

    expect(onFullscreenUpdateClip).not.toHaveBeenCalled();
    expect(onOpenClipInFocus).toHaveBeenCalledWith(42);
  });

  it('opens an overlaid highlight in Preview instead of sending the user back to Framing', () => {
    const project = { id: 42, has_working_video: true, has_final_video: true, is_published: false, final_video_id: 'final-1' };
    projectsListMock = [project];
    const onOpenClipPreview = vi.fn();
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ ...selectedRegion, autoProjectId: 42, reelSourceStartTime: 10, reelSourceEndTime: 20 }],
      annotateSelectedRegionId: 'r1',
      onOpenClipPreview,
    });

    fireEvent.click(screen.getByRole('button', { name: /^preview highlight$/i }));
    expect(onOpenClipPreview).toHaveBeenCalledWith(project, false);
  });

  it('opens a published highlight with the View Highlight CTA in published mode', () => {
    const project = { id: 42, has_working_video: true, has_final_video: true, is_published: true, final_video_id: 'final-1' };
    projectsListMock = [project];
    const onOpenClipPreview = vi.fn();
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ ...selectedRegion, autoProjectId: 42, reelSourceStartTime: 10, reelSourceEndTime: 20 }],
      annotateSelectedRegionId: 'r1',
      onOpenClipPreview,
    });

    fireEvent.click(screen.getByRole('button', { name: /^view highlight$/i }));
    expect(onOpenClipPreview).toHaveBeenCalledWith(project, true);
  });
});
