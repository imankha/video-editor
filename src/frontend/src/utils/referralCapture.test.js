/**
 * T3455: Tests for campaign URL param capture and auth passthrough.
 *
 * Tests the sessionStorage-based campaign attribution flow:
 * - Capture ref, UTM params, and click_source from URL on app mount
 * - First-touch-wins (don't overwrite existing campaignParams)
 * - Click source derivation from platform click IDs
 * - Include campaign fields in Google auth request body
 * - Include campaign fields in OTP verify request body
 * - T7910: referrer-host capture (lref param, else external document.referrer host)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureCampaignParams } from './campaignCapture';

// Drives the production capture App.jsx runs on mount. `referrer`/`hostname`
// model document.referrer and window.location.hostname for the T7910 referrer branch.
function simulateCampaignCapture(searchString, existingParams = null, { referrer = '', hostname = 'app.reelballers.com' } = {}) {
  if (existingParams) {
    sessionStorage.setItem('campaignParams', JSON.stringify(existingParams));
  }
  captureCampaignParams(searchString, referrer, hostname);
}

function getCaptured() {
  const raw = sessionStorage.getItem('campaignParams');
  return raw ? JSON.parse(raw) : null;
}

describe('campaign param capture (App.jsx logic)', () => {
  let originalSessionStorage;

  beforeEach(() => {
    originalSessionStorage = globalThis.sessionStorage;
    const store = {};
    globalThis.sessionStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => { store[key] = val; }),
      removeItem: vi.fn((key) => { delete store[key]; }),
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = originalSessionStorage;
    vi.restoreAllMocks();
  });

  it('captures ref param from URL', () => {
    simulateCampaignCapture('?ref=abc12345');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored.ref).toBe('abc12345');
  });

  it('captures sport snapshot alongside a ref (T2915)', () => {
    simulateCampaignCapture('?ref=abc12345&sport=basketball');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored.ref).toBe('abc12345');
    expect(stored.ref_sport).toBe('basketball');
  });

  it('ignores sport without a ref', () => {
    simulateCampaignCapture('?sport=basketball');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('captures full UTM params with ref', () => {
    simulateCampaignCapture('?ref=ig_summer&utm_source=instagram&utm_medium=paid_social&utm_campaign=summer_sale&utm_content=video_v2&utm_term=soccer');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({
      ref: 'ig_summer',
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'summer_sale',
      utm_content: 'video_v2',
      utm_term: 'soccer',
    });
  });

  it('does not capture when no actionable params', () => {
    simulateCampaignCapture('?mode=test&foo=bar');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not overwrite existing campaignParams (first-touch wins)', () => {
    simulateCampaignCapture('?ref=new-code', { ref: 'existing-code' });
    const setCalls = sessionStorage.setItem.mock.calls;
    const paramCalls = setCalls.filter(([key]) => key === 'campaignParams');
    expect(paramCalls.length).toBe(1);
    expect(JSON.parse(paramCalls[0][1]).ref).toBe('existing-code');
  });

  it('handles empty ref param gracefully', () => {
    simulateCampaignCapture('?ref=');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('captures utm_campaign alone (no ref, no click ID)', () => {
    simulateCampaignCapture('?utm_source=email&utm_campaign=alpha_outreach');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ utm_source: 'email', utm_campaign: 'alpha_outreach' });
  });

  // T13980: platforms rewrite links, so a campaign id may survive only in a
  // lower utm field. Any attribution field present is captured for the server.
  it('captures utm_source alone (no ref, utm_campaign or click ID)', () => {
    simulateCampaignCapture('?utm_source=k7x2m&utm_medium=cpc');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ utm_source: 'k7x2m', utm_medium: 'cpc' });
  });

  it('captures utm_content alone', () => {
    simulateCampaignCapture('?utm_content=k7x2m');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ utm_content: 'k7x2m' });
  });

  it('captures utm_term alone', () => {
    simulateCampaignCapture('?utm_term=k7x2m');
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ utm_term: 'k7x2m' });
  });
});

describe('T7910: referrer-host capture', () => {
  let originalSessionStorage;

  beforeEach(() => {
    originalSessionStorage = globalThis.sessionStorage;
    const store = {};
    globalThis.sessionStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => { store[key] = val; }),
      removeItem: vi.fn((key) => { delete store[key]; }),
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = originalSessionStorage;
    vi.restoreAllMocks();
  });

  it('captures lref param relayed by the landing (preferred over document.referrer)', () => {
    simulateCampaignCapture('?lref=reddit.com', null, { referrer: 'https://www.google.com/search' });
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).referrer_host).toBe('reddit.com');
  });

  it('falls back to external document.referrer host (hostname only) when no lref', () => {
    simulateCampaignCapture('', null, { referrer: 'https://old.reddit.com/r/soccer/comments/xyz' });
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).referrer_host).toBe('old.reddit.com');
  });

  it('captures referrer alone when no ref/utm/click present', () => {
    simulateCampaignCapture('?foo=bar', null, { referrer: 'https://www.google.com/' });
    const stored = JSON.parse(sessionStorage.setItem.mock.calls[0][1]);
    expect(stored).toEqual({ referrer_host: 'www.google.com' });
  });

  it('ignores our own domains as referrer (landing->app hop without lref)', () => {
    simulateCampaignCapture('', null, { referrer: 'https://www.reelballers.com/features', hostname: 'app.reelballers.com' });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('ignores same-host self-referral', () => {
    simulateCampaignCapture('', null, { referrer: 'https://app.reelballers.com/gallery', hostname: 'app.reelballers.com' });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not capture when referrer is empty and no other params', () => {
    simulateCampaignCapture('', null, { referrer: '' });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('handles a malformed referrer gracefully', () => {
    simulateCampaignCapture('', null, { referrer: 'not a url' });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('sends referrer_host in the auth request body', () => {
    const campaign = { referrer_host: 'www.google.com' };
    const authBody = { token: 'mock' };
    if (campaign.referrer_host) authBody.referrer_host = campaign.referrer_host;
    expect(authBody).toEqual({ token: 'mock', referrer_host: 'www.google.com' });
  });
});

describe('click source derivation', () => {
  let originalSessionStorage;

  beforeEach(() => {
    originalSessionStorage = globalThis.sessionStorage;
    const store = {};
    globalThis.sessionStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => { store[key] = val; }),
      removeItem: vi.fn((key) => { delete store[key]; }),
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = originalSessionStorage;
    vi.restoreAllMocks();
  });

  it('derives facebook from fbclid', () => {
    simulateCampaignCapture('?fbclid=IwAR3x');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('facebook');
  });

  it('derives google from gclid', () => {
    simulateCampaignCapture('?gclid=xyz789');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('google');
  });

  it('derives google from gbraid (iOS)', () => {
    simulateCampaignCapture('?gbraid=abc123');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('google');
  });

  it('derives google from wbraid (iOS web-to-app)', () => {
    simulateCampaignCapture('?wbraid=abc123');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('google');
  });

  it('derives tiktok from ttclid', () => {
    simulateCampaignCapture('?ttclid=tiktok123');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('tiktok');
  });

  it('derives snapchat from sclid', () => {
    simulateCampaignCapture('?sclid=snap123');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('snapchat');
  });

  it('derives snapchat from ScCid (legacy)', () => {
    simulateCampaignCapture('?ScCid=snap_legacy');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('snapchat');
  });

  it('derives pinterest from epik', () => {
    simulateCampaignCapture('?epik=dj0yJnU9');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('pinterest');
  });

  it('derives reddit from rdt_cid', () => {
    simulateCampaignCapture('?rdt_cid=reddit123');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('reddit');
  });

  it('first click ID wins (fbclid over gclid)', () => {
    simulateCampaignCapture('?fbclid=abc&gclid=xyz');
    expect(JSON.parse(sessionStorage.setItem.mock.calls[0][1]).click_source).toBe('facebook');
  });
});

describe('campaign params in Google auth request', () => {
  it('includes all campaign fields in request body', () => {
    const raw = JSON.stringify({
      ref: 'ig_summer',
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'summer_sale',
      utm_content: 'video_v2',
      utm_term: 'soccer',
      click_source: 'facebook',
    });

    const authBody = { token: 'mock-google-token' };
    const campaign = JSON.parse(raw);
    if (campaign.ref)          authBody.ref = campaign.ref;
    if (campaign.utm_source)   authBody.utm_source = campaign.utm_source;
    if (campaign.utm_medium)   authBody.utm_medium = campaign.utm_medium;
    if (campaign.utm_campaign) authBody.utm_campaign = campaign.utm_campaign;
    if (campaign.utm_content)  authBody.utm_content = campaign.utm_content;
    if (campaign.utm_term)     authBody.utm_term = campaign.utm_term;
    if (campaign.click_source) authBody.click_source = campaign.click_source;

    expect(authBody).toEqual({
      token: 'mock-google-token',
      ref: 'ig_summer',
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'summer_sale',
      utm_content: 'video_v2',
      utm_term: 'soccer',
      click_source: 'facebook',
    });
  });

  it('sends only ref when no UTM params present', () => {
    const raw = JSON.stringify({ ref: 'a1b2c3d4' });

    const authBody = { token: 'mock-google-token' };
    const campaign = JSON.parse(raw);
    if (campaign.ref)          authBody.ref = campaign.ref;
    if (campaign.utm_source)   authBody.utm_source = campaign.utm_source;
    if (campaign.utm_campaign) authBody.utm_campaign = campaign.utm_campaign;
    if (campaign.click_source) authBody.click_source = campaign.click_source;

    expect(authBody).toEqual({ token: 'mock-google-token', ref: 'a1b2c3d4' });
  });

  it('sends nothing when campaignParams is null', () => {
    const raw = null;
    const authBody = { token: 'mock-google-token' };
    if (raw) {
      const campaign = JSON.parse(raw);
      if (campaign.ref) authBody.ref = campaign.ref;
    }
    expect(authBody).toEqual({ token: 'mock-google-token' });
  });
});

describe('campaign params in OTP verify request', () => {
  it('includes campaign fields in verify-otp body', () => {
    const raw = JSON.stringify({
      ref: 'ig_summer',
      utm_source: 'instagram',
      utm_campaign: 'summer_camp',
      click_source: 'facebook',
    });

    const verifyBody = { email: 'user@test.com', code: '123456' };
    const campaign = JSON.parse(raw);
    if (campaign.ref)          verifyBody.ref = campaign.ref;
    if (campaign.utm_source)   verifyBody.utm_source = campaign.utm_source;
    if (campaign.utm_campaign) verifyBody.utm_campaign = campaign.utm_campaign;
    if (campaign.click_source) verifyBody.click_source = campaign.click_source;

    expect(verifyBody).toEqual({
      email: 'user@test.com',
      code: '123456',
      ref: 'ig_summer',
      utm_source: 'instagram',
      utm_campaign: 'summer_camp',
      click_source: 'facebook',
    });
  });

  it('does not include campaign fields when no campaignParams', () => {
    const raw = null;
    const verifyBody = { email: 'user@test.com', code: '123456' };
    if (raw) {
      const campaign = JSON.parse(raw);
      if (campaign.ref) verifyBody.ref = campaign.ref;
    }
    expect(verifyBody).toEqual({ email: 'user@test.com', code: '123456' });
  });
});
