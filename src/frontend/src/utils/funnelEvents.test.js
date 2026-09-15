import { describe, it, expect, vi, beforeEach } from 'vitest';

// T10010: unit-test the activation-funnel beacon transport in isolation — mock
// config, apiFetch, and the auth store it reads (same pattern as uiTelemetry).
vi.mock('../config', () => ({ API_BASE: 'https://api.test' }));
const apiFetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

let impersonator = null;
vi.mock('../stores/authStore.js', () => ({
  useAuthStore: { getState: () => ({ impersonator }) },
}));

import {
  recordFunnelEvent,
  FUNNEL_EVENTS,
  computeViewed,
  viewedThresholdSeconds,
} from './funnelEvents';

describe('computeViewed (viewed convention, NOT satisfaction)', () => {
  it.each([
    [2, 6, true],    // >= 2s on a long clip
    [1.9, 6, false], // just under 2s
    [2, 4, true],    // exactly at the long-clip boundary
    [1.6, 3, true],  // short clip: >= 50%
    [1.4, 3, false], // short clip: < 50%
    [5, 0, false],   // unknown/zero duration is never viewed
    [-1, 6, false],  // nonsense playback position
  ])('computeViewed(%s, %s) === %s', (watched, duration, expected) => {
    expect(computeViewed(watched, duration)).toBe(expected);
  });
});

describe('viewedThresholdSeconds', () => {
  it('is 2s for a clip long enough to afford it', () => {
    expect(viewedThresholdSeconds(6)).toBe(2);
  });
  it('is 50% of a short clip', () => {
    expect(viewedThresholdSeconds(3)).toBe(1.5);
  });
  it('is 0 (skip the beacon) for an unknown/zero duration', () => {
    expect(viewedThresholdSeconds(0)).toBe(0);
    expect(viewedThresholdSeconds(undefined)).toBe(0);
  });
});

describe('recordFunnelEvent', () => {
  beforeEach(() => { apiFetchMock.mockClear(); impersonator = null; });

  it('POSTs a known event to the funnel-event endpoint with its context', () => {
    recordFunnelEvent(FUNNEL_EVENTS.RESULT_OPENED, { result_id: 'r1', entry_route: 'my_reels' });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/telemetry/funnel-event');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(opts.rbNonDataWrite).toBe(true);
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('result_opened');
    expect(body.context).toEqual({ result_id: 'r1', entry_route: 'my_reels' });
  });

  it('drops an unknown event before it ever leaves the browser', () => {
    recordFunnelEvent('totally_made_up_event', { result_id: 'r1' });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing while impersonating (zero footprint)', () => {
    impersonator = 'admin-123';
    recordFunnelEvent(FUNNEL_EVENTS.DRAFT_SAVED, { project_id: 'p1' });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('never throws even if apiFetch rejects (fire-and-forget)', () => {
    apiFetchMock.mockImplementationOnce(() => Promise.reject(new Error('down')));
    expect(() => recordFunnelEvent(FUNNEL_EVENTS.PREVIEW_STARTED, {})).not.toThrow();
  });

  it('carries only coarse ids/durations — callers pass no PII', () => {
    // The util is a dumb transport; the guardrail is that call sites pass IDs
    // only. This pins the contract that a result_viewed beacon carries the
    // numbers the server needs to re-validate the view, nothing else.
    recordFunnelEvent(FUNNEL_EVENTS.RESULT_VIEWED, {
      result_id: 'r1', watched_seconds: 2, duration_seconds: 6,
    });
    const body = JSON.parse(apiFetchMock.mock.calls.at(-1)[1].body);
    expect(Object.keys(body.context).sort()).toEqual(
      ['duration_seconds', 'result_id', 'watched_seconds'],
    );
  });
});
