import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useFocusCompletionStore } from '../../stores/focusCompletionStore';

// T16750: when the Finished panel (the completion preview) opens over Frame, the
// Frame editor's own video must stop playing; it was left looping, unmuted, behind
// the Finished player. Closing Finished must not start it again.
// Harness copied from focusScreenClipRestore.characterization.test.jsx, with the
// REAL focusCompletionStore (its openPreview is what makes the panel appear).

const testState = vi.hoisted(() => ({
  clips: [],
  projectClipId: null,
  projectClip: null,
  clipMetadataCache: {},
}));

const spies = vi.hoisted(() => ({
  restoreCropState: vi.fn(),
  restoreSegmentState: vi.fn(),
  resetCrop: vi.fn(),
  resetSegments: vi.fn(),
  initializeSegments: vi.fn(),
  loadVideoFromStreamingUrl: vi.fn(),
}));

// The Frame editor's <video>, as useVideo hands it out. Playing at the start of each test.
const frameVideo = vi.hoisted(() => ({
  ref: { current: null },
  reset() {
    const el = { paused: false };
    el.pause = vi.fn(() => { el.paused = true; });
    el.play = vi.fn(() => { el.paused = false; return Promise.resolve(); });
    this.ref.current = el;
    return el;
  },
}));
vi.mock('../../modes', () => ({ FocusModeView: () => null }));

vi.mock('../../containers', () => ({
  FocusContainer: () => ({
    clipsWithCurrentState: [],
    clipEffectiveDuration: 0,
    canUndoFraming: false,
    handleCropChange: vi.fn(),
    handleCropComplete: vi.fn(),
    handleTrimSegment: vi.fn(),
    handleDetrimStart: vi.fn(),
    handleDetrimEnd: vi.fn(),
    handleKeyframeClick: vi.fn(),
    handleKeyframeDelete: vi.fn(),
    handleCopyCrop: vi.fn(),
    handlePasteCrop: vi.fn(),
    handleAddSplit: vi.fn(),
    handleRemoveSplit: vi.fn(),
    handleSegmentSpeedChange: vi.fn(),
    handleSetRotation: vi.fn(),
    handleUndoFraming: vi.fn(),
  }),
}));

vi.mock('../../modes/focus', () => ({
  useCrop: () => ({
    aspectRatio: '9:16',
    keyframes: [],
    isEndKeyframeExplicit: false,
    copiedCrop: null,
    framerate: 30,
    rotation: 0,
    updateAspectRatio: vi.fn(),
    setRotation: vi.fn(),
    clampCropForCurrentRotation: (c) => c,
    addOrUpdateKeyframe: vi.fn(),
    removeKeyframe: vi.fn(),
    deleteKeyframesInRange: vi.fn(),
    cleanupTrimKeyframes: vi.fn(),
    setEndFrame: vi.fn(),
    copyCropKeyframe: vi.fn(),
    pasteCropKeyframe: vi.fn(),
    interpolateCrop: () => null,
    hasKeyframeAt: () => false,
    getCropDataAtTime: () => null,
    getKeyframesForExport: () => [],
    reset: spies.resetCrop,
    restoreState: spies.restoreCropState,
  }),
  useSegments: () => ({
    boundaries: [0, 10],
    segments: [],
    sourceDuration: 10,
    visualDuration: 10,
    trimmedDuration: 10,
    segmentVisualLayout: null,
    framerate: 30,
    trimRange: null,
    trimHistory: [],
    segmentSpeeds: {},
    initializeWithDuration: spies.initializeSegments,
    reset: spies.resetSegments,
    restoreState: spies.restoreSegmentState,
    addBoundary: vi.fn(),
    removeBoundary: vi.fn(),
    setSegmentSpeed: vi.fn(),
    toggleTrimSegment: vi.fn(),
    getSegmentAtTime: () => null,
    getExportData: () => null,
    isTimeVisible: () => true,
    clampToVisibleRange: (t) => t,
    sourceTimeToVisualTime: (t) => t,
    visualTimeToSourceTime: (t) => t,
    createFrameRangeKey: () => '',
    isSegmentTrimmed: () => false,
    detrimStart: vi.fn(),
    detrimEnd: vi.fn(),
  }),
}));

