import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8130 — Annotate primary CTA hierarchy.
 *
 * "Add Play" must be the single loudest interactive element under the video; the
 * secondary Playback Annotations + Share actions are demoted to text-level
 * prominence until the first clip exists, and a one-line first-use hint replaces
 * the old alternate-instruction paragraphs while clip_count === 0.
 */

// Stub heavy children — we only assert the action hierarchy that AnnotateModeView
// itself renders (the primary CTA + secondary buttons live directly in this view).
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
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView primary CTA hierarchy (T8130)', () => {
  it('renders "Add Play" as a full-width, >=44pt primary button — the loudest element', () => {
    renderView({ hasAnnotateClips: false });
    const cta = screen.getByRole('button', { name: /add play/i });
    expect(cta).toBeTruthy();
    // Full-width + tall tap target = the loud primary launchpad, not a small control.
    expect(cta.className).toMatch(/w-full/);
    expect(cta.className).toMatch(/min-h-\[52px\]/);
    expect(cta.className).toMatch(/text-lg/);
  });

  it('calls onAddClip when the primary CTA is clicked', () => {
    const onAddClip = vi.fn();
    renderView({ onAddClip });
    screen.getByRole('button', { name: /add play/i }).click();
    expect(onAddClip).toHaveBeenCalledTimes(1);
  });

  it('flips to "Edit Play" when a clip is selected, since onAddClip edits it instead of creating a new one', () => {
    renderView({ isEditMode: true });
    expect(screen.queryByRole('button', { name: /^add play$/i })).toBeNull();
    const cta = screen.getByRole('button', { name: /edit play/i });
    expect(cta).toBeTruthy();
    expect(cta.getAttribute('title')).toBe('Edit the selected play');
  });

  it('shows the one-line first-use hint only while there are no clips', () => {
    renderView({ hasAnnotateClips: false });
    expect(screen.getByText(/we grab the last few seconds/i)).toBeTruthy();
    // The old "auto-saved" reassurance paragraph is not shown in the empty state.
    expect(screen.queryByText(/automatically saved to your library/i)).toBeNull();
  });

  it('demotes Playback Annotations to text-level (not a prominent button) until a clip exists', () => {
    renderView({ hasAnnotateClips: false });
    const playback = screen.getByRole('button', { name: /playback annotations/i });
    // Text-level demotion: small text, no full prominence padding/background.
    expect(playback.className).toMatch(/text-xs/);
    expect(playback.className).not.toMatch(/py-3/);
    expect(playback.disabled).toBe(true);
  });

  it('promotes Playback Annotations to a full button once clips exist, and hides the first-use hint', () => {
    renderView({ hasAnnotateClips: true });
    const playback = screen.getByRole('button', { name: /playback annotations/i });
    expect(playback.className).toMatch(/flex-1/);
    expect(playback.className).toMatch(/py-3/);
    expect(playback.disabled).toBe(false);
    expect(screen.queryByText(/we grab the last few seconds/i)).toBeNull();
    expect(screen.getByText(/automatically saved to your library/i)).toBeTruthy();
  });

  it('no alternate-instruction copy: nothing on the surface says "Add Clip"', () => {
    const { container } = renderView({ hasAnnotateClips: false });
    expect(container.textContent).not.toMatch(/Add Clip/);
  });
});
