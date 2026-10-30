/**
 * T3455: capture campaign params from the landing URL into
 * sessionStorage.campaignParams (first-touch attribution). Both auth paths send
 * them on signup; the backend's _determine_origin turns them into the origin.
 */
export function captureCampaignParams(search, referrer, hostname) {
  if (sessionStorage.getItem('campaignParams')) return;

  const params = new URLSearchParams(search);
  const ref = params.get('ref');
  const ref_sport = params.get('sport');  // T2915: inviter's sport snapshot on the invite link
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

  // T7910: external referrer hint (hostname ONLY — never query strings/paths).
  // Prefer `lref`, the original external host the landing relays across the
  // landing->app hop (PageLayout.astro); otherwise fall back to our own
  // document.referrer host. Skip our own domains (reelballers.com landing/app)
  // so a landing->app hop without lref isn't misattributed as a real referrer.
  let referrer_host = params.get('lref') || null;
  if (!referrer_host && referrer) {
    try {
      const h = new URL(referrer).hostname;
      if (h && h !== hostname && !/(^|\.)reelballers\.com$/i.test(h)) {
        referrer_host = h;
      }
    } catch { /* malformed referrer — ignore */ }
  }

  // T13980: ANY attribution field, not just ref/utm_campaign: an admin campaign
  // id may survive a platform's link rewrite only in utm_source/content/term.
  if (ref || utm_source || utm_medium || utm_campaign || utm_content || utm_term
      || click_source || referrer_host) {
    const data = {};
    if (ref)          data.ref = ref;
    if (ref && ref_sport) data.ref_sport = ref_sport;  // only meaningful alongside a referral
    if (utm_source)   data.utm_source = utm_source;
    if (utm_medium)   data.utm_medium = utm_medium;
    if (utm_campaign) data.utm_campaign = utm_campaign;
    if (utm_content)  data.utm_content = utm_content;
    if (utm_term)     data.utm_term = utm_term;
    if (click_source) data.click_source = click_source;
    if (referrer_host) data.referrer_host = referrer_host;
    sessionStorage.setItem('campaignParams', JSON.stringify(data));
  }
}
