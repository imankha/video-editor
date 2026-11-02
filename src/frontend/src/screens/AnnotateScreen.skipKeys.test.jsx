import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

/**
 * T14350: Annotate keys match YouTube and the transport buttons. Playhead layer:
 * Left/Right = 5 s. Every layer: J / L = 10 s back / forward, K = play/pause.
 * Plays layer Left/Right still jump between marked plays. Nothing seeks while
 * the play editor is open. Harness copied from AnnotateScreen.firstRun.test.jsx
 * (everything below the screen stubbed); the container's effective* transport
 * functions are spies, so a key's effect is the call it makes.
 */

// A proxy whose props are safe defaults: handler-ish names -> no-op fn, else []
// ([] is array-safe for .map/.forEach/.length and truthy for guards).
const HANDLER_RE = /^(handle|set|on|get|select|clear|await|lock|unlock|import|update|delete|persist|finish|save|load|fetch|open|close|toggle|add|mark|retry|consume|arm|show|redirect)/;
function safeBag(overrides = {}) {
  return new Proxy(overrides, {
    has: () => true,
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      if (prop === 'annotateClipCount') return 3;
      if (HANDLER_RE.test(prop)) return vi.fn();
      return [];
    },
  });
}

const containerState = {};
const viewport = { mobile: false };
const modeViewProps = { current: null };
const panelProps = [];
vi.mock('../containers', () => ({ AnnotateContainer: () => safeBag({ clipRegions: [], annotateRegionsWithLayout: [], ...containerState }) }));
vi.mock('../modes', () => ({ AnnotateModeView: (p) => { modeViewProps.current = p; return null; } }));
vi.mock('../modes/annotate', () => ({ ClipsSidePanel: (p) => { panelProps.push(p); return <div data-testid="panel" data-hide={String(p.hideLayerFilter)} />; } }));
vi.mock('../components/ShareWithTeammatesModal', () => ({ ShareWithTeammatesModal: () => null }));
vi.mock('../components/SharePlaybackDialog', () => ({ SharePlaybackDialog: () => null }));
vi.mock('../components/UploadPreviewNotice', () => ({ UploadPreviewNotice: () => null }));
vi.mock('../components/shared/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('../components/shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// UnifiedHeader renders the screen's extraControls (where the button lives).
vi.mock('../components/shared/UnifiedHeader', () => ({ UnifiedHeader: (p) => <div data-testid="hdr" data-loading={String(p.isLoadingGameData)}>{p.extraControls}</div> }));
vi.mock('../hooks/useVideo', () => ({ useVideo: () => safeBag() }));
vi.mock('../hooks/useZoom', () => ({ default: () => safeBag() }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => viewport.mobile, useIsLandscape: () => false }));
// Zustand stores are called both as hooks (useStore(selector)) AND statically
// (useStore.getState()), so the mock must be a function WITH getState/setState.
function mkStore() {
  return Object.assign(
    (sel) => (sel ? sel(safeBag()) : safeBag()),
    { getState: () => safeBag(), setState: vi.fn(), subscribe: vi.fn() },
  );
}
vi.mock('../stores/editorStore', () => ({ useEditorStore: mkStore(), EDITOR_MODES: {} }));
vi.mock('../stores/authStore', () => ({ useAuthStore: mkStore() }));
vi.mock('../stores/uploadStore', () => ({
  useUploadStore: mkStore(),
  useActiveUploadBlobUrl: () => null,
  selectActiveUpload: () => null,
}));
vi.mock('../stores/gamesDataStore', () => ({ useGamesDataStore: mkStore() }));
vi.mock('../stores/projectsStore', () => ({ useProjectsStore: mkStore() }));
vi.mock('./ProjectsScreen', () => ({ getPendingGameFile: () => null, getPendingGameDetails: () => null, clearPendingGameFile: vi.fn() }));
vi.mock('../utils/pendingNavigation', () => ({
  hasPendingGame: () => false,
  consumePendingGame: () => null,
  setAnnotateOrigin: () => {},
  clearAnnotateResume: () => {},
}));

import { AnnotateScreen } from './AnnotateScreen';

const PLAYS = [
  { id: 'a', startTime: 10, endTime: 20 },
  { id: 'b', startTime: 50, endTime: 60 },
];

