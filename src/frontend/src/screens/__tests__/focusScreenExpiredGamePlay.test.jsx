import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// T17070: a marked play outlives its game. Once the game's storage ends,
// playback-url answers 200 with the play's own surviving source (its preserved
// extract, 0..duration) instead of 410 source_expired. Frame must play that
// source with no expired panel, and the <video> #t= range must be the LOADED
// source's range -- not the play's game times (100..108 would seek past the end
// of an 8-second extract). Harness: focusScreenSourceUploading.test.jsx.

const testState = vi.hoisted(() => ({
  clips: [],
  projectClipId: null,
  projectClip: null,
  clipMetadataCache: {},
  lastModeViewProps: null,
  videoStore: { clipOffset: 0, clipDuration: null },
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
    setClipMetadata: vi.fn(),
    fetchClips: vi.fn().mockResolvedValue([]),
    updateClipMetadata: vi.fn(),
    changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);

  const overlayState = { reset: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

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
    // The loaded source's range (useVideo.loadVideoFromStreamingUrl writes it).
    useVideoStore: (selector) => selector(testState.videoStore),
  };
});

import { FocusScreen } from '../FocusScreen';

const PROJECT_ID = 10;
const EXTRACT_URL = 'https://r2.example.com/raw_clips/auto_1_1_abc.mp4?sig=t';

describe('T17070 FocusScreen plays an expired game\'s marked play from its own video', () => {
  beforeEach(() => {
    testState.lastModeViewProps = null;
    videoSpies.loadVideoFromStreamingUrl.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // What loadVideoFromStreamingUrl writes for the extract's range.
    videoSpies.loadVideoFromStreamingUrl.mockImplementation((url, meta, clipRange) => {
      testState.videoStore = { clipOffset: clipRange.clipOffset, clipDuration: clipRange.clipDuration };
    });
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/playback-url')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ url: EXTRACT_URL, expires_in: 3600, file_size: null, start_time: 0, end_time: 8 }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    videoSpies.loadVideoFromStreamingUrl.mockReset();
  });

  it('T17070:C1 loads the extract over 0..8 with no expired panel and a 0..8 player range', async () => {
    const clip = {
      id: 6,
      project_id: PROJECT_ID,
      game_video_url: 'https://r2.example.com/games/expired.mp4',
      start_time: 100,
      end_time: 108,
      crop_data: null,
      segments_data: null,
    };
    testState.clips = [clip];
    testState.projectClipId = 6;
    testState.projectClip = clip;
    testState.clipMetadataCache = { 6: { duration: 8, width: 1080, height: 1920, framerate: 30 } };
    testState.videoStore = { clipOffset: 0, clipDuration: null };

    const { rerender } = render(<FocusScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    rerender(<FocusScreen />);

    expect(videoSpies.loadVideoFromStreamingUrl).toHaveBeenCalled();
    const [url, , clipRange] = videoSpies.loadVideoFromStreamingUrl.mock.calls[0];
    expect(url).toBe(EXTRACT_URL);
    expect(clipRange).toEqual({ clipOffset: 0, clipDuration: 8 });
    expect(testState.lastModeViewProps.isSourceExpired).toBe(false);
    expect(testState.lastModeViewProps.clipRange).toEqual({ clipOffset: 0, clipDuration: 8 });
  });
});
