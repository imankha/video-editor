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
import { ANNOTATE_COACH } from '../components/instructions/catalog';

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

  // 31b50fab5 (Unify annotate action cards and guided pulses): the whole-game
  // actions became equal-size ActionCards. Mark play stays first in the row and is
  // the one the watch-phase guidance coach pulses, which is what now marks it as
  // the primary action.
  it('renders "Mark play" as the first full-size (>=44pt) action card, pulsed by the guidance coach', () => {
    renderView({ hasAnnotateClips: false });
    const cta = screen.getByRole('button', { name: /mark play/i });
    expect(cta).toBe(screen.getByTestId('annotate-mark-play-button'));
    // Full-width + tall tap target = a launchpad card, not a small control.
    expect(cta.className).toMatch(/w-full/);
    expect(cta.className).toMatch(/min-h-\[168px\]/);
    // The guided pulse marks it as the action to take while watching.
    expect(cta.className).toMatch(/coach-target-pulse/);
    // First action in the whole-game row.
    expect(cta.parentElement.firstElementChild).toBe(cta);
    // Visual primacy: the one solid cyan fill; the other cards are tinted secondaries.
    expect(cta.className).toMatch(/\bbg-cyan-500\b/);
    expect(cta.className).not.toMatch(/from-cyan-500\/20/);
    const other = screen.getByRole('button', { name: /review plays/i });
    expect(other.className).not.toMatch(/\bbg-cyan-500\b/);
  });

  it('selected play: the two highlight slots come before Edit play, and Edit play is a secondary card', () => {
    renderView({
      isEditMode: true,
      playback: { isPlaybackMode: false, enterPlaybackMode: vi.fn(), getCurrentSegment: () => null },
      annotateSelectedRegionId: 'r1',
      clipRegions: [{ id: 'r1', startTime: 0, endTime: 5, rating: 3, tags: [], notes: '', highlightInstances: [] }],
    });
    const slots = screen.getByTestId('annotate-highlight-slots');
    const editPlay = screen.getByRole('button', { name: /edit play/i });
    // Slots precede Edit play in document order (main action first).
    expect(slots.compareDocumentPosition(editPlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Edit play is a secondary: no solid cyan fill, tinted card from the shared ActionCard.
    expect(editPlay.className).not.toMatch(/\bbg-cyan-500\b/);
    expect(editPlay.className).toMatch(/from-cyan-500\/20/);
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

  // a2432f7b6 replaced the inline first-use hint with the shared guidance coach
  // (FloatingCoach anchored to Mark play); 3662653a0 set its watch-phase copy.
  it('shows the one-line watch-phase guidance coach in the empty state', () => {
    renderView({ hasAnnotateClips: false });
    const coach = screen.getByTestId('annotate-guidance');
    expect(coach.getAttribute('data-phase')).toBe('watch');
    expect(coach.textContent).toContain(ANNOTATE_COACH.watch.title);
    // The old "auto-saved" reassurance paragraph is not shown in the empty state.
    expect(screen.queryByText(/automatically saved to your library/i)).toBeNull();
  });

  it('locks Review plays until a clip exists: aria-disabled (still tappable), not the disabled attribute, Lock icon, no outline, dimmer text', () => {
    renderView({ hasAnnotateClips: false });
    const playback = screen.getByRole('button', { name: /review plays/i });
    // T11750: locked (not disabled) — a tap still lands to show the toast.
    expect(playback.getAttribute('aria-disabled')).toBe('true');
    expect(playback.disabled).toBe(false);
    // T11750 cue 1: the Lock icon replaces ListVideo (lucide renders lucide-<name> classes).
    expect(playback.querySelector('.lucide-lock')).not.toBeNull();
    expect(playback.querySelector('.lucide-list-video')).toBeNull();
    // T11750 cue 2: no cyan outline (locked card is borderless).
    expect(playback.className).not.toMatch(/border-cyan-400\/50/);
    // T11750 cue 3: dimmer text, and it clears 4.5:1 on the page gradient (gray-300; gray-400 fails).
    expect(playback.className).toMatch(/text-gray-300/);
    expect(playback.className).not.toMatch(/text-cyan-50/);
    expect(playback.className).not.toMatch(/text-gray-400/);
    // No fill padding beyond the shared card's.
    expect(playback.className).not.toMatch(/py-3/);
  });

  it('enabled Review plays (clips exist) shows the list icon and the secondary card, not the lock', () => {
    renderView({ hasAnnotateClips: true });
    const playback = screen.getByRole('button', { name: /review plays/i });
    expect(playback.querySelector('.lucide-list-video')).not.toBeNull();
    expect(playback.querySelector('.lucide-lock')).toBeNull();
    expect(playback.className).toMatch(/border-cyan-400\/50/);
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

  // Review mode: one primary. Share plays is the primary, Back to mark plays follows it.
  it('review mode: Share plays is the one primary card and comes before Back', () => {
    renderView({
      hasAnnotateClips: true,
      playback: { isPlaybackMode: true, activeClipId: null, enterPlaybackMode: vi.fn(), exitPlaybackMode: vi.fn(), getCurrentSegment: () => null },
      onSharePlayback: vi.fn(),
    });
    const share = screen.getByRole('button', { name: /share plays/i });
    const back = screen.getByRole('button', { name: new RegExp(ANNOTATE.BACK_TO_MARK_PLAYS, 'i') });
    expect(share.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(share.className).toMatch(/\bbg-cyan-500\b/);
    expect(back.className).not.toMatch(/\bbg-cyan-500\b/);
  });

  // 31b50fab5: Share plays and Add footage render as the same ActionCard as the
  // other whole-game actions (AddFootageButton variant="card").
  it('renders Share and Add footage as visibly tappable outlined cards in the zero-plays row (>=44px, outline, light text)', () => {
    renderView({ hasAnnotateClips: false, onSharePlayback: vi.fn(), addFootage: { gameId: 'g1', disabled: false, onFootageAttached: vi.fn() } });
    const share = screen.getByRole('button', { name: /share/i });
    const addFootage = screen.getByRole('button', { name: /add footage/i });
    for (const btn of [share, addFootage]) {
      expect(btn.className).toMatch(/min-h-\[168px\]/); // >=44px tap target
      expect(btn.className).toMatch(/border-cyan-400\/50/); // visible outline
      expect(btn.className).toMatch(/text-cyan-50/); // light (not dimmed) text
      expect(btn.className).not.toMatch(/text-xs/); // not tiny
    }
  });

  it('unlocks Review plays once clips exist, and shows no inline first-use hint', () => {
    const enterPlaybackMode = vi.fn();
    renderView({ hasAnnotateClips: true, playback: { isPlaybackMode: false, enterPlaybackMode } });
    const playback = screen.getByRole('button', { name: /review plays/i });
    expect(playback.getAttribute('aria-disabled')).toBeNull();
    expect(playback.disabled).toBe(false);
    playback.click();
    expect(enterPlaybackMode).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
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
