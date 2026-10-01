# T11520: Harden share-link unfurls for real crawlers

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Epic Context

This is task 3 of 5 in the Social Cover Image epic. Read [EPIC.md](EPIC.md). After T11510, link
shares are the main way our cover reaches iMessage, WhatsApp, Instagram DM, Facebook and X. This
task makes sure that path actually works for each real crawler.

## Problem

`functions/shared/[token].js` emits these tags:

- `og:image` (a stable poster proxy, made absolute by `absolutizePosterUrl`)
- `og:video`
- `twitter:card`

The expert flagged three unverified risks that could make an unfurl show no image, or a broken
video:

1. **`og:video` is a presigned URL.** `shares.py:1043` sets `video_url =
   generate_presigned_url_global(...)`, and the edge page interpolates it (`[token].js:185, :231`).
   T4890 fixed this exact problem for `og:image`: crawlers refetch later, and edge-cached HTML keeps
   a signature that has since expired. `og:video` never got the same fix.
2. **WhatsApp image limits.** WhatsApp is commonly reported to drop `og:image` above roughly
   300KB, or when the fetch is slow. Our full-size poster is a 1080x1920 JPEG at q:v 3, which may
   be over that.
3. **Cold start.** `UPSTREAM_TIMEOUT_MS = 8000`. Memory note `project_staging_cold_start_breaks_unfurl`
   records that a ~145s staging cold start broke unfurls. Check that prod's poster proxy and share
   page answer within crawler budgets.

## Solution

Measure first, then fix only what fails:

- Use curl with each crawler user agent: `facebookexternalhit/1.1`, `WhatsApp/2.x`, `Twitterbot`,
  `Applebot` / iMessage LinkPresentation, and `Slackbot`. Fetch the share page, then the
  `og:image` URL. Record status, content-type, byte size, latency, and whether the HTML is
  edge-cached.
- Then fix whichever of these the measurements confirm:
  - If `og:video` expires in cached HTML: serve it through a stable proxy path, mirroring T4890's
    poster proxy. Never embed a presigned URL in cacheable HTML.
  - If the poster is too large for WhatsApp: add a size-capped `og:image` variant (for example
    1080 px max dimension, quality tuned to stay under about 300KB). Keep the full-size object
    untouched, per T5682. Derive the variant from the existing poster, like `ensure_reel_card_poster`.
  - If cold start breaks the fetch: make the poster proxy serve from the edge cache, or warm it.

## Context

### Relevant Files
- `src/frontend/functions/shared/[token].js` (L25-45, L185, L199-236): the edge share page.
- `src/frontend/functions/shared/share-page.test.js`.
- `src/backend/app/routers/shares.py` (~L1040-1060): builds `video_url` and `video_poster_url`.
- `src/backend/app/services/poster.py`: poster key scheme, `ensure_reel_card_poster` as the
  pattern for a derived size variant.
- `src/backend/tests/test_t4890_share_poster.py`.
- Game, collection and teammate pages (`functions/shared/{game,collection,teammate}/[token].js`)
  use the same pattern. Check `og:video` / `og:image` there too.

### Related Tasks
- Related: T4890 (stable poster proxy), T5890 (poster URLs missing API base), T5682 (card-size
  variants).

### Technical Notes
- Crawlers don't send cookies, so poster and video proxies must stay unauthenticated, with the same
  access model as today's share token.
- Any new derived object follows "explicit names after archive": a deterministic key, never
  re-derived ambiguously.

## Acceptance Criteria
- [ ] A measurement table (crawler x {page, og:image, og:video}: status, type, size, latency) is
      recorded in the Progress Log, for prod and staging.
- [ ] No presigned URL appears in edge-cacheable share HTML (test on the rendered HTML).
- [ ] `og:image` is under the WhatsApp size threshold, or this was measured and found unnecessary.
- [ ] Live-verified: a highlight link pasted into WhatsApp and iMessage shows the chosen cover.
