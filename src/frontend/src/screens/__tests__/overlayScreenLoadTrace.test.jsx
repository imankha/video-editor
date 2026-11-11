import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// T16050:C1 - OverlayScreen (Spotlight) wires the [LOAD] trace
// (src/utils/loadTrace.js) to its working-video/overlay-data loading state.
// Reuses the overlayCompletionPlayerProps.test.jsx harness (OverlayScreen is
// too large to mount with real children) with mutable video/overlay state so
// a rerender can move the trace through its needs.

const testState = vi.hoisted(() => ({
  videoUrl: null,
  videoError: null,
  clips: [{ id: 1, project_id: 42 }],
  framingVideoUrl: 'https://cdn.example.com/clip.mp4',
}));

const overlayState = vi.hoisted(() => ({ overlaySyncState: 'idle', overlayLoadedProjectId: null }));

vi.mock('../../modes', () => ({ OverlayModeView: () => null }));
vi.mock('../../containers', () => ({ OverlayContainer: () => ({}) }));

vi.mock('../../modes/overlay', () => ({
  useHighlightRegions: () => ({
    boundaries: [], regions: [], keyframes: [], framerate: 30,
    initializeWithDuration: vi.fn(), initializeFromClipMetadata: vi.fn(),
    addRegion: vi.fn(), deleteRegionByIndex: vi.fn(), moveRegionStart: vi.fn(), moveRegionEnd: vi.fn(),
    toggleRegionEnabled: vi.fn(), addOrUpdateKeyframe: vi.fn(), removeKeyframe: vi.fn(),
    isTimeInEnabledRegion: vi.fn(), getRegionAtTime: vi.fn(), getHighlightAtTime: vi.fn(),
    getRegionsForExport: vi.fn(), reset: vi.fn(), restoreRegions: vi.fn(), setVideoDetections: vi.fn(),
    highlightCarryNote: null, setHighlightCarryNote: vi.fn(),
  }),
  useOverlayState: () => ({
    dragHighlight: null, setDragHighlight: vi.fn(),
    selectedHighlightKeyframeTime: null, setSelectedHighlightKeyframeTime: vi.fn(),
    get overlaySyncState() { return overlayState.overlaySyncState; },
    setOverlaySyncState: (v) => { overlayState.overlaySyncState = v; },
    get overlayLoadedProjectId() { return overlayState.overlayLoadedProjectId; },
    setOverlayLoadedProjectId: (v) => { overlayState.overlayLoadedProjectId = v; },
  }),
  useTextOverlays: () => ({
    textOverlaysWithLayout: [], selectedRegionId: null, selectedElementId: null, inlineEditingElementId: null,
    selectRegion: vi.fn(), selectElement: vi.fn(), beginInlineEdit: vi.fn(), endInlineEdit: vi.fn(),
    addRegion: vi.fn(), addElement: vi.fn(), moveRegionStart: vi.fn(), moveRegionEnd: vi.fn(),
    moveRegionBlock: vi.fn(), updateElementSpec: vi.fn(), toggleElement: vi.fn(), deleteElement: vi.fn(),
    deleteRegion: vi.fn(), restoreTextOverlays: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVideo', () => ({
  useVideo: () => ({
    videoRef: { current: null },
    get videoUrl() { return testState.videoUrl; },
    metadata: null, isPlaying: false, currentTime: 0, duration: 0,
    get error() { return testState.videoError; },
    isLoading: false, isVideoElementLoading: false, loadingProgress: 0,
    loadingElapsedSeconds: 0, loadVideo: vi.fn(), loadVideoFromUrl: vi.fn().mockResolvedValue(null),
    loadVideoFromStreamingUrl: vi.fn(), togglePlay: vi.fn(), seek: vi.fn(), stepForward: vi.fn(),
    stepBackward: vi.fn(), seekForward: vi.fn(), seekBackward: vi.fn(), restart: vi.fn(), clearError: vi.fn(),
    isUrlExpiredError: false, handlers: {},
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
vi.mock('../../hooks/useFullscreenWorthwhile', () => ({ useFullscreenWorthwhile: () => false }));
vi.mock('../../utils/videoMetadata', () => ({
  extractVideoMetadataFromUrl: vi.fn().mockResolvedValue(null),
  VideoAssetMissingError: class VideoAssetMissingError extends Error {},
}));
vi.mock('../../utils/highlightCarryNote', () => ({ describeHighlightCarryNote: () => null }));
vi.mock('../../utils/persistKeyframeEdit', () => ({ persistKeyframeEdit: vi.fn() }));
vi.mock('../../utils/storageUrls', () => ({ forceRefreshUrl: vi.fn() }));
vi.mock('../../utils/apiFetch', () => ({ default: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) }));
vi.mock('../../api/overlayActions', () => ({}));
vi.mock('../../stores/overlayActionStore', () => ({
  dispatchOverlayAction: vi.fn(),
  useOverlayActionStore: Object.assign(() => ({}), { getState: () => ({ reset: vi.fn() }) }),
}));
vi.mock('../../utils/analytics', () => ({ track: vi.fn() }));
vi.mock('../../hooks/usePublishProject', () => ({
  usePublishProject: () => ({ publish: vi.fn().mockResolvedValue(true), isPublishing: false }),
}));
vi.mock('../../stores/publishIntentStore', () => {
  const state = { projectId: null, clear: vi.fn(), set: vi.fn() };
  const usePublishIntentStore = (selector) => (selector ? selector(state) : state);
  usePublishIntentStore.getState = () => state;
  return { usePublishIntentStore };
});
vi.mock('../../utils/finishedReelNav', () => ({ openFinishedReel: vi.fn() }));
vi.mock('../../utils/funnelEvents', () => ({ recordFunnelEvent: vi.fn(), FUNNEL_EVENTS: {} }));
vi.mock('../../components/shared', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/OverlayPublishActionBar', () => ({ OverlayPublishActionBar: () => null }));

const { PROJECT_ID } = vi.hoisted(() => ({ PROJECT_ID: 42 }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, name: 'Great Clip', final_video_id: 99 },
    refresh: vi.fn().mockResolvedValue({ id: PROJECT_ID, name: 'Great Clip', final_video_id: 99 }),
  }),
}));

vi.mock('../../stores/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector) => selector({ setEditorMode: vi.fn() }),
    { getState: () => ({ setEditorMode: vi.fn(), goToProjectManager: vi.fn() }) },
  ),
  EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay', PROJECT_MANAGER: 'project-manager' },
}));
vi.mock('../../stores/overlayStore', () => ({
  useOverlayStore: () => ({
    effectType: 'spotlight', highlightColor: '#fff', isLoadingWorkingVideo: false,
    setEffectType: vi.fn(), setHighlightColor: vi.fn(), setIsLoadingWorkingVideo: vi.fn(),
    setOverlayChangedSinceExport: vi.fn(),
    highlightShape: 'ellipse', strokeWidth: 2, fillEnabled: true, fillOpacity: 0.5, dimStrength: 0.5,
    setHighlightShape: vi.fn(), setStrokeWidth: vi.fn(), setFillEnabled: vi.fn(), setFillOpacity: vi.fn(),
    setDimStrength: vi.fn(),
    posterMarkerTime: null, posterSlowmoSection: null, posterUploadedFilename: null,
    setPosterMarkerTime: vi.fn(), setPosterSlowmoSection: vi.fn(), setPosterUploadedFilename: vi.fn(),
  }),
}));
vi.mock('../../stores/projectDataStore', () => ({
  useProjectDataStore: (selector) => selector({
    workingVideo: null, setWorkingVideo: vi.fn(), clipMetadata: {}, setClipMetadata: vi.fn(),
    get clips() { return testState.clips; },
    clipMetadataCache: {},
    getClipFileUrl: () => testState.framingVideoUrl,
  }),
}));
vi.mock('../../stores/focusStore', () => ({
  useFocusStore: (selector) => selector({ hasChangedSinceExport: false }),
}));
vi.mock('../../stores/exportStore', () => ({
  useExportStore: (selector) => selector({ exportingProject: null, dismissExportCompleteToast: vi.fn() }),
}));
vi.mock('../../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ recordAchievement: vi.fn() }) },
}));

