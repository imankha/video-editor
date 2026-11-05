// T15100: the viewer's country rides in campaignParams beside the utm fields.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureCampaignParams } from './campaignCapture';

const stored = () => JSON.parse(sessionStorage.getItem('campaignParams'));
const capture = (search = '') => captureCampaignParams(search, '', 'app.reelballers.com');
const geoAnswers = (country) => ({ ok: true, json: async () => ({ country }) });

describe('country capture', () => {
  let fetchMock;
  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(geoAnswers('US'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the country on an organic visit with no attribution', async () => {
    capture();
    await vi.waitFor(() => expect(stored()).toEqual({ country: 'US' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/geo');
  });

  it('keeps the attribution captured while the request was in flight', async () => {
    capture('?utm_source=meta');
    await vi.waitFor(() => expect(stored()).toEqual({ utm_source: 'meta', country: 'US' }));
  });

  it('asks once per tab', async () => {
    capture();
    await vi.waitFor(() => expect(stored()).toEqual({ country: 'US' }));
    capture();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a stored country does not block a later referral link in the same tab', async () => {
    capture();
    await vi.waitFor(() => expect(stored()).toEqual({ country: 'US' }));
    capture('?ref=abc12345&utm_source=share_endcard');
    expect(stored()).toEqual({ ref: 'abc12345', utm_source: 'share_endcard', country: 'US' });
  });

  it('first-touch attribution still wins over a later link', async () => {
    sessionStorage.setItem('campaignParams', JSON.stringify({ utm_source: 'first' }));
    capture('?utm_source=second');
    await vi.waitFor(() => expect(stored()).toEqual({ utm_source: 'first', country: 'US' }));
  });

  it.each([
    ['local dev 404', () => Promise.resolve({ ok: false, json: async () => ({ detail: 'Not Found' }) })],
    ['an HTML fallback page', () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('<'); } })],
    ['a network failure', () => Promise.reject(new TypeError('failed'))],
    ['a null country', () => Promise.resolve(geoAnswers(null))],
  ])('stores nothing on %s', async (_name, answer) => {
    fetchMock.mockImplementation(answer);
    capture();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve));
    expect(stored()).toBeNull();
  });
});
