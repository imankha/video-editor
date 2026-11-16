import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';

// T4490: one owner for the Spotlight video. The REAL projectDataStore is used
// (not mocked): the load status lives in one slice,
// projectDataStore.workingVideo, written only by loadWorkingVideo. Opening
// Spotlight from Frame after a render, from Home on an existing draft, and after
// a failed video load each reach the right screen.
// Harness from overlayScreenFailedLoad.test.jsx.

const testState = vi.hoisted(() => ({
  videoUrl: null,
  project: null,
  videoError: null,
  clipMetadata: null,
  clips: [{ id: 1, project_id: 42 }],
  framingVideoUrl: 'https://cdn.example.com/clip.mp4',
}));
const regionSpies = vi.hoisted(() => ({ addRegion: vi.fn(), restoreRegions: vi.fn() }));
const { apiFetchSpy, dispatchSpy, streamSpy } = vi.hoisted(() => ({ apiFetchSpy: vi.fn(), dispatchSpy: vi.fn(), streamSpy: vi.fn() }));

const { modeViewSpy } = vi.hoisted(() => ({ modeViewSpy: vi.fn(() => null) }));
vi.mock('../../modes', () => ({ OverlayModeView: modeViewSpy }));
vi.mock('../../containers', () => ({ OverlayContainer: () => ({}) }));

vi.mock('../../modes/overlay', async () => {
  const { useState } = await import('react');
  function useSyncState() {
    const [overlaySyncState, setOverlaySyncState] = useState('idle');
    const [overlayLoadedProjectId, setOverlayLoadedProjectId] = useState(null);
    return { overlaySyncState, setOverlaySyncState, overlayLoadedProjectId, setOverlayLoadedProjectId };
  }
  return {
  useHighlightRegions: () => ({
    boundaries: [], regions: [], keyframes: [], framerate: 30,
    initializeWithDuration: vi.fn(),
    addRegion: regionSpies.addRegion, deleteRegionByIndex: vi.fn(), moveRegionStart: vi.fn(), moveRegionEnd: vi.fn(),
    toggleRegionEnabled: vi.fn(), addOrUpdateKeyframe: vi.fn(), removeKeyframe: vi.fn(),
    isTimeInEnabledRegion: vi.fn(), getRegionAtTime: vi.fn(), getHighlightAtTime: vi.fn(),
    getRegionsForExport: vi.fn(), reset: vi.fn(), restoreRegions: regionSpies.restoreRegions, setVideoDetections: vi.fn(),
    highlightCarryNote: null, setHighlightCarryNote: vi.fn(),
  }),
  useOverlayState: () => ({
    dragHighlight: null, setDragHighlight: vi.fn(),
    selectedHighlightKeyframeTime: null, setSelectedHighlightKeyframeTime: vi.fn(),
    ...useSyncState(),
  }),
  useTextOverlays: () => ({
    textOverlaysWithLayout: [], selectedRegionId: null, selectedElementId: null, inlineEditingElementId: null,
    selectRegion: vi.fn(), selectElement: vi.fn(), beginInlineEdit: vi.fn(), endInlineEdit: vi.fn(),
    addRegion: vi.fn(), addElement: vi.fn(), moveRegionStart: vi.fn(), moveRegionEnd: vi.fn(),
    moveRegionBlock: vi.fn(), updateElementSpec: vi.fn(), toggleElement: vi.fn(), deleteElement: vi.fn(),
    deleteRegion: vi.fn(), restoreTextOverlays: vi.fn(),
  }),
  };
});

vi.mock('../../hooks/useVideo', () => ({
  useVideo: () => ({
    videoRef: { current: null },
    get videoUrl() { return testState.videoUrl; },
    metadata: null, isPlaying: false, currentTime: 0, duration: 0,
    get error() { return testState.videoError; },
    isLoading: false, isVideoElementLoading: false, loadingProgress: 0,
    loadingElapsedSeconds: 0, loadVideo: vi.fn(), loadVideoFromUrl: vi.fn().mockResolvedValue(null),
    loadVideoFromStreamingUrl: streamSpy, togglePlay: vi.fn(), seek: vi.fn(), stepForward: vi.fn(),
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
  extractVideoMetadataFromUrl: vi.fn().mockResolvedValue({ duration: 10, width: 1080, height: 1920 }),
  VideoAssetMissingError: class VideoAssetMissingError extends Error {
    constructor(url, status) { super(`missing ${status}`); this.status = status; }
  },
}));
vi.mock('../../utils/highlightCarryNote', () => ({ describeHighlightCarryNote: () => null }));
vi.mock('../../utils/persistKeyframeEdit', () => ({ persistKeyframeEdit: vi.fn() }));
vi.mock('../../utils/storageUrls', () => ({ forceRefreshUrl: vi.fn() }));
vi.mock('../../utils/apiFetch', () => ({ default: apiFetchSpy }));
vi.mock('../../api/overlayActions', () => ({ seedProjectVersion: vi.fn() }));
vi.mock('../../stores/overlayActionStore', () => ({
  dispatchOverlayAction: dispatchSpy,
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
    project: testState.project,
    refresh: vi.fn(async () => testState.project),
  }),
}));

