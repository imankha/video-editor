# T2845: Scalability Audit

**Status:** TESTING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-13
**Updated:** 2026-05-13

## Problem

The Team Sharing Alpha epic (T2800-T2860) has shipped several PRs building out sharing infrastructure: tagged teammates, shares table refactor, game + annotation materialization, email delivery. Before continuing to the remaining tasks, we need to audit whether these design decisions will hold at millions of users -- or whether we're building on foundations that will need painful rework later.

## Solution

Code review + architecture audit of all merged Team Sharing Alpha PRs. Produce a written assessment with concrete recommendations (keep, change, or defer).

## Context

### Relevant PRs / Tasks to Audit
- **T2800** - `tagged_teammates` JSON on raw_clips, `teammate_emails` table, autocomplete APIs
- **T2810** - Annotation UI (frontend only, less relevant to scale)
- **T2820** - Share with Tagged Players button, per-tag email mappings
- **T2825** - Shares table refactor: `shares` + `share_videos` + `share_games` normalization
- **T2830** - Game + annotation materialization into recipient profiles, overlap merging

### Key Questions

1. **Joins vs. denormalized tables**: The current design normalizes shares into `shares` + `share_videos` + `share_games`. At millions of users with frequent sharing, will the JOIN pattern hold? Should we denormalize into fewer, wider tables instead?

2. **Ever-growing share tables**: `shares`, `share_videos`, `share_games` grow monotonically. Should we expire and clean up shares after a period (e.g., 1 week, 30 days)? What's the retention policy? Does the recipient still need the share record after materialization completes?

3. **Materialization copies**: T2830 copies game refs + annotations into recipient profiles. At scale, does this create a storage multiplier problem? One game shared with 11 players = 11 copies of annotations + game refs.

4. **`tagged_teammates` as JSON column**: Is a JSON array on `raw_clips` the right model, or should teammate tags be a separate table with proper indexing for queries like "find all clips tagged with Jake"?

5. **`teammate_emails` table growth**: Mappings persist forever. At scale, does this table need cleanup or archival?

6. **Query patterns**: Are the current query patterns (especially materialization and overlap merging) O(n) or worse? Will they degrade as users accumulate hundreds of games and thousands of clips?

7. **Any other issues**: Race conditions in concurrent shares, email delivery failures leaving partial state, orphaned records if materialization fails mid-way, etc.

### Related Tasks
- Depends on: T2800, T2810, T2820, T2825, T2830 (all must be merged to audit)
- Blocks: T2850 (Share Game), T2860 (My Athlete Filter) -- audit findings may change approach

### Technical Notes
This is a read-only audit task -- no code changes expected. Output is a written assessment in the task file's Progress Log or a separate design doc. Any recommended changes become new tasks or amendments to T2850/T2860.

## Implementation

### Steps
1. [ ] Read all Team Sharing Alpha PRs (T2800, T2820, T2825, T2830 diffs)
2. [ ] Audit Postgres schema: `shares`, `share_videos`, `share_games` -- row growth projections
3. [ ] Audit SQLite schema: `tagged_teammates` JSON, `teammate_emails` -- query patterns
4. [ ] Audit materialization logic: copy volume, overlap merging complexity
5. [ ] Assess join patterns vs. denormalization tradeoffs
6. [ ] Determine share retention policy (expire? keep forever? keep after materialization?)
7. [ ] Document findings and recommendations
8. [ ] Create follow-up tasks for any changes needed

### Progress Log

#### Audit Findings (2026-05-13)

**Executive Summary**: The sharing infrastructure is well-designed for the target audience and will hold comfortably to 100K users without changes. The normalized shares schema, per-user SQLite isolation, and materialization approach are all sound. Two items need attention before scaling further: the `tagged_teammates` JSON column becomes a bottleneck at >5K clips per profile, and there is a `NameError` bug in the single-profile materialization path (`sharer_email` not in scope in `_materialize_or_pend`). Everything else is either fine as-is or deferrable to post-100K scale.

---

**Detailed Findings**

##### 1. Normalized shares tables (shares + share_videos + share_games)

**Assessment: KEEP**

The Table-Per-Type inheritance pattern (base `shares` + child `share_videos`/`share_games` with share_id as PK) is well-designed. Every token lookup (`get_share_by_token`, `get_game_share_by_token`) hits the UNIQUE index on `share_token`, making it O(1) regardless of table size. The 1:1 JOIN to the child table is a PK-to-PK lookup -- effectively free.

