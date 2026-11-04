import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('../config', () => ({ API_BASE: '' }));

import { ConnectionStatus } from './ConnectionStatus';

// A health check takes real time: settling instantly batches setIsChecking(true/false)
// into no state change, the retry effect never re-runs, and the loop stalls.
const after = (settle) => () => new Promise((resolve, reject) => {
  setTimeout(() => settle(resolve, reject), 50);
});

// Small steps so each act() boundary renders, letting the retry loop run out the
// friendly grace period until the red banner shows.
async function exhaustGracePeriod() {
  for (let i = 0; i < 120; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  }
}

describe('T14530: ConnectionStatus error copy', () => {
  beforeEach(() => { vi.useFakeTimers(); apiFetch.mockReset(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it.each([
    ['a refused connection', after((_ok, fail) => fail(new TypeError('Failed to fetch')))],
    ['a 500', after((ok) => ok({ ok: false, status: 500 }))],
    ['a 502', after((ok) => ok({ ok: false, status: 502 }))],
  ])('T14530:C3 %s reads plainly', async (_name, impl) => {
    apiFetch.mockImplementation(impl);
    render(<ConnectionStatus />);
    await exhaustGracePeriod();
    const banner = screen.getByText(/connect/i);
    expect(banner.textContent).toMatch(/We couldn't connect/);
    expect(banner.textContent).not.toMatch(/backend|server|\d{3}/i);
  });
});
