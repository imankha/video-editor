# T13980: Manage Campaigns: create a named campaign, get a short attribution URL, show the name everywhere

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Campaign attribution already works end to end: the landing site relays `?ref=` and `utm_*`
across to the app (`src/landing/src/layouts/PageLayout.astro`), the app stores them in
`sessionStorage.campaignParams` on first touch (`App.jsx`, T3455), both auth paths send them
on signup, and `_determine_origin` (`analytics.py`) makes any non-invite-code `ref` (or, failing
that, `utm_campaign`) the new user's `origin`. But there is no place in the admin panel to
CREATE a campaign: the owner has to invent an id by hand, type a URL by hand, and remember which
ids exist. The Campaign table (`ChannelsTable`) shows raw origin strings, and only for origins
that already have users.

User request 2026-10-29, refined the same day:
- "Manage Campaigns" button: list current campaigns, create one from a piece of text, receive a
  URL; every user who signs up through that URL is attributed to the campaign.
- The link carries a SHORT id, because the point of the internal link builder is a short URL.
  The admin UI never shows that id as the label: it shows the campaign's text (name).
- Attribution must recognise the campaign id wherever it arrives: `ref`, `utm_campaign`, or any
  other attribution field a social platform or ad manager might put it in. Platforms rewrite
  links; the id must survive that.

## Solution

### Data model (Postgres, migration `v038_campaigns.py` + `_SCHEMA_DDL` in `pg.py`)

```sql
CREATE TABLE IF NOT EXISTS campaigns (
    id         TEXT PRIMARY KEY,          -- short code, see below
    name       TEXT NOT NULL,             -- the text the admin typed; what the UI displays
    created_by TEXT NOT NULL,             -- admin user_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `id` is generated server-side: 5 chars from `[a-z0-9]` with `0 o 1 l i` removed (31 symbols,
  about 28M ids), lowercase, retried on collision. 5 chars can never match the invite-code shape
  `^[0-9a-f]{8}$` (`INVITE_CODE_RE`), so `_determine_origin` never routes it to
  `resolve_invite_code`. Reject any generated id that equals a reserved origin bucket (`organic`,
  values of `REFERRER_HOST_BUCKETS`, `seo`) or ends in `_unknown`; regenerate.
- `name` is free text, trimmed, 1 to 80 chars, unique case-insensitively (so two campaigns are
  never displayed identically). Rename allowed (`PATCH /api/admin/campaigns/{id} {name}`): the
  id is the stored key, the name is display only, so a rename is safe.
- No delete: `user_segments.origin` stores the id as a plain string; removing the row would turn
  attributed users back into an opaque code.

### URL

`{base}/?ref={id}`, e.g. `https://reelballers.com/?ref=k7x2m`. `ref` is the highest-priority
signal in `_determine_origin` and the landing already relays it. `base` is
`https://reelballers.com` on prod only; dev and staging return the app origin (`FRONTEND_URL`,
today derived from the CORS list inside `payments.py`; move that derivation to a shared module)
so a URL made on staging attributes on staging.

Shorter still would be a path form `https://reelballers.com/c/k7x2m` redirecting to
`/?ref=k7x2m`; that needs a landing-site redirect rule and is NOT in this task. Note it in the
modal's help text only if the worker finds a one-line `_redirects` rule covers it; otherwise
leave it out.

### Attribution: recognise the id in any field

Two layers, both keyed on the campaigns table:

1. **At signup (authoritative).** `_determine_origin` gains one step, placed right after the
   invite-code branch and before the raw `ref` / `utm_campaign` fallthrough: collect every
   captured attribution value (`ref`, `utm_campaign`, `utm_source`, `utm_medium`,
   `utm_content`, `utm_term`, in that priority), lowercase them, and if any equals a registered
   `campaigns.id`, return `(that id, None)`. Unregistered `ref` / `utm_campaign` values keep
   today's behaviour (they become the origin verbatim, for campaigns set up only in an ad
   manager). `_determine_origin` therefore needs the utm fields passed in; `auth.py` already has
   them on both request models.
2. **Capture (frontend).** `App.jsx` currently writes `campaignParams` only when `ref`,
   `utm_campaign`, a click id or a referrer host is present. Change the condition to "any
   attribution field present" so an id arriving in `utm_source` or `utm_content` alone is not
   dropped before it reaches the server. `referralCapture.test.js` covers this capture.

Because the resolved id lands in `origin`, everything downstream is unchanged: the Campaign
table groups by origin, cohorts filter by origin, and account deletion keeps `origin` while
stripping `utm_*` (`_DEIDENTIFY_SEGMENT_COLUMNS`), so deleted users stay attributed.

