import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8140 — the full-screen "What sport is this?" question is wired to a MOBILE
 * first clip save while the profile is still no_sport, and answers persist
 * through the existing profile-sport gesture (updateProfile).
 */

const updateProfileMock = vi.fn(() => Promise.resolve());

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  // Stub overlay: exposes a Save button that fires the create handler so we can
  // drive the mobile first-save path without the real form.
  AnnotateFullscreenOverlay: ({ onCreateClip }) => (
    <button data-testid="stub-save" onClick={() => onCreateClip({ rating: 4, tags: [], name: 'Play 1' })}>
      stub-save
    </button>
  ),
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
    showAnnotateOverlay: true, // form open
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
    onFullscreenCreateClip: vi.fn(),
    onFullscreenUpdateClip: vi.fn(),
    onOverlayResume: vi.fn(),
    onOverlayClose: vi.fn(),
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

describe('AnnotateModeView — first-save sport question (T8140)', () => {
  it('opens the full-screen sport question after a mobile no_sport first save', () => {
    renderView();
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
    fireEvent.click(screen.getByTestId('stub-save'));
    expect(screen.getByRole('dialog', { name: 'What sport is this?' })).toBeTruthy();
  });

  it('still calls the real create handler (clip saves in one tap)', () => {
    const onFullscreenCreateClip = vi.fn();
    renderView({ onFullscreenCreateClip });
    fireEvent.click(screen.getByTestId('stub-save'));
    expect(onFullscreenCreateClip).toHaveBeenCalledTimes(1);
  });

  it('picking a sport persists via updateProfile and closes the question', () => {
    renderView();
    fireEvent.click(screen.getByTestId('stub-save'));
    // Pick the first sport button inside the dialog.
    const dialog = screen.getByRole('dialog', { name: 'What sport is this?' });
    const sportButtons = dialog.querySelectorAll('button');
    fireEvent.click(sportButtons[0]);
    expect(updateProfileMock).toHaveBeenCalledWith('p1', expect.objectContaining({ sport: expect.any(String) }));
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
  });

  it('does not re-ask on a second save in the same session', () => {
    renderView();
    fireEvent.click(screen.getByTestId('stub-save'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' })); // dismiss
    fireEvent.click(screen.getByTestId('stub-save')); // second save
    expect(screen.queryByRole('dialog', { name: 'What sport is this?' })).toBeNull();
  });
});
