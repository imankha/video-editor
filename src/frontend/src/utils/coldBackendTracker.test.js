import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config', () => ({ API_BASE: 'https://reel-ballers-api-staging.fly.dev' }));

import {
  recordHealthCheck,
  getColdBackendNote,
  __resetColdBackendTrackerForTest,
} from './coldBackendTracker';

// T16060: staging's backend sleeps when idle; the first health check after a
// pause fails or is slow, then later checks succeed once it wakes. Requests
// that fail/slow in that window should carry a note; outside it, none.
describe('T16060: coldBackendTracker', () => {
  beforeEach(() => {
    __resetColdBackendTrackerForTest();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('T16060:C1 notes a request in the window after a failed first check then healthy', () => {
    recordHealthCheck({ isFirstCheck: true, ok: false, elapsedMs: 10000 });
    vi.setSystemTime(12000);
    recordHealthCheck({ isFirstCheck: false, ok: true, elapsedMs: 50 });
    // backend became healthy at t=12000, after 12000ms since the first failure
    const note = getColdBackendNote(12500);
    expect(note).toMatch(/COLD BACKEND/);
    expect(note).toMatch(/healthy after 12s/);
  });

  it('T16060:C1 notes a request when the first check itself is just slow (no failure)', () => {
    recordHealthCheck({ isFirstCheck: true, ok: true, elapsedMs: 3000 });
    const note = getColdBackendNote(1000);
    expect(note).toMatch(/COLD BACKEND/);
  });

  it('T16060:C2 does not note a request on a warm backend (fast first check)', () => {
    recordHealthCheck({ isFirstCheck: true, ok: true, elapsedMs: 100 });
    const note = getColdBackendNote(50);
    expect(note).toBeNull();
  });

  it('T16060:C2 does not note a request outside the grace window', () => {
    recordHealthCheck({ isFirstCheck: true, ok: false, elapsedMs: 5000 });
    vi.setSystemTime(5000);
    recordHealthCheck({ isFirstCheck: false, ok: true, elapsedMs: 50 });
    // grace period is 15s past healthy (t=5000) -> t=20000
    const note = getColdBackendNote(25000);
    expect(note).toBeNull();
  });
});

describe('T16060:C3 production gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('never notes when API_BASE is the production backend', async () => {
    vi.doMock('../config', () => ({ API_BASE: 'https://reel-ballers-api.fly.dev' }));
    const prodTracker = await import('./coldBackendTracker');
    prodTracker.__resetColdBackendTrackerForTest();
    prodTracker.recordHealthCheck({ isFirstCheck: true, ok: false, elapsedMs: 10000 });
    prodTracker.recordHealthCheck({ isFirstCheck: false, ok: true, elapsedMs: 50 });
    expect(prodTracker.getColdBackendNote(0)).toBeNull();
  });
});
