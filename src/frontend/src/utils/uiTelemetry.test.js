import { describe, it, expect, vi, beforeEach } from 'vitest';

// T7515: unit-test the frustration-signal frontend transport in isolation —
// mock config, apiFetch, and the two stores it reads.
vi.mock('../config', () => ({ API_BASE: 'https://api.test' }));
const apiFetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

let impersonator = null;
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: { getState: () => ({ impersonator }) },
}));

let editorMode = 'annotate';
const subscribers = [];
vi.mock('../stores/editorStore.js', () => ({
  useEditorStore: {
    getState: () => ({ editorMode }),
    subscribe: (fn) => { subscribers.push(fn); return () => {}; },
  },
  EDITOR_MODES: {
    FRAMING: 'framing', OVERLAY: 'overlay', ANNOTATE: 'annotate',
    PROJECT_MANAGER: 'project-manager', ADMIN: 'admin',
  },
}));

import { recordUiImpression, installSessionBreadcrumbs } from './uiTelemetry';

describe('recordUiImpression (tier 3)', () => {
  beforeEach(() => { apiFetchMock.mockClear(); impersonator = null; });

  it('POSTs the impression to the telemetry endpoint', () => {
    recordUiImpression('dialog', 'Tag not submitted');
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/telemetry/impression');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.kind).toBe('dialog');
    expect(body.name).toBe('Tag not submitted');
    expect(body.session_count).toBe(1);
  });

  it('increments the per-session count for a repeated impression', () => {
    recordUiImpression('toast', 'Save failed');
    recordUiImpression('toast', 'Save failed');
    const last = JSON.parse(apiFetchMock.mock.calls.at(-1)[1].body);
    expect(last.session_count).toBe(2);
  });

  it('sends nothing while impersonating (zero footprint)', () => {
    impersonator = 'admin-123';
    recordUiImpression('dialog', 'Tag not submitted');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('ignores a blank name', () => {
    recordUiImpression('toast', '');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('never throws even if apiFetch rejects (fire-and-forget)', () => {
    apiFetchMock.mockImplementationOnce(() => Promise.reject(new Error('down')));
    expect(() => recordUiImpression('dialog', 'X')).not.toThrow();
  });
});

describe('installSessionBreadcrumbs (tier 4)', () => {
  it('flushes a screen trail on pagehide via sendBeacon', () => {
    const beacon = vi.fn(() => true);
    const origBeacon = navigator.sendBeacon;
    navigator.sendBeacon = beacon;
    try {
      editorMode = 'project-manager';
      installSessionBreadcrumbs();
      // Simulate navigation gestures the store would emit.
      editorMode = 'annotate';
      subscribers.forEach((fn) => fn({ editorMode }));
      editorMode = 'framing';
      subscribers.forEach((fn) => fn({ editorMode }));

      window.dispatchEvent(new Event('pagehide'));

      expect(beacon).toHaveBeenCalledTimes(1);
      const [url, blob] = beacon.mock.calls[0];
      expect(url).toBe('https://api.test/api/telemetry/session-breadcrumbs');
      expect(blob.type).toBe('application/json');
    } finally {
      navigator.sendBeacon = origBeacon;
    }
  });

  it('does NOT re-send already-flushed crumbs after a resume (no duplicate trail)', () => {
    // Continues from the module state left by the prior flush test (breadcrumbs
    // are installed once; the buffer was reset on that flush). This pins the
    // reset-after-flush fix: a hidden -> resumed -> re-hidden tab must send only
    // the crumbs accrued AFTER the resume, never the whole trail again. Drop
    // sendBeacon so the flush takes the apiFetch fallback, whose body (a plain
    // JSON string) is inspectable — jsdom's Blob has no .text().
    const origBeacon = navigator.sendBeacon;
    navigator.sendBeacon = undefined;
    apiFetchMock.mockClear();
    const setVisibility = (v) =>
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    try {
      // Tab returns to the foreground -> re-arms the flush guard.
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));

      // User navigates to ONE new screen after resuming.
      editorMode = 'overlay';
      subscribers.forEach((fn) => fn({ editorMode }));

      // Hidden again -> flush #2 carries ONLY the post-resume crumb.
      window.dispatchEvent(new Event('pagehide'));

      const call = apiFetchMock.mock.calls.find(
        ([url]) => url === 'https://api.test/api/telemetry/session-breadcrumbs',
      );
      expect(call).toBeTruthy();
      const payload = JSON.parse(call[1].body);
      expect(payload.trail).toEqual(['overlay']);
      expect(payload.trail).not.toContain('framing');         // already sent in flush #1
      expect(payload.trail).not.toContain('project-manager');  // already sent in flush #1
      expect(payload.last_screen).toBe('overlay');
    } finally {
      navigator.sendBeacon = origBeacon;
    }
  });
});
