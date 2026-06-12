# T3620: Collection Share Links + Public Viewer

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-06-12

## Problem

Parents can share one reel at a time, but the epic's headline use case is "share a link to the culmination of all reels for a game (same aspect ratio)". No share type models a multi-reel, live-membership collection.

## Solution

New `share_type = 'collection'` whose definition (scope/filter/ratio) is stored in Postgres and **evaluated live against the sharer's profile DB at view time**. Game scope ships here; season/smart scopes reuse this end-to-end in T3640/T3670 (no new share plumbing there).

See [EPIC.md](EPIC.md) decisions #1, #2, #9.

### Postgres migration (v016 + `_SCHEMA_DDL` update in pg.py)

| Change | Detail |
|---|---|
| `shares.share_type` CHECK | add `'collection'` to `('video','game','annotation_playback')` |
| `shares.collection_definition JSONB NULL` | `{scope: {type: 'game'|'season'|'all', game_id?, season_label?}, filter: {tags?: [..], min_rating?}, aspect_ratio: '9:16'|'16:9', title: '<frozen display title incl. ratio word>'}` |

Frozen `title` follows the explicit-names-after-archive convention; everything else is evaluated live.

### Backend

- `POST /api/collections/share` (auth): body = collection definition; reuses token/email/public-toggle flow from `create_share` ([shares.py:145-225](../../../../src/backend/app/routers/shares.py)). Email via new `send_collection_share_email()` in [email.py](../../../../src/backend/app/services/email.py) (Resend, `_build_share_email` template).
- `GET /api/shared/collection/{token}` (public -- must live under `/api/shared/` for the middleware auth allowlist, [db_sync.py:293](../../../../src/backend/app/middleware/db_sync.py)): revoked->410; private->email check via `_get_email_from_request` (shares.py:100); then evaluate definition against the **sharer's** profile DB and return `{title, context_line, aspect_ratio, members: [{name, duration, presigned_url}]}` ordered per EPIC decision #3 (rank column exists only after T3630; until then order = quality score + recency -- read `season_rank` defensively as "column may not exist yet" is NOT allowed, so: this task ships ordering by frozen quality/recency only, and T3630 adds rank to the ORDER BY).
- **New helper required** (main new capability): read-only "ensure sharer profile DB" that opens the locally-cached DB OR downloads it from R2 -- the existing `materialization.py::_open_profile_db` (line 24) does NOT download and fails after machine restarts. Reuse `sync_database_from_r2_if_newer` machinery; do not write to the sharer's DB; do not touch their version counters.
- Presign member files with `generate_presigned_url_global` (existing share pattern, 4h expiry). Empty membership -> 200 with empty members + title ("no highlights yet" state), not 404.

### Frontend

- Route: regex `/^\/shared\/collection\/([a-f0-9-]+)$/` in App.jsx init (same pattern as existing share routes at ~341-348); mounts new `SharedCollectionView`.
- `SharedCollectionView`: header (frozen title, context line, ratio chip) + **CollectionPlayer from T3610** fed presigned URLs. 9:16 story layout, 16:9 filmstrip.
- **Mobile-PRIMARY** (EPIC decision #14): recipients open these links almost exclusively on phones. Design at 360-428px first -- full-screen player, tap/swipe navigation, no hover-dependent affordances; desktop is the scale-up. Include a native re-share button via `navigator.share` (pattern: `useWebShare`).
- Share creation UI: "Share" verb on T3610's CollectionHeader opens ShareModal generalized to collection mode (same contacts/public-toggle/copy-link/revoke flows; existing-share dedup: re-sharing the same definition surfaces the existing link). Copy line for live links: "this link always shows the current reels for this game".

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v016_collection_shares.py` - NEW
- `src/backend/app/services/pg.py` - `_SCHEMA_DDL` shares DDL update
- `src/backend/app/routers/shares.py` - create + resolve endpoints
- `src/backend/app/services/materialization.py` - extract/extend profile-DB-open helper with R2 download fallback (move helper to a neutral module if cleaner)
- `src/backend/app/services/email.py` - `send_collection_share_email()`
- `src/frontend/src/App.jsx` - route detection + mount
- `src/frontend/src/components/SharedCollectionView.jsx` - NEW public viewer
- `src/frontend/src/components/ShareModal.jsx` - collection mode
- `src/frontend/src/components/collections/CollectionHeader.jsx` - wire Share verb
- `src/frontend/src/components/SharedVideoOverlay.jsx` - reference for public-page patterns (auth gate, presigned playback)

### Related Tasks
- Depends on: T3600 (member durations), T3610 (CollectionHeader verb slot + CollectionPlayer component)
- Blocks: T3640 + T3670 (they pass season/smart definitions through this exact pipeline)
- Reuses: T1750/T2825's shares tables + token lifecycle; T1780's public-page approach; T3210's sender-name email helpers

### Technical Notes
- Sharing internals, optional-auth, routing: tech-notes section 5. Migration mechanics + deploy checklist: EPIC.md Migration Inventory.
- Resolver performance: each public view = sharer DB ensure + N presigns. Acceptable now; if needed add short-TTL in-memory cache keyed by share_token (note in design doc, do not build speculatively).
- Include the **Migration agent** (Postgres schema change).

## Implementation

### Steps
1. [ ] v016 migration + `_SCHEMA_DDL` update
2. [ ] Sharer-profile-DB ensure helper (R2 download fallback, read-only)
3. [ ] Create + resolve endpoints with live evaluation and presigned members
4. [ ] `send_collection_share_email()`
5. [ ] SharedCollectionView + App.jsx route
6. [ ] ShareModal collection mode + CollectionHeader Share verb
7. [ ] Backend tests: definition round-trip, live evaluation (member added after share appears in resolve), revoke->410, private->403, empty membership
8. [ ] E2E: create game share -> open link logged out -> reels play

### Progress Log

## Acceptance Criteria

- [ ] Game header Share verb creates/copies a live public link; email path works
- [ ] Public viewer plays current members with story/filmstrip layout per ratio
- [ ] Viewer is fully usable at 360px (tap/swipe navigation, no overflow, native re-share); E2E runs at a mobile viewport
- [ ] Publishing a new reel for the game appears on the next link visit (live membership proven in a test)
- [ ] Revoked links show 410 state; private links enforce recipient email
- [ ] Resolver works after the sharer's DB is evicted locally (R2 fallback test)
- [ ] Migration applied via admin endpoint on staging before prod
