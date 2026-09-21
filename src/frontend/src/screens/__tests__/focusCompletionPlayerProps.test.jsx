import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { act } from 'react';

// T10190 §3.2 Shaper 3: FocusScreen's post-export completion-preview
// CollectionPlayer mount (FocusScreen.jsx:1572-1594) currently feeds NEITHER
// gameName nor gameStartTime (title={project?.name} only) -- this is gap 1 in
// the design doc. The fix derives `projectListItem` off useProjectsStore (the
// SAME pattern OverlayScreen already uses) and feeds gameName + RAW
// gameStartTime + gameId, so the header shows "game name + clock" instead of
// falling back to the clip name, for a single-source-game project. Multi/no-
// game projects must still fall back to title (no gameName fed).
//
// This mounts the REAL FocusScreen (mocking scaffold copied from
// focusScreenStaleClipGuard.test.jsx, the established pattern for rendering
// this otherwise-unmountable screen) and spies on the real CollectionPlayer
// mount's props via a mock, so a regression in the derivation fails here
// exactly as it would in production -- not a reimplementation of the logic.

const testState = vi.hoisted(() => ({
  clips: [],
  selectedClipId: null,
  selectedClip: null,
  clipMetadataCache: {},
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
    clips: testState.clips, selectedClipId: testState.selectedClipId, selectedClip: testState.selectedClip,
    hasClips: testState.clips.length > 0, globalAspectRatio: '9:16', globalTransition: null,
    deleteClip: vi.fn(), selectClip: vi.fn(), reorderClips: vi.fn(), updateClipData: vi.fn(),
    setGlobalAspectRatio: vi.fn(), setGlobalTransition: vi.fn(), getExportData: vi.fn(),
  }),
}));
vi.mock('../../hooks/useFullscreenWorthwhile', () => ({ useFullscreenWorthwhile: () => false }));
vi.mock('../../stores/gamesDataStore', () => ({ useReadyGames: () => [] }));
vi.mock('../../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('../../components/ClipSelectorSidebar', () => ({ ClipSelectorSidebar: () => null }));
vi.mock('../../components/FileUpload', () => ({ FileUpload: () => null }));
vi.mock('../../components/shared', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  resolveWorkingVideoPreviewUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../utils/framingCtaState', () => ({
  deriveFramingCtaState: () => ({ mode: 'generate', showBackToPreview: false, renderedAt: null }),
}));
vi.mock('../../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));
vi.mock('../../utils/resultRetentionNote', () => ({ resultRetentionNote: () => null }));
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
vi.mock('../focusCompletionOffer', () => ({ offerFocusCompletionPreview: vi.fn() }));

const { PROJECT_ID } = vi.hoisted(() => ({ PROJECT_ID: 42 }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, name: 'Great Clip', working_video_id: null },
    aspectRatio: '9:16',
    refresh: vi.fn(),
  }),
}));

// focusCompletionStore drives `previewOpen`: preview.projectId === projectId.
vi.mock('../../stores/focusCompletionStore', () => {
  const state = {
    preview: { projectId: PROJECT_ID, previewUrl: 'blob://preview', openMode: 'framing' },
    openPreview: vi.fn(),
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
    setWorkingVideo: vi.fn(), setClipMetadata: vi.fn(), fetchClips: vi.fn().mockResolvedValue([]),
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

function setClips(clips, selectedClipId) {
  testState.clips = clips;
  testState.selectedClipId = selectedClipId;
  testState.selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  testState.clipMetadataCache = {};
}

describe('FocusScreen completion-preview CollectionPlayer props (T10190 §3.2 Shaper 3)', () => {
  beforeEach(() => {
    setClips([], null);
    collectionPlayerSpy.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('feeds gameName + RAW gameStartTime on the completion reel when the project resolves exactly one source game', async () => {
    projectsState.projects = [{
      id: PROJECT_ID, name: 'Great Clip', game_names: ['Lakers'], game_ids: [55], clip_game_start_time: 750,
    }];

    await act(async () => { render(<FocusScreen />); });

    expect(collectionPlayerSpy).toHaveBeenCalled();
    const lastCallProps = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1][0];
    const reel = lastCallProps.reels[0];
    expect(reel.gameName).toBe('Lakers');
    // RAW seconds -- CollectionPlayer formats internally via formatGameClock.
    expect(reel.gameStartTime).toBe(750);
  });

  it('feeds no gameName for a multi-clip project with no single source game (falls back to title)', async () => {
    projectsState.projects = [{
      id: PROJECT_ID, name: 'Great Clip', game_names: [], game_ids: [], clip_game_start_time: null,
    }];

    await act(async () => { render(<FocusScreen />); });

    const lastCallProps = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1][0];
    const reel = lastCallProps.reels[0];
    expect(reel.gameName ?? null).toBeNull();
    expect(lastCallProps.title).toBe('Great Clip');
  });
});
