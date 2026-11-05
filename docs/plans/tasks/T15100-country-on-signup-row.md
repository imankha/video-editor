# T15100: Country on the sign-up row (US vs non-US readable on organic and on every arm)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (one nullable `user_segments` column with a postgres migration, Migration agent; one Pages Function; one field through the existing sign-up payload; admin dimension)
**Created:** 2026-11-04
**Updated:** 2026-11-05

Owner-approved 2026-11-04 from the acquisition-test prep list in
[topdown-vs-bottomup-2026-11-04.md](../bi/topdown-vs-bottomup-2026-11-04.md) section 10. The
product is multi-sport and multi-country; 40% of October's search clicks were non-US (Search
Console, n 129), the non-US soccer registered base is larger than the US competitive soccer tier,
and the paid test splits its arms by geography. Yet no sign-up carries a country, so the organic
comparator the geo arms need does not exist and "where do our users come from" is answered by
guessing from spelling.

## Problem

Audit 2026-11-04 (read-only): nothing in `src/backend/app` reads a country, `CF-IPCountry`,
`Accept-Language` or a geo lookup. IPs are kept only for abuse limits and audit
(`ip_rate_events.ip`, `impersonation_audit.ip`), unlinked to segments. The API runs on Fly and is
called directly by the browser; Fly adds no country header. The app itself is served by Cloudflare
Pages (`src/frontend/functions/*` are Pages Functions and receive `request.cf`), so the edge knows
the viewer's country for every page load, and nothing asks it.

## Solution

1. **Edge answers the country.** New Pages Function `src/frontend/functions/api/geo.js`
   (pattern: `functions/api/version.js`) returns `{"country": request.cf?.country ?? null}` as
   ISO 3166-1 alpha-2, `Cache-Control: no-store`. In local dev (Vite, no Pages runtime) the fetch
   404s and the value is null; never fabricate one.
2. **App captures it once per tab.** `captureCampaignParams` (`src/frontend/src/utils/campaignCapture.js`)
   fetches `/api/geo` on the Pages origin on first run and stores `country` in
   `sessionStorage.campaignParams` beside `utm_*` (first touch, same policy). Both sign-up paths
   already forward that object (`OtpAuthForm.jsx:188-197`, `googleAuth.js:74-83`); add `country`
   to both.
3. **Backend validates and stores.** `GoogleAuthRequest` and `VerifyOtpRequest`
   (`auth.py:300-310`, `638-649`) accept `country: str | None`; the server keeps it only if it
   matches `^[A-Z]{2}$`, else NULL. `create_user_segment` (`analytics.py:793-831`) writes
   `user_segments.country`, probing for the column the way `signup_build` does so a sign-up never
   fails before the admin migration has run.
4. **Migration.** Postgres track, next free version at implementation time (v042 is pencilled for
   T14980; check `app/migrations/postgres/` and take the next number; version collisions across
   branches are a known landmine): `ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS country
   TEXT`, plus `_SCHEMA_DDL` in `pg.py`. Existing rows stay NULL (no backfill; a guess from IP
   history would be fiction and the IPs are not linked anyway). Not in
   `_DEIDENTIFY_SEGMENT_COLUMNS`: a country is not a person.
5. **Admin reads it.** `by=country` on the Channels dimension (T15120's picker; if T15120 is not
   yet merged, add `country` to the same whitelist here), `by=country` in the Journey step
   inspector (`JourneyTab`/`StepInspector`, beside platform, origin, build, cohort_month), and a
   `country` filter on `GET /api/admin/users`. NULL shows as "unknown", never dropped.
6. **T14910 gate payload** gains `signups_by_country` for the window so the spend-readiness panel
   can show the US share beside the search-click share.

