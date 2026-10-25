import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * T13390: with the open game's upload failed, Annotate kept saying "Tap Play to watch ... tap
 * Mark play", pulsed Play and Mark play, and the shade dimmed the "Upload failed" banner and its
 * Retry upload button. The failure must outrank the watch/plays/review rules, name Retry upload,
 * pulse it, and keep the banner clear of the shade.
 */

vi.mock('../VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../../modes/annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div />,
}));
vi.mock('../../modes/annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false }));
vi.mock('../../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true, handleInteraction: () => {}, handleTapVideo: () => {},
    handleLongPressTouchStart: () => {}, handleLongPressTouchMove: () => {}, handleLongPressTouchEnd: () => {},
  }),
}));

import { resolveGuide } from './resolveGuide';
import { annotateFacts } from './catalog';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from './guideTargets';
import { GUIDE } from '../../config/displayNames';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUploadStore, UPLOAD_STATUS } from '../../stores/uploadStore';
import { UPLOAD_PHASE } from '../../services/uploadManager';
import { AnnotateModeView } from '../../modes/AnnotateModeView';

const BANNER = '[data-testid="upload-preview-notice"]';
const failed = (region, local) => resolveGuide(annotateFacts(region, [], { uploading: true, uploadFailed: true, ...local }));

describe('T13390 rule: a failed upload outranks the Annotate watch rules', () => {
  it('names Retry upload, pulses it, and keeps the failure banner clear', () => {
    const g = failed(null, { playCount: 0 });
    expect(g.id).toBe('annotate.upload-failed');
    expect(g.pulse).toBe(GUIDE_PULSE.UPLOAD_RETRY);
    expect(g.message.title).toBe(GUIDE.annotate.uploadFailed.title);
    expect(g.message.title).toContain('Retry upload');
    expect(g.anchor.target).toBe(BANNER);
    expect(g.keepClear).toContain(BANNER);
  });

  it('outranks watching, marked plays, a selected play and Review plays', () => {
    expect(failed(null, { isPlaying: true }).id).toBe('annotate.upload-failed');
    expect(failed(null, { playCount: 3 }).id).toBe('annotate.upload-failed');
    expect(failed({ rating: 5 }, { playCount: 3 }).id).toBe('annotate.upload-failed');
    expect(failed(null, { reviewing: true, playCount: 3 }).id).toBe('annotate.upload-failed');
  });

  it('an upload still in flight keeps the uploading rules', () => {
    expect(resolveGuide(annotateFacts(null, [], { uploading: true, playCount: 2 })).id).toBe('annotate.uploading.has-plays');
  });
});

function renderView(overrides = {}) {
  const noop = vi.fn();
  const props = {
    videoController: { _renderRefs: { videoARef: { current: null }, videoBRef: { current: null } } },
    annotateVideoUrl: 'blob:local-preview',
    annotateVideoMetadata: { width: 1920, height: 1080, duration: 100, format: 'mp4', size: 0 },
    annotateContainerRef: { current: null },
    gameId: 8,
    currentTime: 0, duration: 100, isPlaying: false, handlers: {},
    annotateFullscreen: false, showAnnotateOverlay: false,
    togglePlay: noop, stepForward: noop, stepBackward: noop, seekBackward: noop, restart: noop, seek: noop,
    onTimelineSeek: noop, annotatePlaybackSpeed: 1, onSpeedChange: noop,
    annotateRegionsWithLayout: [], annotateSelectedRegionId: null, hasAnnotateClips: false, clipRegions: [],
    isEditMode: false, onSelectRegion: noop, onDeleteRegion: noop, getAnnotateRegionAtTime: () => null,
    annotateSelectedLayer: 'clips', onLayerSelect: noop, playback: { isPlaybackMode: false },
    multiVideo: null, boundaryOffsets: undefined,
    isGameUploading: true,
    isGameUploadFailed: true,
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('T13390 wiring: the Retry upload button sits inside Annotate\'s guide scope', () => {
  beforeEach(() => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
    useUploadStore.setState({
      uploads: [{ id: 'u8', gameId: 8, gameName: 'Game 8', status: UPLOAD_STATUS.ERROR, phase: UPLOAD_PHASE.ERROR, message: 'Upload failed' }],
    });
  });
  afterEach(() => {
    cleanup();
    useSettingsStore.getState().reset();
    useUploadStore.setState({ uploads: [] });
  });

  it('pulses Retry upload on the failure banner', () => {
    renderView();
    const retry = screen.getByTestId(GUIDE_PULSE.UPLOAD_RETRY);
    expect(retry.closest(BANNER)).toBeTruthy();
    expect(retry.className).toContain(GUIDE_PULSE_CLASS);
  });
});
