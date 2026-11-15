import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// T16480: a failed Spotlight overlay-data load must never replace the saved
// spotlights with a fresh default circle. The editor shows an error with Retry
// and stays off (no OverlayModeView, no action can sync) until a load succeeds.
// Harness from overlayScreenLoadTrace.test.jsx, with real React sync state so the
// failed load and the retry re-render the screen.

const testState = vi.hoisted(() => ({
  videoUrl: 'blob:working',
  videoError: null,
  clipMetadata: null,
  clips: [{ id: 1, project_id: 42 }],
  framingVideoUrl: 'https://cdn.example.com/clip.mp4',
}));
const regionSpies = vi.hoisted(() => ({ addRegion: vi.fn(), restoreRegions: vi.fn() }));
const { apiFetchSpy, dispatchSpy } = vi.hoisted(() => ({ apiFetchSpy: vi.fn(), dispatchSpy: vi.fn() }));

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
    workingVideo: null, setWorkingVideo: vi.fn(),
    // clipMetadata set = the fresh-export loader runs; null = the plain-open loader.
    get clipMetadata() { return testState.clipMetadata; },
    setClipMetadata: (v) => { testState.clipMetadata = v; },
    get clips() { return testState.clips; },
    clipMetadataCache: { 1: { duration: 10, width: 1080, height: 1920 } },
    getClipFileUrl: () => testState.framingVideoUrl,
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

const SAVED = {
  has_data: true,
  version: 7,
  video_duration: 10,
  highlights_data: [{ id: 'saved-1', start_time: 0, end_time: 3, keyframes: [] }],
  text_overlays: [],
};

function overlayDataCalls() {
  return apiFetchSpy.mock.calls.filter(([url]) => String(url).includes('/overlay-data'));
}

function routeApi({ overlayData }) {
  apiFetchSpy.mockImplementation(async (url) => {
    if (String(url).includes('/overlay-data')) return overlayData();
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const networkFailure = async () => { throw new TypeError('Failed to fetch'); };

describe('T16480 Spotlight failed overlay-data load', () => {
  beforeEach(() => {
    regionSpies.addRegion.mockReset();
    regionSpies.restoreRegions.mockReset();
    apiFetchSpy.mockReset();
    dispatchSpy.mockReset();
    modeViewSpy.mockClear();
    testState.clipMetadata = null;
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

  it('T16480:C1 a network failure shows an error with Retry and no default circle', async () => {
    routeApi({ overlayData: networkFailure });
    render(<OverlayScreen />);

    await screen.findByRole('button', { name: /retry/i });
    expect(overlayDataCalls()).toHaveLength(1);
    expect(regionSpies.addRegion).not.toHaveBeenCalled();
    expect(regionSpies.restoreRegions).not.toHaveBeenCalled();
  });

  it('T16480:C1 the fresh-export loader also shows Retry instead of a default circle', async () => {
    testState.clipMetadata = { source_clips: [] };
    routeApi({ overlayData: networkFailure });
    render(<OverlayScreen />);

    await screen.findByRole('button', { name: /retry/i });
    expect(overlayDataCalls()).toHaveLength(1);
    expect(regionSpies.addRegion).not.toHaveBeenCalled();
  });

  it('T16480:C1 a server error response is a failed load, not "nothing saved"', async () => {
    routeApi({ overlayData: async () => ({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) }) });
    render(<OverlayScreen />);

    await screen.findByRole('button', { name: /retry/i });
    expect(regionSpies.addRegion).not.toHaveBeenCalled();
  });

  it('T16480:C3 the editor is not mounted while the load has failed, so no edit can be sent', async () => {
    routeApi({ overlayData: networkFailure });
    render(<OverlayScreen />);

    await screen.findByRole('button', { name: /retry/i });
    modeViewSpy.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(modeViewSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('T16480:C2 Retry reloads the saved circles and re-enables the editor', async () => {
    let fail = true;
    routeApi({
      overlayData: async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => SAVED };
      },
    });
    render(<OverlayScreen />);

    const retry = await screen.findByRole('button', { name: /retry/i });
    fail = false;
    fireEvent.click(retry);

    await waitFor(() => expect(regionSpies.restoreRegions).toHaveBeenCalledTimes(1));
    expect(regionSpies.restoreRegions.mock.calls[0][0]).toEqual(SAVED.highlights_data);
    expect(overlayDataCalls()).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry/i })).toBeNull());
    expect(modeViewSpy).toHaveBeenCalled();
    expect(regionSpies.addRegion).not.toHaveBeenCalled();
  });
});