vi.mock('../../stores/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector) => selector({ setEditorMode: vi.fn() }),
    { getState: () => ({ setEditorMode: vi.fn(), goToProjectManager: vi.fn() }) },
  ),
  EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay', PROJECT_MANAGER: 'project-manager' },
}));
// Stateless overlayStore mock (as in overlayScreenFailedLoad): the harness's
// per-render vi.fn() deps would make a real whole-state subscription loop.
vi.mock('../../stores/overlayStore', () => ({
  useOverlayStore: () => ({
    effectType: 'spotlight', highlightColor: '#fff',
    setEffectType: vi.fn(), setHighlightColor: vi.fn(),
    setOverlayChangedSinceExport: vi.fn(),
    // Pre-T4490 fields, inert today: kept so the red run against the old revision
    // reaches the assertions instead of crashing on a missing setter.
    isLoadingWorkingVideo: false, setIsLoadingWorkingVideo: vi.fn(),
    highlightShape: 'ellipse', strokeWidth: 2, fillEnabled: true, fillOpacity: 0.5, dimStrength: 0.5,
    setHighlightShape: vi.fn(), setStrokeWidth: vi.fn(), setFillEnabled: vi.fn(), setFillOpacity: vi.fn(),
    setDimStrength: vi.fn(),
    posterMarkerTime: null, posterSlowmoSection: null, posterUploadedFilename: null,
    setPosterMarkerTime: vi.fn(), setPosterSlowmoSection: vi.fn(), setPosterUploadedFilename: vi.fn(),
  }),
}));
vi.mock('../../stores/exportStore', () => ({
  useExportStore: (selector) => selector({ exportingProject: null, dismissExportCompleteToast: vi.fn() }),
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
import { useProjectDataStore } from '../../stores/projectDataStore';

const SAVED = {
  has_data: true,
  version: 7,
  video_duration: 10,
  highlights_data: [{ id: 'saved-1', start_time: 0, end_time: 3, keyframes: [] }],
  text_overlays: [],
};
const DRAFT = { id: PROJECT_ID, name: 'Great Clip', final_video_id: null, working_video_id: null, working_video_url: null };
const RENDERED = { ...DRAFT, working_video_id: 71, working_video_url: `/api/projects/${PROJECT_ID}/working_video/stream` };
const PRESIGNED = 'https://r2.example.com/working_71.mp4';

let playback;
function routeApi() {
  apiFetchSpy.mockImplementation(async (url) => {
    if (String(url).includes('/overlay-data')) return { ok: true, status: 200, json: async () => SAVED };
    if (String(url).includes('/working_video/playback-url')) return playback();
    return { ok: true, status: 200, json: async () => ({}) };
  });
}
const playbackOk = async () => ({ ok: true, status: 200, json: async () => ({ url: PRESIGNED }) });
const playbackFails = async () => ({ ok: false, status: 500, json: async () => ({}) });
const lastViewProps = () => modeViewSpy.mock.calls.at(-1)?.[0];
const slice = () => useProjectDataStore.getState().workingVideo;

describe('T4490 Spotlight video has one owner', () => {
  beforeEach(() => {
    apiFetchSpy.mockReset();
    streamSpy.mockReset();
    modeViewSpy.mockClear();
    useProjectDataStore.getState().reset();
    useProjectDataStore.setState({
      clips: testState.clips,
      clipMetadataCache: { 1: { duration: 10, width: 1080, height: 1920 } },
    });
    testState.project = null;
    playback = playbackOk;
    routeApi();
    projectsState.projects = [{ id: PROJECT_ID, game_names: [], game_ids: [], clip_game_start_time: null }];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('T4490:C2 from Frame after a render: the new working video reaches the player', async () => {
    // Frame's completion path refreshes the project; nothing else is handed over.
    testState.project = DRAFT;
    const { rerender } = render(<OverlayScreen />);
    testState.project = RENDERED;
    rerender(<OverlayScreen />);

    await waitFor(() => expect(streamSpy).toHaveBeenCalledWith(PRESIGNED, expect.objectContaining({ duration: 10 })));
    expect(slice()).toMatchObject({ status: 'ready', videoId: 71 });
    await waitFor(() => expect(lastViewProps()).toMatchObject({ isLoading: false, error: null }));
  });

  it('T4490:C2 from Home on an existing draft: the working video reaches the player', async () => {
    testState.project = RENDERED;
    render(<OverlayScreen />);

    await waitFor(() => expect(streamSpy).toHaveBeenCalledWith(PRESIGNED, expect.anything()));
    expect(slice()).toMatchObject({ status: 'ready', videoId: 71 });
    await waitFor(() => expect(lastViewProps()).toMatchObject({ isLoading: false, error: null }));
  });

  it('T4490:C2 after a failed video load: error with Retry, and Retry reaches the player', async () => {
    playback = playbackFails;
    testState.project = RENDERED;
    render(<OverlayScreen />);

    await waitFor(() => expect(lastViewProps()?.error).toBeTruthy());
    expect(slice().status).toBe('error');
    expect(lastViewProps().isUrlExpiredError()).toBe(true);
    expect(streamSpy).not.toHaveBeenCalledWith(PRESIGNED, expect.anything());

    playback = playbackOk;
    await act(async () => { await lastViewProps().onRetryVideo(); });

    await waitFor(() => expect(streamSpy).toHaveBeenCalledWith(PRESIGNED, expect.anything()));
    expect(slice().status).toBe('ready');
    await waitFor(() => expect(lastViewProps()).toMatchObject({ isLoading: false, error: null }));
  });

  it('T4490:C2 a missing working video (404) shows "unavailable" without Retry', async () => {
    playback = async () => ({ ok: false, status: 404, json: async () => ({}) });
    testState.project = RENDERED;
    render(<OverlayScreen />);

    await waitFor(() => expect(lastViewProps()?.error).toMatch(/no longer available/));
    expect(slice().status).toBe('missing');
    expect(lastViewProps().isUrlExpiredError()).toBe(false);
  });
});
