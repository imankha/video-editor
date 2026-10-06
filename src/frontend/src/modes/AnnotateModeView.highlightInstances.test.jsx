import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T11430 review-fix regression (caught by the Reviewer agent, fixed by the
 * supervisor):
 *
 * 1. BLOCKING: clicking a per-instance "preview"/"published" CTA passed a
 *    bare `{ id: projectId }` to onOpenClipPreview, which requires the FULL
 *    project shape (final_video_id, aspect_ratio, name, clip_count,
 *    stale_share, ...) — openClipPreview's own `!project?.final_video_id`
 *    guard always fired, so the button silently did nothing but error-toast.
 *    Fix: fetch the full project via useProjectsStore.fetchProject(id)
 *    (the archived project is not in projectsList, so a store lookup can't
 *    substitute) before calling onOpenClipPreview.
 * 2. MAJOR: the legacy single-stage CTA (`annotate-stage-cta`) rendered
 *    unconditionally alongside the new per-instance collection, showing
 *    contradictory statuses for the same play (the legacy CTA can't see an
 *    archived/published project via projectsList, so it kept showing "Make
 *    Highlight" — the original reported bug — right next to the new
 *    "Portrait Video Finished" badge). Fix: the two are now mutually
 *    exclusive on regionStages.instances.length.
 */

const fetchProjectMock = vi.fn();

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
vi.mock('../stores', async () => {
  const actual = await vi.importActual('../stores');
  return {
    ...actual,
    useProjectsList: () => [], // archived/published projects are never in this list
    useProjectsStore: { getState: () => ({ fetchProject: fetchProjectMock }) },
  };
});

import { AnnotateModeView } from './AnnotateModeView';

