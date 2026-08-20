# T7410: First-party visit beacon (landing + app, aggregate-only)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-20

## Problem

The funnel's first stage (requirement 2.1: **visit** → sign-up) is invisible. The landing site (`src/landing`, static Astro) emits no analytics at all — it only relays `utm_*`/`ref` params onto CTA links (`PageLayout.astro:41-64`). The app's Cloudflare beacon (`utils/analytics.js:58`) is inert without `VITE_CF_ANALYTICS_TOKEN` and is an external dependency anyway. Visit → sign-up conversion by source cannot be computed, so requirement 2.4's channel attribution starts at sign-up instead of at the visit.

## Solution

A first-party, cookie-free, aggregate-only visit counter: a tiny inline beacon on landing + app pre-auth pages POSTs `{source_bucket, page_class}` to a new unauthenticated backend endpoint, which buffers in-process (same pattern as `_DailyCounterBuffer`) and flushes `(day, source) -> count` rows into `analytics.sqlite.visit_daily`. No cookies, no user IDs, no IP storage, no fingerprinting — consistent with the kids-privacy brand stance (see the planned /kids-privacy page, T7120).

See [EPIC.md](EPIC.md) for the no-external-tools / aggregates-only / no-new-PG directives.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/layouts/PageLayout.astro` — add beacon call next to the existing param-relay script
- `src/frontend/src/utils/analytics.js` — pre-auth app visit ping; decide fate of the inert CF/zaraz sink (recommend: delete, it's dead weight — but confirm T3000's status first)
- `src/backend/app/routers/telemetry.py` — `POST /api/t` (unauthenticated, 204, rate-limited) alongside the existing client-error route
- `src/backend/app/services/analytics_store.py` — `visit_daily` table (bump `PRAGMA user_version` to 2; depends on T7400's store module)

### Related Tasks
- Depends on: T7400 (`analytics_store.py`)
- Blocks: T7440 (visit → signup conversion by source)
- Supersedes: T3000 (fix-cloudflare-web-analytics) — mark it accordingly if this lands

### Schema
| Table | Columns | Notes |
|---|---|---|
| `visit_daily` | `day TEXT` (UTC date), `source TEXT`, `page_class TEXT` (`landing`/`app`/`share`), `count INTEGER`, PK(day, source, page_class) | upsert-increment only |

`source` buckets (computed CLIENT-side from URL params + `document.referrer`, mirroring `_determine_origin`'s priority order): `invite`, `referral`, `social-<network>` (from click-IDs: fbclid/gclid/ttclid/etc — reuse the App.jsx:151-157 mapping), `seo` (search-engine referrer), `community`, `direct`, `other`. Keep the bucket list in ONE shared constant server-side; the beacon sends raw hints, the server buckets — do not fork the mapping logic into three copies.

### Technical Notes
- **CORS:** endpoint must accept the landing origin (`reelballers.com`) + app origin; POST, no credentials.
- **Abuse/bots:** cheap-and-honest only — drop obvious bot UAs, rate-limit per-IP in-memory (IP used for limiting only, never stored). Perfect bot filtering is out of scope; investor charts care about trend shape.
- **Loss tolerance:** in-process buffer means a crash loses <=15s of counts; machine replacement loses the un-uploaded local delta. Acceptable for visit counts — document it, don't engineer around it.
- **Share pages count too** (`page_class='share'`): shared-reel views are the top of the referral loop (feeds T7440's K-factor story).
- **Privacy line for the beacon script:** no cookies, no localStorage, no IDs — literally a counter ping. Keep the payload so small the privacy page can quote it.
- Landing is static + cross-host: hardcode the API base per env the same way CTA hrefs are built; beacon must never block rendering (fire-and-forget, `navigator.sendBeacon` with fetch fallback).

## Implementation

### Steps
1. [ ] `visit_daily` + user_version bump in `analytics_store.py`
2. [ ] `POST /api/t` with buffer + flush + CORS + rate limit
3. [ ] Landing beacon in `PageLayout.astro` (all pages); app pre-auth ping; source-hint capture
4. [ ] Remove/retire the zaraz/CF sink in `analytics.js` (after confirming T3000 status)
5. [ ] Tests: bucketing priority (invite beats utm beats referrer), upsert-increment, unauthenticated 204, CORS

## Acceptance Criteria

- [ ] A landing visit with `?utm_source=instagram&fbclid=...` increments `(today, social-facebook...)` — bucket priority matches `_determine_origin` order
- [ ] Zero cookies/IDs/IP stored (code-review provable); payload documented in the task file for the privacy page
- [ ] Visit counts by day × source × page_class queryable from analytics.sqlite
- [ ] Landing Lighthouse/CLS unaffected (beacon async, fire-and-forget)
