import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// T16040: GET /clips/projects/{id}/clips can fail (network blip, a cold staging
// backend waking up -- T16060) and projectDataStore.fetchClips's catch branch
// resolves with [] exactly like a highlight that genuinely has zero plays
// (projectDataStore.js clipsError/clips). Nothing retried a failed fetch, so a
// transient failure left Frame stuck forever -- the owner's "Play 5" hang,
// reproduced here as a clips fetch that fails once then would succeed on retry.
// Same harness as focusScreenRetryFallback.test.jsx.

const testState = vi.hoisted(() => ({
  clips: [],
  projectClipId: null,
  projectClip: null,
  clipMetadataCache: {},
  clipsError: null,
  lastModeViewProps: null,
}));

vi.mock('../../modes', () => ({
  FocusModeView: (props) => {
    testState.lastModeViewProps = props;
    return null;
  },
}));

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
    saveCurrentClipState: vi.fn().mockResolvedValue(),
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
    reset: vi.fn(),
    restoreState: vi.fn(),
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
    initializeWithDuration: vi.fn(),
    reset: vi.fn(),
    restoreState: vi.fn(),
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
    videoRef: { current: null },
    videoUrl: null,
    metadata: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    error: null,
    isLoading: false,
    isVideoElementLoading: false,
    loadingProgress: 0,
    loadingElapsedSeconds: 0,
    loadVideo: vi.fn(),
    loadVideoFromUrl: vi.fn().mockResolvedValue(null),
    loadVideoFromStreamingUrl: vi.fn(),
    togglePlay: vi.fn(),
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
vi.mock('../../utils/storageUrls', () => ({ forceRefreshUrl: vi.fn().mockResolvedValue(null) }));
vi.mock('../../utils/cacheWarming', () => ({ warmVideoCache: vi.fn(), pushClipRanges: vi.fn() }));
vi.mock('../../utils/acknowledgeExportJob', () => ({ acknowledgeExportJob: vi.fn() }));

vi.mock('../focusOverlayTransition', () => ({
  shouldPersistFocusForOverlayTransition: () => false,
  shouldSkipFocusCompletionPreview: () => false,
}));
vi.mock('../focusCompletionOffer', () => ({ offerFocusCompletionPreview: vi.fn() }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    projectId: 4,
    project: { id: 4, name: 'Test Project', working_video_id: null },
    aspectRatio: '9:16',
    refresh: vi.fn(),
  }),
}));

vi.mock('../../stores/focusCompletionStore', () => {
  const state = { preview: null, openPreview: vi.fn(), closePreview: vi.fn() };
  const useFocusCompletionStore = (selector) => selector(state);
  useFocusCompletionStore.getState = () => state;
  return { useFocusCompletionStore };
});

const invalidateClipsSpy = vi.hoisted(() => vi.fn());

vi.mock('../../stores', () => {
  const editorState = { setEditorMode: vi.fn(), goToProjectManager: vi.fn() };
  const useEditorStore = (selector) => selector(editorState);
  useEditorStore.getState = () => editorState;

  const projectDataState = {
    isLoading: false,
    loadingStage: null,
    get clipsError() { return testState.clipsError; },
    get clipMetadataCache() { return testState.clipMetadataCache; },
    setWorkingVideo: vi.fn(),
    setClipMetadata: vi.fn(),
    fetchClips: vi.fn().mockResolvedValue([]),
    invalidateClips: invalidateClipsSpy,
    saveFramingEdits: vi.fn(),
    updateClipMetadata: vi.fn(),
    changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);
  useProjectDataStore.getState = () => projectDataState;

  const overlayState = { reset: vi.fn(), setIsLoadingWorkingVideo: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

  const questState = { recordAchievement: vi.fn() };
  const useQuestStore = { getState: () => questState };

  const projectsState = { selectedProjectId: 4, projects: [] };
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
    useRegisterActiveSaveHandler: vi.fn(),
    useQuestStore,
  };
});

import { FocusScreen } from '../FocusScreen';

describe('T16040 FocusScreen retries a failed clips fetch instead of treating it as empty forever', () => {
  beforeEach(() => {
    testState.clips = [];
    testState.projectClipId = null;
    testState.projectClip = null;
    testState.clipMetadataCache = {};
    testState.clipsError = null;
    testState.lastModeViewProps = null;
    invalidateClipsSpy.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries invalidateClips once when the store reports clipsError with an empty clip list', () => {
    testState.clipsError = 'Failed to fetch clips';

    render(<FocusScreen />);

    expect(invalidateClipsSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);

    expect(invalidateClipsSpy).toHaveBeenCalledTimes(1);
    expect(invalidateClipsSpy).toHaveBeenCalledWith(4);
  });

  it('never retries when clips loaded successfully (no clipsError)', () => {
    testState.clipsError = null;
    testState.clips = [{ id: 7, project_id: 4, filename: 'clip-7.mp4', crop_data: null, segments_data: null }];
    testState.projectClipId = 7;
    testState.projectClip = testState.clips[0];

    render(<FocusScreen />);
    vi.advanceTimersByTime(5000);

    expect(invalidateClipsSpy).not.toHaveBeenCalled();
  });
});

// T16040:C2 (T16120 review): FocusModeView.loadingState.test.jsx only proves the view
// renders the message when handed stuckEmpty=true. These prove FocusScreen itself
// decides "stuck" (a project, nothing in flight, no video URL) and logs a
// console.error naming the project id and the missing input.
describe('T16040:C2 FocusScreen flags a project that will never show a video', () => {
  beforeEach(() => {
    testState.clips = [];
    testState.selectedClipId = null;
    testState.selectedClip = null;
    testState.clipMetadataCache = {};
    testState.clipsError = null;
    testState.lastModeViewProps = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stuckErrors() {
    return console.error.mock.calls.map((args) => args.join(' ')).filter((l) => l.includes('stuck with no video'));
  }

  it('T16040:C2 empty clips: stuckEmpty reaches the view and console.error names project and clips', () => {
    render(<FocusScreen />);
    expect(testState.lastModeViewProps.stuckEmpty).toBe(false);

    act(() => { vi.advanceTimersByTime(8000); });

    expect(testState.lastModeViewProps.stuckEmpty).toBe(true);
    expect(typeof testState.lastModeViewProps.onBackToAnnotate).toBe('function');
    expect(stuckErrors()).toEqual([expect.stringMatching(/project=4\b.*missing=clips/)]);
  });

  it('T16040:C2 a clip whose URL resolves to nothing: console.error names videoUrl as missing', () => {
    testState.clips = [{ id: 7, project_id: 4, filename: 'clip-7.mp4', crop_data: null, segments_data: null }];
    testState.selectedClipId = 7;
    testState.selectedClip = testState.clips[0];

    render(<FocusScreen />);
    act(() => { vi.advanceTimersByTime(8000); });

    expect(testState.lastModeViewProps.stuckEmpty).toBe(true);
    expect(stuckErrors()).toEqual([expect.stringMatching(/project=4\b.*missing=videoUrl/)]);
  });
});
