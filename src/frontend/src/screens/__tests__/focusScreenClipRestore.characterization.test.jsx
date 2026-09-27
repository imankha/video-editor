import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// T11240 C1/C4 characterization (design doc §3.1/§4.3): pins FocusScreen's
// mount, no-cache, and version-bump behavior BEFORE the clip-switch restore
// effect (FocusScreen.jsx ~719-791) is deleted in C4, so the deletion's
// red-to-green proof lives in one file.
//
// CH1/CH2 and the assertions here must stay green, UNCHANGED, before and after
// C4 (the init effect already covers this exact ground). CH3/CH4 assert the
// TARGET post-C4 behavior (no reset, no extra reload on a version bump) and
// are RED on this (C1) revision — master's clip-switch effect still resets/
// reloads on every id change. CH5 pins today's expired-source behavior and
// must stay identical across C4 (or C4 must apply the design doc §3.1 fold
// fallback rather than accept a regression).
//
// Mocking approach copied verbatim from focusScreenStaleClipGuard.test.jsx —
// same harness, reused per the design doc instruction, with clip-switch-effect
// -relevant spies added (resetSegments/resetCrop/loadVideoFromStreamingUrl).

const testState = vi.hoisted(() => ({
  clips: [],
  selectedClipId: null,
  selectedClip: null,
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
    loadVideoFromStreamingUrl: spies.loadVideoFromStreamingUrl,
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
    useRegisterActiveSaveHandler: vi.fn(),
    useQuestStore,
  };
});

import { FocusScreen } from '../FocusScreen';

const PROJECT_ID = 42;

function makeClip({ id, projectId = PROJECT_ID }) {
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

// Unlike the T10740 harness's setClips, this does NOT unconditionally cache
// every clip: `cachedIds` controls which ids get a clipMetadataCache entry so
// CH2/CH3 can produce the "id absent from cache" production shape.
function setClips(clips, selectedClipId, cachedIds = clips.map((c) => c.id)) {
  testState.clips = clips;
  testState.selectedClipId = selectedClipId;
  testState.selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  testState.clipMetadataCache = Object.fromEntries(
    clips.filter((c) => cachedIds.includes(c.id))
      .map((c) => [c.id, { duration: 10, width: 1080, height: 1920, framerate: 30 }])
  );
}

function clearSpies() {
  Object.values(spies).forEach((s) => s.mockClear());
}

describe('T11240 clip-switch restore effect characterization (design doc §3.1/§4.3)', () => {
  beforeEach(() => {
    setClips([], null);
    clearSpies();
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

  it('CH1: mount, own project, metadata cached -> restores crop+segments with the clip\'s parsed data and loads the clip URL', async () => {
    const clip = makeClip({ id: 1 });
    setClips([clip], 1);

    render(<FocusScreen />);

    await waitFor(() => {
      expect(spies.restoreCropState).toHaveBeenCalled();
      expect(spies.restoreSegmentState).toHaveBeenCalled();
    });

    const [cropArgs] = spies.restoreCropState.mock.calls[0];
    expect(cropArgs).toEqual(clip.crop_data);
    const [segmentArgs] = spies.restoreSegmentState.mock.calls[0];
    expect(segmentArgs).toEqual(clip.segments_data);

    await waitFor(() => {
      expect(spies.loadVideoFromStreamingUrl).toHaveBeenCalled();
    });
  });

  it('CH2: mount, own project, NO metadata-cache entry -> no restore, resets only', async () => {
    const clip = makeClip({ id: 1 });
    setClips([clip], 1, []); // id 1 absent from the cache

    render(<FocusScreen />);

    await waitFor(() => {
      expect(spies.resetSegments).toHaveBeenCalled();
      expect(spies.resetCrop).toHaveBeenCalled();
    });

    expect(spies.restoreCropState).not.toHaveBeenCalled();
    expect(spies.restoreSegmentState).not.toHaveBeenCalled();
  });

  it('CH3 (RED at C1, GREEN at C4): version bump to a NEW id absent from the cache, same URL -> today resets + reloads; the target is NEITHER', async () => {
    const oldClip = makeClip({ id: 1 });
    setClips([oldClip], 1);
    const { rerender } = render(<FocusScreen />);

    await waitFor(() => expect(spies.restoreCropState).toHaveBeenCalled());
    clearSpies();

    const newClip = makeClip({ id: 2 }); // same game_video_url -> same resolved URL
    setClips([newClip], 2, []); // id 2 absent from the cache (production shape)
    rerender(<FocusScreen />);

    await waitFor(() => expect(spies.resetSegments).not.toHaveBeenCalled());
    expect(spies.resetCrop).not.toHaveBeenCalled();
    expect(spies.loadVideoFromStreamingUrl).not.toHaveBeenCalled();
  });

  it('CH4 (RED at C1, GREEN at C4): version bump to a NEW id PRESENT in the cache -> today re-restores + reloads; the target is NEITHER (hook state already reflects what was just saved)', async () => {
    const oldClip = makeClip({ id: 1 });
    setClips([oldClip], 1);
    const { rerender } = render(<FocusScreen />);

    await waitFor(() => expect(spies.restoreCropState).toHaveBeenCalled());
    clearSpies();

    const newClip = makeClip({ id: 2 });
    setClips([newClip], 2); // id 2 present in the cache this time
    rerender(<FocusScreen />);

    await waitFor(() => expect(spies.restoreCropState).not.toHaveBeenCalled());
    expect(spies.restoreSegmentState).not.toHaveBeenCalled();
    expect(spies.loadVideoFromStreamingUrl).not.toHaveBeenCalled();
  });

  it('CH5: source URL unresolvable (playback-url 410 source_expired), metadata cached -> crop/segment state still restores today (before the URL ever resolves)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ detail: { code: 'source_expired', can_extend: true } }),
    });
    const clip = makeClip({ id: 1 });
    setClips([clip], 1);

    render(<FocusScreen />);

    await waitFor(() => {
      expect(spies.restoreCropState).toHaveBeenCalled();
      expect(spies.restoreSegmentState).toHaveBeenCalled();
    });
    // The source never resolved -> no video load call for this clip.
    expect(spies.loadVideoFromStreamingUrl).not.toHaveBeenCalled();
  });
});
