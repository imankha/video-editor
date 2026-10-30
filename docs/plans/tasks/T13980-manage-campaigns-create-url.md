# T13980: Manage Campaigns: create a named campaign and get its attribution URL

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Campaign attribution already works end to end: the landing site relays `?ref=` and `utm_*`
across to the app (`src/landing/src/layouts/PageLayout.astro`), the app stores them in
`sessionStorage.campaignParams` on first touch (`App.jsx`, T3455), both auth paths send them
on signup, and `_determine_origin` (`analytics.py`) makes any non-invite-code `ref` the new
user's `origin`. But there is no place in the admin panel to CREATE a campaign: the owner has
to invent a slug by hand, type a URL by hand, and remember which slugs exist. The Campaign
table in the admin panel (`ChannelsTable`) only shows origins that already have users.

User request 2026-10-29: a "Manage Campaigns" button on the admin panel that lists the
current campaigns and lets me create one by entering a piece of text; I then receive a URL,
and every user who signs up through that URL is attributed to that campaign.

## Solution

Minimal: a `campaigns` registry in Postgres plus an admin modal.

**Backend**
- New Postgres table (migration `v038_campaigns.py` + `_SCHEMA_DDL` in `pg.py`):
  `campaigns(slug TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
- `POST /api/admin/campaigns {name}`: derive `slug` from the name (lowercase, `[a-z0-9-]`,
  3 to 40 chars; collapse runs of dashes). Refuse (409 / 422, loud) when the slug already
  exists, matches the invite-code shape `^[0-9a-f]{8}$` (`INVITE_CODE_RE`, it would be routed
  to `resolve_invite_code`), or collides with a reserved origin bucket (`organic`, every value
  of `REFERRER_HOST_BUCKETS`, `seo`, `*_unknown`). Returns the row plus `url`.
- `GET /api/admin/campaigns`: every campaign with `signups` (count of `user_segments` rows
  whose `origin = slug`, honoring the `exclude_test` predicate like `analytics_channels`),
  newest first, each with `url`.
- `url` = `{landing base}/?ref={slug}`. The landing base is `https://reelballers.com` on prod
  only; dev and staging return the app origin (`FRONTEND_URL`, already derived from the CORS
  list in `payments.py`; move that derivation to a shared place rather than duplicate it) so a
  URL created on staging attributes on staging. Use `ref`, not `utm_campaign`: `ref` is higher
  priority in `_determine_origin` and is already relayed by the landing site.
- No delete and no rename of the slug: `user_segments.origin` stores the slug as a plain
  string, so removing or renaming it would orphan attribution. The name is editable later if
  needed (not in this task).

**Frontend** (`AdminScreen.jsx`, new `components/admin/CampaignsModal.jsx`, `adminStore.js`)
- "Manage Campaigns" button in the admin header row next to the env badge.
- Modal (no backdrop close, per project rule): text input + Create button on top; list below
  with name, slug, signups, created date, the URL in a read-only field with a Copy button.
  After Create, the new row appears at the top with its URL ready to copy (event-driven
  insert into store state, no refetch).
- Store: `campaigns`, `fetchCampaigns`, `createCampaign`. Both are gestures (open modal,
  click Create); nothing persists reactively.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v038_campaigns.py` (new) and `migrations/postgres/__init__.py`
- `src/backend/app/services/pg.py` (`_SCHEMA_DDL`: add `campaigns`)
- `src/backend/app/routers/admin.py` (two endpoints; reuse `_require_admin`, `_test_exclusion`)
- `src/backend/app/analytics.py` (`INVITE_CODE_RE`, `REFERRER_HOST_BUCKETS` for the reserved check; no logic change)
- `src/frontend/src/screens/AdminScreen.jsx` (button)
- `src/frontend/src/components/admin/CampaignsModal.jsx` (new) + test
- `src/frontend/src/stores/adminStore.js`
- `src/backend/tests/test_t13980_campaigns.py` (new)

### Related Tasks
- Sibling: T13990 (dimension selector), T14000 (build-version dimension)
- Builds on: T3455 (campaign param capture), T7910 (referrer relay)

### Technical Notes
- Attribution path needs NO change: `?ref=<slug>` on the landing or app URL -> sessionStorage
  -> auth body -> `_determine_origin` returns `(slug, None)` because the slug is not an invite
  code. The acceptance test must drive that real path, not mock it.
- Postgres track migration: deploy does not run it; the operator hits
  `POST /api/admin/migrate-postgres` after deploy (CLAUDE.md Migration System). Mark `Migr`.
- Campaign rows created on dev or staging live in that env's Postgres only.
- Knowledge doc: `.claude/knowledge/backend-services.md` (admin router, migration system).

## Acceptance Criteria

- [ ] `POST /api/admin/campaigns {"name": "Fall Tryouts 2026"}` creates slug `fall-tryouts-2026` and returns a URL ending in `/?ref=fall-tryouts-2026`
- [ ] Creating the same name twice, a name that slugs to 8 hex chars, or a reserved bucket name fails loudly with a clear message; nothing is written
- [ ] A new user who signs up (Google or OTP test path) after landing on that URL gets `user_segments.origin = 'fall-tryouts-2026'`, and `GET /api/admin/campaigns` shows `signups: 1` for it
- [ ] The modal lists campaigns newest first with name, slug, signups, created date and a working Copy button; the created row appears without a reload
- [ ] Non-admin sessions get 403 on both endpoints
