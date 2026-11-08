import { render, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T15260 (AC2): a URL-driven play open (fromUrl:true) that fails with a non-404 (e.g. a
// 500) clears the selection but used to settle the `pendingProject` breadcrumb only in
// the final `finally`, AFTER `await recoverDeepLink(...)` resolves. App.jsx's URL-normalize
// effect (App.jsx:538) fires off the `selectedProjectId` change and skips the redirect home
// while `hasPendingProject()` is still true -- so the URL stayed on /focus|overlay/p/{id}
// with Home rendered underneath it. This proves `settlePendingProject` now runs in the
// SAME synchronous block as `clearSelection`, before the `recoverDeepLink` await, so a
// breadcrumb reader sees it cleared the moment selection clears.

let capturedOnSelectProjectWithMode = null;

vi.mock('../../components/ProjectManager', () => ({
  ProjectManager: (props) => {
    capturedOnSelectProjectWithMode = props.onSelectProjectWithMode;
    return null;
  },
}));
vi.mock('../../components/PublishedReelsPanel', () => ({ PublishedReelsPanel: () => null }));
vi.mock('../../components/InsufficientCreditsModal', () => ({ InsufficientCreditsModal: () => null }));
vi.mock('../../hooks/useGameUpload', () => ({
  useGameUpload: () => ({ pendingUploads: [], fetchPendingUploads: vi.fn() }),
}));
vi.mock('../../hooks/useProjectLoader', () => ({
  useProjectLoader: () => ({ loadProject: vi.fn() }),
}));
vi.mock('../../stores/uploadStore', () => ({
  useUploadStore: (selector) =>
    selector({
      uploads: [],
      cancelUpload: vi.fn(),
      insufficientCredits: false,
      clearInsufficientCredits: vi.fn(),
    }),
}));
vi.mock('../../services/ExportWebSocketManager', () => ({
  default: { addEventListener: () => () => {} },
}));

const callOrder = vi.hoisted(() => ({ events: [], pendingWhenRecovering: undefined }));

vi.mock('../../utils/deepLinkRecovery', async () => {
  const { hasPendingProject: realHasPendingProject } = await vi.importActual('../../utils/pendingNavigation');
  return {
    recoverDeepLink: vi.fn(async () => {
      callOrder.events.push('recoverDeepLink');
      // The decisive check: by the time this async probe starts, has the breadcrumb
      // already been settled (new code), or is it still sitting there (old code, only
      // cleared in the caller's `finally` AFTER this resolves)?
      callOrder.pendingWhenRecovering = realHasPendingProject();
      return 'unavailable'; // RECOVERY.UNAVAILABLE -- a non-404 failure
    }),
    showUrlLandingNotice: vi.fn(),
    RECOVERY: { SWITCHED: 'switched', MISSING: 'missing', UNAVAILABLE: 'unavailable' },
  };
});

vi.mock('../../components/shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { ProjectsScreen } from '../ProjectsScreen';
import { useProjectsStore } from '../../stores/projectsStore';
import { setPendingProject, hasPendingProject, clearPendingProject } from '../../utils/pendingNavigation';

const PROJECT_ID = 142;

describe('ProjectsScreen: a failed URL-driven project open settles its breadcrumb before recoverDeepLink (T15260)', () => {
  let clearSelectionSpy;
  let originalState;

  beforeEach(() => {
    callOrder.events = [];
    callOrder.pendingWhenRecovering = undefined;
    clearPendingProject();
    originalState = useProjectsStore.getState();
    clearSelectionSpy = vi.fn(() => {
      callOrder.events.push('clearSelection');
    });
    useProjectsStore.setState({
      selectProject: vi.fn().mockResolvedValue(null), // simulates the 500: selectProject resolves no project
      clearSelection: clearSelectionSpy,
      selectedProjectId: PROJECT_ID, // isStillOpening(projectId) must hold through the failed fetch
      projects: [],
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectsStore.setState(originalState, true);
    clearPendingProject();
    vi.restoreAllMocks();
  });

  it('clears the pendingProject breadcrumb synchronously with clearSelection, before awaiting recoverDeepLink', async () => {
    setPendingProject(PROJECT_ID, { mode: 'framing' });
    render(<ProjectsScreen />);

    expect(typeof capturedOnSelectProjectWithMode).toBe('function');

    await act(async () => {
      await capturedOnSelectProjectWithMode(PROJECT_ID, { mode: 'framing', fromUrl: true });
    });

    expect(clearSelectionSpy).toHaveBeenCalled();
    // The breadcrumb must already be settled by the time recoverDeepLink's async probe
    // starts -- i.e. settled in the SAME synchronous block as clearSelection, before the
    // `await`, not only in the caller's `finally` after recoverDeepLink resolves.
    expect(callOrder.pendingWhenRecovering).toBe(false);
    expect(hasPendingProject()).toBe(false);
    expect(callOrder.events.indexOf('clearSelection')).toBeLessThan(callOrder.events.indexOf('recoverDeepLink'));
  });
});