Out of scope: region or city, any IP storage, any geo database dependency on the backend, the
landing site (it has no sign-up; its visitor country belongs to the T7410 beacon's aggregate
counters if ever needed).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/functions/api/geo.js` (new) - edge country endpoint; a unit test beside `version.js` if one exists, else a minimal one
- `src/frontend/src/utils/campaignCapture.js` (+ test) - fetch once, store `country`
- `src/frontend/src/components/auth/OtpAuthForm.jsx`, `src/frontend/src/utils/googleAuth.js` - forward `country`
- `src/backend/app/routers/auth.py` - request models, pass-through to `create_user_segment`
- `src/backend/app/analytics.py` - `create_user_segment` column probe and write
- `src/backend/app/migrations/postgres/v0NN_user_segments_country.py` (new) + `src/backend/app/services/pg.py` `_SCHEMA_DDL`
- `src/backend/app/routers/admin.py` - `country` in the dimension whitelist, step inspector `by=country`, users filter, T14910 payload field
- `src/frontend/src/components/admin/StepInspector.jsx`, `JourneyTab.jsx`, `ChannelsTable.jsx` - the new `by` value
- `src/backend/tests/` - validation (`us` and `USA` rejected, `US` kept), probe path without the column, migration up is idempotent, admin grouping with "unknown"

### Related Tasks
- Pairs with: T14930 (arrival sport on `utm_content`): sport and country are the two segment dimensions the owner asked for; T14930 needs no column, this one does.
- Feeds: T15120 (dimension), T14910 (gates), the paid test's US vs non-US arms (organic comparator), the top-down's non-US slice in the revenue outlook.
- Pattern: T15010 (one nullable `user_segments` column, same probe-before-write rule) and T14000/v039 (`signup_build`).
- Migration operator step after deploy: `POST /api/admin/migrate-postgres` (postgres track never auto-runs).

### Technical Notes
- Why the edge and not the API: the browser calls Fly directly, so the API never sees a Cloudflare header; a backend geo lookup would add a MaxMind-style dependency and store or process IPs the project has chosen not to keep. The Pages Function is already in the request path of every app load.
- The value is a hint stamped at sign-up, like `click_source`; it is never updated later (a parent on holiday signs up where they are).
- Analytics rule check: in-house, aggregate reads, one column on an existing row, no third party, no per-event table.

## Implementation

### Steps
1. [x] Failing tests: `geo.js` returns `cf.country` and null without it; `captureCampaignParams` stores `country` once; both auth bodies carry it; backend keeps `US`, drops `us`/`USA`/`X1`; segment written without the column when the probe fails; admin `by=country` groups NULL as "unknown".
2. [x] Migration file + `_SCHEMA_DDL`; Migration agent review.
3. [x] Edge function, capture, auth payloads, backend write.
4. [x] Admin dimension, inspector, users filter. Gate payload moved to T14910: its endpoint does not exist yet.
5. [ ] Staging: sign up a fresh test account, confirm `country` on its segment row and in the Channels table; run the postgres migration on staging first, then prod after deploy.

### Progress Log

**2026-11-04**: Filed from the owner's approval of the acquisition-test prep list.

**2026-11-05**: Implemented as v043. Beyond the plan: `captureCampaignParams` first-touch now ignores `country` (else an organic visit blocks a later `?ref=` link in the tab); the server also rejects Cloudflare's `XX`; the pulse cards follow the country filter, so the selection chip stays true. A Channels `unknown` row filters on NULL. Migration agent sign-off: SIGN-OFF (v043 free, additive, idempotent; `copy_user_between_envs.py` needs the destination migrated first). Staging step 5 still to run.

**2026-11-05 (rework, owner review)**: country is now a segment filter on journey, journey step, funnel, channels, cohorts, builds and the dashboard read, not only users and pulse, with a direct Country selector in the filter bar. It is a standing filter: row picks compose with it, only Clear all drops it. Unattributed revenue is scoped by country. Options come in the dashboard payload (T8020 keeps mount to one request), then `/analytics/countries` when the window or Real pill changes. Not filtered: the platform breakdown (out of the requested scope). `/analytics/funnel` has no frontend loader since T14010.

## Acceptance Criteria

- [ ] A new sign-up on the Pages-served app carries a two-letter country on its `user_segments` row; local dev sign-ups carry NULL.
- [ ] Invalid or missing values are stored as NULL, never guessed.
- [ ] Admin Channels and the Journey step inspector can group by country with an explicit "unknown" row; the Users table can filter by it.
- [ ] Migration is additive and idempotent; sign-up succeeds before it has run.
- [ ] Relevant backend and frontend tests pass; Migration agent sign-off recorded.
