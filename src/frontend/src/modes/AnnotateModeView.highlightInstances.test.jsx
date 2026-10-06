import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T11430 review-fix regression + T11910 single render path.
 *
 * T11430 (kept): clicking an instance whose stage is preview/published must fetch
 * the FULL project (useProjectsStore.fetchProject) before onOpenClipPreview;
 * the instance is archived so it is not in projectsList and a bare {id} would
 * trip openClipPreview's final_video_id guard.
 *
 * T11910: the legacy single-stage CTA, the instance list and "Make Another
 * Highlight" are one surface now: two permanent Portrait/Landscape slots that
 * render identically in every state (zero / one / both instances), so a play
 * looks the same right after creating a highlight and after a reload.
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

const landscapePublished = {
  id: 'c3', startTime: 2, endTime: 8, autoProjectId: 55,
  highlightInstances: [{
    projectId: 55, aspectRatio: '16:9', highlightOrdinal: 1,
    hasWorkingVideo: true, hasFinalVideo: true, isPublished: true, archivedAt: '2026-09-01T00:00:00Z',
  }],
};

const noHighlight = { id: 'c2', startTime: 2, endTime: 8, autoProjectId: null, highlightInstances: [] };

const slot = (orientation) => screen.getByTestId(`annotate-highlight-slot-${orientation}`);

describe('T11430 highlight instances (review-fix regression)', () => {
  it('a published instance row fetches the full project and opens preview with it (BLOCKING fix)', async () => {
    fetchProjectMock.mockResolvedValue(PUBLISHED_PROJECT_DETAIL);
    const onOpenClipPreview = vi.fn();
    renderView({ clipRegions: [publishedRegion], onOpenClipPreview });

    fireEvent.click(screen.getByRole('button', { name: /portrait highlight, finished/i }));

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

    fireEvent.click(screen.getByRole('button', { name: /portrait highlight, finished/i }));

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalledWith(42));
    expect(onOpenClipPreview).not.toHaveBeenCalled();
  });

  it('per-instance focus and overlay rows open their own distinct projects', async () => {
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
    fireEvent.click(screen.getByText('2. Clipped'));
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(202));

    expect(onOpenClipInOverlay).not.toHaveBeenCalledWith(202);
    expect(onOpenClipInFocus).not.toHaveBeenCalledWith(201);
  });
});

describe('T11910 orientation slots: one render path for every state', () => {
  it.each([
    ['no highlight', noHighlight, 'c2'],
    ['one published', publishedRegion, 'c1'],
    ['landscape published', landscapePublished, 'c3'],
  ])('%s: renders both slots and never the legacy CTAs', (_label, region, id) => {
    renderView({ clipRegions: [region], annotateSelectedRegionId: id });
    expect(screen.getByTestId('annotate-highlight-slots')).toBeTruthy();
    expect(slot('portrait')).toBeTruthy();
    expect(slot('landscape')).toBeTruthy();
    expect(screen.getByTestId('instance-orientation-icon-portrait')).toBeTruthy();
    expect(screen.getByTestId('instance-orientation-icon-landscape')).toBeTruthy();
    expect(screen.queryByTestId('annotate-stage-cta')).toBeNull();
    expect(screen.queryByTestId('annotate-make-another-highlight-cta')).toBeNull();
    // Edit play is always there.
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
  });

  it('no highlight: both slots offer their own Make button, neither preselected', () => {
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2' });
    expect(screen.getByTestId('annotate-make-highlight-portrait')).toBeTruthy();
    expect(screen.getByTestId('annotate-make-highlight-landscape')).toBeTruthy();
    expect(screen.getByText('Make Portrait')).toBeTruthy();
    expect(screen.getByText('Make Landscape')).toBeTruthy();
  });

  it('neither slot is favored: both Make buttons have identical styling', () => {
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2' });
    const portrait = screen.getByTestId('annotate-make-highlight-portrait');
    const landscape = screen.getByTestId('annotate-make-highlight-landscape');
    expect(portrait.className).toBe(landscape.className);
    expect(document.activeElement).not.toBe(portrait);
    expect(document.activeElement).not.toBe(landscape);
  });

  it('Make Portrait creates a NEW 9:16 highlight and opens Framing', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 77 });
    const onOpenClipInFocus = vi.fn();
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2', onFullscreenUpdateClip, onOpenClipInFocus });

    fireEvent.click(screen.getByTestId('annotate-make-highlight-portrait'));

    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(77));
    expect(onFullscreenUpdateClip).toHaveBeenCalledWith('c2', {
      createProject: true, forceNew: true, silent: true, aspectRatio: '9:16',
    });
  });

  it('Make Landscape creates a NEW 16:9 highlight', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 78 });
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2', onFullscreenUpdateClip });

    fireEvent.click(screen.getByTestId('annotate-make-highlight-landscape'));

    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    expect(onFullscreenUpdateClip.mock.calls[0][1]).toMatchObject({
      createProject: true, forceNew: true, aspectRatio: '16:9',
    });
  });

  it('portrait published: the portrait slot lists it, the landscape slot offers Make Landscape (16:9)', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 1000 });
    renderView({ clipRegions: [publishedRegion], onFullscreenUpdateClip });

    expect(screen.queryByTestId('annotate-make-highlight-portrait')).toBeNull();
    expect(slot('portrait').textContent).toContain('Finished');

    fireEvent.click(screen.getByTestId('annotate-make-highlight-landscape'));
    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    expect(onFullscreenUpdateClip.mock.calls[0][1]).toMatchObject({ createProject: true, forceNew: true, aspectRatio: '16:9' });
  });

  it('landscape published: the landscape slot lists it, the portrait slot offers Make Portrait (9:16)', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 1001 });
    renderView({ clipRegions: [landscapePublished], annotateSelectedRegionId: 'c3', onFullscreenUpdateClip });

    expect(screen.queryByTestId('annotate-make-highlight-landscape')).toBeNull();
    expect(slot('landscape').textContent).toContain('Finished');

    fireEvent.click(screen.getByTestId('annotate-make-highlight-portrait'));
    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    expect(onFullscreenUpdateClip.mock.calls[0][1]).toMatchObject({ createProject: true, forceNew: true, aspectRatio: '9:16' });
  });

  it('a double click on Make cannot create two highlights', async () => {
    let resolve;
    const onFullscreenUpdateClip = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2', onFullscreenUpdateClip });

    fireEvent.click(screen.getByTestId('annotate-make-highlight-portrait'));
    fireEvent.click(screen.getByTestId('annotate-make-highlight-landscape'));

    expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1);
    resolve({ saveOk: false, projectId: null });
  });
});
