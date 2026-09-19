import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10310 (2026-09-18 user request):
 *  - Once a play is selected, the whole-game "Preview plays"/"Share plays"
 *    row is gone (only play-specific actions apply); the primary CTA splits
 *    into [Edit Play] + a Frame action.
 *  - The "You are bookmarking, not editing..." stage-reason line is gone.
 *
 * T10450 (2026-09-18 user request):
 *  - While the play has NO project yet, the Frame action splits into
 *    [Frame Now] (create the project, then opens Framing immediately) and
 *    [Frame Later] (create the project only, no navigation — the play
 *    becomes an editable clip left for a later Framing pass).
 *  - Once a project exists (the play already IS a clip), it's back to a
 *    single stage-CTA button (reusing getClipStage, the same logic the
 *    editor's own stage CTA already used) — Frame Now/Later was only ever
 *    about the create decision.
 *  - Frame Later throbs (motion-safe:animate-pulse) when the play is rated
 *    5 stars.
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
    ...overrides,
  };
}

function renderView(overrides = {}) {
  return render(<AnnotateModeView {...buildProps(overrides)} />);
}

describe('AnnotateModeView — play-selected CTA row (T10310/T10450)', () => {
  it('splits into [Edit Play] + [Frame Now] + [Frame Later] once a project-less play is selected', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^frame now$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^frame later$/i })).toBeTruthy();
  });

  it('collapses back to [Edit Play] + a single stage button once the play has a project', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ ...selectedRegion, autoProjectId: 42 }],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.getByRole('button', { name: /^edit play$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^frame now$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^frame later$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^frame$/i })).toBeTruthy();
  });

  it('Frame Later throbs when the play is rated 5 stars, not otherwise', () => {
    const baseOverrides = {
      isEditMode: true,
      hasAnnotateClips: true,
      annotateSelectedRegionId: 'r1',
    };
    const { rerender } = renderView({
      ...baseOverrides,
      clipRegions: [{ ...selectedRegion, rating: 3 }],
    });
    expect(screen.getByRole('button', { name: /^frame later$/i }).className).not.toMatch(/animate-pulse/);

    rerender(
      <AnnotateModeView
        {...buildProps({ ...baseOverrides, clipRegions: [{ ...selectedRegion, rating: 5 }] })}
      />,
    );
    expect(screen.getByRole('button', { name: /^frame later$/i }).className).toMatch(/animate-pulse/);
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

  it('Frame Now on a project-less play creates the project, then opens Framing with the new id', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /^frame now$/i }));

    expect(onFullscreenUpdateClip).toHaveBeenCalledWith('r1', { createProject: true });
    await waitFor(() => expect(onOpenClipInFocus).toHaveBeenCalledWith(99));
  });

  it('disables both Frame Now and Frame Later while a create is in flight', async () => {
    let resolveCreate;
    const onFullscreenUpdateClip = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [selectedRegion],
      annotateSelectedRegionId: 'r1',
      onFullscreenUpdateClip,
    });

    fireEvent.click(screen.getByRole('button', { name: /^frame now$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^frame now$/i }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: /^frame later$/i }).disabled).toBe(true);
    });

    resolveCreate({ saveOk: true, projectId: 99 });
    await waitFor(() => expect(screen.getByRole('button', { name: /^frame later$/i }).disabled).toBe(false));
  });

  it('Frame Later on a project-less play creates the project WITHOUT navigating to Framing', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /^frame later$/i }));

    await waitFor(() => expect(onFullscreenUpdateClip).toHaveBeenCalledWith('r1', { createProject: true }));
    expect(onOpenClipInFocus).not.toHaveBeenCalled();
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
    // FOCUS-stage label is "Frame" (ANNOTATE.FRAME_THIS_CLIP, shortened from
    // "Frame this clip" 2026-09-18, same day this test was written) -- distinct
    // from "Frame Now"/"Frame Later" which only ever apply pre-project.
    fireEvent.click(screen.getByRole('button', { name: /^frame$/i }));

    expect(onFullscreenUpdateClip).not.toHaveBeenCalled();
    expect(onOpenClipInFocus).toHaveBeenCalledWith(42);
  });
});
