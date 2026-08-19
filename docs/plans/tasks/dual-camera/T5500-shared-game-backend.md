# T5500: Pool Entity + Invite/Join Backend

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

There is no cross-account "same real-world game" object. Sharing today is one-directional
(sharer → recipient copies); a game pool needs a symmetric coordination object up to **50
contributors** (both teams) can join and register feeds against. See [EPIC.md](EPIC.md)
decisions 1, 3, 5-7 (Postgres coordination + private per-member game rows; N-feed
registry; wall-clock origin as stored constant; names are perspectives; share/claim reuse).

## Solution

Postgres schema + FastAPI endpoints for the pool lifecycle: create → per-side invite
links → public status → join (signed-in and claim-through-signup) → membership reads +
rotate/leave. **Backend + schema only** (UX in T5510; feed registration in T5520).

### Schema (Postgres — `_SCHEMA_DDL` in `pg.py` AND a versioned migration; **check sibling
unmerged branches for the next version number at implementation**)

DDL sketch per EPIC decision 1 (exact shapes are the design gate's to settle):

```sql
CREATE TABLE IF NOT EXISTS shared_games (
    id SERIAL PRIMARY KEY,
    game_date DATE NOT NULL,
    sport TEXT NOT NULL,                  -- creator's sport SNAPSHOT at pool creation (§3 new-account prefill, T2915 rails)
    game_type TEXT NOT NULL,              -- creator's Home/Away/Tournament (joiner side-derivation inverts it)
    side_a_name TEXT,                     -- creator's team; captured at share time when missing (§1.2)
    side_b_name TEXT,                     -- other team (creator's Opponent snapshot)
    invite_token_any TEXT UNIQUE NOT NULL,    -- 'Anyone' link (default, untagged)
    invite_token_side_a TEXT UNIQUE,          -- side-tagged links, issued on demand (§1.2)
    invite_token_side_b TEXT UNIQUE,
    wall_clock_origin_blake3 TEXT,        -- STORED CONSTANT: anchor of shared-clock 0 (creator's first
                                          -- full feed; survives feed deletion — UX-SPEC §10 settled
                                          -- outcome; exact representation = architect call, incl. the
                                          -- clips-only provisional origin re-anchored by constant shift)
    created_by_user_id TEXT NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_game_members (
    shared_game_id INTEGER NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
    member_index INTEGER NOT NULL,        -- join order; drives FEED_COLORS; 0 = creator
    user_id TEXT NOT NULL REFERENCES users(user_id),
    profile_id TEXT NOT NULL,             -- the join BINDS to a profile (§3)
    side TEXT NOT NULL,                   -- 'a' | 'b' (from the join's team question)
    local_game_id INTEGER,                -- that member's private games.id
    display_name TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shared_game_id, member_index),
    UNIQUE (shared_game_id, user_id)      -- cap 50 enforced in the join handler
);

CREATE TABLE IF NOT EXISTS shared_game_feeds (
    id SERIAL PRIMARY KEY,
    shared_game_id INTEGER NOT NULL REFERENCES shared_games(id) ON DELETE CASCADE,
    member_index INTEGER NOT NULL,
    kind TEXT NOT NULL,                   -- 'full' | 'clip' (one full camera per member; clips unlimited — §5)
    label TEXT,
    withdrawn_at TIMESTAMPTZ,             -- remove-my-camera / creator removal (§10; delisted, refs survive)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_game_feed_videos (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES shared_game_feeds(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    blake3_hash TEXT NOT NULL,
    duration REAL, video_width INTEGER, video_height INTEGER, fps REAL,
    creation_time TIMESTAMPTZ,            -- mvhd stamp (T5495 client parse; ordering/seed per ALIGNMENT.md)
    wall_offset REAL,                     -- shared-clock seconds at t=0; NULL = never fabricated
    offset_source TEXT,                   -- 'auto' | 'metadata' | 'manual' (+ confidence; T5530 verdict ladder)
    offset_confidence REAL,
    offset_updated_by TEXT, offset_updated_at TIMESTAMPTZ,  -- drives the §6 re-lined-up toast (derived, LWW)
    UNIQUE (feed_id, sequence)
);
```

`games.shared_game_id INTEGER DEFAULT NULL` (profile_db) is needed at join time —
coordinate the profile_db migration file with T5520 (which adds `game_videos.feed_id`):
one file if they land together, never a reused version number.

### Endpoints (new router `src/backend/app/routers/pools.py`, prefix `/api/pools` — routes
per UX-SPEC gesture tables; "pool" is internal vocabulary, fine in routes, never in UI copy)