vi.mock('../../hooks/useZoom', () => ({
  default: () => ({
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    isZoomed: false,
    MIN_ZOOM: 1,
    MAX_ZOOM: 4,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    zoomByWheel: vi.fn(),
    updatePan: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTimelineZoom', () => ({
  default: () => ({
    timelineZoom: 1,
    scrollPosition: 0,
    zoomByWheel: vi.fn(),
    updateScrollPosition: vi.fn(),
    getTimelineScale: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVideo', () => ({
  useVideo: () => ({
    videoRef: frameVideo.ref,
    videoUrl: null,
    metadata: null,
    isPlaying: !frameVideo.ref.current?.paused,
    currentTime: 0,
    duration: 0,
    error: null,
    isLoading: false,
    isVideoElementLoading: false,
    loadingProgress: 0,
    loadingElapsedSeconds: 0,
    loadVideo: vi.fn(),
    loadVideoFromUrl: vi.fn().mockResolvedValue(null),
    loadVideoFromStreamingUrl: spies.loadVideoFromStreamingUrl,
    play: () => frameVideo.ref.current?.play(),
    pause: () => frameVideo.ref.current?.pause(),
    togglePlay: () => frameVideo.ref.current?.play(),
    seek: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekForward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    clearError: vi.fn(),
    isUrlExpiredError: false,
    handlers: {},
  }),
}));
vi.mock('../../hooks/useClipManager', () => ({
  useClipManager: () => ({
    clips: testState.clips,
    projectClipId: testState.projectClipId,
    projectClip: testState.projectClip,
    hasClips: testState.clips.length > 0,
    globalAspectRatio: '9:16',
    updateClipData: vi.fn(),
  }),
}));

vi.mock('../../hooks/useFullscreenWorthwhile', () => ({ useFullscreenWorthwhile: () => false }));
vi.mock('../../stores/gamesDataStore', () => ({ useReadyGames: () => [] }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../components/FileUpload', () => ({ FileUpload: () => null }));
vi.mock('../../components/shared', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/collections/CollectionPlayer', () => ({ CollectionPlayer: () => null }));
vi.mock('../../components/FocusPublishActionBar', () => ({ FocusPublishActionBar: () => null }));

vi.mock('../../stores/publishIntentStore', () => {
  const state = { projectId: null, clear: vi.fn(), set: vi.fn() };
  const usePublishIntentStore = (selector) => selector(state);
  usePublishIntentStore.getState = () => state;
  return { usePublishIntentStore };
});

vi.mock('../../utils/resolveWorkingVideoPreviewUrl', () => ({
  resolveWorkingVideoPreviewUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../utils/framingCtaState', () => ({
  deriveFramingCtaState: () => ({ mode: 'generate', showBackToPreview: false, renderedAt: null }),
}));
vi.mock('../../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));
vi.mock('../../utils/videoMetadata', () => ({
  extractVideoMetadata: vi.fn(),
  extractVideoMetadataFromUrl: vi.fn(),
}));
vi.mock('../../utils/storageUrls', () => ({ forceRefreshUrl: vi.fn() }));
vi.mock('../../utils/cacheWarming', () => ({ warmVideoCache: vi.fn(), pushClipRanges: vi.fn() }));
vi.mock('../../utils/acknowledgeExportJob', () => ({ acknowledgeExportJob: vi.fn() }));

vi.mock('../focusOverlayTransition', () => ({
  shouldPersistFocusForOverlayTransition: () => false,
  shouldSkipFocusCompletionPreview: () => false,
}));
vi.mock('../focusCompletionOffer', () => ({ offerFocusCompletionPreview: vi.fn() }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    projectId: 42,
    project: { id: 42, name: 'Test Project', working_video_id: null },
    aspectRatio: '9:16',
    refresh: vi.fn(),
  }),
}));

vi.mock('../../stores', () => {
  const editorState = { setEditorMode: vi.fn(), goToProjectManager: vi.fn() };
  const useEditorStore = (selector) => selector(editorState);
  useEditorStore.getState = () => editorState;

  const projectDataState = {
    isLoading: false,
    loadingStage: null,
    get clipMetadataCache() { return testState.clipMetadataCache; },
    setClipMetadata: vi.fn(),
    fetchClips: vi.fn().mockResolvedValue([]),
    updateClipMetadata: vi.fn(),
    changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);

  const overlayState = { reset: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

  const projectsState = { selectedProjectId: 42, projects: [] };
  function useProjectsStore(selector) {
    return selector(projectsState);
  }
  useProjectsStore.getState = () => projectsState;

  return {
    useProjectDataStore,
    useFocusStore: () => ({
      includeAudio: false,
      setIncludeAudio: vi.fn(),
      videoFile: null,
      setVideoFile: vi.fn(),
      framingChangedSinceExport: false,
      setFramingChangedSinceExport: vi.fn(),
    }),
    useEditorStore,
    EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay' },
    useOverlayStore,
    useProjectsStore,
    useVideoStore: () => ({}),
  };
});

import { FocusScreen } from '../FocusScreen';

const PROJECT_ID = 42;

function openFinished() {
  act(() => {
    useFocusCompletionStore.getState().openPreview({
      projectId: PROJECT_ID, previewUrl: 'https://r2/working.mp4', openMode: 'framing', jobId: 'job-1',
    });
  });
}

describe('T16750 Finished over Frame stops the Frame video', () => {
  beforeEach(() => {
    cleanup();
    useFocusCompletionStore.getState().closePreview();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('pauses the playing Frame video when the Finished panel opens', () => {
    const video = frameVideo.reset();
    render(<FocusScreen onExportComplete={vi.fn()} exportButtonRef={{ current: null }} />);
    expect(video.paused).toBe(false);

    openFinished();

    expect(video.pause).toHaveBeenCalled();
    expect(video.paused).toBe(true);
  });

  it('closing Finished back to Frame does not start the Frame video again', () => {
    const video = frameVideo.reset();
    render(<FocusScreen onExportComplete={vi.fn()} exportButtonRef={{ current: null }} />);
    openFinished();
    expect(video.paused).toBe(true);
    video.play.mockClear();

    act(() => { useFocusCompletionStore.getState().closePreview(); });

    expect(video.play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
  });
});
