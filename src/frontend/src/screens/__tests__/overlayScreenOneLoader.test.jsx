import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// T4480: the Spotlight editor has two load triggers -- right after a fresh render
// (projectDataStore.clipMetadata set by the export gesture) and a plain open. Both
// must apply the same saved overlay-data to the same editor state; a setting wired
// into only one of them silently goes missing in the other case.
// Harness from overlayScreenFailedLoad.test.jsx, with every editor setter recording
// into `applied` so the two loads can be compared field by field.

const testState = vi.hoisted(() => ({
  videoUrl: 'blob:working',
  videoError: null,
  clipMetadata: null,
  clips: [{ id: 1, project_id: 42 }],
  framingVideoUrl: 'https://cdn.example.com/clip.mp4',
}));
const applied = vi.hoisted(() => ({ current: {} }));
const record = vi.hoisted(() => (key) => (...args) => { applied.current[key] = args; });
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
    getRegionsForExport: vi.fn(), reset: vi.fn(), restoreRegions: (...a) => { regionSpies.restoreRegions(...a); record('restoreRegions')(...a); },
    setVideoDetections: record('videoDetections'),
    highlightCarryNote: null, setHighlightCarryNote: record('carryNote'),
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
    deleteRegion: vi.fn(), restoreTextOverlays: record('textOverlays'),
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
vi.mock('../../api/overlayActions', () => ({ seedProjectVersion: (...a) => record('seedVersion')(...a) }));
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
    setEffectType: record('effectType'), setHighlightColor: record('highlightColor'), setIsLoadingWorkingVideo: vi.fn(),
    setOverlayChangedSinceExport: record('changedSinceExport'),
    highlightShape: 'ellipse', strokeWidth: 2, fillEnabled: true, fillOpacity: 0.5, dimStrength: 0.5,
    setHighlightShape: record('highlightShape'), setStrokeWidth: record('strokeWidth'),
    setFillEnabled: record('fillEnabled'), setFillOpacity: record('fillOpacity'),
    setDimStrength: record('dimStrength'),
    posterMarkerTime: null, posterSlowmoSection: null, posterUploadedFilename: null,
    setPosterMarkerTime: record('posterMarkerTime'), setPosterSlowmoSection: record('posterSlowmoSection'),
    setPosterUploadedFilename: record('posterUploadedFilename'),
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

// Every Spotlight setting overlay-data carries, each set to a non-default value.
const SAVED = {
  has_data: true,
  version: 7,
  video_duration: 10,
  highlights_data: [{ id: 'saved-1', start_time: 0, end_time: 3, keyframes: [] }],
  detections_data: { frames: [{ t: 0, boxes: [] }] },
  highlight_carry_note: { kind: 'kept', count: 1 },
  effect_type: 'dark_overlay',
  highlight_color: '#ff00aa',
  highlight_shape: 'rectangle',
  stroke_width: 5,
  fill_enabled: false,
  fill_opacity: 0.25,
  dim_strength: 0.8,
  poster_marker_time: 2.5,
  poster_slowmo_section: { start: 1, end: 2 },
  poster_source: 'upload',
  poster_filename: 'cover.jpg',
  text_overlays: [{ id: 'txt-1', start_time: 0, end_time: 2, elements: [] }],
};

function routeApi() {
  apiFetchSpy.mockImplementation(async (url) => {
    if (String(url).includes('/overlay-data')) return { ok: true, status: 200, json: async () => SAVED };
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

async function loadOnce({ freshExport }) {
  applied.current = {};
  testState.clipMetadata = freshExport ? { source_clips: [] } : null;
  routeApi();
  render(<OverlayScreen />);
  await waitFor(() => expect(applied.current.changedSinceExport).toBeDefined());
  const state = applied.current;
  cleanup();
  return state;
}

describe('T4480 one loader for Spotlight data', () => {
  beforeEach(() => {
    regionSpies.addRegion.mockReset();
    regionSpies.restoreRegions.mockReset();
    apiFetchSpy.mockReset();
    dispatchSpy.mockReset();
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

  it('T4480:C2 the fresh-render and plain-open loads give the same editor state', async () => {
    const plainOpen = await loadOnce({ freshExport: false });
    const freshRender = await loadOnce({ freshExport: true });

    expect(freshRender).toEqual(plainOpen);
    // Every Spotlight setting reached the editor, not just the regions.
    expect(Object.keys(plainOpen).sort()).toEqual([
      'carryNote', 'changedSinceExport', 'dimStrength', 'effectType', 'fillEnabled', 'fillOpacity',
      'highlightColor', 'highlightShape', 'posterMarkerTime', 'posterSlowmoSection',
      'posterUploadedFilename', 'restoreRegions', 'seedVersion', 'strokeWidth', 'textOverlays',
      'videoDetections',
    ]);
    expect(plainOpen.restoreRegions).toEqual([SAVED.highlights_data, 10]);
    expect(plainOpen.posterUploadedFilename).toEqual(['cover.jpg']);
    expect(regionSpies.addRegion).not.toHaveBeenCalled();
  });

  it('T4480:C1 OverlayScreen applies overlay-data in one place', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/screens/OverlayScreen.jsx'), 'utf8');
    // One function body reads the payload; two copies is the bug class this task removes.
    expect(source.match(/setDimStrength\(data\.dim_strength\)/g)).toHaveLength(1);
    expect(source.match(/const applyOverlayData = useCallback\(/g)).toHaveLength(1);
    expect(source.match(/applyOverlayData\(data, /g)).toHaveLength(2);
  });
});
