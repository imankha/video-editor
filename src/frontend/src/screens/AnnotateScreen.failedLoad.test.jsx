import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * T11830 loading placeholder tests reuse this harness.
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

const { selectSpy, redirectSpy, toastErrorSpy } = vi.hoisted(() => ({ selectSpy: vi.fn(), redirectSpy: vi.fn(), toastErrorSpy: vi.fn() }));
const containerState = { isGameDataLoading: false };
vi.mock('../containers', () => ({ AnnotateContainer: () => safeBag({ clipRegions: [], annotateRegionsWithLayout: [], handleGameVideoSelect: selectSpy, annotateVideoUrl: null, ...containerState }) }));
vi.mock('../modes', () => ({ AnnotateModeView: () => null }));
vi.mock('../modes/annotate', () => ({ ClipsSidePanel: () => null }));
vi.mock('../components/ShareWithTeammatesModal', () => ({ ShareWithTeammatesModal: () => null }));
vi.mock('../components/SharePlaybackDialog', () => ({ SharePlaybackDialog: () => null }));
vi.mock('../components/UploadPreviewNotice', () => ({ UploadPreviewNotice: () => null }));
vi.mock('../components/shared/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('../components/shared/Toast', () => ({ toast: { success: vi.fn(), error: toastErrorSpy } }));
// UnifiedHeader renders the screen's extraControls (where the button lives).
vi.mock('../components/shared/UnifiedHeader', () => ({ UnifiedHeader: (p) => <div data-testid="hdr" data-loading={String(p.isLoadingGameData)}>{p.extraControls}</div> }));
vi.mock('../hooks/useVideo', () => ({ useVideo: () => safeBag() }));
vi.mock('../hooks/useZoom', () => ({ default: () => safeBag() }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => true, useIsLandscape: () => false }));
// Zustand stores are called both as hooks (useStore(selector)) AND statically
// (useStore.getState()), so the mock must be a function WITH getState/setState.
function mkStore() {
  return Object.assign(
    (sel) => (sel ? sel(safeBag()) : safeBag()),
    { getState: () => safeBag(), setState: vi.fn(), subscribe: vi.fn() },
  );
}
vi.mock('../stores/editorStore', () => {
  const state = new Proxy({ redirectToMode: redirectSpy }, { has: () => true, get: (t, p) => (p in t ? t[p] : typeof p === 'string' && /^(handle|set|on|get|select|clear|show)/.test(p) ? vi.fn() : []) });
  return { useEditorStore: Object.assign((sel) => (sel ? sel(state) : state), { getState: () => state, setState: vi.fn(), subscribe: vi.fn() }), EDITOR_MODES: { PROJECT_MANAGER: 'project-manager' } };
});
vi.mock('../stores/authStore', () => ({ useAuthStore: mkStore() }));
vi.mock('../stores/uploadStore', () => ({
  useUploadStore: mkStore(),
  useActiveUploadBlobUrl: () => null,
  selectActiveUpload: () => null,
}));
vi.mock('../stores/gamesDataStore', () => ({ useGamesDataStore: mkStore() }));
vi.mock('../stores/projectsStore', () => ({ useProjectsStore: mkStore() }));
vi.mock('./ProjectsScreen', () => ({ getPendingGameFile: () => null, getPendingGameDetails: () => ({ files: [{ file: {}, sequence: 1 }] }), clearPendingGameFile: vi.fn() }));
vi.mock('../utils/pendingNavigation', () => ({
  hasPendingGame: () => false,
  consumePendingGame: () => null,
  setAnnotateOrigin: () => {},
  clearAnnotateResume: () => {},
}));

import { AnnotateScreen } from './AnnotateScreen';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => cleanup());

// T12830: a footage probe failure inside Annotate must land the user on Games
// with a toast, not strand them on a blank screen.
describe('AnnotateScreen failed game load (T12830)', () => {
  it('toasts and redirects to Games when handleGameVideoSelect rejects', async () => {
    selectSpy.mockRejectedValueOnce(new Error('Failed to load video metadata'));
    render(<AnnotateScreen onClearSelection={() => {}} onModeChange={() => {}} />);
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
    expect(redirectSpy).toHaveBeenCalledWith('project-manager');
  });
});
