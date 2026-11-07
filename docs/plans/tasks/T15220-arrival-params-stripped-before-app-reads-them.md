# T15220: Payment return and campaign params are stripped before the app reads them

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Tier:** M (bug fix, frontend only, no schema change)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Found during T14970 review and confirmed live. Owner asked for it as a priority task 2026-11-05.

## Problem

`editorStore.js` canonicalizes the URL at module load with `history.replaceState`, keeping only
`dev_account` from the query string. Module load runs before any App effect, so App reads an
already empty `window.location.search` in two places:

- **Payment return.** Stripe's `success_url` is `{FRONTEND_URL}?payment=success&session_id=...`
  (`payments.py:307`). App's payment block (`App.jsx:313`) never sees it, so the
  `/api/payments/verify` call, the result modal, the credit refresh, the return to the user's
  page and the payment auto-export do not run. Credits still arrive through the Stripe webhook
  (from the code; not exercised here), so no money is lost, but a user who just paid lands on
  Home with no confirmation and no export.
- **Campaign attribution.** `captureCampaignParams` (`App.jsx:157`) gets an empty string, so
  `ref`, `utm_*`, `lref`, `sport` and the click ids never reach `sessionStorage.campaignParams`,
  and sign-ups carry no attribution. The landing to app hop (T3455, T7910) depends on these
  params, and a `reelballers.com` referrer is deliberately ignored, so that hop appears to arrive
  with nothing.

Introduced by b95bb7f25 and made `/home`-aware by 2b1e2a80a (T5677); T11500 added the
`dev_account` carve-out. It predates T14970.

### Evidence (2026-11-05)

| Check | Where | Result |
|---|---|---|
| Fresh visit to `/?utm_source=..&utm_campaign=x&ref=abc&fbclid=1` | Staging, build 7200 (d0e78b47d), signed out | The first script saw the params; the page ended on `/home`; `campaignParams` held only `{"country":"US"}` |
| `/?payment=success&session_id=cs_test_probe` | Staging, signed out | Params gone, URL `/home` |
| `/?payment=success&session_id=cs_test_fake&utm_source=x&ref=abc` | T14970 branch stack, signed in | `/api/payments/verify` never called, no campaign params stored |

**Production (business-intelligence anchor, measured 2026-11-03, 375 real sign-ups, all-time
since the account base began — the full window since b95bb7f25 2026-06-08):** attribution
coverage is 0 of 375 sign-ups (`.claude/agents/business-intelligence.md` "Anchors measured
2026-11-03" / "Known gaps"). This is an all-time aggregate, not a month-by-month split; the doc's
own gap note attributes the 0 partly to a separate cause (the landing site relays `utm_*`/`ref`
only from the first page a visitor sees, so multi-page visits arrive untagged until T15000, and no
landing page is recorded at sign-up until T15010) in addition to this bug's stripping. There is no
pre-b95bb7f25 baseline to compare against in prod (the account base is younger than the bug), so a
before/after-by-month split is not computable from existing data; the honest number past-that-date
is 0 of 375 for the whole window. Treat any attribution-dependent number (T14910, T14930, T15000,
T15010, T15120) as 0%-covered until this fix is live in production and re-measured.

## Solution

Query params that App owns must survive canonicalization until App has read them. Keep the
existing rule that unrelated params do not linger in the URL. Name the params explicitly, as the
`dev_account` carve-out does, or read them before the strip; decide in the implementation, and
prefer one small named list over a second copy of the rule.

- Payment: `payment`, `session_id`. App's own block already removes them after reading.
- Campaign: `ref`, `sport`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`,
  `lref`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `ttclid`, `sclid`, `ScCid`, `epik`, `rdt_cid`.
  `captureCampaignParams` is the source of this list; T15000 and T15010 add `lp`.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/stores/editorStore.js` - module-load canonicalization
- `src/frontend/src/App.jsx` - payment block and `captureCampaignParams` call, both read the query
- `src/frontend/src/utils/campaignCapture.js` - the campaign param names
- `src/frontend/src/stores/editorStore.coldLoad.test.js` - cold-load tests; the T14970 worker reports a test pins the current stripping, so correct it
- `src/frontend/e2e/` - new spec for arrival with params

### Related Tasks
- Blocked by: T14970 landing on master. It rewrites this same module-load block in `editorStore.js`
  and adds its own carve-outs (`profile`, `t`, `game`). Build on the landed version.
- Feeds: T14910 (attribution coverage gate), T14930, T15000, T15010. Their numbers depend on
  these params arriving. T15120 reads the attribution this bug loses.
- Related: T3455, T7910, T13980 (campaign capture), T7670 (email link carve-out), T5677.

### Technical Notes
- Public routes (`/shared/*`) skip canonicalization, so their params already survive.
- `captureCampaignParams` is first-touch: once a tab holds attribution, later params are ignored.
- The payment block runs after `initSession`, so test it signed in. Signed out it proves little.
- Persistence is unchanged: `campaignParams` stays in sessionStorage until sign-up sends it.

## Implementation

### Steps
1. [x] Read-only prod aggregate: the share of sign-ups with any attribution, against the date of
       b95bb7f25. Recorded in the Evidence table above from the existing business-intelligence
       anchor (0 of 375, measured 2026-11-03) rather than a fresh prod pull, since no pre-bug
       baseline exists to split by month and a new prod DB connection needs the owner's explicit
       grant per `.claude/agents/business-intelligence.md`.
2. [ ] Failing tests: e2e, a signed-out arrival with `utm_*`, `ref` and a click id lands those
       values in `campaignParams`; e2e, a signed-in arrival with `?payment=success&session_id=`
       calls `/api/payments/verify`; unit, unrelated params are still stripped.
3. [ ] Keep the named params through canonicalization.
4. [ ] Confirm a sign-up after a campaign arrival stores the attribution in `user_segments`.
5. [ ] After staging deploy, repeat the two staging probes from the evidence table.

### Progress Log

**2026-11-05**: Filed as a priority bug. Waiting for T14970 to land, because it rewrites this block.

## Acceptance Criteria

- [ ] A paying user who returns from Stripe gets the confirmation, the credit refresh, the return
      to their page and the auto-export.
- [ ] `/payments/verify` runs once per return, and `payment` and `session_id` leave the URL after.
- [ ] A fresh visit with any campaign param stores it, and sign-up carries it into `user_segments`.
- [ ] An unrelated query param is still stripped, and T14970's URLs and `dev_account` keep working.
- [x] The prod attribution impact is recorded in this file.
