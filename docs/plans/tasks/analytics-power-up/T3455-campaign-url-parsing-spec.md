# T3455: Campaign URL Parsing

**Status:** SPEC COMPLETE
**Priority:** P0 (blocks T3450 origin determination logic)
**Parent Epic:** [Analytics Power-Up](EPIC.md)

---

## 1. Two Levels of Attribution

Campaign tracking serves two distinct questions:

| Question | Field | Inherited by viral descendants? |
|----------|-------|---------------------------------|
| "What campaign tree does this user belong to?" | `origin` | Yes -- viral users inherit inviter's origin |
| "What ad did THIS user click?" | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | No -- only set on the user who clicked the ad |

**Why both are needed:**

`origin` alone can't answer "which platform should I spend more on?" If you run `summer_sale` on Facebook ($500 spend) and Google ($300 spend), `GROUP BY origin` merges them into one row. You can't calculate per-platform ROAS.

`utm_*` alone can't answer "what's the total revenue from campaign X including viral spread?" Only `origin` propagates through invite chains.

They're complementary. `origin` is the campaign tree root. `utm_*` fields are the direct-click details.

---

## 2. What Each Ad Platform Appends to URLs

Every platform auto-appends a click ID. UTM parameters are NEVER auto-generated -- the advertiser must explicitly set them (manually or via dynamic macros in the ad platform UI). This means many ad clicks arrive with ONLY a click ID and no utm_campaign.

### Tier 1

| Platform | Auto-appended params | Advertiser-set params | Notes |
|----------|---------------------|----------------------|-------|
| **Meta (Facebook + Instagram)** | `fbclid` | UTMs via manual entry or dynamic macros: `{{campaign.name}}`, `{{site_source_name}}` (fb/ig), `{{placement}}` | `fbclid` is the same for FB and IG. To distinguish: use `{{site_source_name}}` in `utm_source`. |
| **TikTok** | `ttclid` | UTMs via manual entry or macros: `__CAMPAIGN_NAME__`, `__CREATIVE_NAME__`, `__PLACEMENT__` | `ttclid` can be 100+ chars. In-app browser may behave differently. |
| **Google Ads** (Search, Display, YouTube) | `gclid`, `gad_source`, `gbraid` (iOS), `wbraid` (iOS web-to-app) | UTMs via manual entry. `utm_term` auto-filled with search keyword for Search ads. | `gbraid`/`wbraid` appear INSTEAD of `gclid` for iOS 14+ users due to privacy restrictions. Must check all three. |

### Tier 2

| Platform | Auto-appended params | Advertiser-set params | Notes |
|----------|---------------------|----------------------|-------|
| **Snapchat** | `sclid` (modern), `ScCid` (legacy) | UTMs via manual entry or macros: `{{campaign.name}}`, `{{ad.name}}` | Check both `sclid` and `ScCid` for backward compatibility. |
| **Pinterest** | `epik` | UTMs via manual entry or macros: `{campaignname}`, `{adgroupname}`, `{creative_id}`. Auto-applies UTMs for Performance+ campaigns. | `epik` only appended when Pinterest tag is active. Pinterest recommends NOT adding manual UTMs (let `epik` handle it), but cross-platform analytics needs them. |
| **Reddit** | `rdt_cid` | UTMs via manual entry or macros: `{{CAMPAIGN_NAME}}`, `{{AD_NAME}}`, `{{DEVICE}}`, `{{COUNTRY}}` | If ad names change after publication, macros pull the updated name -- can break historical UTM consistency. |

### Click Source Derivation Table

Frontend checks for these params (in order) to derive `click_source`:

| URL Parameter | click_source |
|---------------|-------------|
| `fbclid` | `facebook` |
| `gclid` or `gbraid` or `wbraid` | `google` |
| `ttclid` | `tiktok` |
| `sclid` or `ScCid` | `snapchat` |
| `epik` | `pinterest` |
| `rdt_cid` | `reddit` |

