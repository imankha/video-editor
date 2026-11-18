# T16900: Tell direct sign-ups from unknown sources

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Tier:** L (schema change: one nullable column on `user_segments`; backend + admin frontend; Migration agent)
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

Today the admin Campaigns table groups sign-ups by where they came from. On production, 418 sign-ups
show as "organic" and 7 as "seo". "seo" means the visitor arrived from a search engine. "organic"
does not name a channel. It means we found no source at all: a typed address or bookmark, an app that
hides where the visitor came from, or a referring website that is not on our list.

The referring website is read once at sign-up to pick the label and is then thrown away. So the 418
"organic" sign-ups can never be broken down, even after the list of known websites grows. The
campaign medium (for example "email") and search term are already saved, but the table cannot group
by them. Found by the owner on 2026-11-17 while reading the Campaigns table.

We will save the referring website's name with each new sign-up. We will split "organic" into
"direct", meaning no referring website, and "other website", meaning a website we do not recognise
yet. We will add email providers and AI assistants such as ChatGPT and Perplexity to the known list.
The table will also group by medium and by referring website.

This follows the standard practice in analytics tools such as Google Analytics 4. Save the raw source
fields at sign-up and work out the channel when reading, so a better list also relabels past sign-ups.
Re-labelling the existing 418 is ruled out, because their referring website was never saved.

It worked when, after a week of new sign-ups on production, "organic" is no longer the only bucket
without a source. New sign-ups appear as "direct" or "other website", and grouping by referring
website shows the actual website names.

## Ruling

User picked "direct / other-website" (owner, 2026-11-17): new sign-ups with no source signal get
"direct" (no referring website) or "other-website" (a referring website we do not recognise). Existing
rows keep "organic", which now means "before 2026-11-17, source unknown", and the Campaigns table
shows a note saying so. Keeping "organic" for new sign-ups was ruled out because the default view
would still hide the split.

## Implementer detail

### Current state (verified 2026-11-17)
- Landing `src/landing/src/attribution.ts` relays `lref` (external referrer hostname only), `lp`,
  utm_* and click ids on CTA links (T15000).
- App `src/frontend/src/utils/campaignCapture.js` turns `lref`, or else `document.referrer`'s host,
  into `referrer_host` and sends it on both auth paths.
- Backend `routers/auth.py` passes `referrer_host` to `_determine_origin`
  (`src/backend/app/analytics.py:835`). That function uses it only through `bucket_referrer_host` to
  break the `organic` fallback, then discards it. `user_segments` (`services/pg.py:285`) has
  utm_source/medium/campaign/content/term, click_source, landing_path, but no referrer host.
- `ChannelDimension` (`services/analytics.py:88`) supports origin, utm_source, utm_campaign,
  utm_content, click_source, referral_channel, country. It does not support utm_medium or
  referrer host.

### Steps
1. Postgres migration `v050`: `ALTER TABLE user_segments ADD COLUMN referrer_host TEXT` (nullable);
   mirror in `_SCHEMA_DDL`. Add a migration-window probe like `segment_has_landing_path`.
2. Store the normalized hostname (lowercase, port stripped, max 253 chars, hostname characters only)
   at sign-up on both auth paths. Kept on account deletion, like `landing_path` (T15010 ruling).
3. `_determine_origin` fallback, per the ruling: no referrer host gives `direct`; an unrecognised host
   gives `other-website`. Existing `organic` rows stay; the Campaigns table shows a note that
   `organic` means "source unknown, before 2026-11-17". Add both to `_is_reserved_origin` so a campaign id can never collide.
4. `REFERRER_HOST_BUCKETS`: add `email` (mail.google.com, outlook.live.com, mail.yahoo.com, ...) and
   `ai` (chatgpt.com, chat.openai.com, perplexity.ai, gemini.google.com, copilot.microsoft.com,
   claude.ai). Check that `mail.google.com` / `gemini.google.com` match before the generic google.com
   to seo rule (`bucket_referrer_host` suffix matching currently returns seo for any *.google.com).
5. Add `utm_medium`, `utm_term` and `referrer_host` to `ChannelDimension` / `_CHANNEL_GROUP_EXPR`,
   and add the admin "Group by" options in `adminStore.js` / the Campaigns UI.
6. Visit beacon `bucket_visit_source` already returns `direct`; keep the vocabularies aligned.

### Relevant files
- `src/backend/app/analytics.py` (origin, buckets, reserved origins)
- `src/backend/app/routers/auth.py` (both sign-up paths)
- `src/backend/app/services/pg.py`, `src/backend/app/migrations/postgres/v050_*.py`
- `src/backend/app/services/analytics.py` (channel dimensions)
- `src/frontend/src/stores/adminStore.js` and the Campaigns table component
- Tests: `tests/test_analytics.py`, `tests/test_analytics_dashboards.py`

### Related tasks
- T7910 (referrer host bucketing), T15000 (first touch survives landing navigation), T15010
  (landing_path column, same pattern), T15120 (channel read-out).

## Acceptance Criteria
- [ ] A sign-up arriving with no referrer and no campaign signal stores `referrer_host` NULL and the
      "no source" origin chosen in the ruling.
- [ ] A sign-up from an unlisted website stores its hostname and is labelled "other website".
- [ ] A sign-up from mail.google.com is labelled email, and one from chatgpt.com is labelled ai (not seo).
- [ ] Admin Campaigns can group by medium and by referring website; blank values show as "unknown".
- [ ] Existing rows are unchanged; the migration is idempotent.
