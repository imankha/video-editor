import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

/**
 * T11120 — Route 5 at the AnnotateScreen level: leaving Annotate while EDITING an
 * UNRATED play via the mode bar (UnifiedHeader onModeChange) OR Home/back/breadcrumb
 * (UnifiedHeader onHomeClick) is an EXIT that must be gated. The screen delegates the
 * decision to the container's guardRateThenExit and must NOT navigate
 * (setEditorMode / onModeChange) until the stashed continuation runs — i.e. until a
 * rating is picked.
 *
 * AnnotateScreen is a heavy screen, so it is stubbed the same way as
 * AnnotateScreen.mobileToggle.test.jsx: the container is mocked to a safe bag with
 * the two fields the exit branches read (showAnnotateOverlay + annotateSelectedRegionId)
 * plus a REAL-shaped guardRateThenExit spy that gates (stashes proceed, returns true,
 * never calls proceed) — exactly what the container does for an unrated play. Picking a
 * rating is simulated by invoking that stashed continuation, and we assert the nav then
 * fires. setEditorMode / redirectToMode are stable hoisted spies so their (non-)calls
 * are observable; UnifiedHeader is stubbed to surface onHomeClick / onModeChange.
 */

const H = vi.hoisted(() => {
  const holder = { proceed: null };
  return {
    holder,
    setEditorMode: vi.fn(),
    redirectToMode: vi.fn(),
    selectProject: vi.fn(async (id) => ({ id })),
    // Mirrors the container's guardRateThenExit on an UNRATED play: stash the
    // continuation, open the gate, and tell the caller it was gated (return true).
    guard: vi.fn((regionId, proceed) => { holder.proceed = proceed; return true; }),
  };
});

// Container: safe bag (array-safe defaults; handler-ish -> no-op) with the exit
// branches' inputs + the gating guard. annotateVideoUrl stays a truthy default so
// the screen renders (it returns null when annotateVideoUrl is falsy).
vi.mock('../containers', () => {
  const HANDLER_RE = /^(handle|set|on|get|select|clear|await|lock|unlock|import|update|delete|persist|finish|save|load|fetch|open|close|toggle|add|mark|retry|consume|arm|show|redirect)/;
  const safeBag = (overrides = {}) => new Proxy(overrides, {
    has: () => true,
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      if (HANDLER_RE.test(prop)) return () => {};
      return [];
    },
  });
  return {
    AnnotateContainer: () => safeBag({
      showAnnotateOverlay: true,
      annotateSelectedRegionId: 'p1',
      guardRateThenExit: H.guard,
      fullTimeline: null,
      clipRegions: [
        { id: 'p1', autoProjectId: 11 },
        { id: 'p2', autoProjectId: 22 },
      ],
      annotateRegionsWithLayout: [],
    }),
  };
});

