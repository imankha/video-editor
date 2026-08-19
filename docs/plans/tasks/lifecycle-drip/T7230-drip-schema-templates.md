# T7230: Drip Stores + Seed Copy (drip.sqlite, R2 templates doc, unsubscribe markers)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-08-19
**Updated:** 2026-08-19 (rewritten same day: was a Postgres migration; user directive —
Postgres is the most expensive part of the stack, ZERO new PG fields/rows; see EPIC §3)

Epic task 1/5 — see [EPIC.md](EPIC.md) for design decisions: writer-partitioned storage
(§3), single-writer idempotency (§4), stage model (§2), content rules (§8).

## Problem

The drip system needs its three stores — send log, templates, unsubscribe registry —
WITHOUT adding a single field or row to Postgres. Each store must live where its writer
runs (EPIC §3), or we recreate the multi-machine SQLite clobber class that T1960 escaped.

## Solution

### Store 1: `drip.sqlite` (tick-machine local, persisted to R2 `drip/drip.sqlite`)

Created lazily by the tick process (`_ensure_drip_db()`, `PRAGMA user_version` for future
schema bumps — mirrors `ensure_database()`'s pattern, but this is NOT a per-user/profile DB
and must NOT touch those code paths):

```sql
CREATE TABLE IF NOT EXISTS drip_sends (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    drip_day     INTEGER NOT NULL,          -- 1 | 3 | 7 | 14
    stage        TEXT,                      -- stage at claim time (point-in-time audit)
    template_key TEXT,                      -- "{day}:{stage}" into templates.json
    status       TEXT NOT NULL,             -- 'claimed' | 'sent' | 'failed' | 'skipped'
    detail       TEXT,                      -- failure/skip reason
    created_at   TEXT NOT NULL,             -- ISO8601 UTC
    sent_at      TEXT,
    UNIQUE (user_id, drip_day)              -- the idempotency guarantee (EPIC §4)
);
```

Download/upload helpers for the R2 object (plain get/put of the file — the tick is the
only writer, so no version negotiation is needed on download; upload still asserts the R2
etag it downloaded via If-Match so a rogue second writer is REFUSED loudly, never merged.
Never reuse the per-user CAS/sync machinery — this file is outside the user-DB universe).

### Store 2: `drip/templates.json` (R2, written by admin endpoints, read by tick)

```json
{
  "version": 1,
  "templates": {
    "1:uploaded": {"subject": "...", "body": "...", "enabled": true,
                    "updated_at": "2026-08-19T00:00:00Z"},
    "...": {}
  }
}
```

All 28 cells. Defaults: every cell enabled EXCEPT `1:completed` and `3:completed`. The
seed lives as a checked-in file `src/backend/app/drip_seed_templates.json` (greppable,
reviewable in git) plus an idempotent uploader `python -m app.drip_seed` that PUTs it to R2
**only if the object is absent** (If-None-Match: `*`) — a re-run can never clobber
admin-edited copy.

### Store 3: unsubscribe markers (R2, written by the public endpoint — T7250 wires it)

`drip/unsubscribed/{user_id}` — empty object (or `{"at": iso}` body for audit). PUT-only,
idempotent, distinct keys never conflict: app servers write these with zero coordination.
This task only documents the key layout; T7250 implements the writer.

### Seed copy

Same tone matrix + 4 fully-drafted cells as before (they set the voice; remaining cells
drafted at implementation per the matrix, user-reviewed in the admin editor before prod
enable — EPIC rollout step 3):

Tone: day 1 = helpful nudge with tutorial; day 3 = value-prop reminder; day 7 = direct
support ask ("what blocked you? reply and tell us"); day 14 = last touch, short, pure reply
invitation. Every body MUST contain the support line (memory
`feedback_winback_email_support_framing`): a variant of *"reply and tell us exactly where
you got stuck -- we'll walk you through it or fix it."* At most ONE link per email.

**(`1:uploaded`)** — subject: `Your game is in -- here's the 60-second next step`
```
Hi there,

Your game "{{game_name}}" is uploaded and ready on Reel Ballers. The next step is the fun
part: skimming the video and marking the plays worth keeping. It takes about a minute to
learn: https://assets.reelballers.com/tutorials/annotate.mp4

If anything was confusing or something didn't work, just reply and tell us exactly where you
got stuck -- we'll walk you through it or fix it.

-- Iman, Reel Ballers
```

