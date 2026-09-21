import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// T10190 §3.2 Shaper 4: OverlayScreen's post-export completion-preview
// CollectionPlayer mount (OverlayScreen.jsx:1825-1847) currently feeds NEITHER
// gameName nor gameStartTime into the reel, even though OverlayScreen ALREADY
// derives `gameName` (:174) and a pre-formatted `gameClock` string (:175, via
// clipGameClock) from `projectListItem` (:173) -- used elsewhere (:1678) but
// not wired into the completion reel. The fix must feed the RAW
// `projectListItem.clip_game_start_time`, NOT the pre-formatted `gameClock`
// (CollectionPlayer double-formats otherwise -- design §5 landmine).
//
// OverlayScreen is too large to mount with all its real children (see
// overlayPublishExit.test.jsx's own note); this test mounts the REAL
// OverlayScreen with its heavy children/hooks mocked, drives the real
// `handleExportComplete` callback (passed to the mocked OverlayModeView) to
// flip `showExportCompletePreview` true, and spies on the real
// CollectionPlayer mount's props -- so a regression in the derivation fails
// here exactly as it would in production.

const testState = vi.hoisted(() => ({ projectId: 42 }));

const { collectionPlayerSpy } = vi.hoisted(() => ({ collectionPlayerSpy: vi.fn() }));
vi.mock('../../components/collections/CollectionPlayer', () => ({
  CollectionPlayer: (props) => { collectionPlayerSpy(props); return null; },
}));

// OverlayModeView is mocked down to a single button that fires the REAL
// handleExportComplete callback OverlayScreen passes as onExportComplete --
// the actual trigger path for showExportCompletePreview.
vi.mock('../../modes', () => ({
  OverlayModeView: (props) => (
    <button onClick={() => props.onExportComplete({ projectId: testState.projectId, mode: 'overlay' })}>
      fire-export-complete
    </button>
  ),
}));

vi.mock('../../containers', () => ({
  OverlayContainer: () => ({}),
}));

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
    overlaySyncState: 'idle', setOverlaySyncState: vi.fn(),
    overlayLoadedProjectId: null, setOverlayLoadedProjectId: vi.fn(),
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
    videoRef: { current: null }, videoUrl: null, metadata: null, isPlaying: false, currentTime: 0,
    duration: 0, error: null, isLoading: false, isVideoElementLoading: false, loadingProgress: 0,
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
vi.mock('../../utils/resultRetentionNote', () => ({ resultRetentionNote: () => null }));
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
    clips: [], clipMetadataCache: {}, getClipFileUrl: vi.fn(),
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
import { formatGameClock } from '../../utils/timeFormat';

describe('OverlayScreen completion-preview CollectionPlayer props (T10190 §3.2 Shaper 4)', () => {
  beforeEach(() => {
    collectionPlayerSpy.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('feeds the RAW gameStartTime (not the pre-formatted gameClock) once the completion preview opens', async () => {
    projectsState.projects = [{
      id: PROJECT_ID, game_names: ['Lakers'], game_ids: [55], clip_game_start_time: 750,
    }];

    render(<OverlayScreen />);
    fireEvent.click(screen.getByText('fire-export-complete'));

    await waitFor(() => {
      const lastCall = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1];
      expect(lastCall?.[0]?.reels?.[0]).toBeTruthy();
    });
    const lastCallProps = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1][0];
    const reel = lastCallProps.reels[0];

    expect(reel.gameName).toBe('Lakers');
    // RAW seconds -- not the pre-formatted "12'30\"" string (double-format guard).
    expect(reel.gameStartTime).toBe(750);
    expect(formatGameClock(reel.gameStartTime)).toBe('12\'30"');
  });

  it('feeds no gameName when the project has no single source game (falls back to title)', async () => {
    projectsState.projects = [{ id: PROJECT_ID, game_names: [], game_ids: [], clip_game_start_time: null }];

    render(<OverlayScreen />);
    fireEvent.click(screen.getByText('fire-export-complete'));

    await waitFor(() => {
      const lastCall = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1];
      expect(lastCall?.[0]?.reels?.[0]).toBeTruthy();
    });
    const lastCallProps = collectionPlayerSpy.mock.calls[collectionPlayerSpy.mock.calls.length - 1][0];
    const reel = lastCallProps.reels[0];

    expect(reel.gameName ?? null).toBeNull();
    expect(lastCallProps.title).toBe('Great Clip');
  });
});
