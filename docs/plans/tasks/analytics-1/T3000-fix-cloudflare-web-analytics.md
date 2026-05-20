# T3000: Fix Cloudflare Web Analytics

**Status:** TODO
**Impact:** 6
**Complexity:** 1
**Created:** 2026-05-20

## Problem

Cloudflare Web Analytics is set up but not working:
- **App:** `VITE_CF_ANALYTICS_TOKEN` is unset in the Cloudflare Pages production build environment. The beacon script in [analytics.js](../../../../src/frontend/src/utils/analytics.js) checks for this token and no-ops without it -- zero data from the app.
- **Landing page:** Has a hardcoded beacon token (`1f6df107d8a943e488e609ce101776ae`) in [index.html](../../../../src/landing/index.html#L10) but data hasn't been verified in the CF dashboard.

We're paying for Cloudflare but getting nothing from its free analytics.

## Solution

1. Set `VITE_CF_ANALYTICS_TOKEN` in the Cloudflare Pages production environment variables
2. Verify the beacon loads on both the app and landing page
3. Confirm data appears in the CF Web Analytics dashboard

## Context

### Relevant Files
- `src/frontend/src/utils/analytics.js` -- Beacon injection logic (reads VITE_CF_ANALYTICS_TOKEN)
- `src/frontend/.env.example` -- Documents the env var (line 20, currently blank)
- `src/landing/index.html` -- Landing page beacon (hardcoded token, line 10)

### Technical Notes
- CF Web Analytics is free, cookieless, privacy-first. No privacy policy changes needed.
- The beacon provides: page views, unique visitors, top pages, referrers, countries, device types, browsers.
- Custom events via `zaraz.track()` / `__cfBeacon.send()` are already wired up in analytics.js for login, export_started, export_complete, quest_reward_claimed, share_initiated. These will start flowing once the token is set.
- Consider whether app and landing page should use the same token (one site in CF dashboard) or separate tokens (segmented traffic). Separate is cleaner.

## Implementation

### Steps
1. [ ] Log into Cloudflare dashboard -> Web Analytics
2. [ ] Check if the landing page site exists and shows data
3. [ ] Create a new site (or reuse existing) for the app domain
4. [ ] Copy the site token
5. [ ] Set `VITE_CF_ANALYTICS_TOKEN` in Cloudflare Pages production environment variables
6. [ ] Trigger a production deploy so the token is baked into the frontend build
7. [ ] Verify: open app in browser, check Network tab for `beacon.min.js` loading
8. [ ] Wait 24h, verify data appears in CF Web Analytics dashboard

### VPS/UI Work Note
**Steps 1-6 are manual Cloudflare dashboard work** -- the AI implements only the code side. If any code changes are needed (e.g., the beacon injection logic needs fixing), those are in scope.

## Acceptance Criteria

- [ ] `beacon.min.js` loads on production app pages (visible in browser Network tab)
- [ ] CF Web Analytics dashboard shows page view data for the app within 24h of deploy
- [ ] Landing page beacon verified working (or fixed if broken)
- [ ] No code changes break existing analytics.js track() calls
