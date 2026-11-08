/**
 * T7410: app-side first-party visit beacon (sendVisitBeacon) and the
 * click-id-key priority helper it shares with campaignCapture's naming
 * convention (firstClickIdKey picks the raw param NAME, never a resolved
 * network name -- see analytics.js module comment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendVisitBeacon } from './analytics';
import { firstClickIdKey } from './campaignCapture';

describe('firstClickIdKey', () => {
  it('returns the first present click-id key in priority order', () => {
    expect(firstClickIdKey('?utm_source=instagram&fbclid=abc')).toBe('fbclid');
    expect(firstClickIdKey('?gclid=xyz')).toBe('gclid');
    expect(firstClickIdKey('?fbclid=a&gclid=b')).toBe('fbclid');
  });

  it('returns null when no click id is present', () => {
    expect(firstClickIdKey('?utm_source=instagram')).toBeNull();
  });
});

describe('sendVisitBeacon', () => {
  let sendBeaconMock;

  beforeEach(() => {
    sendBeaconMock = vi.fn(() => true);
    navigator.sendBeacon = sendBeaconMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete navigator.sendBeacon;
  });

  it('posts page_class + the raw click_id key, never a resolved network name', () => {
    sendVisitBeacon('app', '?utm_source=instagram&fbclid=abc', '');
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeaconMock.mock.calls[0];
    expect(url).toMatch(/\/api\/t$/);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    delete navigator.sendBeacon;
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchMock;

    sendVisitBeacon('share', '', '');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/t$/);
    const body = JSON.parse(opts.body);
    expect(body.page_class).toBe('share');
    expect(body.click_id).toBeNull();
  });
});