function setContainer(overrides = {}) {
  for (const k of Object.keys(containerState)) delete containerState[k];
  Object.assign(containerState, {
    isGameDataLoading: false,
    annotateGameId: 7,
    hasAnnotateClips: true,
    annotateVideoUrl: 'blob:video',
    annotateSelectedLayer: 'playhead',
    annotateSelectedRegionId: null,
    showAnnotateOverlay: false,
    effectiveCurrentTime: 100,
    effectiveSeek: vi.fn(),
    effectiveSeekBackward: vi.fn(),
    effectiveSeekForward: vi.fn(),
    effectiveTogglePlay: vi.fn(),
    selectAnnotateRegion: vi.fn(),
    clipRegions: PLAYS,
    annotateRegionsWithLayout: PLAYS,
    playback: { isPlaybackMode: false },
    fullTimeline: null,
    ...overrides,
  });
}

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  viewport.mobile = false;
  modeViewProps.current = null;
  panelProps.length = 0;
  setContainer();
});
afterEach(() => cleanup());

const makeUi = () => <AnnotateScreen onClearSelection={() => {}} onModeChange={() => {}} />;
const press = (code, key) => fireEvent.keyDown(document, { code, key });

describe('AnnotateScreen skip keys (T14350)', () => {
  it('playhead layer: Right arrow = forward 5 s, Left arrow = back 5 s', () => {
    render(makeUi());
    press('ArrowRight', 'ArrowRight');
    expect(containerState.effectiveSeekForward).toHaveBeenCalledWith(5);
    press('ArrowLeft', 'ArrowLeft');
    expect(containerState.effectiveSeekBackward).toHaveBeenCalledWith(5);
    expect(containerState.effectiveSeek).not.toHaveBeenCalled();
  });

  it('J / L skip 10 s and K toggles play, on the playhead layer', () => {
    render(makeUi());
    press('KeyL', 'l');
    expect(containerState.effectiveSeekForward).toHaveBeenCalledWith(10);
    press('KeyJ', 'j');
    expect(containerState.effectiveSeekBackward).toHaveBeenCalledWith(10);
    press('KeyK', 'k');
    expect(containerState.effectiveTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('J / L / K also work on the plays layer', () => {
    setContainer({ annotateSelectedLayer: 'clips' });
    render(makeUi());
    press('KeyL', 'L');
    expect(containerState.effectiveSeekForward).toHaveBeenCalledWith(10);
    press('KeyJ', 'J');
    expect(containerState.effectiveSeekBackward).toHaveBeenCalledWith(10);
    press('KeyK', 'K');
    expect(containerState.effectiveTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('plays layer: arrows still jump between marked plays', () => {
    setContainer({ annotateSelectedLayer: 'clips', annotateSelectedRegionId: 'a' });
    render(makeUi());
    press('ArrowRight', 'ArrowRight');
    expect(containerState.selectAnnotateRegion).toHaveBeenCalledWith('b');
    expect(containerState.effectiveSeek).toHaveBeenCalledWith(50);
    expect(containerState.effectiveSeekForward).not.toHaveBeenCalled();
  });

  it('no seek key fires while the play editor is open; K stays play/pause like Space', () => {
    setContainer({ showAnnotateOverlay: true });
    render(makeUi());
    ['ArrowRight', 'ArrowLeft'].forEach((c) => press(c, c));
    press('KeyL', 'l');
    press('KeyJ', 'j');
    expect(containerState.effectiveSeekForward).not.toHaveBeenCalled();
    expect(containerState.effectiveSeekBackward).not.toHaveBeenCalled();
    expect(containerState.effectiveSeek).not.toHaveBeenCalled();
    // Play/pause is the editor's one transport control (T8760), so K keeps it.
    press('KeyK', 'k');
    expect(containerState.effectiveTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('ignores J / K / L with a modifier held (browser shortcuts)', () => {
    render(makeUi());
    fireEvent.keyDown(document, { code: 'KeyL', key: 'l', ctrlKey: true });
    fireEvent.keyDown(document, { code: 'KeyK', key: 'k', metaKey: true });
    expect(containerState.effectiveSeekForward).not.toHaveBeenCalled();
    expect(containerState.effectiveTogglePlay).not.toHaveBeenCalled();
  });

  it('passes the forward skip to the view (buttons and double-tap use it)', () => {
    render(makeUi());
    expect(modeViewProps.current.seekForward).toBe(containerState.effectiveSeekForward);
  });
});