`list_shares_for_game` and `list_shares_for_video` filter by video_id/game_id (indexed) and sharer_user_id (indexed). At 400M rows the query planner would use the more selective index (game_id narrows to ~10 rows per game), then nested-loop join to shares. This holds fine.

The `share_type` discriminator on `shares` cleanly separates the two share types. No schema changes needed.

##### 2. Ever-growing share tables

**Assessment: DEFER**

At 1M users the shares table reaches ~400M rows (see projections below). This is large but manageable for Postgres with proper indexing. The share record still serves a purpose after materialization:
- `revoked_at` enables share revocation
- `materialized_at` tracks completion status
- `watched_at` tracks engagement (video shares)
- Audit trail for "who shared what with whom"

There is no active query that scans ALL shares -- every query filters by an indexed column (share_token, sharer_user_id, game_id, recipient_email). So table size doesn't degrade query performance.

**Recommendation**: No action needed until 100K+ users. At that point, consider:
- Partition shares by `shared_at` (yearly) if table exceeds 100M rows
- Archive resolved `pending_teammate_shares` after 90 days (they accumulate clip_data JSONB which is the largest per-row payload)
- Add a `list_contacts_for_user` composite index `(sharer_user_id, revoked_at, recipient_email)` to make the GROUP BY query a covering index scan

##### 3. Materialization storage multiplier

**Assessment: KEEP**

One game shared with 11 players creates in each recipient's SQLite:
- 1 `games` row (~200 bytes)
- 1-2 `game_videos` rows (~100 bytes each)
- 15 `raw_clips` rows (~300 bytes each, typically ~4.5KB total)
- Total per recipient: ~5KB of SQLite data

Plus in Postgres:
- 1-2 `game_storage_refs` rows (~100 bytes each)

For 11 recipients: ~55KB SQLite metadata + ~1KB Postgres refs. The actual video bytes in R2 are NOT duplicated (same blake3_hash). This is negligible -- a user's SQLite DB is typically 500KB-5MB. Adding 55KB of shared game metadata is noise.

The `_find_existing_game_by_hashes` dedup correctly prevents creating duplicate games when the recipient already has the same recording. The ON CONFLICT on `game_storage_refs` prevents duplicate refs. Both are correct.

##### 4. tagged_teammates as JSON column

**Assessment: CHANGE (before 100K users)**

Two query patterns scan and decode ALL clips with JSON deserialization:

**`_filter_clips_for_tag()`** (materialization.py:152-177): Loads ALL clips for a game, decodes msgpack for each, filters in Python. At 15-50 clips per game, this is ~1-3ms. Fine.

**`GET /teammate-tags`** (clips.py:1970-1990): Loads ALL clips in the ENTIRE profile where `tagged_teammates IS NOT NULL`, decodes msgpack for every row, counts tag frequencies in Python. At 600 clips (typical user), ~5-10ms. At 2000 clips (power user), ~20-50ms. At 5000+ clips, could exceed 100ms.

**`share-with-teammates` tag counting** (clips.py:2112-2123): Same pattern -- loads all clips for a game, decodes msgpack to count clips per tag.

The issue is not the per-game scans (bounded by clips-per-game, typically 15-50) but the profile-wide scan in `GET /teammate-tags`. This is called on every visit to the share dialog.

**Recommendation**: Introduce a `clip_teammates` junction table in SQLite:

```sql
CREATE TABLE clip_teammates (
    clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
    tag_name TEXT NOT NULL,
    UNIQUE(clip_id, tag_name)
);
CREATE INDEX idx_clip_teammates_tag ON clip_teammates(tag_name);
```

This enables `SELECT tag_name, COUNT(*) FROM clip_teammates GROUP BY tag_name` instead of scanning all clips. The JSON column can remain for backward compatibility but queries should use the indexed table.

**Timing**: Not urgent at current scale. Plan for it when the first user exceeds 1000 clips, or before 100K users, whichever comes first.

##### 5. teammate_emails table growth

**Assessment: KEEP**

This is per-user SQLite. A typical user maps 5-15 tag names to 2 emails each = 10-30 rows. A power user over many seasons might accumulate 200 rows. This is trivially small for SQLite. The `UNIQUE(tag_name, email)` constraint prevents duplicates. The `idx_teammate_emails_tag` index supports lookups.

No cleanup needed. Even at 1000 rows (unrealistic), SQLite handles this without issue.

##### 6. Query complexity

**Assessment: KEEP (with monitoring note)**