Signups that arrived BEFORE the campaign row existed are not re-attributed; the id was not
registered, so their origin is whatever the raw params gave. Campaigns are created before the
link is shared, so this is the expected order; no backfill.

### Display: name, never the id

- `GET /api/admin/analytics/channels`: `LEFT JOIN campaigns c ON c.id = s.origin` and return
  `campaign_name` per row (NULL for organic, seo, unregistered utm values, invite origins).
  `ChannelsTable` renders `campaign_name` when present, with the id in small muted text after
  it; otherwise the origin string as today.
- `GET /api/admin/users` (and the `UserDetailPanel`) show the name the same way wherever
  origin is displayed today. One helper on the backend (`campaign_label(origin, name)`) or one
  frontend formatter; not both.
- `GET /api/admin/campaigns`: every campaign, newest first, with `id`, `name`, `url`,
  `created_at`, `signups` (count of `user_segments` where `origin = id`, honoring the
  `exclude_test` predicate like `analytics_channels`).

### Admin UI (`AdminScreen.jsx`, new `components/admin/CampaignsModal.jsx`, `adminStore.js`)

- "Manage Campaigns" button in the admin header row next to the env badge.
- Modal (no backdrop close): name input + Create on top; list below with name, signups, created
  date, the URL in a read-only field with a Copy button, and a pencil to rename inline. After
  Create, the new row appears at the top with its URL ready to copy (store insert, no refetch).
- Store: `campaigns`, `fetchCampaigns`, `createCampaign`, `renameCampaign`. All gestures.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v038_campaigns.py` (new) and `migrations/postgres/__init__.py`
- `src/backend/app/services/pg.py` (`_SCHEMA_DDL`: add `campaigns`)
- `src/backend/app/analytics.py` (`_determine_origin` registry step; id generator; reserved-bucket check)
- `src/backend/app/routers/auth.py` (pass utm fields into `_determine_origin`, both paths)
- `src/backend/app/routers/admin.py` (campaigns CRUD minus delete; `campaign_name` on channels and users)
- `src/frontend/src/App.jsx` (capture condition) + `src/frontend/src/utils/referralCapture.test.js`
- `src/frontend/src/screens/AdminScreen.jsx` (button)
- `src/frontend/src/components/admin/CampaignsModal.jsx` (new) + test
- `src/frontend/src/components/admin/ChannelsTable.jsx` (+ test), `UserDetailPanel.jsx`
- `src/frontend/src/stores/adminStore.js`
- `src/backend/tests/test_t13980_campaigns.py` (new); extend `test_analytics.py` for `_determine_origin`

### Related Tasks
- Sibling: T13990 (dimension selector), T14000 (build-version dimension)
- Builds on: T3455 (campaign param capture), T7910 (referrer relay)

### Technical Notes
- The acceptance test for attribution must drive the real path (URL params -> auth body ->
  `_determine_origin` -> `user_segments.origin`), not a mock of the resolver.
- Postgres track migration: deploy does not run it; the operator hits
  `POST /api/admin/migrate-postgres` after deploy. Until then the `campaigns` table is missing:
  `_determine_origin` must treat a missing table as "no registry match" with a loud log line
  (migration-window guard, backend-services.md), never fail a signup.
- Campaign rows created on dev or staging live in that env's Postgres only.
- Knowledge doc: `.claude/knowledge/backend-services.md` (admin router, migration system).

## Acceptance Criteria

- [ ] `POST /api/admin/campaigns {"name": "Fall Tryouts 2026"}` returns a 5-char id and a URL ending in `/?ref=<id>`; the modal shows "Fall Tryouts 2026", never the id as the label
- [ ] A duplicate name (case-insensitive) or an empty name fails loudly; nothing is written
- [ ] A new user whose first URL carried the id in `ref`, OR only in `utm_campaign`, OR only in `utm_source`, gets `user_segments.origin = <id>`; `GET /api/admin/campaigns` shows `signups` counting all three
- [ ] An unregistered `ref=my-ad-manager-name` still becomes origin `my-ad-manager-name` (today's behaviour kept)
- [ ] The Campaign table row for that origin reads "Fall Tryouts 2026" with the id muted beside it; renaming the campaign changes the label without touching any user row
- [ ] Signup still succeeds, with a loud log line, when the `campaigns` table does not exist yet
- [ ] Non-admin sessions get 403 on every campaigns endpoint
