import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * T11840/T11860 first-run disclosure gating on AnnotateScreen. Reuses the
 * loadingPlaceholder harness (everything below the screen stubbed).
 * Original harness note:
 * T11150 — the mobile plays-drawer header button (AnnotateScreen, gated by
 * useMobileClipPanel = isMobile && !isLandscape) must use Highlight-flow
 * vocabulary: title="Show plays", never "Show clips". Red on base 48605465
 * (title="Show clips"), green after the fix.
 *
 * AnnotateScreen is a heavy screen (AnnotateContainer + useVideo + many stores),
 * so everything below the screen is stubbed: UnifiedHeader is stubbed to render
 * its `extraControls` (where the button lives), the container/hooks/stores return
 * array-safe proxies so the screen's render-path memos (which .map/.forEach over
 * clipRegions / annotateRegionsWithLayout) don't throw. isMobile=true +
 * isLandscape=false makes the mobile drawer toggle render.
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

const containerState = { isGameDataLoading: false, annotateGameId: 7, hasAnnotateClips: false };
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
}));

import { AnnotateScreen } from './AnnotateScreen';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.assign(containerState, { isGameDataLoading: false, annotateGameId: 7, hasAnnotateClips: false });
  viewport.mobile = false;
  modeViewProps.current = null;
  panelProps.length = 0;
});
afterEach(() => cleanup());

const makeUi = () => <AnnotateScreen onClearSelection={() => {}} onModeChange={() => {}} />;

describe('AnnotateScreen first-run gating (T11860 / T11840)', () => {
  it('is NOT first-run before any game is identified (first-commit flash)', () => {
    containerState.annotateGameId = null;
    render(makeUi());
    expect(modeViewProps.current.isFirstRun).toBe(false);
    expect(modeViewProps.current.simplifiedControls).toBe(false);
  });

  it('does not apply first-run while the game data is loading', () => {
    containerState.isGameDataLoading = true;
    render(makeUi());
    expect(modeViewProps.current.isFirstRun).toBe(false);
    expect(modeViewProps.current.simplifiedControls).toBe(false);
  });

  it('applies first-run once the game has loaded with 0 plays', () => {
    render(makeUi());
    expect(modeViewProps.current.isFirstRun).toBe(true);
    expect(modeViewProps.current.simplifiedControls).toBe(true);
  });

  it('a game with plays is never first-run', () => {
    containerState.hasAnnotateClips = true;
    render(makeUi());
    expect(modeViewProps.current.isFirstRun).toBe(false);
    expect(modeViewProps.current.simplifiedControls).toBe(false);
  });

  it('latches: after the first play, deleting the last one keeps the chrome revealed', () => {
    const { rerender } = render(makeUi());
    expect(modeViewProps.current.simplifiedControls).toBe(true);
    containerState.hasAnnotateClips = true;
    rerender(makeUi());
    containerState.hasAnnotateClips = false;
    rerender(makeUi());
    expect(modeViewProps.current.isFirstRun).toBe(true);
    expect(modeViewProps.current.simplifiedControls).toBe(false);
  });

  it('desktop ClipsSidePanel gets hideLayerFilter while simplified, and not after the latch', () => {
    const { rerender } = render(makeUi());
    expect(screen.getByTestId('panel').getAttribute('data-hide')).toBe('true');
    containerState.hasAnnotateClips = true;
    rerender(makeUi());
    expect(screen.getByTestId('panel').getAttribute('data-hide')).toBe('false');
  });

  it('the phone drawer ClipsSidePanel gets hideLayerFilter too', () => {
    viewport.mobile = true;
    render(makeUi());
    fireEvent.click(screen.getByTitle('Show plays'));
    const panels = screen.getAllByTestId('panel');
    expect(panels.length).toBeGreaterThan(0);
    panels.forEach((p) => expect(p.getAttribute('data-hide')).toBe('true'));
  });
});
