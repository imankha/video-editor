import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  toast: { info: toastInfo },
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
import { ANNOTATE } from '../config/displayNames';

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
  beforeEach(() => toastInfo.mockClear());

  it('renders "Add Play" as a full-width, >=44pt primary button — the loudest element', () => {
    renderView({ hasAnnotateClips: false });
    const cta = screen.getByRole('button', { name: /mark play/i });
    expect(cta).toBeTruthy();
    // Full-width + tall tap target = the loud primary launchpad, not a small control.
    expect(cta.className).toMatch(/w-full/);
    expect(cta.className).toMatch(/min-h-\[52px\]/);
    expect(cta.className).toMatch(/text-lg/);
  });

  it('calls onAddClip when the primary CTA is clicked', () => {
    const onAddClip = vi.fn();
    renderView({ onAddClip });
    screen.getByRole('button', { name: /mark play/i }).click();
    expect(onAddClip).toHaveBeenCalledTimes(1);
  });

  it('flips to "Edit Play" when a clip is selected, since onAddClip edits it instead of creating a new one', () => {
    renderView({ isEditMode: true });
    expect(screen.queryByRole('button', { name: /^mark play$/i })).toBeNull();
    const cta = screen.getByRole('button', { name: /edit play/i });
    expect(cta).toBeTruthy();
    expect(cta.getAttribute('title')).toBe('Edit the selected play');
  });

  it('shows the one-line first-use hint only while there are no clips', () => {
    renderView({ hasAnnotateClips: false });
    expect(screen.getByText('Play the game. Mark the moments worth keeping.')).toBeTruthy();
    // The old "auto-saved" reassurance paragraph is not shown in the empty state.
    expect(screen.queryByText(/automatically saved to your library/i)).toBeNull();
  });

  it('locks Review plays until a clip exists: aria-disabled (still tappable), not the disabled attribute, no prominence padding', () => {
    renderView({ hasAnnotateClips: false });
    const playback = screen.getByRole('button', { name: /review plays/i });
    // T11750: locked (not disabled) — a tap still lands to show the toast.
    expect(playback.getAttribute('aria-disabled')).toBe('true');
    expect(playback.disabled).toBe(false);
    // The row stays below the hero: no fill padding.
    expect(playback.className).not.toMatch(/py-3/);
    // AC3 contrast: this row renders near the gradient's purple midpoint, where
    // gray-400 (~3.4:1) and gray-500 (~1.7:1) fall below 4.5:1. gray-300 (~5.9:1)
    // is the locked-text color that clears the bar. Pin it so it can't regress.
    expect(playback.className).toMatch(/text-gray-300/);
    expect(playback.className).not.toMatch(/text-gray-[45]00/);
  });

  it('shows the locked toast once (deduped) when Review plays is tapped with zero plays, and never enters playback', () => {
    const enterPlaybackMode = vi.fn();
    renderView({ hasAnnotateClips: false, playback: { isPlaybackMode: false, enterPlaybackMode } });
    const playback = screen.getByRole('button', { name: /review plays/i });
    playback.click();
    playback.click();
    expect(enterPlaybackMode).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith('Mark your first play to review it.', {
      dedupKey: 'review-locked',
    });
    // Dedupe is the toast store's job (same dedupKey replaces), so the view may
    // call info() per tap — the key is what collapses them to one visible toast.
    expect(toastInfo.mock.calls.every(([, opts]) => opts?.dedupKey === 'review-locked')).toBe(true);
  });

  it('renders Share and Add footage as visibly tappable outlined controls in the zero-plays row (>=44px, outline, light text)', () => {
    renderView({ hasAnnotateClips: false, onSharePlayback: vi.fn(), addFootage: { gameId: 'g1', disabled: false, onFootageAttached: vi.fn() } });
    const share = screen.getByRole('button', { name: /share/i });
    const addFootage = screen.getByRole('button', { name: /add footage/i });
    for (const btn of [share, addFootage]) {
      expect(btn.className).toMatch(/min-h-11/); // 44px tap target
      expect(btn.className).toMatch(/ring-1/); // visible outline
      expect(btn.className).toMatch(/text-gray-100/); // light (not dimmed) text
      expect(btn.className).not.toMatch(/text-xs/); // no longer tiny
    }
  });

  it('promotes Playback Annotations to a full button once clips exist, and hides the first-use hint', () => {
    renderView({ hasAnnotateClips: true });
    const playback = screen.getByRole('button', { name: /review plays/i });
    expect(playback.className).toMatch(/flex-1/);
    expect(playback.className).toMatch(/py-3/);
    expect(playback.disabled).toBe(false);
    expect(screen.queryByText(ANNOTATE.MARK_PLAY_HELPER)).toBeNull();
    // T9450: the standing "automatically saved to your library" reassurance was
    // removed. A saved confirmation now fires only after a real save succeeds
    // (a toast in AnnotateContainer), never as a pre-save claim on the surface.
    expect(screen.queryByText(/automatically saved to your library/i)).toBeNull();
  });

  it('no alternate-instruction copy: nothing on the surface says "Add Clip"', () => {
    const { container } = renderView({ hasAnnotateClips: false });
    expect(container.textContent).not.toMatch(/Add Clip/);
  });

  // Regression (2026-09-18 user request): the technical readouts (resolution/
  // format/size) moved from the TOP of the screen to a de-emphasized footer
  // BELOW the bottom CTA (Review plays), so this is a DOM-order check, not
  // just a "does it render" check.
  it('renders the technical metadata footer AFTER the bottom CTA, de-emphasized', () => {
    renderView({ hasAnnotateClips: true, annotateVideoMetadata: { format: 'mp4', size: 1024 } });
    const playback = screen.getByRole('button', { name: /review plays/i });
    const footer = screen.getByText('Format:').closest('div');
    expect(footer.textContent).toMatch(/MP4/);
    expect(footer.textContent).toMatch(/1 KB/);
    expect(footer.className).toMatch(/text-xs/);
    expect(playback.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
