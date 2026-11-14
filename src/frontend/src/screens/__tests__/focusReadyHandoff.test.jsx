import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { act } from 'react';
import { FOCUS_PREVIEW } from '../../config/displayNames';

// T11970: mounts the REAL FocusScreen (scaffold from focusCompletionPlayerProps.test.jsx)
// with the real loadAndOfferFocusCompletion and deriveFramingCtaState, and drives the
// FocusModeView's captured onProceedToOverlay (the WS-COMPLETE entry) with both GETs held
// pending. A regression in FocusScreen's wiring fails here.

const testState = vi.hoisted(() => ({
  clips: [],
  projectClipId: null,
  projectClip: null,
  clipMetadataCache: {},
}));

const { viewSpy, refreshMock, resolveUrlMock, openPreviewMock, toastError, fetchClipsMock } = vi.hoisted(() => ({
  viewSpy: vi.fn(), refreshMock: vi.fn(), resolveUrlMock: vi.fn(), openPreviewMock: vi.fn(), toastError: vi.fn(),
  fetchClipsMock: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../modes', () => ({ FocusModeView: (p) => { viewSpy(p); return null; } }));
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
    aspectRatio: '9:16', keyframes: [], isEndKeyframeExplicit: false, copiedCrop: null,
    framerate: 30, rotation: 0, updateAspectRatio: vi.fn(), setRotation: vi.fn(),
    clampCropForCurrentRotation: (c) => c, addOrUpdateKeyframe: vi.fn(), removeKeyframe: vi.fn(),
    deleteKeyframesInRange: vi.fn(), cleanupTrimKeyframes: vi.fn(), setEndFrame: vi.fn(),
    copyCropKeyframe: vi.fn(), pasteCropKeyframe: vi.fn(), interpolateCrop: () => null,
    hasKeyframeAt: () => false, getCropDataAtTime: () => null, getKeyframesForExport: () => [],
    reset: vi.fn(), restoreState: vi.fn(),
  }),
  useSegments: () => ({
    boundaries: [0, 10], segments: [], sourceDuration: 10, visualDuration: 10, trimmedDuration: 10,
    segmentVisualLayout: null, framerate: 30, trimRange: null, trimHistory: [], segmentSpeeds: {},
    initializeWithDuration: vi.fn(), reset: vi.fn(), restoreState: vi.fn(), addBoundary: vi.fn(),
    removeBoundary: vi.fn(), setSegmentSpeed: vi.fn(), toggleTrimSegment: vi.fn(),
    getSegmentAtTime: () => null, getExportData: () => null, isTimeVisible: () => true,
    clampToVisibleRange: (t) => t, sourceTimeToVisualTime: (t) => t, visualTimeToSourceTime: (t) => t,
    createFrameRangeKey: () => '', isSegmentTrimmed: () => false, detrimStart: vi.fn(), detrimEnd: vi.fn(),
  }),
}));
vi.mock('../../hooks/useZoom', () => ({
  default: () => ({
    zoom: 1, panOffset: { x: 0, y: 0 }, isZoomed: false, MIN_ZOOM: 1, MAX_ZOOM: 4,
    zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn(), zoomByWheel: vi.fn(), updatePan: vi.fn(),
  }),
}));
vi.mock('../../hooks/useTimelineZoom', () => ({
  default: () => ({
    timelineZoom: 1, scrollPosition: 0, zoomByWheel: vi.fn(), updateScrollPosition: vi.fn(), getTimelineScale: vi.fn(),
  }),
}));
vi.mock('../../hooks/useVideo', () => ({
  useVideo: () => ({
    videoRef: { current: null }, videoUrl: null, metadata: null, isPlaying: false, currentTime: 0,
    duration: 0, error: null, isLoading: false, isVideoElementLoading: false, loadingProgress: 0,
    loadingElapsedSeconds: 0, loadVideo: vi.fn(), loadVideoFromUrl: vi.fn().mockResolvedValue(null),
    loadVideoFromStreamingUrl: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(), stepForward: vi.fn(),
    stepBackward: vi.fn(), seekForward: vi.fn(), seekBackward: vi.fn(), restart: vi.fn(), clearError: vi.fn(),
    isUrlExpiredError: false, handlers: {},
  }),
}));
vi.mock('../../hooks/useClipManager', () => ({
  useClipManager: () => ({
    clips: testState.clips, projectClipId: testState.projectClipId, projectClip: testState.projectClip,
    hasClips: testState.clips.length > 0, globalAspectRatio: '9:16', updateClipData: vi.fn(),
  }),
}));
vi.mock('../../hooks/useFullscreenWorthwhile', () => ({ useFullscreenWorthwhile: () => false }));
vi.mock('../../stores/gamesDataStore', () => ({ useReadyGames: () => [] }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../components/shared', () => ({ toast: { success: vi.fn(), error: toastError } }));

// The prop-capturing spy under test.
const { collectionPlayerSpy } = vi.hoisted(() => ({ collectionPlayerSpy: vi.fn() }));
vi.mock('../../components/collections/CollectionPlayer', () => ({
  CollectionPlayer: (props) => { collectionPlayerSpy(props); return null; },
}));
vi.mock('../../components/FocusPublishActionBar', () => ({ FocusPublishActionBar: () => null }));

vi.mock('../../stores/publishIntentStore', () => {
  const state = { projectId: null, clear: vi.fn(), set: vi.fn() };
  const usePublishIntentStore = (selector) => selector(state);
  usePublishIntentStore.getState = () => state;
  return { usePublishIntentStore };
});

vi.mock('../../utils/resolveWorkingVideoPreviewUrl', () => ({
  resolveWorkingVideoPreviewUrl: (...a) => resolveUrlMock(...a),
}));
vi.mock('../../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));
vi.mock('../../utils/videoMetadata', () => ({
  extractVideoMetadata: vi.fn(), extractVideoMetadataFromUrl: vi.fn(),
}));
vi.mock('../../utils/storageUrls', () => ({ forceRefreshUrl: vi.fn() }));
vi.mock('../../utils/cacheWarming', () => ({ warmVideoCache: vi.fn(), pushClipRanges: vi.fn() }));
vi.mock('../../utils/acknowledgeExportJob', () => ({ acknowledgeExportJob: vi.fn() }));
vi.mock('../focusOverlayTransition', () => ({
  shouldPersistFocusForOverlayTransition: () => false,
  shouldSkipFocusCompletionPreview: () => false,
}));

const { PROJECT_ID } = vi.hoisted(() => ({ PROJECT_ID: 42 }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, name: 'Great Clip', working_video_id: null },
    aspectRatio: '9:16',
    refresh: (...a) => refreshMock(...a),
  }),
}));

