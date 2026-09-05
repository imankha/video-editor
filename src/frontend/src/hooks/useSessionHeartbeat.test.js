import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// apiFetch is the heartbeat's write path -- mock it so we can assert whether a
// tick actually pinged the server.
vi.mock('../utils/apiFetch', () => ({ default: vi.fn(() => Promise.resolve()) }));
// The hook only wires up while authenticated; force that on.
vi.mock('../stores/authStore', () => ({ useIsAuthenticated: () => true }));

import apiFetch from '../utils/apiFetch';
import { useSessionHeartbeat } from './useSessionHeartbeat';

const HEARTBEAT_INTERVAL_MS = 60_000;
const INTERACTION_WINDOW_MS = 90_000;

/** Assert exactly the heartbeat endpoint (not session-close) was POSTed. */
function heartbeatCalls() {
  return apiFetch.mock.calls.filter(([url]) => url.endsWith('/api/auth/heartbeat'));
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function fireInteraction() {
  window.dispatchEvent(new Event('mousemove'));
}

describe('useSessionHeartbeat interaction-recency gate (T8920)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the 60s heartbeat when interaction happened recently', () => {
    renderHook(() => useSessionHeartbeat());

    // Simulate a user gesture just before the tick. Advance past the throttle
    // window first so the stamp actually records, then interact.
    vi.advanceTimersByTime(2_000);
    fireInteraction();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(heartbeatCalls()).toHaveLength(1);
  });

  it('WITHHOLDS the 60s heartbeat when no interaction happened within the window', () => {
    renderHook(() => useSessionHeartbeat());

    // The mount stamp keeps the FIRST tick (60s) inside the window; let it pass,
    // then clear and assert every subsequent tick is withheld once the stamp
    // has gone stale (no simulated events).
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(heartbeatCalls()).toHaveLength(1); // mount-stamped first tick fires
    apiFetch.mockClear();

    // t=120s and t=180s ticks: both past the 90s window from the mount stamp.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);

    expect(heartbeatCalls()).toHaveLength(0);
  });

  it('fires the very first heartbeat because mount counts as interaction', () => {
    renderHook(() => useSessionHeartbeat());

    // Tick lands at 60s -- inside the 90s window from the mount stamp, no
    // explicit interaction needed.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(heartbeatCalls()).toHaveLength(1);
  });

  it('visibility-regain path fires when interaction is recent', () => {
    renderHook(() => useSessionHeartbeat());

    vi.advanceTimersByTime(2_000);
    fireInteraction();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    apiFetch.mockClear();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(heartbeatCalls()).toHaveLength(1);
  });

  it('visibility-regain path is WITHHELD when interaction is stale', () => {
    renderHook(() => useSessionHeartbeat());

    // Go stale, hide, then return -- the regain ping must respect the gate.
    vi.advanceTimersByTime(INTERACTION_WINDOW_MS + 5_000);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    apiFetch.mockClear();

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(heartbeatCalls()).toHaveLength(0);
  });

  it('tab-close beacon fires on hide regardless of interaction recency', () => {
    const sendBeacon = vi.fn();
    // Some jsdom builds omit sendBeacon; define it either way.
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: sendBeacon,
    });

    renderHook(() => useSessionHeartbeat());

    // Deliberately stale -- the new gate must NOT leak into the close path.
    vi.advanceTimersByTime(INTERACTION_WINDOW_MS + 5_000);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toMatch(/\/api\/auth\/session-close$/);
  });
});