| Endpoint | Gesture (UX-SPEC §) | Behavior |
|---|---|---|
| `POST /api/pools` | First Copy/Share click in the invite sheet (§1.2) | `{game_id}` → creates pool from that game's metadata, member row 0, snapshots sport + game type + team names, binds the game as reference. Idempotent per game. |
| `POST /api/pools/{id}/link` | Later Copy clicks (§1.2) | Read-or-return existing tokens; side-tagged token issued on demand; writing the sharer's team name (when the same gesture captured it) also updates profile team fact + pool side name. |
| `GET /api/pools/token/{token}` | Status page load (§2) | PUBLIC, no auth: date, side names, creator first name, camera **kinds and counts — never member names** (§2 privacy), cap state, the token's side tag. Revoked → 410. |
| `POST /api/pools/{token}/join` | "Join game" (§3) | Auth required. `{profile_id \| new_profile: {name, sport}, team_side, opponent_name}` — one write: creates profile if needed (sport prefilled from snapshot), member row (side from the answer), private `games` row (name DERIVED from side: other-team inverts Home↔Away, same-team inherits verbatim — EPIC decision 6; `shared_game_id` set; `shared_by` provenance), registers existing feeds as references (delegates to T5520's materialization). Idempotent; at cap 50 → 409; revoked → 410. |
| `GET /api/pools/{id}` | Member game load / T5520 live-sync poll | Member-only: full registry (members, feeds, feed videos + offsets). |
| `POST /api/pools/{id}/rotate-link` | Replace invite link confirm (§10) | Creator-only; replaces ALL tokens; old ones 410. |
| `POST /api/pools/{id}/leave` | Stop sharing confirm (§10) | Member-only; releases the slot (count against 50 drops); the invite link re-admits later. |

**Claim-through-signup:** the token rides the URL path through auth (T5730/T2915 deferred
resolution rails — the pending-claim hook `resolve_pending_shares` in `clips.py` ~2578);
after signup the §3 confirm runs with the token's side tag intact.

**T1180 exception:** a pool game legitimately exists with zero videos (§1.3 share-first
AND T5495's general awaiting-video creation). Coordinate the `create_game` exception shape
with T5495 — one exception, not two.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` additions (near shares DDL)
- NEW `src/backend/app/routers/pools.py` + registration in `src/backend/app/main.py`
- `src/backend/app/routers/shares.py` — token generation pattern
- `src/backend/app/routers/clips.py` — `resolve_pending_shares` (~2578) deferred-join hook
- `src/backend/app/services/materialization.py` — `_insert_game_with_videos` + `shared_by` provenance (T5330 quest-blind)
- `src/backend/app/database.py` — `ensure_database()` `games.shared_game_id`
- `src/backend/app/migrations/postgres/` + `migrations/profile_db/` — NEW versioned files (Migration agent; **never auto-run — `POST /api/admin/migrate`**)
- `src/backend/tests/test_pools.py` — NEW

### Related Tasks
- Part of [Game Pools epic](EPIC.md); blocks T5510–T7310
- Depends on: T5495 (T1180 exception coordination)
- Reuses: shares.py tokens; T5720/T5730 claim rails; T2915 inherited-sport; T5330 provenance
- Normative UX contract: UX-SPEC §1.2 (writes table), §2, §3, §10

### Technical Notes
- Knowledge docs: [backend-services.md](../../../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md)
- L-tier → Architect design gate. Must settle: wall-clock-origin storage shape (§10 flags
  this explicitly, incl. clips-only provisional origin re-anchoring — EPIC decision 3),
  token-per-side representation, member-check helper, pending-claim table shape
- `%s` params + RealDictCursor; membership check helper in ONE place, used by every `/{id}` handler
- Every write above traces to a named gesture (Copy/Share click, Join click, Replace
  confirm, Leave second tap) — opening modals writes nothing (T7150 rule)

## Implementation

### Steps
1. [ ] Architect design doc (origin constant, token shape, pending-claim, member helper) — user approval gate
2. [ ] `_SCHEMA_DDL` + Postgres migration (4 tables) + profile_db `games.shared_game_id` (coordinated with T5520)
3. [ ] Router: create / link / public status / join / get / rotate-link / leave + member helper
4. [ ] Claim-through-signup wired into the existing pending-share resolution hook
5. [ ] T1180 awaiting-video exception (with T5495)
6. [ ] Tests: create idempotent; side derivation (invert vs inherit); join idempotent / 409 at 50 / 410 revoked+rotated; public status leaks no names; signup claim keeps side tag; provenance stamped; leave releases slot + rejoin works

## Acceptance Criteria

- [ ] One Copy click creates the pool + Anyone link; side-tagged links issue on demand; team-name capture writes profile fact + pool side in the same gesture
- [ ] Public status endpoint requires no auth and exposes kinds/counts only — no member names, emails, or user_ids
- [ ] Join binds to a profile (or creates one with the sport snapshot), derives the game name from the chosen side, and is idempotent; cap 50 and revoked/rotated tokens behave per spec
- [ ] Claim-through-signup completes with the side tag intact
- [ ] Pool, members, offsets, and the stored wall-clock origin survive the creator's game deletion (§10 settled outcome)
- [ ] Migrations runnable via `POST /api/admin/migrate`; version numbers checked against sibling branches; backend tests pass