vi.mock('../modes', () => ({ AnnotateModeView: () => null }));
vi.mock('../modes/annotate', () => ({ ClipsSidePanel: () => null }));
vi.mock('../components/ShareWithTeammatesModal', () => ({ ShareWithTeammatesModal: () => null }));
vi.mock('../components/SharePlaybackDialog', () => ({ SharePlaybackDialog: () => null }));
vi.mock('../components/UploadPreviewNotice', () => ({ UploadPreviewNotice: () => null }));
vi.mock('../components/shared/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('../components/shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Surface the two navigation gestures under test as buttons.
vi.mock('../components/shared/UnifiedHeader', () => ({
  UnifiedHeader: (p) => (
    <div data-testid="hdr">
      <button data-testid="home-btn" onClick={() => p.onHomeClick?.()}>home</button>
      <button data-testid="mode-btn" onClick={() => p.onModeChange?.('overlay')}>mode</button>
      {p.extraControls}
    </div>
  ),
}));
vi.mock('../hooks/useVideo', () => ({ useVideo: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock('../hooks/useZoom', () => ({ default: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false }));

function mkStore() {
  const bag = new Proxy({}, {
    has: () => true,
    get(_t, prop) { return typeof prop === 'string' ? () => {} : undefined; },
  });
  return Object.assign((sel) => (sel ? sel(bag) : bag), { getState: () => bag, setState: vi.fn(), subscribe: vi.fn() });
}
// editorStore: stable setEditorMode / redirectToMode spies so nav is observable.
vi.mock('../stores/editorStore', () => {
  const bag = new Proxy({ setEditorMode: H.setEditorMode, redirectToMode: H.redirectToMode }, {
    has: () => true,
    get(target, prop) {
      if (prop in target) return target[prop];
      return typeof prop === 'string' ? () => {} : undefined;
    },
  });
  return {
    useEditorStore: Object.assign((sel) => (sel ? sel(bag) : bag), { getState: () => bag, setState: vi.fn(), subscribe: vi.fn() }),
    EDITOR_MODES: { PROJECT_MANAGER: 'project-manager', FRAMING: 'framing', OVERLAY: 'overlay' },
  };
});
vi.mock('../stores/authStore', () => ({ useAuthStore: mkStore() }));
vi.mock('../stores/uploadStore', () => ({
  useUploadStore: mkStore(),
  useActiveUploadBlobUrl: () => null,
  selectActiveUpload: () => null,
}));
vi.mock('../stores/gamesDataStore', () => ({ useGamesDataStore: mkStore() }));
vi.mock('../stores/projectsStore', () => {
  const bag = {
    projects: [
      { id: 11, has_working_video: true },
      { id: 22, has_working_video: true },
    ],
    selectedProject: null,
    selectProject: H.selectProject,
    fetchProjects: vi.fn(),
  };
  return {
    useProjectsStore: Object.assign((sel) => (sel ? sel(bag) : bag), {
      getState: () => bag,
      setState: vi.fn(),
      subscribe: vi.fn(),
    }),
  };
});
vi.mock('./ProjectsScreen', () => ({ getPendingGameFile: () => null, getPendingGameDetails: () => null, clearPendingGameFile: vi.fn() }));
vi.mock('../utils/pendingNavigation', () => ({ hasPendingGame: () => false, consumePendingGame: () => null }));

import { AnnotateScreen } from './AnnotateScreen';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  H.holder.proceed = null;
  H.guard.mockClear();
  H.setEditorMode.mockClear();
  H.redirectToMode.mockClear();
  H.selectProject.mockClear();
});
afterEach(() => cleanup());

describe('AnnotateScreen — Route 5: mode-bar / Home exit gates on an unrated play (T11120)', () => {
  it('Home/back/breadcrumb click gates (guardRateThenExit) and does NOT navigate until a rating is picked', () => {
    const onClearSelection = vi.fn();
    const onModeChange = vi.fn();
    render(<AnnotateScreen onClearSelection={onClearSelection} onModeChange={onModeChange} />);

    fireEvent.click(screen.getByTestId('home-btn'));

    // Gated on the editing play; navigation withheld.
    expect(H.guard).toHaveBeenCalledTimes(1);
    expect(H.guard.mock.calls[0][0]).toBe('p1');
    expect(typeof H.guard.mock.calls[0][1]).toBe('function');
    expect(H.setEditorMode).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();

    // Picking a rating runs the stashed continuation -> NOW it navigates Home.
    act(() => { H.holder.proceed(); });
    expect(H.setEditorMode).toHaveBeenCalledWith('project-manager');
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('mode-bar change gates, then opens the selected play project rather than the most recent one', async () => {
    const onClearSelection = vi.fn();
    const onModeChange = vi.fn();
    render(<AnnotateScreen onClearSelection={onClearSelection} onModeChange={onModeChange} />);

    fireEvent.click(screen.getByTestId('mode-btn'));

    expect(H.guard).toHaveBeenCalledTimes(1);
    expect(H.guard.mock.calls[0][0]).toBe('p1');
    expect(typeof H.guard.mock.calls[0][1]).toBe('function');
    expect(onModeChange).not.toHaveBeenCalled();

    // Picking a rating runs the stashed continuation -> NOW the mode change fires.
    act(() => { H.holder.proceed(); });
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('overlay'));
    expect(H.selectProject).toHaveBeenCalledWith(11);
    expect(H.selectProject).not.toHaveBeenCalledWith(22);
  });
});