| Query | Complexity | Typical Scale | At 10x | Verdict |
|-------|-----------|--------------|--------|---------|
| `_materialize_clips()` overlap detection | O(incoming x existing) | 15 x 50 = 750 comparisons | 50 x 200 = 10K | Fine -- pure arithmetic, no I/O |
| `_filter_clips_for_tag()` | O(clips_in_game) | 15-50 clips, msgpack decode | 200 clips | Fine -- bounded by clips-per-game |
| `GET /teammate-tags` | O(clips_in_profile) | 600 clips | 6000 clips | See finding #4 -- CHANGE at scale |
| `list_contacts_for_user()` | O(user's shares) via index | 400 shares | 4000 shares | Fine -- index scan + GROUP BY |
| `_find_existing_game_by_hashes()` | O(1) via blake3_hash index | Index seek | Index seek | Fine |

The overlap detection in `_materialize_clips` is the most complex algorithm. It's O(n*m) where n=incoming clips (typically 15) and m=existing clips (typically 0-50). Even at extreme scale (50 incoming x 500 existing = 25K comparisons), each comparison is two field lookups and arithmetic. This would take <1ms.

The `existing` list grows during materialization (line 293 appends new clips). This is correct -- it prevents inserting duplicate clips within a single materialization batch.

##### 7. Failure modes and race conditions

**Assessment: 2 items CHANGE, rest KEEP**

**a) Two SQLite DBs open simultaneously during materialization**

KEEP. Both connections use WAL mode (`PRAGMA journal_mode=WAL`) and 30-second busy timeout (`PRAGMA busy_timeout=30000`). WAL allows concurrent readers, and the materialization only writes to the recipient's DB (sharer is read-only). If an R2 sync is writing to the sharer's DB concurrently, WAL handles this correctly. If R2 sync is writing to the recipient's DB, the busy_timeout will wait up to 30s.

**b) Email delivery failure mid-way through recipients**

KEEP. The code correctly handles partial failure at the tag level: if any email in a tag group fails, the entire tag is marked "failed" and successfully-created share records for failed emails are revoked (clips.py:2168-2171). Tags are independent of each other.

**c) Read-after-write on share token lookup**

KEEP. `create_game_share()` commits via its `with get_sharing_db() as conn:` context manager before `_materialize_or_pend` calls `get_share_by_token()`. Since both use the same Postgres instance, the committed write is visible to subsequent reads. No race condition.

**d) BUG: `sharer_email` NameError in `_materialize_or_pend()`**

CHANGE. `_materialize_or_pend()` (clips.py:2212) is a module-level function. At line 2264, it passes `sharer_email=sharer_email` to `materialize_game_share()`, but `sharer_email` is NOT a parameter of `_materialize_or_pend` -- it's a local variable in `share_with_teammates()` (line 2100). Since `_materialize_or_pend` is not nested inside `share_with_teammates`, Python will raise `NameError: name 'sharer_email' is not defined` at runtime.

This bug affects the **single-profile immediate materialization** path (70% of recipients per assumptions). The non-user and multi-profile paths don't reference `sharer_email` and work correctly.

**Fix**: Add `sharer_email: str | None = None` as a parameter to `_materialize_or_pend()` and pass it from the caller at line 2184.

**e) Stale clip_data in pending_teammate_shares**

DEFER. When a pending share is created, `clip_data` is serialized from the sharer's current state. If the sharer modifies annotations before the recipient resolves the pending share, the materialized clips use the stale snapshot. This is acceptable for v1:
- The window is typically short (hours to days)
- Re-querying on resolve requires the sharer's DB to be mounted, which isn't guaranteed
- The alternative (live query) adds complexity and a failure mode

Document as a known limitation. Consider a "re-sync" feature post-launch if users report stale data.

**f) No transaction wrapping the full share flow**

KEEP. This is correct. Each recipient is processed independently. A failure materializing to one recipient should not prevent others from receiving their share. The per-recipient error handling (clips.py:2193-2197) logs failures and continues.

##### 8. Missing indexes or schema issues

**Assessment: KEEP (with notes for scale)**

Current indexes are well-chosen for the existing query patterns:

| Table | Index | Used By | Adequate? |
|-------|-------|---------|-----------|
| shares | share_token (UNIQUE) | Token lookups | Yes -- O(1) |
| shares | sharer_user_id | list_contacts, revoke | Yes |
| shares | recipient_email | Unused currently | Future-proofing |
| share_videos | share_id (PK) | JOINs | Yes -- 1:1 PK join |
| share_videos | video_id | list_shares_for_video | Yes |
| share_games | share_id (PK) | JOINs | Yes -- 1:1 PK join |
| share_games | game_id | list_shares_for_game | Yes |
| share_games | recipient_profile_id | Unused currently | Future-proofing |
| pending_teammate_shares | recipient_email | get_pending_for_email | Yes |
| pending_teammate_shares | share_id | FK cascade | Yes |
| game_storage_refs | blake3_hash | Dedup lookups | Yes |
| game_storage_refs | user_id | Per-user listing | Yes |
| game_storage_refs | (user_id, profile_id, blake3_hash) UNIQUE | Upsert | Yes |