First match wins. `gad_source` is NOT checked independently -- it always accompanies `gclid`/`gbraid`/`wbraid`.

### iOS Safari Link Tracking Protection (LTP)

As of iOS 17+ (and expanding in iOS 26), Safari strips `fbclid`, `gclid`, `ttclid`, and other click IDs in Private Browsing. Safari Technology Preview is already stripping them in regular browsing -- this will likely expand to all Safari sessions soon.

**What survives LTP:** Standard UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, etc.) are NOT stripped. Google's `gbraid`/`wbraid` also survive (they're privacy-preserving by design).

**Impact on this spec:** iOS Safari users who click ads will increasingly arrive with UTM params but NO click ID. This means:
- The `{platform}_unknown` fallback (Priority 5) will fire less often on iOS -- if UTMs are set, they'll be the only signal present.
- If UTMs are NOT set, iOS users won't have a click ID either -- they'll fall to `"organic"` (Priority 6), making the ad spend invisible.
- **Setting UTM params on every ad is not optional.** It's the only attribution mechanism that survives across all browsers.

---

## 3. Origin Resolution Priority

The backend receives campaign params from the frontend and resolves `origin` in this order. First match wins.

| Priority | Condition | origin | referrer_id |
|----------|-----------|--------|-------------|
| 1 | `ref` matches `/^[0-9a-f]{8}$/` AND `resolve_invite_code(ref)` finds a user | Inviter's origin (inherited) | Inviter's user_id |
| 2 | `ref` present AND does NOT match invite code pattern | `ref` value as-is | NULL |
| 3 | `ref` matched invite code pattern but didn't resolve, AND `utm_campaign` present | `utm_campaign` value | NULL |
| 4 | No `ref`, `utm_campaign` present | `utm_campaign` value | NULL |
| 5 | No `ref`, no `utm_campaign`, `click_source` present | `"{click_source}_unknown"` | NULL |
| 6 | No params at all | `"organic"` | NULL |

### Why `ref` Beats `utm_campaign`

We control `ref`. When we create a campaign link (`?ref=ig_summer_camp`), we're choosing a stable, human-readable origin. `utm_campaign` is set in the ad platform UI and might be inconsistent or auto-generated. `ref` is our canonical campaign identifier.

### Why Unresolved Invite Codes Fall Through

An 8-char hex `ref` that doesn't resolve (deleted account, typo, hex collision) is meaningless noise in GROUP BY queries. Falling through to `utm_campaign` or `click_source` gives us something actionable.

### The `{platform}_unknown` Problem

`facebook_unknown` will be common -- it means the advertiser clicked "create ad" but didn't set UTM parameters. This is actionable feedback: "you're running Facebook ads but forgot to tag them with utm_campaign, so we can't tell your campaigns apart."

The admin Campaigns view should surface a note when `_unknown` origins have significant user counts, prompting the marketer to fix their ad tagging.

---

## 4. Frontend URL Parser

**Replaces:** `src/frontend/src/App.jsx` lines 121-128

**Also update:** `src/landing/src/App.tsx` lines 12-18 (landing page CTA redirect)

### App.jsx Pseudocode

```javascript
useEffect(() => {
  // First-touch: don't overwrite existing attribution
  if (sessionStorage.getItem('campaignParams')) return;

  const params = new URLSearchParams(window.location.search);

  const ref = params.get('ref');
  const utm_source = params.get('utm_source');
  const utm_medium = params.get('utm_medium');
  const utm_campaign = params.get('utm_campaign');
  const utm_content = params.get('utm_content');
  const utm_term = params.get('utm_term');

  // Derive click_source from platform click IDs
  let click_source = null;
  if (params.has('fbclid'))                                      click_source = 'facebook';
  else if (params.has('gclid') || params.has('gbraid') || params.has('wbraid'))  click_source = 'google';
  else if (params.has('ttclid'))                                 click_source = 'tiktok';
  else if (params.has('sclid') || params.has('ScCid'))           click_source = 'snapchat';
  else if (params.has('epik'))                                   click_source = 'pinterest';
  else if (params.has('rdt_cid'))                                click_source = 'reddit';

  // Only store if at least one signal is present
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
}, []);
```