**(`1:not_uploaded`)** — subject: `One upload turns your sideline video into a highlight reel`
```
Hi there,

You created your Reel Ballers account but haven't uploaded a game yet -- so you haven't seen
what it actually does: turn raw phone footage into a highlight reel your kid will rewatch.

All it takes is one game video from your phone. Here's the first step, under a minute:
https://assets.reelballers.com/tutorials/annotate.mp4

Stuck or unsure about anything? Reply and tell us where -- we're here to help, and we'd
rather fix a problem than send another email.

-- Iman, Reel Ballers
```

**(`7:clipped`)** — subject: `You did the hard part -- framing takes two minutes`
```
Hi there,

You've marked up {{clip_count}} plays on Reel Ballers -- that's the slow part, and it's
done. Framing (cropping the video to follow the action) is the quick part, and it's where
the reel starts looking professional: https://assets.reelballers.com/tutorials/framing.mp4

If framing is where you stopped, something probably wasn't obvious -- reply and tell us
exactly where you got stuck and we'll walk you through it, or fix it.

-- Iman, Reel Ballers
```

**(`14:not_uploaded`)** — subject: `Should we keep your Reel Ballers spot?`
```
Hi there,

Two weeks ago you signed up for Reel Ballers, and it looks like it never clicked into place.
That's on us to fix, not you.

If you've got 30 seconds: what got in the way? Just reply -- one sentence is plenty. And if
you'd still like to see what it does, this is the whole first step:
https://assets.reelballers.com/tutorials/annotate.mp4

-- Iman, Reel Ballers
```

Variable whitelist per stage (renderer contract, enforced in T7240): `not_uploaded` — none;
`uploaded`+ — `{{game_name}}`; `clipped`+ — `{{clip_count}}`. Seeds must not use a variable
outside their stage's whitelist.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/drip_store.py` — NEW: `_ensure_drip_db`, R2 download/upload
  (etag-asserted), templates-doc get/put helpers, unsubscribe-prefix list helper, key
  constants (`drip/drip.sqlite`, `drip/templates.json`, `drip/unsubscribed/`)
- `src/backend/app/drip_seed_templates.json` — NEW: the 28-cell seed (checked in)
- `src/backend/app/drip_seed.py` — NEW: idempotent one-shot uploader (If-None-Match: `*`)
- `src/backend/tests/test_drip_store.py` — NEW

### Related Tasks
- Blocks: T7240 (reads templates doc), T7250 (writes markers), T7260 (owns drip.sqlite),
  T7270 (edits templates doc)

### Technical Notes
- **NO Postgres migration, NO `_SCHEMA_DDL` change, NO Migration agent** — that is the
  point of this task's rewrite. Grep-provable at review.
- R2 access via the existing `r2_storage`/`storage` helpers — these are GLOBAL keys
  (env-prefixed like other non-user objects; confirm the env-prefix convention in
  `storage.py` so staging and prod never share drip state — the `games/` shared-namespace
  exception is exactly what we don't want here).
- SQLite: `?` params, `sqlite3.Row`, no `.get()` on rows (backend house rules). Do NOT
  route through `ensure_database()`/user-DB sync — this file must never enter the per-user
  CAS machinery or its version tables.
- Subject/body caps mirror bulk email (200 / 10000 chars) — enforced at the edit API
  (T7270), documented in the seed file header comment.

## Implementation

### Steps
1. [ ] `drip_store.py`: schema + `_ensure_drip_db` + R2 file helpers (etag-asserted upload)
2. [ ] Templates doc get/put + If-None-Match seed uploader
3. [ ] Write all 28 seed cells (4 above verbatim; rest per tone matrix + content rules)
4. [ ] Tests: ensure-db idempotent; UNIQUE(user_id, drip_day) enforced; seed uploader
       refuses to overwrite an existing doc; etag-mismatch upload REFUSES loudly
5. [ ] Run the seeder against dev R2; verify layout

### Progress Log

**2026-08-19**: Rewritten from a Postgres-migration task to SQLite+R2 stores per user
directive (zero new PG fields/rows). Original PG DDL preserved in git history if ever
needed.

## Acceptance Criteria

- [ ] Zero Postgres changes (no migration file, no `_SCHEMA_DDL` diff) — grep-proven
- [ ] `drip.sqlite` created lazily with UNIQUE(user_id, drip_day) verified by test
- [ ] Etag-asserted upload refuses a concurrent-writer conflict loudly (test with forced mismatch)
- [ ] 28 seed cells; `1:completed`/`3:completed` disabled; re-seeding cannot clobber edits
- [ ] Every seeded body contains the support-framing line and at most one CTA link
- [ ] Tests pass (relevant set)
