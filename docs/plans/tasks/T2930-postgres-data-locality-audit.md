# T2930: Postgres Data Locality Audit

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-15
**Updated:** 2026-05-15

## Problem

**Architectural rule: all per-user data belongs in profile.sqlite. Postgres is only for global data or data shared between multiple accounts.** Several Postgres tables violate this rule by storing per-user data that should be in the user's profile.

The core issue: `game_storage_refs` stores per-user, per-game storage expiration in Postgres. Each user x game combination has its own expiration date — this is per-user data, not global. It should live in profile.sqlite alongside the `games` and `game_videos` tables it relates to.

Consequences of violating this rule:

1. **Data is split across systems.** Games live in SQLite, but their expiration lives in Postgres. Checking if a game is expiring requires cross-joining two databases.

2. **Missing from R2 sync.** Per-user SQLite syncs to R2 automatically — portable, backed up, survives restarts. Postgres per-user data doesn't benefit from this.

3. **Script friction.** Debugging or migrating a user requires downloading their SQLite AND querying Postgres separately. The Beach FC incident showed this — `game_storage_refs` had no rows for a game the user clearly had, because the refs were never inserted.

## Concrete Example: game_storage_refs

`game_storage_refs` stores `(user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)` in Postgres. This is per-user, per-profile data that tracks when each game's storage credit expires. It belongs alongside the `games` and `game_videos` tables in the user's SQLite, where the game data actually lives.

The only reason it's in Postgres today is that the R2 cleanup sweep needs a global view of all refs to decide when a game file can be deleted (when zero users reference it). This is a valid cross-user concern, but the solution should be a lightweight global index in Postgres (just `blake3_hash` + `ref_count` or a periodic scan), not the full per-user expiration data.

## Solution

Audit every Postgres table and determine if its data is per-user (belongs in SQLite) or truly cross-user (belongs in Postgres).

### Audit Checklist

For each Postgres table, answer:
1. **Is this data scoped to a single user?** If yes, it's a candidate for SQLite.
2. **Does any cross-user query need this data?** If yes, what's the minimal Postgres footprint?
3. **Does this data relate to entities in SQLite?** If yes, locality argues for SQLite.
4. **Would moving it to SQLite break any endpoint?** What refactoring is needed?

### Tables to Audit

| Table | Per-user? | Cross-user need? | Candidate? |
|-------|-----------|-------------------|------------|
| `users` | Yes (one row per user) | Yes (login, admin) | No — auth is inherently cross-user |
| `sessions` | Yes | Yes (validation from any machine) | No — must be accessible pre-sync |
| `otp_codes` | Yes | Yes (email verification) | No — ephemeral auth |
| `admin_users` | No | Yes | No |
| `impersonation_audit` | Yes | Yes (admin queries) | No |
| `game_storage_refs` | **Yes** | Yes (R2 cleanup sweep) | **YES — move expiry to SQLite, keep minimal ref index in Postgres** |
| `r2_grace_deletions` | No (per-hash) | Yes (cleanup sweep) | No — global R2 lifecycle |
| `shares` | Yes (sharer) | Yes (recipient lookup) | Maybe — investigate |
| `share_videos` | Yes | Yes (share token lookup) | Maybe — follows shares |
| `share_games` | Yes | Yes (share token lookup) | Maybe — follows shares |
| `pending_teammate_shares` | Yes | Yes (recipient signup) | Maybe — follows shares |

### Expected Outcome

1. **game_storage_refs** → Move `storage_expires_at` and `game_size_bytes` into a new `game_storage` table in SQLite (alongside `games`/`game_videos`). Keep a lightweight `game_refs(blake3_hash, user_count)` in Postgres for R2 cleanup. The sweep queries Postgres for hashes with zero refs, not per-user expiry dates.

2. **shares ecosystem** → Likely stays in Postgres. Share tokens must be resolvable without knowing which user shared them, and recipients need to find shares by email before they have a profile. Document the reasoning.

3. **Document the boundary** — Write a clear rule in the persistence-model skill: "All per-user data goes in profile.sqlite. Postgres holds only global data and data shared between multiple accounts. When a global process (like R2 cleanup) needs to aggregate per-user data, it queries a lightweight Postgres index — never stores the per-user data itself in Postgres."

## Context

### Relevant Files
- `src/backend/app/services/pg.py` — Postgres schema DDL
- `src/backend/app/services/auth_db.py` — game_storage_refs CRUD
- `src/backend/app/services/sharing_db.py` — shares CRUD
- `src/backend/app/database.py` — SQLite schema DDL
- `src/backend/app/services/storage_credits.py` — credit/expiry logic
- `src/backend/app/routers/games.py` — game endpoints that join SQLite + Postgres
- `src/backend/.claude/skills/persistence-model/SKILL.md` — persistence rules

### Related Tasks
- T2920 Migration System Infrastructure — will be needed to execute any moves
- T1960 Migrate Global SQLite to Fly Postgres — the migration that created this split

### Technical Notes
- Moving data between Postgres and SQLite requires a migration script (download profile, insert rows, upload)
- The R2 cleanup sweep (`app/services/storage_credits.py`) must be refactored to query a lightweight Postgres index instead of full per-user refs
- `game_storage_refs` currently has `ON CONFLICT ... DO UPDATE` upsert semantics that need equivalent SQLite implementation

## Implementation

### Steps
1. [ ] Audit all Postgres tables against the checklist above
2. [ ] For each "YES" candidate, design the SQLite schema + minimal Postgres index
3. [ ] For game_storage_refs specifically: design new `game_storage` SQLite table + `game_ref_counts` Postgres view/table
4. [ ] Write migration script to move data (uses T2920 infrastructure if available)
5. [ ] Refactor R2 cleanup sweep to use new Postgres index
6. [ ] Refactor storage credits endpoints to read from SQLite
7. [ ] Update persistence-model skill with data locality rules
8. [ ] Write tests verifying data consistency between SQLite and Postgres index

## Acceptance Criteria

- [ ] Every Postgres table has a documented rationale for being in Postgres vs SQLite
- [ ] game_storage_refs expiry data lives in user's profile.sqlite
- [ ] R2 cleanup sweep works with lightweight Postgres ref counts
- [ ] Storage extension UI reads expiry from SQLite (no Postgres round-trip for display)
- [ ] persistence-model skill documents the data locality boundary
- [ ] Migration script moves existing game_storage_refs data for all users