const projectsState = vi.hoisted(() => ({ projects: [] }));
vi.mock('../../stores/projectsStore', () => {
  function useProjectsStore(selector) {
    return selector(projectsState);
  }
  useProjectsStore.getState = () => projectsState;
  return { useProjectsStore };
});

import { OverlayScreen } from '../OverlayScreen';

function infoLines() {
  return console.info.mock.calls.map((args) => args.join(' '));
}

describe('T16050 OverlayScreen (Spotlight) [LOAD] trace wiring', () => {
  beforeEach(() => {
    testState.videoUrl = null;
    testState.videoError = null;
    testState.framingVideoUrl = 'https://cdn.example.com/clip.mp4';
    overlayState.overlaySyncState = 'idle';
    overlayState.overlayLoadedProjectId = null;
    projectsState.projects = [{ id: PROJECT_ID, game_names: [], game_ids: [], clip_game_start_time: null }];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('T16050:C1 logs one [LOAD] Spotlight waiting-for line naming video/overlayData on open', async () => {
    render(<OverlayScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const waitingLines = infoLines().filter((l) => l.includes('[LOAD] Spotlight waiting for'));
    expect(waitingLines).toHaveLength(1);
    expect(waitingLines[0]).toContain('video, overlayData');
    expect(waitingLines[0]).toContain('projectId=42');
  });

  it('logs video and overlayData arrived, then settles, once both resolve', async () => {
    const { rerender } = render(<OverlayScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    overlayState.overlaySyncState = 'ready';
    overlayState.overlayLoadedProjectId = PROJECT_ID;
    rerender(<OverlayScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(infoLines().some((l) => l.includes('[LOAD] Spotlight video arrived'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Spotlight overlayData arrived'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Spotlight settled in'))).toBe(true);
  });

  it('logs video empty when no working/framing video source resolves (no project data)', async () => {
    testState.clips = [];
    testState.framingVideoUrl = undefined;

    render(<OverlayScreen />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(infoLines().some((l) => l.includes('[LOAD] Spotlight video empty'))).toBe(true);
  });
});
