import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T11860: a fresh game (0 plays) shows one obvious action. The view hides frame-step
 * and the timeline zoom behind a "More controls" button, promotes the helper copy,
 * and reads the 6/2 second numbers from clipConstants (never hardcoded).
 */

const mobile = { value: false };

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  // Surface the zoom prop the real AnnotateTimeline would turn into the chip.
  AnnotateMode: ({ zoom }) => (
    <div data-testid="timeline" data-zoom={zoom?.timelineZoom} data-center-key={zoom?.centerPlayheadKey} data-hide-chip={String(zoom?.hideChip)}>
      <button data-testid="zin" onClick={zoom?.zoomIn}>+</button>
      <button data-testid="zout" onClick={zoom?.zoomOut}>-</button>
      <button data-testid="zreset" onClick={zoom?.resetZoom}>reset</button>
    </div>
  ),
  AnnotateControls: ({ simplified }) => <div data-testid="controls" data-simplified={String(simplified)} />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="overlay" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div data-testid="playback-controls" /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value, useIsLandscape: () => false }));
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

function baseProps(overrides = {}) {
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
    hasAnnotateClips: true,
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
}

import { ANNOTATE } from '../config/displayNames';
import { DEFAULT_CLIP_BEFORE, DEFAULT_CLIP_AFTER } from '../components/shared/clipConstants';

const firstRun = () => ({ hasAnnotateClips: false, isFirstRun: true, simplifiedControls: true, onShowAllControls: vi.fn() });
const withPlays = () => ({ hasAnnotateClips: true, isFirstRun: false, simplifiedControls: false, onShowAllControls: vi.fn() });

describe('AnnotateModeView first-run disclosure (T11860)', () => {
  beforeEach(() => { mobile.value = false; });

  it('simplifies the transport and timeline and offers More controls on a fresh game', () => {
    render(<AnnotateModeView {...baseProps(firstRun())} />);
    expect(screen.getByTestId('controls').getAttribute('data-simplified')).toBe('true');
    expect(screen.getByTestId('timeline').getAttribute('data-hide-chip')).toBe('true');
    expect(screen.getByRole('button', { name: ANNOTATE.MORE_CONTROLS })).toBeTruthy();
  });

  it('More controls asks the owner to reveal everything (one gesture, no persistence call)', () => {
    const props = baseProps(firstRun());
    render(<AnnotateModeView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: ANNOTATE.MORE_CONTROLS }));
    expect(props.onShowAllControls).toHaveBeenCalledTimes(1);
  });

  it('once revealed (or once a play exists) everything is visible and the button is gone', () => {
    render(<AnnotateModeView {...baseProps(withPlays())} />);
    expect(screen.getByTestId('controls').getAttribute('data-simplified')).toBe('false');
    expect(screen.getByTestId('timeline').getAttribute('data-hide-chip')).toBe('false');
    expect(screen.queryByRole('button', { name: ANNOTATE.MORE_CONTROLS })).toBeNull();
  });

  it('fullscreen never simplifies (a deliberate gesture wants the full transport)', () => {
    render(<AnnotateModeView {...baseProps({ ...firstRun(), annotateFullscreen: true })} />);
    expect(screen.getByTestId('controls').getAttribute('data-simplified')).toBe('false');
    expect(screen.queryByRole('button', { name: ANNOTATE.MORE_CONTROLS })).toBeNull();
  });

  it('promotes the helper to text-base text-gray-200 with the 6/2 numbers from clipConstants', () => {
    render(<AnnotateModeView {...baseProps(firstRun())} />);
    const helper = screen.getByTestId('mark-play-helper');
    expect(helper.className).toMatch(/text-base/);
    expect(helper.className).toMatch(/text-gray-200/);
    expect(helper.textContent).toBe(
      `Play the game. Right after a great moment, press Mark play. It keeps the ${DEFAULT_CLIP_BEFORE} seconds before and ${DEFAULT_CLIP_AFTER} after.`
    );
  });

  it('the helper is not shown once the game has plays', () => {
    render(<AnnotateModeView {...baseProps(withPlays())} />);
    expect(screen.queryByTestId('mark-play-helper')).toBeNull();
  });
});
