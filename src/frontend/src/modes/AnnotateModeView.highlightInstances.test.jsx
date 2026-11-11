import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T11430 review-fix regression + T14770 single entry + list.
 *
 * T11430 (kept): clicking an instance whose stage is preview/published must fetch
 * the FULL project (useProjectsStore.fetchProject) before onOpenClipPreview;
 * the instance is archived so it is not in projectsList and a bare {id} would
 * trip openClipPreview's final_video_id guard.
 *
 * T14770: the T11910 two-slot surface is replaced by ONE Make highlight entry
 * (always creates a new portrait highlight, forceNew) plus "Highlights from
 * this play" listing every highlight already made (either shape, any count),
 * each opening where it left off.
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

describe('T11430 highlight instances (review-fix regression)', () => {
  it('a published instance row fetches the full project and opens preview with it (BLOCKING fix)', async () => {
    fetchProjectMock.mockResolvedValue(PUBLISHED_PROJECT_DETAIL);
    const onOpenClipPreview = vi.fn();
    renderView({ clipRegions: [publishedRegion], onOpenClipPreview });

    fireEvent.click(screen.getByRole('button', { name: /^portrait, finished/i }));

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

    fireEvent.click(screen.getByRole('button', { name: /^portrait, finished/i }));

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalledWith(42));
    expect(onOpenClipPreview).not.toHaveBeenCalled();
  });

  it('per-instance rows open their own distinct projects', async () => {
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
        // Second highlight from the same play, still at the Frame stage -> 'focus' action.
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

    fireEvent.click(screen.getByTestId('highlight-row-201'));
    await waitFor(() => expect(onOpenClipInOverlay).toHaveBeenCalledWith(201));

    fireEvent.click(screen.getByTestId('highlight-row-202'));
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(202));

    expect(onOpenClipInOverlay).not.toHaveBeenCalledWith(202);
    expect(onOpenClipInFocus).not.toHaveBeenCalledWith(201);
  });
});

describe('T14770 single Make highlight entry + Highlights from this play list', () => {
  it.each([
    ['no highlight', noHighlight, 'c2'],
    ['one published', publishedRegion, 'c1'],
    ['landscape published', landscapePublished, 'c3'],
  ])('%s: Edit play first, one Make highlight entry, never the legacy slots', (_label, region, id) => {
    renderView({ clipRegions: [region], annotateSelectedRegionId: id });
    expect(screen.getByTestId('annotate-make-highlight')).toBeTruthy();
    expect(screen.queryByTestId('annotate-highlight-slots')).toBeNull();
    expect(screen.queryByTestId(/annotate-highlight-slot-/)).toBeFalsy();
    expect(screen.queryByTestId('annotate-stage-cta')).toBeNull();
    expect(screen.queryByTestId('annotate-make-another-highlight-cta')).toBeNull();
    // Edit play is always there, first. 31b50fab5: it is a card whose accessible
    // name is the title followed by a description line, so anchor on the title.
    expect(screen.getByRole('button', { name: /^edit play/i })).toBeTruthy();
  });

  it('no highlight: one Make highlight button, no list', () => {
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2' });
    expect(screen.getByTestId('annotate-make-highlight').textContent).toContain('Make highlight');
    expect(screen.queryByTestId('annotate-highlight-list')).toBeNull();
  });

  it('Make highlight creates a NEW portrait (9:16) highlight and opens Frame (shape picked there)', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 77 });
    const onOpenClipInFocus = vi.fn();
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2', onFullscreenUpdateClip, onOpenClipInFocus });

    fireEvent.click(screen.getByTestId('annotate-make-highlight'));

    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(77));
    expect(onFullscreenUpdateClip).toHaveBeenCalledWith('c2', {
      createProject: true, forceNew: true, silent: true, aspectRatio: '9:16',
    });
  });

  it('a second highlight can be made from a play that already has one', async () => {
    const onFullscreenUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 1000 });
    renderView({ clipRegions: [publishedRegion], onFullscreenUpdateClip });

    // The entry button is still there (never disappears once a highlight exists).
    fireEvent.click(screen.getByTestId('annotate-make-highlight'));
    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1));
    expect(onFullscreenUpdateClip.mock.calls[0][1]).toMatchObject({
      createProject: true, forceNew: true, aspectRatio: '9:16',
    });
  });

  it('a play with a highlight says Make new highlight and titles the list Existing highlights', () => {
    renderView({ clipRegions: [publishedRegion], annotateSelectedRegionId: 'c1' });
    expect(screen.getByTestId('annotate-make-highlight').textContent).toContain('Make new highlight');
    expect(screen.getByTestId('annotate-highlight-list').textContent).toContain('Existing highlights');
  });

  it('Edit play and Make highlight share one two-column row from sm', () => {
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2' });
    const grid = screen.getByTestId('annotate-primary-cta').parentElement;
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(screen.getByTestId('annotate-make-highlight').className).toContain('h-full');
  });

  it('list shows a count chip and the row opens where it left off', () => {
    renderView({ clipRegions: [publishedRegion], annotateSelectedRegionId: 'c1' });
    expect(screen.getByTestId('annotate-highlight-list')).toBeTruthy();
    expect(screen.getByTestId('highlight-count-portrait').textContent).toBe('1 portrait');
    expect(screen.queryByTestId('highlight-count-landscape')).toBeNull();
    expect(screen.getByTestId('highlight-row-42').textContent).toContain('Finished');
  });

  it('landscape published: the list shows a landscape count chip', () => {
    renderView({ clipRegions: [landscapePublished], annotateSelectedRegionId: 'c3' });
    expect(screen.getByTestId('highlight-count-landscape').textContent).toBe('1 landscape');
    expect(screen.queryByTestId('highlight-count-portrait')).toBeNull();
  });

  it('a double click on Make highlight cannot create two highlights', async () => {
    let resolve;
    const onFullscreenUpdateClip = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderView({ clipRegions: [noHighlight], annotateSelectedRegionId: 'c2', onFullscreenUpdateClip });

    fireEvent.click(screen.getByTestId('annotate-make-highlight'));
    fireEvent.click(screen.getByTestId('annotate-make-highlight'));

    expect(onFullscreenUpdateClip).toHaveBeenCalledTimes(1);
    resolve({ saveOk: false, projectId: null });
  });
});
