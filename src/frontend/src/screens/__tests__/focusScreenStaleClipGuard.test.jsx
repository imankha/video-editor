import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// T10740: FocusScreen showed a FALSE "video no longer available" panel when
// Annotate "Frame Later" -> "Frame" opened Focus while projectDataStore.clips
// still held the PREVIOUS project's rows (App.handleModeChange fires
// invalidateClips fire-and-forget and switches mode immediately; fetchClips
// only writes on response, never clears first). FocusScreen then paired the
// OLD clip id with the NEW project id -- a pair the backend can only 404 for
// (`WHERE wc.id = ? AND wc.project_id = ?`).
//
// clipVideoResolution.test.js already pins the two pure predicates
// (isClipFromAnotherProject / shouldRetryClipVideoViaProxy) in isolation, but
// as the reviewer noted, that suite would still pass if BOTH call sites were
// deleted from FocusScreen.jsx. The riskiest part of the fix is an ORDERING
// claim inside FocusScreen's "Handle clip switching" effect: the foreign-clip
// bail must run BEFORE restoreCropState/restoreSegmentState and BEFORE
// previousClipIdRef.current is stamped -- so this suite renders the REAL
// FocusScreen and asserts on the wiring, not a reimplementation of it.
//
// Mocking approach follows focusBackToPreview.test.jsx / focusCompletionPreview.test.jsx
// (stub every heavy hook/store FocusScreen pulls in) but goes one step further:
// those two files never actually render FocusScreen (they replay its handlers in
// a local harness). This file mounts the real `../FocusScreen` component, and
// deliberately leaves `../clipVideoResolution` (the guard under test) and
// `../../utils/clipSelectors` (pure parsing) UNMOCKED.

const testState = vi.hoisted(() => ({
  clips: [],
  selectedClipId: null,
  selectedClip: null,
  clipMetadataCache: {},
}));

const spies = vi.hoisted(() => ({
  restoreCropState: vi.fn(),
  restoreSegmentState: vi.fn(),
}));

vi.mock('../../modes', () => ({ FocusModeView: () => null }));

vi.mock('../../containers', () => ({
  FocusContainer: () => ({
    clipsWithCurrentState: [],
    selectedClipEffectiveDuration: 0,
    projectEffectiveDuration: 0,
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
    clearFramingHistory: vi.fn(),
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
    initializeWithDuration: vi.fn(),
    reset: vi.fn(),
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
    selectedClipId: testState.selectedClipId,
    selectedClip: testState.selectedClip,
    hasClips: testState.clips.length > 0,
    globalAspectRatio: '9:16',
    globalTransition: null,
    deleteClip: vi.fn(),
    selectClip: vi.fn(),
    reorderClips: vi.fn(),
    updateClipData: vi.fn(),
    setGlobalAspectRatio: vi.fn(),
    setGlobalTransition: vi.fn(),
    getExportData: vi.fn(),
  }),
}));

vi.mock('../../hooks/useFullscreenWorthwhile', () => ({ useFullscreenWorthwhile: () => false }));
vi.mock('../../stores/gamesDataStore', () => ({ useReadyGames: () => [] }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../components/ClipSelectorSidebar', () => ({ ClipSelectorSidebar: () => null }));
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
vi.mock('../../utils/resultRetentionNote', () => ({ resultRetentionNote: () => null }));
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
    addClipFromLibrary: vi.fn(),
    uploadClipWithMetadata: vi.fn(),
    saveFramingEdits: vi.fn(),
    updateClipMetadata: vi.fn(),
    removeClip: vi.fn(),
    changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);

  const overlayState = { reset: vi.fn(), setIsLoadingWorkingVideo: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

  const questState = { recordAchievement: vi.fn() };
  const useQuestStore = { getState: () => questState };

  const projectsState = { selectedProjectId: 42 };
  const useProjectsStore = { getState: () => projectsState };

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

// Real: '../clipVideoResolution' (the guard under test) and
// '../../utils/clipSelectors' (pure parsing of crop_data/segments_data).
import { FocusScreen } from '../FocusScreen';

const PROJECT_ID = 42; // must match the ProjectContext mock above

function makeClip({ id, projectId }) {
  return {
    id,
    project_id: projectId,
    name: `clip-${id}`,
    filename: `clip-${id}.mp4`,
    game_video_url: 'https://cdn.example.com/game.mp4',
    start_time: 0,
    end_time: 10,
    video_duration: 10,
    video_size: 1000,
    crop_data: [{ time: 0, x: 0, y: 0, width: 100, height: 100 }],
    segments_data: { boundaries: [0, 10], userSplits: [], trimRange: null, segmentSpeeds: {} },
  };
}

function setClips(clips, selectedClipId) {
  testState.clips = clips;
  testState.selectedClipId = selectedClipId;
  testState.selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  testState.clipMetadataCache = Object.fromEntries(
    clips.map((c) => [c.id, { duration: 10, width: 1080, height: 1920, framerate: 30 }])
  );
}

function playbackUrlCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url).includes('/playback-url'));
}
function streamCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url).includes('/stream'));
}

describe('T10740 FocusScreen stale-clip guard (render-level)', () => {
  beforeEach(() => {
    setClips([], null);
    spies.restoreCropState.mockClear();
    spies.restoreSegmentState.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://r2/signed.mp4', start_time: 0, end_time: 10 }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('a clip left over from a DIFFERENT project never restores crop/segment state and never fetches its playback-url', async () => {
    const staleClip = makeClip({ id: 1, projectId: 999 }); // foreign: NOT this screen's project (42)
    setClips([staleClip], 1);

    render(<FocusScreen />);

    // Let mount effects (useLayoutEffect + the clips-keyed effect + the
    // clip-switching effect) run their microtasks/macrotasks to completion.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spies.restoreCropState).not.toHaveBeenCalled();
    expect(spies.restoreSegmentState).not.toHaveBeenCalled();
    expect(playbackUrlCalls()).toHaveLength(0);
    expect(streamCalls()).toHaveLength(0);
  });

  it('a matching clip DOES restore state and DOES fetch its playback-url (negative control -- proves the guard is not just eating every render)', async () => {
    const goodClip = makeClip({ id: 1, projectId: PROJECT_ID });
    setClips([goodClip], 1);

    render(<FocusScreen />);

    await waitFor(() => {
      expect(spies.restoreCropState).toHaveBeenCalled();
      expect(spies.restoreSegmentState).toHaveBeenCalled();
    });

    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url]) =>
        String(url).includes(`/projects/${PROJECT_ID}/clips/1/playback-url`)
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('replacing the stale list with the fresh matching list loads the correct clip (the guard defers work, it does not permanently suppress it)', async () => {
    const staleClip = makeClip({ id: 1, projectId: 999 });
    setClips([staleClip], 1);
    const { rerender } = render(<FocusScreen />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spies.restoreCropState).not.toHaveBeenCalled();
    expect(playbackUrlCalls()).toHaveLength(0);

    // The fresh clips list lands (App's invalidateClips/fetchClips resolving).
    const freshClip = makeClip({ id: 1, projectId: PROJECT_ID });
    setClips([freshClip], 1);
    rerender(<FocusScreen />);

    await waitFor(() => {
      expect(spies.restoreCropState).toHaveBeenCalled();
      expect(spies.restoreSegmentState).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(playbackUrlCalls().length).toBeGreaterThan(0);
    });
  });
});
