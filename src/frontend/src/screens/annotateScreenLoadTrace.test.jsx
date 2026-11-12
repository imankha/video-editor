import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * T16050:C1 - AnnotateScreen wires the [LOAD] trace (src/utils/loadTrace.js)
 * to its game-load state, started when a pending-game breadcrumb is consumed
 * (the gesture that fires /games/{id}/load). Reuses the lightweight
 * AnnotateScreen.loadingPlaceholder.test.jsx harness: everything below the
 * screen is stubbed with a safe proxy so the screen's render-path memos don't
 * throw, and the container's return value is driven via mutable containerState
 * so a rerender can move the trace through its needs.
 */

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

const containerState = {
  isGameDataLoading: true,
  annotateGameId: null,
  annotateVideoUrl: null,
  annotateSourceExpired: false,
};

vi.mock('../containers', () => ({
  AnnotateContainer: () => safeBag({ clipRegions: [], annotateRegionsWithLayout: [], ...containerState }),
}));
vi.mock('../modes', () => ({ AnnotateModeView: () => null }));
vi.mock('../modes/annotate', () => ({ ClipsSidePanel: () => null }));
vi.mock('../components/ShareWithTeammatesModal', () => ({ ShareWithTeammatesModal: () => null }));
vi.mock('../components/SharePlaybackDialog', () => ({ SharePlaybackDialog: () => null }));
vi.mock('../components/UploadPreviewNotice', () => ({ UploadPreviewNotice: () => null }));
vi.mock('../components/shared/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('../components/shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/shared/UnifiedHeader', () => ({ UnifiedHeader: () => null }));
vi.mock('../hooks/useVideo', () => ({ useVideo: () => safeBag() }));
vi.mock('../hooks/useZoom', () => ({ default: () => safeBag() }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false }));
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

let pendingGameOnce = null;
vi.mock('../utils/pendingNavigation', () => ({
  hasPendingGame: () => false,
  consumePendingGame: () => {
    const p = pendingGameOnce;
    pendingGameOnce = null;
    return p;
  },
  setAnnotateOrigin: () => {},
  clearAnnotateResume: () => {},
}));

import { AnnotateScreen } from './AnnotateScreen';

function infoLines() {
  return console.info.mock.calls.map((args) => args.join(' '));
}

beforeEach(() => {
  global.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
  pendingGameOnce = { gameId: 5, seekTime: null, sourceClipId: null };
  containerState.isGameDataLoading = true;
  containerState.annotateGameId = null;
  containerState.annotateVideoUrl = null;
  containerState.annotateSourceExpired = false;
  vi.spyOn(console, 'info').mockImplementation(() => { });
  vi.spyOn(console, 'warn').mockImplementation(() => { });
  vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderScreen = () => render(<AnnotateScreen onClearSelection={() => { }} onModeChange={() => { }} />);

describe('T16050 AnnotateScreen [LOAD] trace wiring', () => {
  it('T16050:C1 logs one [LOAD] Annotate waiting-for line naming game/video on a pending-game open', () => {
    renderScreen();

    const waitingLines = infoLines().filter((l) => l.includes('[LOAD] Annotate waiting for'));
    expect(waitingLines).toHaveLength(1);
    expect(waitingLines[0]).toContain('game, video');
    expect(waitingLines[0]).toContain('gameId=5');
  });

  it('logs game and video arrived, then settles, once the load resolves', () => {
    const { rerender } = renderScreen();

    containerState.isGameDataLoading = false;
    containerState.annotateGameId = 5;
    containerState.annotateVideoUrl = 'https://cdn.example.com/game.mp4';
    rerender(<AnnotateScreen onClearSelection={() => { }} onModeChange={() => { }} />);

    expect(infoLines().some((l) => l.includes('[LOAD] Annotate game arrived'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Annotate video arrived'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Annotate settled in'))).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('T16050 logs a failed video line when the source expires before the video resolves', () => {
    const { rerender } = renderScreen();

    containerState.isGameDataLoading = false;
    containerState.annotateGameId = 5;
    containerState.annotateSourceExpired = true;
    rerender(<AnnotateScreen onClearSelection={() => { }} onModeChange={() => { }} />);

    expect(infoLines().some((l) => l.includes('[LOAD] Annotate video failed'))).toBe(true);
  });
});