**Key changes from current code:**
- Stores JSON object (`campaignParams`) instead of a single string (`referralCode`)
- Captures all 5 UTM fields + click_source + ref
- Checks `gbraid`/`wbraid` for iOS Google Ads clicks
- Still first-touch-wins (checks for existing `campaignParams` before writing)

### Landing Page Pseudocode

```typescript
// src/landing/src/App.tsx — forward ALL query params to app
const ctaHref = useMemo(() => {
  const search = window.location.search;
  return search
    ? `https://app.reelballers.com${search}`
    : 'https://app.reelballers.com';
}, []);
```

Currently only forwards `ref`. Must forward the entire query string so UTM params and click IDs survive the `www` -> `app` redirect.

---

## 5. Frontend Auth Request Changes

**Files:** `src/frontend/src/utils/googleAuth.js` and `src/frontend/src/components/auth/OtpAuthForm.jsx`

**Currently:** Both read `sessionStorage.getItem('referralCode')` and send `{ ref: string }`.

**New:** Both read `sessionStorage.getItem('campaignParams')` and spread the fields into the request body:

```javascript
const raw = sessionStorage.getItem('campaignParams');
if (raw) {
  const campaign = JSON.parse(raw);
  if (campaign.ref)          authBody.ref = campaign.ref;
  if (campaign.utm_source)   authBody.utm_source = campaign.utm_source;
  if (campaign.utm_medium)   authBody.utm_medium = campaign.utm_medium;
  if (campaign.utm_campaign) authBody.utm_campaign = campaign.utm_campaign;
  if (campaign.utm_content)  authBody.utm_content = campaign.utm_content;
  if (campaign.utm_term)     authBody.utm_term = campaign.utm_term;
  if (campaign.click_source) authBody.click_source = campaign.click_source;
}
```

**Wire format** (POST body, all new fields optional):

```json
{
  "token": "google-id-token...",
  "ref": "ig_summer_camp",
  "utm_source": "facebook",
  "utm_medium": "paid_social",
  "utm_campaign": "summer_sale_2026",
  "utm_content": "before_after_video",
  "utm_term": "soccer highlights",
  "click_source": "facebook"
}
```

---

## 6. Backend `_determine_origin()`

**File:** `src/backend/app/routers/auth.py`

### Pseudocode

```python
INVITE_CODE_RE = re.compile(r'^[0-9a-f]{8}$')

def _determine_origin(
    ref: str | None,
    utm_campaign: str | None,
    click_source: str | None,
) -> tuple[str, str | None]:
    """Resolve signup origin from campaign/referral params.

    Returns (origin, referrer_id).
    """
    if ref:
        if INVITE_CODE_RE.match(ref):
            referrer_id = resolve_invite_code(ref)
            if referrer_id:
                inviter_origin = _get_user_origin(referrer_id)
                return (inviter_origin, referrer_id)
            # Didn't resolve — fall through
        else:
            return (ref, None)

    if utm_campaign:
        return (utm_campaign, None)

    if click_source:
        return (f"{click_source}_unknown", None)

    return ("organic", None)
```

### Integration with `_find_or_create_user()`

```python
def _find_or_create_user(
    email: str,
    *,
    google_id: str | None = None,
    ref: str | None = None,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
    utm_content: str | None = None,
    utm_term: str | None = None,
    click_source: str | None = None,
    signup_method: str = "google",
) -> tuple[str, bool]:
    # ... existing user lookup (unchanged) ...

    # New user — determine origin
    origin, referrer_id = _determine_origin(ref, utm_campaign, click_source)

    # Insert user_segments row with origin + direct-click UTM fields
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_segments
                (user_id, origin, referrer_id, signup_method,
                 utm_source, utm_medium, utm_campaign, utm_content, utm_term)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (user_id, origin, referrer_id, signup_method,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term))
        conn.commit()