// focusCompletionStore drives `previewOpen`: preview.projectId === projectId.
vi.mock('../../stores/focusCompletionStore', () => {
  const state = {
    preview: null,
    openPreview: (...a) => openPreviewMock(...a),
    closePreview: vi.fn(),
  };
  const useFocusCompletionStore = (selector) => selector(state);
  useFocusCompletionStore.getState = () => state;
  return { useFocusCompletionStore };
});

// useProjectsStore must support the selector-hook form FocusScreen will use to
// derive `projectListItem` (mirrors OverlayScreen's existing pattern), so this
// mock is a real selector-hook, not just `.getState()`.
const projectsState = vi.hoisted(() => ({ projects: [] }));
vi.mock('../../stores', () => {
  const editorState = { setEditorMode: vi.fn(), goToProjectManager: vi.fn() };
  const useEditorStore = (selector) => selector(editorState);
  useEditorStore.getState = () => editorState;

  const projectDataState = {
    isLoading: false, loadingStage: null,
    get clipMetadataCache() { return testState.clipMetadataCache; },
    setWorkingVideo: vi.fn(), setClipMetadata: vi.fn(), fetchClips: (...a) => fetchClipsMock(...a),
    addClipFromLibrary: vi.fn(), uploadClipWithMetadata: vi.fn(), saveFramingEdits: vi.fn(),
    updateClipMetadata: vi.fn(), removeClip: vi.fn(), changeAspectRatio: vi.fn(),
  };
  const useProjectDataStore = (selector) => selector(projectDataState);

  const overlayState = { reset: vi.fn(), setIsLoadingWorkingVideo: vi.fn() };
  const useOverlayStore = (selector) => selector(overlayState);

  const questState = { recordAchievement: vi.fn() };
  const useQuestStore = { getState: () => questState };

  function useProjectsStore(selector) {
    return selector(projectsState);
  }
  useProjectsStore.getState = () => projectsState;

  return {
    useProjectDataStore,
    useFocusStore: () => ({
      includeAudio: false, setIncludeAudio: vi.fn(), videoFile: null, setVideoFile: vi.fn(),
      framingChangedSinceExport: false, setFramingChangedSinceExport: vi.fn(),
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

function lastView() {
  return viewSpy.mock.calls[viewSpy.mock.calls.length - 1][0];
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('FocusScreen highlight-ready handoff (T11970)', () => {
  beforeEach(() => {
    testState.clips = []; testState.projectClipId = null; testState.projectClip = null; testState.clipMetadataCache = {};
    viewSpy.mockClear(); refreshMock.mockReset(); resolveUrlMock.mockReset();
    openPreviewMock.mockReset(); toastError.mockReset();
    fetchClipsMock.mockReset(); fetchClipsMock.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('on COMPLETE: both GETs start together, the CTA is "opening", and the panel opens when the URL resolves', async () => {
    const refresh = deferred(); const url = deferred();
    refreshMock.mockReturnValue(refresh.promise);
    resolveUrlMock.mockReturnValue(url.promise);

    await act(async () => { render(<FocusScreen />); });
    expect(lastView().framingCtaMode).toBe('generate');

    let done;
    await act(async () => { done = lastView().onProceedToOverlay(null, null, PROJECT_ID, 'job1'); });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(resolveUrlMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(lastView().framingCtaMode).toBe('opening');
    expect(openPreviewMock).not.toHaveBeenCalled();

    await act(async () => { url.resolve('https://r2/w.mp4'); });
    expect(openPreviewMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID, previewUrl: 'https://r2/w.mp4', jobId: 'job1',
    }));
    expect(lastView().framingCtaMode).toBe('opening'); // refresh still pending

    await act(async () => { refresh.resolve(); await done; });
    expect(lastView().framingCtaMode).toBe('generate');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('no playback URL: opens no panel and announces the failure loudly', async () => {
    refreshMock.mockResolvedValue();
    resolveUrlMock.mockResolvedValue(null);

    await act(async () => { render(<FocusScreen />); });
    await act(async () => { await lastView().onProceedToOverlay(null, null, PROJECT_ID, 'job1'); });

    expect(openPreviewMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(FOCUS_PREVIEW.LOAD_FAILED);
    expect(lastView().framingCtaMode).toBe('generate');
  });

  it('T15510: the opening CTA survives the clips refetch -- it must not flash back to Sharpen my highlight before exported_at lands in memory', async () => {
    const refresh = deferred(); const url = deferred(); const clipsRefetch = deferred();
    refreshMock.mockReturnValue(refresh.promise);
    resolveUrlMock.mockReturnValue(url.promise);
    fetchClipsMock.mockReturnValue(clipsRefetch.promise);

    await act(async () => { render(<FocusScreen />); });

    let done;
    await act(async () => { done = lastView().onProceedToOverlay(null, null, PROJECT_ID, 'job1'); });
    await act(async () => { url.resolve('https://r2/w.mp4'); });
    await act(async () => { refresh.resolve(); });

    // Both GETs behind the preview (refresh + playback URL) are done, but the
    // clips refetch (which lands the durable exported_at staleness signal
    // deriveFramingCtaState reads, see T10650) is still pending. The CTA must
    // stay 'opening', not fall back to 'generate' -- that fallback is exactly
    // what showed "Sharpen my highlight" + a fresh credit estimate again right
    // after a successful render (T15510 staging QA repro).
    expect(lastView().framingCtaMode).toBe('opening');

    await act(async () => { clipsRefetch.resolve([]); await done; });
    expect(lastView().framingCtaMode).toBe('generate');
  });
});
