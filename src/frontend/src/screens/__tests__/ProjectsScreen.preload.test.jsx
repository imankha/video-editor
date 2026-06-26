import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Track which editor-screen chunks get dynamically imported. The hoisted tracker lets the
// vi.mock factories (hoisted above imports) record loads. A dynamic-import cache means a
// given chunk's factory only runs on its first import in the file, so cross-test load
// assertions live in the first test that triggers the real default importers.
const tracker = vi.hoisted(() => ({ loaded: [] }));

vi.mock('../AnnotateScreen', () => {
  tracker.loaded.push('annotate');
  return { AnnotateScreen: () => null };
});
vi.mock('../FramingScreen', () => {
  tracker.loaded.push('framing');
  return { FramingScreen: () => null };
});
vi.mock('../OverlayScreen', () => {
  tracker.loaded.push('overlay');
  return { OverlayScreen: () => null };
});

// Stub the heavy children / side-effectful hooks so ProjectsScreen mounts without hitting
// the network. The test only exercises the idle-preload wiring.
vi.mock('../../components/ProjectManager', () => ({ ProjectManager: () => null }));
vi.mock('../../components/DownloadsPanel', () => ({ DownloadsPanel: () => null }));
vi.mock('../../hooks/useGameUpload', () => ({
  useGameUpload: () => ({ pendingUploads: [], fetchPendingUploads: vi.fn() }),
}));
vi.mock('../../hooks/useProjectLoader', () => ({
  useProjectLoader: () => ({ loadProject: vi.fn() }),
}));
vi.mock('../../services/ExportWebSocketManager', () => ({
  default: { addEventListener: () => () => {} },
}));

import { ProjectsScreen, preloadEditorScreens } from '../ProjectsScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('preloadEditorScreens', () => {
  it('imports every lazy editor screen chunk', async () => {
    // First test to trigger the real default importers — records all three loads.
    // Generous timeout: this exercises real dynamic import() which is slow when the
    // shared Vite transform server is contended during the full parallel suite.
    await preloadEditorScreens();
    expect(tracker.loaded).toContain('annotate');
    expect(tracker.loaded).toContain('framing');
    expect(tracker.loaded).toContain('overlay');
  }, 30000);

  it('swallows a rejected preload without throwing and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A purged chunk rejects on import; preloadEditorScreens must still resolve.
    await expect(
      preloadEditorScreens([
        () => Promise.resolve({}),
        () => Promise.reject(new Error('chunk purged')),
      ])
    ).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('ProjectsScreen idle preload', () => {
  let idleCallbacks;

  beforeEach(() => {
    idleCallbacks = [];
    // Capture the scheduled idle callback instead of waiting for real browser idle.
    window.requestIdleCallback = vi.fn((cb) => {
      idleCallbacks.push(cb);
      return 1;
    });
    window.cancelIdleCallback = vi.fn();
  });

  afterEach(() => {
    delete window.requestIdleCallback;
    delete window.cancelIdleCallback;
  });

  it('schedules an idle editor-screen preload on mount', () => {
    render(<ProjectsScreen />);

    // Mount schedules exactly one idle preload, and the scheduled work is the
    // preload (a function returning a promise). We don't await the real dynamic
    // import here — that timing is covered by the preloadEditorScreens test and is
    // slow under full-suite transform contention.
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
    const scheduled = idleCallbacks[0];
    expect(typeof scheduled).toBe('function');
    const result = scheduled();
    expect(typeof result.then).toBe('function');
    result.catch(() => {}); // swallow the floating preload promise
  });

  it('cancels the scheduled idle preload on unmount', () => {
    const { unmount } = render(<ProjectsScreen />);
    expect(() => unmount()).not.toThrow();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(1);
  });
});
