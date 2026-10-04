import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/**
 * T11430 fixround2 MAJOR: pins the fixround1 cross-layer guard in
 * AnnotateScreen's mode-switch handler. games.py no longer force-NULLs
 * auto_project_id for an archived (published) project, so this "active draft"
 * hint can point at a FROZEN published project whose working_clips were deleted
 * at publish; opening it in Framing/Overlay would be a broken editor. The
 * handler must BAIL (no selectProject, no onModeChange) when the pointed
 * instance is published. Removing that bail must make this test fail.
 *
 * Harness mirrors AnnotateScreen.rateGate.test.jsx, but the selected play (p1)
 * carries a highlight_instance for its autoProjectId that is PUBLISHED.
 */

const H = vi.hoisted(() => {
  const holder = { proceed: null };
  return {
    holder,
    setEditorMode: vi.fn(),
    redirectToMode: vi.fn(),
    selectProject: vi.fn(async (id) => ({ id })),
    // Gate like an unrated play: stash the continuation, return true. We invoke
    // the stashed proceed() manually to drive the post-gate mode-switch branch.
    guard: vi.fn((regionId, proceed) => { holder.proceed = proceed; return true; }),
  };
});

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
        // p1's active-draft hint points at project 11, which is PUBLISHED.
        { id: 'p1', autoProjectId: 11, highlightInstances: [{ projectId: 11, isPublished: true }] },
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
vi.mock('../components/shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../components/shared/UnifiedHeader', () => ({
  UnifiedHeader: (p) => (
    <div data-testid="hdr">
      <button data-testid="mode-btn" onClick={() => p.onModeChange?.('framing')}>mode</button>
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
    projects: [{ id: 11, has_working_video: true }, { id: 22, has_working_video: true }],
    selectedProject: null,
    selectProject: H.selectProject,
    fetchProjects: vi.fn(),
  };
  return {
    useProjectsStore: Object.assign((sel) => (sel ? sel(bag) : bag), {
      getState: () => bag, setState: vi.fn(), subscribe: vi.fn(),
    }),
  };
});
vi.mock('./ProjectsScreen', () => ({ getPendingGameFile: () => null, getPendingGameDetails: () => null, clearPendingGameFile: vi.fn() }));
vi.mock('../utils/pendingNavigation', () => ({
  hasPendingGame: () => false,
  consumePendingGame: () => null,
  setAnnotateOrigin: () => {},
}));

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

describe('AnnotateScreen — mode-switch bails on a published instance (T11430 fixround2)', () => {
  it('switching to framing when autoProjectId points at a PUBLISHED instance opens nothing', async () => {
    const onModeChange = vi.fn();
    render(<AnnotateScreen onClearSelection={vi.fn()} onModeChange={onModeChange} />);

    fireEvent.click(screen.getByTestId('mode-btn'));
    // Gate stashed the continuation; run it (simulate rating picked).
    act(() => { H.holder.proceed?.(); });

    // The pointed instance is published -> the handler bails: neither the
    // project open nor the mode change fires.
    expect(H.selectProject).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