const PUBLISHED_PROJECT_DETAIL = {
  id: 42,
  final_video_id: 99,
  name: 'Great Goal',
  aspect_ratio: '9:16',
  clip_count: 1,
  stale_share: null,
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
    annotateSelectedRegionId: 'c1',
    hasAnnotateClips: true,
    clipRegions: [],
    isEditMode: true,
    onSelectRegion: vi.fn(),
    onDeleteRegion: vi.fn(),
    getAnnotateRegionAtTime: () => null,
    annotateSelectedLayer: 'clips',
    onLayerSelect: vi.fn(),
    playback: { isPlaybackMode: false },
    multiVideo: null,
    boundaryOffsets: undefined,
    isSourceExpired: false,
    gameId: 7,
    onOpenClipPreview: vi.fn(),
    onOpenClipInOverlay: vi.fn(),
    onOpenClipInFocus: vi.fn(),
    onFullscreenUpdateClip: vi.fn(),
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

const publishedRegion = {
  id: 'c1',
  startTime: 2,
  endTime: 8,
  autoProjectId: 42,
  highlightInstances: [
    {
      projectId: 42,
      aspectRatio: '9:16',
      highlightOrdinal: 1,
      hasWorkingVideo: true,
      hasFinalVideo: true,
      isPublished: true,
      archivedAt: '2026-09-01T00:00:00Z',
    },
  ],
};

describe('T11430 highlight-instances collection (review-fix regression)', () => {
  it('a published instance\'s CTA fetches the full project and opens preview with it (BLOCKING fix)', async () => {
    fetchProjectMock.mockResolvedValue(PUBLISHED_PROJECT_DETAIL);
    const onOpenClipPreview = vi.fn();
    renderView({ clipRegions: [publishedRegion], onOpenClipPreview });

    fireEvent.click(screen.getByText('Portrait Video Finished'));

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(onOpenClipPreview).toHaveBeenCalledWith(PUBLISHED_PROJECT_DETAIL, true)
    );
    // Never called with a bare {id} shape missing final_video_id etc.
    expect(onOpenClipPreview).not.toHaveBeenCalledWith({ id: 42 }, true);
  });

  it('does not navigate when fetchProject fails (no bare-id fallback call)', async () => {
    fetchProjectMock.mockResolvedValue(null);
    const onOpenClipPreview = vi.fn();
    renderView({ clipRegions: [publishedRegion], onOpenClipPreview });

    fireEvent.click(screen.getByText('Portrait Video Finished'));

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalledWith(42));
    expect(onOpenClipPreview).not.toHaveBeenCalled();
  });

  it('the legacy single-stage CTA is suppressed once the play has any highlight instance (MAJOR fix)', () => {
    renderView({ clipRegions: [publishedRegion] });
    expect(screen.queryByTestId('annotate-stage-cta')).toBeNull();
    expect(screen.getByTestId('annotate-highlight-instances')).toBeTruthy();
  });

  it('the legacy single-stage CTA still renders for a play with zero highlight instances (unchanged pre-T11430 case)', () => {
    const freshRegion = { id: 'c2', startTime: 2, endTime: 8, autoProjectId: 7, highlightInstances: [] };
    renderView({ clipRegions: [freshRegion], annotateSelectedRegionId: 'c2' });
    expect(screen.getByTestId('annotate-stage-cta')).toBeTruthy();
    expect(screen.queryByTestId('annotate-highlight-instances')).toBeNull();
  });

  // MAJOR 4(a): Make Another Highlight threads forceNew (-> force_new PUT field).
  it('the primary "Make Another Highlight" CTA calls onFullscreenUpdateClip with createProject + forceNew', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 999 });
    renderView({ clipRegions: [publishedRegion], onFullscreenUpdateClip });

    fireEvent.click(screen.getByTestId('annotate-make-another-highlight-cta'));

    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    const [, payload] = onFullscreenUpdateClip.mock.calls[0];
    expect(payload).toMatchObject({ createProject: true, forceNew: true, silent: true });
    // The bare primary CTA does NOT force an orientation (backend defaults 9:16).
    expect(payload.aspectRatio).toBeUndefined();
  });

  it('each instance button shows an orientation icon (portrait real, landscape synthesized)', () => {
    renderView({ clipRegions: [publishedRegion] });
    expect(screen.getByTestId('instance-orientation-icon-portrait')).toBeTruthy();
    expect(screen.getByTestId('instance-orientation-icon-landscape')).toBeTruthy();
  });

  // MAJOR 4(d) + MAJOR 2: the synthesized landscape counterpart creates 16:9.
  it('clicking the synthesized "Landscape Video Not Started" counterpart sends aspectRatio 16:9', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 1000 });
    // One published portrait -> synthesizes a landscape not-started counterpart.
    renderView({ clipRegions: [publishedRegion], onFullscreenUpdateClip });

    fireEvent.click(screen.getByText('Landscape Video Not Started'));

    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    const [, payload] = onFullscreenUpdateClip.mock.calls[0];
    expect(payload).toMatchObject({ createProject: true, forceNew: true, aspectRatio: '16:9' });
  });

  // MAJOR 4(e): the landscape-published direction synthesizes a PORTRAIT
  // not-started counterpart that creates 9:16 (the only tested direction before
  // was portrait-published).
  it('a landscape-published play synthesizes a portrait counterpart that sends aspectRatio 9:16', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 1001 });
    const landscapePublished = {
      id: 'c3', startTime: 2, endTime: 8, autoProjectId: 55,
      highlightInstances: [{
        projectId: 55, aspectRatio: '16:9', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: true, isPublished: true, archivedAt: '2026-09-01T00:00:00Z',
      }],
    };
    renderView({ clipRegions: [landscapePublished], annotateSelectedRegionId: 'c3', onFullscreenUpdateClip });

    expect(screen.getByText('Landscape Video Finished')).toBeTruthy();
    fireEvent.click(screen.getByText('Portrait Video Not Started'));

    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    const [, payload] = onFullscreenUpdateClip.mock.calls[0];
    expect(payload).toMatchObject({ createProject: true, forceNew: true, aspectRatio: '9:16' });
  });

  // MAJOR 4(c): per-instance focus/overlay navigation opens the correct DISTINCT
  // project (two in-progress portrait instances, different stages/projects).
  it('per-instance focus and overlay CTAs open their own distinct projects', async () => {
    const onOpenClipInFocus = vi.fn();
    const onOpenClipInOverlay = vi.fn();
    const twoInProgress = {
      id: 'c4', startTime: 2, endTime: 8, autoProjectId: 201,
      highlightInstances: [
        // FRAMED -> 'overlay' action (working video, snapshot matches play, no final).
        {
          projectId: 201, aspectRatio: '9:16', highlightOrdinal: 1,
          hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
          reelSourceStartTime: 2, reelSourceEndTime: 8,
        },
        // Fresh draft -> 'focus' action.
        {
          projectId: 202, aspectRatio: '9:16', highlightOrdinal: 2,
          hasWorkingVideo: false, hasFinalVideo: false, isPublished: false, archivedAt: null,
          reelSourceStartTime: null, reelSourceEndTime: null,
        },
      ],
    };
    renderView({
      clipRegions: [twoInProgress], annotateSelectedRegionId: 'c4',
      onOpenClipInFocus, onOpenClipInOverlay,
    });

    fireEvent.click(screen.getByText('Add spotlight'));
    await waitFor(() => expect(onOpenClipInOverlay).toHaveBeenCalledWith(201));

    // The fresh-draft (ordinal 2) instance opens Focus on project 202.
    fireEvent.click(screen.getByText('Portrait Video 2 Clipped'));
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(202));

    expect(onOpenClipInOverlay).not.toHaveBeenCalledWith(202);
    expect(onOpenClipInFocus).not.toHaveBeenCalledWith(201);
  });
});