**Notes for 100K+ users:**
- Add composite index `(recipient_email, resolved_at)` on `pending_teammate_shares` for the `WHERE resolved_at IS NULL` filter in `get_pending_shares_for_email`
- Add composite index `(sharer_user_id, revoked_at)` on `shares` for `list_contacts_for_user`
- These are minor optimizations -- the current single-column indexes work fine up to millions of rows

**FK integrity**: All FKs use `ON DELETE CASCADE` from child tables to `shares`. This correctly cascades share deletion. The `game_storage_refs.user_id` references `users(user_id)`, which is correct.

**Missing constraint**: `pending_teammate_shares` has no UNIQUE constraint on `(share_id, game_id, tag_name)`. If `_materialize_or_pend` is called twice for the same share (e.g., retry after partial failure), it would create duplicate pending records. Low risk but worth adding.

---

**Row Growth Projections**

Assumptions: 40 games/user lifetime, 5 tags/game, 2 emails/tag, 70% single-profile, 20% multi-profile, 10% non-user.

Per user as sharer: 40 games x 5 tags x 2 emails = 400 shares, 400 share_games.

| Table | 1K Users | 10K Users | 100K Users | 1M Users |
|-------|----------|-----------|------------|----------|
| shares | 400K | 4M | 40M | 400M |
| share_videos | ~10K | ~100K | ~1M | ~10M |
| share_games | 400K | 4M | 40M | 400M |
| game_storage_refs | 100K | 1M | 10M | 100M |
| pending_teammate_shares | 120K | 1.2M | 12M | 120M |

Notes:
- `share_videos` is low because video shares (non-game) are a secondary feature. Estimated at ~10 per user.
- `pending_teammate_shares` shows cumulative created rows. ~70% resolve within days. Unresolved rows grow by ~30% of new pendings (the 10% non-user recipients who never sign up). At 1M users: ~36M unresolved rows, each carrying JSONB clip_data (~1-5KB).
- `game_storage_refs` deduplicates via UNIQUE(user_id, profile_id, blake3_hash). Estimated ~100 unique game hashes received per user over 2 seasons (from ~5-10 teammates sharing ~20 games each, with overlap).

**Storage estimates at 1M users:**
- shares + share_games: ~800M rows, ~200 bytes/row = ~150GB. This is large for a single Postgres instance. Would benefit from partitioning by `shared_at`.
- pending_teammate_shares (unresolved): ~36M rows with JSONB ~2KB avg = ~72GB. This is the biggest concern. Archiving resolved pending shares is important.
- game_storage_refs: ~100M rows, ~100 bytes/row = ~10GB. Manageable.
- Per-user SQLite: Each DB grows by ~5KB per received game share. A heavy recipient (100 shared games) adds ~500KB. Trivial.

---

**Follow-up Tasks**

1. **Fix `sharer_email` NameError in `_materialize_or_pend()`** -- Bug: single-profile immediate materialization crashes. Add `sharer_email` parameter. Priority: P0 (blocks 70% of sharing flow).

2. **Add `clip_teammates` junction table** -- Replace JSON scanning in `GET /teammate-tags` and `_filter_clips_for_tag()` with indexed lookups. Priority: P2 (defer until >1000 clips per profile observed).

3. **Archive resolved pending_teammate_shares** -- Add a cleanup job to delete or archive resolved pending shares older than 90 days. The JSONB `clip_data` payload makes unresolved rows expensive. Priority: P2 (defer until 10K+ users).

4. **Add UNIQUE constraint on pending_teammate_shares** -- `UNIQUE(share_id, game_id, tag_name)` to prevent duplicate pendings on retry. Priority: P3.

5. **Add composite indexes at scale** -- `(recipient_email, resolved_at)` on pending_teammate_shares, `(sharer_user_id, revoked_at)` on shares. Priority: P3 (defer until 100K+ users).

## Acceptance Criteria

- [ ] All merged Team Sharing Alpha PRs reviewed for scalability
- [ ] Each key question above has a written recommendation (keep / change / defer)
- [ ] Row growth projections for share tables at 1K, 10K, 1M users
- [ ] Follow-up tasks created for any recommended changes
