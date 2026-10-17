import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * The guide is held until the game data has loaded AND the starting playhead +
 * selection have landed (AnnotateContainer isInitialPositionPending), so it never
 * describes the transient "no play selected" state while the video loads. A video
 * that fails to load never lands a position, so it must not hold the guide.
 * Harness reused from AnnotateScreen.firstRun.test.jsx (everything below stubbed).
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

const containerState = { isGameDataLoading: false, isInitialPositionPending: false, annotateGameId: 7, hasAnnotateClips: true };
const videoState = { error: null };
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
// safeBag would return a truthy [] for `error`; the error case needs a real value.
vi.mock('../hooks/useVideo', () => ({ useVideo: () => safeBag({ error: videoState.error }) }));
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
}));

import { AnnotateScreen } from './AnnotateScreen';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.assign(containerState, { isGameDataLoading: false, isInitialPositionPending: false, annotateGameId: 7, hasAnnotateClips: true });
  videoState.error = null;
  viewport.mobile = false;
  modeViewProps.current = null;
  panelProps.length = 0;
});
afterEach(() => cleanup());

const makeUi = () => <AnnotateScreen onClearSelection={() => {}} onModeChange={() => {}} />;

describe('AnnotateScreen guide hold', () => {
  it('holds the guide while the initial position is pending', () => {
    containerState.isInitialPositionPending = true;
    render(makeUi());
    expect(modeViewProps.current.holdGuide).toBe(true);
  });

  it('does not hold for a pending position when the video failed to load', () => {
    containerState.isInitialPositionPending = true;
    videoState.error = 'Failed to load video';
    render(makeUi());
    expect(modeViewProps.current.holdGuide).toBe(false);
  });

  it('releases once the game is loaded and the position has landed', () => {
    render(makeUi());
    expect(modeViewProps.current.holdGuide).toBe(false);
  });

  it('holds while the game data is loading', () => {
    containerState.isGameDataLoading = true;
    render(makeUi());
    expect(modeViewProps.current.holdGuide).toBe(true);
  });
});
