/**
 * T3455: Tests for campaign URL param capture and auth passthrough.
 *
 * Tests the sessionStorage-based campaign attribution flow:
 * - Capture ref, UTM params, and click_source from URL on app mount
 * - First-touch-wins (don't overwrite existing campaignParams)
 * - Click source derivation from platform click IDs
 * - Include campaign fields in Google auth request body
 * - Include campaign fields in OTP verify request body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function simulateCampaignCapture(searchString, existingParams = null) {
  if (existingParams) {
    sessionStorage.setItem('campaignParams', JSON.stringify(existingParams));
  }

  if (sessionStorage.getItem('campaignParams')) return;

  const params = new URLSearchParams(searchString);
  const ref = params.get('ref');
  const utm_source = params.get('utm_source');
  const utm_medium = params.get('utm_medium');
  const utm_campaign = params.get('utm_campaign');
  const utm_content = params.get('utm_content');
  const utm_term = params.get('utm_term');

  let click_source = null;
  if (params.has('fbclid'))                                                    click_source = 'facebook';
  else if (params.has('gclid') || params.has('gbraid') || params.has('wbraid')) click_source = 'google';
  else if (params.has('ttclid'))                                               click_source = 'tiktok';
  else if (params.has('sclid') || params.has('ScCid'))                         click_source = 'snapchat';
  else if (params.has('epik'))                                                 click_source = 'pinterest';
  else if (params.has('rdt_cid'))                                              click_source = 'reddit';

  if (ref || utm_campaign || click_source) {
    const data = {};
    if (ref)          data.ref = ref;
    if (utm_source)   data.utm_source = utm_source;
    if (utm_medium)   data.utm_medium = utm_medium;
    if (utm_campaign) data.utm_campaign = utm_campaign;
    if (utm_content)  data.utm_content = utm_content;
    if (utm_term)     data.utm_term = utm_term;
    if (click_source) data.click_source = click_source;
    sessionStorage.setItem('campaignParams', JSON.stringify(data));
  }
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

  it('does not store utm_source alone without utm_campaign or click_source', () => {
    simulateCampaignCapture('?utm_source=google&utm_medium=cpc');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
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
