import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8140 — the full-screen "What sport is this?" question is wired to a MOBILE
 * user's first Mark-play TAP while the profile is still no_sport, and answers
 * persist through the existing profile-sport gesture (updateProfile).
 *
 * T10610: this used to fire from the editor's create-mode Save gesture
 * (onCreateClip) — the create now happens at the Mark play TAP itself (D2),
 * so the trigger moved to AnnotateModeView's own onAddClip wrapper
 * (handleAddClipWithSportPrompt). The stub below exposes onAddClip instead of
 * the retired onCreateClip.
 */

const updateProfileMock = vi.fn(() => Promise.resolve());

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  // Stub controls: exposes a Mark-play button that fires onAddClip so we can
  // drive the mobile first-tap path without the real transport bar.
  AnnotateControls: ({ onAddClip }) => (
    <button data-testid="stub-add-clip" onClick={() => onAddClip?.()}>
      stub-add-clip
    </button>
  ),
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="stub-overlay" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => true, useIsLandscape: () => false }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({ isVisible: true }),
}));
vi.mock('../stores', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'no_sport' }),
  useProfileStore: (selector) => selector({ updateProfile: updateProfileMock }),
  useProjectsList: () => [],
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
    // T10610: NOT open yet — the sport question fires at the TAP that is
    // about to create a play, before the editor opens.
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
    onFullscreenUpdateClip: vi.fn(),
    onOverlayClose: vi.fn(),
    onDeletePlayFromEditor: vi.fn(),
    onAwaitRegionWrites: vi.fn(() => Promise.resolve(true)),
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

describe('AnnotateModeView — first-tap sport question (T8140, T10610)', () => {
  it('opens the full-screen sport question after a mobile no_sport Mark-play tap', () => {
    renderView();
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
    fireEvent.click(screen.getByTestId('stub-add-clip'));
    expect(screen.getByRole('dialog', { name: 'What sport is this?' })).toBeTruthy();
  });

  it('still calls the real onAddClip handler (the tap creates the play in one gesture)', () => {
    const onAddClip = vi.fn();
    renderView({ onAddClip });
    fireEvent.click(screen.getByTestId('stub-add-clip'));
    expect(onAddClip).toHaveBeenCalledTimes(1);
  });

  it('picking a sport persists via updateProfile and closes the question', () => {
    renderView();
    fireEvent.click(screen.getByTestId('stub-add-clip'));
    // Pick the first sport button inside the dialog.
    const dialog = screen.getByRole('dialog', { name: 'What sport is this?' });
    const sportButtons = dialog.querySelectorAll('button');
    fireEvent.click(sportButtons[0]);
    expect(updateProfileMock).toHaveBeenCalledWith('p1', expect.objectContaining({ sport: expect.any(String) }));
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
  });

  it('does not re-ask on a second tap in the same session', () => {
    renderView();
    fireEvent.click(screen.getByTestId('stub-add-clip'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' })); // dismiss
    fireEvent.click(screen.getByTestId('stub-add-clip')); // second tap
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
  });

  it('does not ask when the tap is editing an already-SELECTED play, not creating one', () => {
    renderView({ annotateSelectedRegionId: 'r1', clipRegions: [{ id: 'r1' }] });
    fireEvent.click(screen.getByTestId('stub-add-clip'));
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
  });
});
