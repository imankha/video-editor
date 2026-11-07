# T15000: Landing attribution survives a multi-page visit (first-touch record relayed from every page)

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Tier:** M (landing only; one layout script becomes a small pure module plus a test)
**Created:** 2026-11-03
**Updated:** 2026-11-03

Owner question 2026-11-03: "are we handing off attribution from links to the main site to
app.reelballers.com?" Answer: yes, since T3455 (params) and T7910 (`lref` referrer host), but only
from the FIRST landing page the visitor sees. This task closes that gap. Spend-readiness gate 10
(attribution coverage, T14910) and the arrival-sport dimension (T14930) both ride on this hop.

## Problem

`src/landing/src/layouts/PageLayout.astro` runs one inline script per page load. It reads the
current page's `window.location.search` and `document.referrer`, and appends them (plus `lref`,
the external referrer host) to every `a[data-cta]` link. Nothing is remembered between pages:

- Internal navigation (`Header.astro` NAV: How it works, Sports, Pricing, Recruiting, Guides,
  About; the sports index to a sport page; guide to guide) carries no query string, so `utm_*`,
  `ref`, `fbclid` and friends are gone after one click.
- After one internal click `document.referrer` is our own host, so `lref` is empty too.
- Result: Google -> `/sports` -> `/hockey` -> "Get started free" signs up with no source at all;
  a shared reel's end card (`?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard`)
  -> landing -> `/how-it-works` -> CTA loses the viral tag. Only a visitor who clicks the app
  button on the very page they arrived at is attributed.
- Every planned extension of the relay (T14930 `utm_content=<sport>`, T7410's source bucket)
  inherits the same one-page memory.

The app side already does first-touch correctly (`captureCampaignParams` writes
`sessionStorage.campaignParams` once per tab and both auth paths send it at sign-up). The landing
side has no equivalent.

## Solution

**First-touch record on the landing, per tab, merged into every app link on every page.**

1. On every landing page load, if `sessionStorage.rbFirstTouch` is absent, write it:
   `{ params: {<whitelisted key>: value}, lref, lp, landed_at }` where
   - `params` keeps only known attribution keys: `ref`, `sport`, `utm_source`, `utm_medium`,
     `utm_campaign`, `utm_content`, `utm_term`, and the click ids the app recognises (`fbclid`,
     `gclid`, `gbraid`, `wbraid`, `ttclid`, `sclid`, `ScCid`, `epik`, `rdt_cid`). Unknown params
     are not stored (today the relay copies the whole query string; stop that).
   - `lref` is the external referrer hostname, computed exactly as today (hostname only,
     apex/www folded, own host excluded), and only on this first page.
   - `lp` is the first landing pathname (consumed by T15010; harmless to store now).
   If the record exists, it is never overwritten (first touch wins, same policy as the app).
2. On every page, build each `a[data-cta]` href from the record: set every stored param that the
   link does not already carry, then `lref` if present. Current-page params are merged into the
   record only when the record is being created, so a later ad click in the same tab does not
   re-attribute.
3. Move the logic out of the inline script into a dependency-free pure module
   `src/landing/src/attribution.ts` (`readFirstTouch(search, referrer, hostname, pathname, store)`,
   `applyFirstTouch(href, record)`), and keep a tiny inline bootstrap in `PageLayout.astro`. Pure
   functions get a `node --test` file that the Branch CI `landing` job runs before `astro build`
   (the job only builds today; Playwright is never run by CI, so a browser spec alone is not
   evidence).
4. Graceful degradation unchanged: without JS or with storage blocked (private mode can throw) the
   CTA still links to the app and simply loses the params; wrap storage access in try/catch.
5. Privacy: per-tab `sessionStorage`, cleared when the tab closes, no cookies, no IDs, hostnames
   only. T7410's privacy line ("no cookies, no localStorage, no IDs") stays true for the beacon;
   add one sentence to the privacy page draft (T7120) that attribution params you arrived with are
   kept in the tab until you open the app.

Out of scope: cross-tab or cross-day memory (would need localStorage or a cookie; the owner's
privacy stance says no), and any change to the app's capture or the backend.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/layouts/PageLayout.astro` - replace the inline relay with the bootstrap
- `src/landing/src/attribution.ts` - new pure module (first-touch read, href merge)
- `src/landing/src/attribution.test.mjs` (or `.test.ts` via `node --test` with a loader) - unit tests
- `.github/workflows/branch-ci.yml` - `landing` job runs the test before the build
- `src/landing/package.json` - `test` script
- `src/landing/SEO.md` - one paragraph documenting the hop contract (what is relayed, when)

### Related Tasks
- Builds on: T3455 (param relay + app capture), T7910 (`lref`), T13980 (campaign id in any field).
- Should land before: T14930 (its `utm_content=<sport>` fill must operate on the merged first-touch
  set, so the arrival sport is the first sport page of the visit, not the page the CTA was on),
  T15010 (`lp` consumer), T7410 (beacon source bucket should read the same record).
- Feeds: T14910 gate 10 (attribution coverage), the `business-intelligence` agent's "0 of 375
  sign-ups carried a UTM" anchor, which this task partly explains (no campaign ever ran, and
  multi-page organic visits could not be attributed either).

### Technical Notes
- First touch, not last touch, to match the app's `campaignParams` policy and the backend's
  `_determine_origin` expectations; document the policy in the module header.
- Whitelisting the params also stops leaking arbitrary landing query strings onto the app URL.
- `lref` and the click ids are hints; they never overwrite an explicit `ref` or `utm_campaign`
  already on a link (T13980 ordering lives in the backend, not here).
- No Astro view transitions are in use; a full page load per navigation is the assumption. If one
  is added later, the bootstrap must also run on `astro:page-load`.

## Implementation

### Steps
1. [ ] Failing unit tests: record written once; second page with new params keeps the first;
       `lref` only on first page and only when external; whitelist drops `foo=bar`; href merge
       respects params already on the link; storage throwing leaves the href untouched.
2. [ ] Pure module + bootstrap; remove the whole-query-string copy.
3. [ ] CI `landing` job runs the test; `astro build` still green.
4. [ ] Manual check on `astro preview`: Google-like referrer -> `/sports` -> `/soccer` -> CTA href
       carries `lref` and params; screenshot of the resulting href in devtools.
5. [ ] After deploy (deploy-landing.yml): verify the deployed bundle contains the bootstrap.

### Progress Log

**2026-11-03**: Filed from the owner's attribution question. Investigation: relay exists
(T3455, T7910) but is single-page; the app side is already first-touch.

## Acceptance Criteria

- [ ] A visitor arriving with `?utm_source=x` (or from an external referrer) who clicks through two
      internal pages before the app button still hands `utm_source=x` (or `lref`) to the app.
- [ ] A later arrival in the same tab with different params does not change the first touch.
- [ ] Only whitelisted keys are relayed; unknown params are dropped.
- [ ] Without JS or with storage blocked, the app button still works.
- [ ] Unit tests run in Branch CI's `landing` job.
