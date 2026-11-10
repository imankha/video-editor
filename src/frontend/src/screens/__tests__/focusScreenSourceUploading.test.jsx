import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// T15730: a game clip whose source game is still uploading made playback-url and
// /stream both return 409 `source_uploading`. FocusScreen's getClipVideoConfig used
// to treat 409 like any other non-404 4xx and fall back to the /stream proxy, which
// 409s identically (assert_clip_source_available gates both seams, games.py) --
// handing <video> a dead URL the player then mislabeled "Video format not
// supported" (bug 50p). This mounts the real FocusScreen (same harness as
// focusScreenRetryFallback.test.jsx) and pins: (1) a 409 never falls back to the
// proxy, and (2) FocusModeView receives isSourceUploading=true, no videoUrl.

const testState = vi.hoisted(() => ({
  clips: [],
  selectedClipId: null,
  selectedClip: null,
  clipMetadataCache: {},
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
    selectedClipEffectiveDuration: 0,
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

const videoSpies = vi.hoisted(() => ({
  loadVideoFromUrl: vi.fn().mockResolvedValue(null),
  loadVideoFromStreamingUrl: vi.fn(),
  clearError: vi.fn(),
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
    loadVideoFromUrl: videoSpies.loadVideoFromUrl,
    loadVideoFromStreamingUrl: videoSpies.loadVideoFromStreamingUrl,
    togglePlay: vi.fn(),
    seek: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekForward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    clearError: videoSpies.clearError,
    isUrlExpiredError: false,
    handlers: {},
  }),
}));

vi.mock('../../hooks/useClipManager', () => ({
  useClipManager: () => ({
    clips: testState.clips,
    selectedClipId: testState.selectedClipId,
    selectedClip: testState.selectedClip,
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
    projectId: 10,
    project: { id: 10, name: 'Test Project', working_video_id: null },
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

vi.mock('../../stores', () => {
  const editorState = { setEditorMode: vi.fn(), goToProjectManager: vi.fn() };
  const useEditorStore = (selector) => selector(editorState);
  useEditorStore.getState = () => editorState;

  const projectDataState = {
    isLoading: false,
    loadingStage: null,
    get clipMetadataCache() { return testState.clipMetadataCache; },
    setWorkingVideo: vi.fn(),
    setClipMetadata: vi.fn(),
    fetchClips: vi.fn().mockResolvedValue([]),
    saveFramingEdits: vi.fn(),
    updateClipMetadata: vi.fn(),
    changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);

  const overlayState = { reset: vi.fn(), setIsLoadingWorkingVideo: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

  const questState = { recordAchievement: vi.fn() };
  const useQuestStore = { getState: () => questState };

  const projectsState = { selectedProjectId: 10, projects: [] };
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

const PROJECT_ID = 10;

function setClips(clips, selectedClipId) {
  testState.clips = clips;
  testState.selectedClipId = selectedClipId;
  testState.selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  testState.clipMetadataCache = Object.fromEntries(
    clips.map((c) => [c.id, { duration: 10, width: 1080, height: 1920, framerate: 30 }])
  );
}

describe('T15730 FocusScreen source-uploading (409) never falls back to a dead proxy URL', () => {
  let fetchMock;

  beforeEach(() => {
    setClips([], null);
    testState.lastModeViewProps = null;
    videoSpies.loadVideoFromUrl.mockClear();
    videoSpies.loadVideoFromStreamingUrl.mockClear();
    videoSpies.clearError.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    fetchMock = vi.fn((url) => {
      if (url.includes('/playback-url')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ detail: { code: 'source_uploading', game_id: 2 } }),
        });
      }
      // The /stream proxy is never a fetch() call in production (it's handed
      // straight to <video> as a src) -- if the fix regresses and this test's
      // fetch mock sees a /stream URL, that itself proves the bug reintroduced.
      return Promise.resolve({ ok: false, status: 409, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sets isSourceUploading and never loads a video from the /stream proxy', async () => {
    const clip = {
      id: 10,
      project_id: PROJECT_ID,
      game_video_url: 'https://r2.example.com/games/uploading.mp4',
      start_time: 0,
      end_time: 5,
      crop_data: null,
      segments_data: null,
    };
    setClips([clip], 10);

    render(<FocusScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(testState.lastModeViewProps.isSourceUploading).toBe(true);
    expect(videoSpies.loadVideoFromStreamingUrl).not.toHaveBeenCalled();
    const calledUrls = fetchMock.mock.calls.map(([url]) => url);
    expect(calledUrls.some((url) => url.includes('/stream'))).toBe(false);
  });
});
