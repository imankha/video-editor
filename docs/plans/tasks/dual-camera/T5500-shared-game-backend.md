# T5500: Shared Game Entity + Invite/Join Backend

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

There is no cross-account "same real-world game" object. Sharing today is one-directional
(sharer → recipient copies); a dual-camera game needs a symmetric coordination object both
accounts can write to (metadata, membership, each side's uploaded videos, alignment
offsets). See [EPIC.md](EPIC.md) for the architecture decisions (Postgres coordination +
local game rows; camera = member slot; wall-clock time model).

## Solution

Postgres schema + FastAPI endpoints for the Shared Game lifecycle: create → invite token →
join (signed-in and deferred no-account) → membership/state reads. This task is
**backend + schema only** (frontend in T5510; video registration in T5520).

### Schema (Postgres — add to `_SCHEMA_DDL` in `pg.py` AND a versioned migration)

```sql
CREATE TABLE IF NOT EXISTS shared_games (
    id SERIAL PRIMARY KEY,
    invite_token TEXT UNIQUE NOT NULL,          -- same token style as shares.share_token
    name TEXT NOT NULL,
    game_date DATE NOT NULL,
    game_time TEXT,                             -- free-form "10:30 AM" (no TZ headaches)
    location TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,                     -- creator can kill the invite link
    alignment_confirmed_at TIMESTAMPTZ          -- set by T5530 confirm gesture
);

CREATE TABLE IF NOT EXISTS shared_game_members (
    shared_game_id INTEGER NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
    member_index INTEGER NOT NULL,              -- 0 = creator, 1 = joiner (cap 2 in v1)
    user_id TEXT NOT NULL REFERENCES users(user_id),
    profile_id TEXT NOT NULL,                   -- which profile the game lives in
    local_game_id INTEGER,                      -- that member's games.id (set on bind/join)
    display_name TEXT,                          -- what the other side sees ("Sam")
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shared_game_id, member_index),
    UNIQUE (shared_game_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_game_videos (
    id SERIAL PRIMARY KEY,
    shared_game_id INTEGER NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
    member_index INTEGER NOT NULL,
    sequence INTEGER NOT NULL,                  -- half ordering within one camera
    blake3_hash TEXT NOT NULL,
    duration REAL,
    video_width INTEGER,
    video_height INTEGER,
    fps REAL,
    wall_offset REAL,                           -- shared-clock seconds at this video's t=0
                                                -- (NULL until T5530 aligns; slot-0 first
                                                -- video conventionally 0)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shared_game_id, member_index, sequence)
);
```

Deferred no-account join: reuse the `pending_teammate_shares` pattern — design decides
between a new `pending_shared_game_joins` table or generalizing the existing one. The
pending row stores `(shared_game_id, recipient_email-or-nothing, created_at, resolved_at,
resolved_user_id)`; resolution runs at first login after signup (same hook point
`resolve_pending_shares` uses in `clips.py`).

### Endpoints (new router `src/backend/app/routers/shared_games.py`, prefix `/api/shared-games`)

| Endpoint | Gesture | Behavior |
|---|---|---|
| `POST /` | Create button | body `{name, game_date, game_time?, location?, local_game_id?}` → creates `shared_games` + member row 0 (display_name from the user's profile); returns `{id, invite_token}`. `local_game_id` binds an existing game as slot 0. |
| `GET /token/{invite_token}` | Landing page load | PUBLIC (no auth): `{name, game_date, game_time, location, creator_display_name, members:[{member_index, display_name, video_count}], revoked}`. Never leaks emails/user_ids. |
| `POST /token/{invite_token}/join` | Join button | Auth required. Creates member row 1 + materializes a local game row in the caller's active profile (name/date from shared game metadata; `games.shared_game_id` set; `shared_by` provenance stamped — see EPIC decision 8 / T5330). Idempotent: joining twice returns the existing membership. Full (2 members) → 409. Revoked → 410. |
| `GET /{id}` | Game load / refresh | Member-only: full state incl. `shared_game_videos` + `wall_offset`s. This is what T5520's propagation reads. |
| `POST /{id}/revoke` | Revoke menu item | Creator-only: sets `revoked_at` (kills the token; existing members unaffected). |

`games.shared_game_id INTEGER DEFAULT NULL` is a **profile_db** column needed at join/bind
time — coordinate with T5520 (which owns the profile_db migration adding `camera`): this
task's migration adds `shared_game_id` in the SAME profile_db migration file if T5520 has
not landed first; otherwise T5520's file carries both. One migration file, no collisions
(never reuse versions — see reference_running_migrations).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` additions (~L97-170 near shares DDL)
- `src/backend/app/routers/shared_games.py` — NEW router
- `src/backend/app/main.py` — router registration (~L154-158)
- `src/backend/app/routers/shares.py` — token generation pattern to copy
- `src/backend/app/routers/clips.py` — `resolve_pending_shares` (~2578): deferred-join hook point
- `src/backend/app/services/materialization.py` — provenance stamping pattern (`shared_by`)
- `src/backend/app/database.py` — `ensure_database()` `games` table: add `shared_game_id`
- `src/backend/app/migrations/postgres/` + `src/backend/app/migrations/profile_db/` — NEW migration files (Migration agent)
- `src/backend/tests/test_shared_games.py` — NEW

### Related Tasks
- Part of [dual-camera epic](EPIC.md); blocks T5510-T5560
- Reuses: shares.py token pattern; T2915 deferred link-resolution; T5330 provenance rules
- Coordinate: T4910 (share-game-via-link) — overlapping token/claim plumbing, whichever lands first owns it

### Technical Notes
- Knowledge docs: [backend-services.md](../../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../../.claude/knowledge/persistence-sync.md)
- L-tier task (schema + new router) → Architect design gate before implementation. Design
  must settle: pending-join table shape, quest-provenance mechanism (EPIC decision 8), and
  whether `GET /token/{...}` gets an edge-cacheable variant for unfurl (stretch).
- `%s` params + RealDictCursor for Postgres (rows are dicts); `_require_admin`-style
  imperative member checks in every `/{id}` handler (membership check helper, one place).
- All writes trace to explicit gestures (create/join/revoke buttons) — no reactive writes.

## Implementation

### Steps
1. [ ] Architect design doc (pending-join shape, provenance, member-check helper) — user approval gate
2. [ ] `_SCHEMA_DDL` + Postgres migration (3 tables) + profile_db `games.shared_game_id` migration
3. [ ] Router: create / token-info / join / get / revoke + membership helper
4. [ ] Deferred-join resolution wired into the existing pending-share resolution hook
5. [ ] Tests: create→join happy path, idempotent join, 409 full, 410 revoked, token info leaks nothing private, deferred join resolves at signup, provenance stamped

## Acceptance Criteria

- [ ] Creator can create a shared game (optionally binding an existing local game) and gets a working invite token
- [ ] `GET /token/{token}` returns game info with no auth and no private data
- [ ] Signed-in join creates membership + a local game row with `shared_game_id` and `shared_by` provenance set
- [ ] Join is idempotent; full game 409s; revoked token 410s; existing members survive revoke
- [ ] No-account visitor's join completes automatically after signup (deferred resolution)
- [ ] Backend tests pass; migrations runnable via `POST /api/admin/migrate`