```

**Note:** `utm_*` fields are stored as-is from the URL. They are NOT inherited by viral descendants -- only `origin` propagates through invite chains. A viral user's `utm_*` fields stay NULL.

### What About Share-Based Attribution?

Share-based attribution (checking `shares` table for `recipient_email`) should also inherit the sharer's origin -- same logic as invite codes. But that's T3450's implementation concern, not this spec.

---

## 7. Schema Addition to `user_segments`

```sql
-- Add to user_segments (T3450 will create this table):
utm_source TEXT,      -- 'facebook', 'google', 'tiktok', 'email', etc.
utm_medium TEXT,      -- 'paid_social', 'cpc', 'display', 'video', 'email'
utm_campaign TEXT,    -- 'summer_sale_2026', 'brand_search', etc.
utm_content TEXT,     -- ad creative variant
utm_term TEXT,        -- keyword or audience segment
```

These are only populated for users who directly clicked an ad. Viral users (those who arrived via invite code) have NULL for all utm_* fields -- their attribution is captured in `origin` (inherited) and `referrer_id`.

---

## 8. Marketing Queries This Enables

### Which platform should I spend more on?
```sql
SELECT
    COALESCE(utm_source, click_source, 'organic') AS platform,
    COUNT(*) AS signups,
    COUNT(CASE WHEN total_spent_cents > 0 THEN 1 END) AS paying,
    SUM(total_spent_cents) AS revenue_cents
FROM user_segments
WHERE referrer_id IS NULL  -- direct clicks only
GROUP BY platform ORDER BY revenue_cents DESC;
```

### Campaign ROI including viral spread?
```sql
SELECT
    origin,
    COUNT(*) AS total_users,
    COUNT(CASE WHEN referrer_id IS NOT NULL THEN 1 END) AS viral_users,
    SUM(total_spent_cents) AS total_revenue_cents
FROM user_segments
WHERE origin != 'organic'
GROUP BY origin ORDER BY total_revenue_cents DESC;
```

### Same campaign, which platform performed better?
```sql
SELECT
    utm_source AS platform,
    COUNT(*) AS signups,
    SUM(total_spent_cents) AS revenue_cents
FROM user_segments
WHERE origin = 'summer_sale' AND referrer_id IS NULL
GROUP BY utm_source;
```

### Which ad creative converts best?
```sql
SELECT
    utm_content AS creative,
    COUNT(*) AS signups,
    COUNT(CASE WHEN total_spent_cents > 0 THEN 1 END) AS paid,
    ROUND(100.0 * COUNT(CASE WHEN total_spent_cents > 0 THEN 1 END)
          / NULLIF(COUNT(*), 0), 1) AS conversion_pct
FROM user_segments
WHERE utm_campaign = 'summer_sale' AND utm_content IS NOT NULL
GROUP BY utm_content ORDER BY conversion_pct DESC;
```

### Is paid social outperforming search?
```sql
SELECT
    utm_medium AS channel,
    COUNT(*) AS signups,
    SUM(total_spent_cents) AS revenue_cents
FROM user_segments
WHERE utm_medium IS NOT NULL
GROUP BY utm_medium ORDER BY revenue_cents DESC;
```

### Viral multiplier by campaign?
```sql
SELECT
    origin,
    COUNT(CASE WHEN referrer_id IS NULL THEN 1 END) AS direct,
    COUNT(CASE WHEN referrer_id IS NOT NULL THEN 1 END) AS viral,
    ROUND(COUNT(*)::numeric
          / NULLIF(COUNT(CASE WHEN referrer_id IS NULL THEN 1 END), 0), 2)
      AS viral_multiplier
FROM user_segments
WHERE origin != 'organic'
GROUP BY origin
HAVING COUNT(CASE WHEN referrer_id IS NULL THEN 1 END) > 0
ORDER BY viral_multiplier DESC;
```

### Funnel by source?
```sql
SELECT
    COALESCE(us.utm_source, 'organic') AS platform,
    COUNT(DISTINCT us.user_id) AS signups,
    COUNT(DISTINCT g.user_id) AS created_game,
    COUNT(DISTINCT e.user_id) AS exported,
    COUNT(DISTINCT CASE WHEN us.total_spent_cents > 0 THEN us.user_id END) AS paid
FROM user_segments us
LEFT JOIN user_actions g ON us.user_id = g.user_id AND g.action = 'game_created'
LEFT JOIN user_actions e ON us.user_id = e.user_id AND e.action = 'export_completed'
WHERE us.referrer_id IS NULL
GROUP BY platform ORDER BY signups DESC;
```

---

## 9. Complete Example Table

| # | URL | origin | referrer_id | utm_source | utm_campaign | Explanation |
|---|-----|--------|-------------|------------|--------------|-------------|
| 1 | `reelballers.com` | `organic` | NULL | NULL | NULL | No params. Priority 6. |
| 2 | `?ref=a1b2c3d4` (valid invite, inviter origin = "ig_summer") | `ig_summer` | inviter_id | NULL | NULL | Viral. Inherits inviter's origin. UTM fields stay NULL. |
| 3 | `?ref=a1b2c3d4` (valid invite, inviter origin = "organic") | `organic` | inviter_id | NULL | NULL | Viral (has referrer_id) but inherited origin is "organic". |
| 4 | `?ref=a1b2c3d4` (invite NOT found) | `organic` | NULL | NULL | NULL | Unresolved hex. No fallback params. Priority 6. |
| 5 | `?ref=a1b2c3d4&utm_campaign=summer_sale` (invite NOT found) | `summer_sale` | NULL | NULL | `summer_sale` | Unresolved hex falls through to utm_campaign. Priority 3. |
| 6 | `?ref=ig_summer_camp` | `ig_summer_camp` | NULL | NULL | NULL | ref is not hex. Used as campaign ID. Priority 2. |
| 7 | `?ref=ig_summer_camp&utm_source=instagram&utm_campaign=Summer+Camp` | `ig_summer_camp` | NULL | `instagram` | `Summer Camp` | ref wins for origin. UTM fields still stored for direct-click analysis. |
| 8 | `?utm_source=facebook&utm_campaign=summer_sale_2026&fbclid=IwAR3x...` | `summer_sale_2026` | NULL | `facebook` | `summer_sale_2026` | Standard Facebook ad click with proper UTM tagging. Priority 4. |
| 9 | `?fbclid=abc123` | `facebook_unknown` | NULL | NULL | NULL | Facebook ad click without UTM tags. Priority 5. |
| 10 | `?gclid=xyz789&utm_source=google&utm_medium=cpc&utm_campaign=brand_search` | `brand_search` | NULL | `google` | `brand_search` | Google Search ad with UTMs. Priority 4. |
| 11 | `?gclid=xyz789` | `google_unknown` | NULL | NULL | NULL | Google ad click without UTMs. Priority 5. |
| 12 | `?gbraid=abc123` | `google_unknown` | NULL | NULL | NULL | iOS Google ad click (gbraid instead of gclid). Same result. |
| 13 | `?ttclid=tiktok123` | `tiktok_unknown` | NULL | NULL | NULL | TikTok ad click without UTMs. Priority 5. |
| 14 | `?ttclid=tiktok123&utm_source=tiktok&utm_campaign=demo_reel&utm_content=v2_hook` | `demo_reel` | NULL | `tiktok` | `demo_reel` | TikTok ad with full UTM tagging. utm_content stored for creative analysis. |
| 15 | `?utm_source=email&utm_campaign=alpha_outreach` | `alpha_outreach` | NULL | `email` | `alpha_outreach` | Non-ad campaign (email blast). Priority 4. |
| 16 | `?sclid=snap123` | `snapchat_unknown` | NULL | NULL | NULL | Snapchat click without UTMs. |
| 17 | `?epik=dj0yJnU9...&utm_source=pinterest&utm_campaign=soccer_mom_pins` | `soccer_mom_pins` | NULL | `pinterest` | `soccer_mom_pins` | Pinterest ad with UTMs. |
| 18 | `?rdt_cid=reddit123&utm_source=reddit&utm_campaign=soccer_parents` | `soccer_parents` | NULL | `reddit` | `soccer_parents` | Reddit ad with UTMs. |
| 19 | `?ref=a1b2c3d4&fbclid=abc123` (valid invite, inviter origin = "fb_launch") | `fb_launch` | inviter_id | NULL | NULL | Invite code resolves. Viral. fbclid and UTMs not stored (viral user). |
| 20 | `?ref=a1b2c3d4&fbclid=abc123` (invite NOT found) | `facebook_unknown` | NULL | NULL | NULL | Unresolved hex, no utm_campaign. Falls to click_source. |
| 21 | `?utm_source=google&utm_medium=cpc&utm_term=soccer+highlights` | `organic` | NULL | `google` | NULL | Has utm_source/medium/term but no utm_campaign and no click ID. Origin falls to "organic". UTM fields still stored. |
| 22 | `?gad_source=1&gclid=CjwKCA...&utm_source=google&utm_campaign=brand_terms` | `brand_terms` | NULL | `google` | `brand_terms` | gad_source ignored. utm_campaign wins for origin. |

---

## 10. UTM Naming Conventions (Guidance for the Marketer)

When setting up ads, use these conventions so campaign data is clean and GROUP BY-friendly:

| Field | Convention | Examples |
|-------|-----------|----------|
| `utm_source` | Lowercase platform name | `facebook`, `google`, `tiktok`, `instagram`, `email`, `reddit` |
| `utm_medium` | Channel type | `paid_social`, `cpc`, `display`, `video`, `email`, `organic_social` |
| `utm_campaign` | Descriptive, lowercase, underscores | `summer_sale_2026`, `brand_search`, `soccer_parents_retarget` |
| `utm_content` | Ad creative variant | `before_after_video`, `testimonial_v2`, `feature_demo` |
| `utm_term` | Keyword or audience | `soccer+video+editor`, `parents_13_17` |

**Don't embed platform in campaign names.** Use `utm_campaign=summer_sale` with `utm_source=facebook` vs `utm_source=google` -- not `fb_summer_sale` vs `google_summer_sale`. This lets you GROUP BY campaign to see total impact and add utm_source to break down by platform.

Most ad platforms support **dynamic macros** that auto-fill these values (e.g., Meta's `{{campaign.name}}`, TikTok's `__CAMPAIGN_NAME__`). Use them. Pinterest is the exception -- UTMs must be set manually per ad.

---

## 11. Implementation Summary

### Files to Change

| File | Change |
|------|--------|
| `src/frontend/src/App.jsx` (lines 121-128) | Replace `referralCode` capture with `campaignParams` JSON capture (all UTMs + click_source) |
| `src/frontend/src/utils/googleAuth.js` (lines 57-58) | Read `campaignParams`, send all fields in auth body |
| `src/frontend/src/components/auth/OtpAuthForm.jsx` (lines 152-153) | Same as googleAuth.js |
| `src/landing/src/App.tsx` (lines 12-18) | Forward full query string instead of just `ref` |
| `src/backend/app/routers/auth.py` | Accept 6 new optional fields; add `_determine_origin()`; store UTMs in user_segments |
| `src/backend/app/services/pg.py` (`_SCHEMA_DDL`) | Add `utm_*` columns to `user_segments` table definition |

### What This Spec Does NOT Cover

- **Server-side conversion events** (sending purchase events back to ad platforms). Future work once revenue tracking is live. Will require storing raw click IDs -- not needed now.
- **Share-based attribution origin inheritance.** That pathway should inherit the sharer's origin, but it's T3450's concern.
- **Admin UI for campaigns.** Campaign creation is a human process (set `ref` or `utm_campaign` in ad URLs). The admin Campaigns view (T3490) will query `user_segments` directly.