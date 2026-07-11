# T4850: Transfer Reels/Clips Between Profiles (Multi-Athlete Accounts)

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-07-10
**Updated:** 2026-07-10

## Problem

From prod bug report **30p** (arshia.kalantari@gmail.com, 2026-07-10, `/home/reels`, profile b95eb93b):

> "One feature that I can't easily find which would be useful is transferring Reels to different profiles. It would be helpful to be able to clip from one video for both girls and then move them to the corresponding profile after the fact. Not major but could be a sticking point for multiple athlete situations like mine."

Multi-athlete parents (two daughters = two profiles) annotate ONE game video containing both kids. Today every clip/draft/reel created from that game lands in whichever profile was active — there is no way to move it afterwards. The reporter looked for the feature and couldn't find it because it doesn't exist (verified: no console errors in the report; this is a capability gap, not a malfunction).

This hits the core audience directly (highly engaged soccer parents; multi-kid families are common) and is exactly the "sticking point" that blocks the second athlete's profile from being useful.

## Current State (investigated 2026-07-10)

- **Reel "sharing" is view-only**: `create_share` in [shares.py](../../../src/backend/app/routers/shares.py) snapshots a final video for another *user* by email — no ownership move, no profile targeting for reels.
- **Game sharing DOES materialize across profiles**: the team-sharing epic (T2820–T2850) can copy a game reference + per-player-filtered annotations into a recipient profile ([materialization.py](../../../src/backend/app/services/materialization.py), T2830's game-reference helper: games + game_videos + game_storage_refs insertion; T2850's share flow has a recipient profile picker). This is the machinery to extend — do NOT build a parallel system.
- **Data locality**: everything a reel is made of lives in the *source profile's* SQLite DB — `raw_clips` → `projects`/`working_clips` (versioned) → `final_videos` (frozen name/aspect/duration/game_ids at publish) — plus R2 media objects. A transfer is a cross-profile-DB row copy + R2 ref handling, same shape as T2830's materialization and `scripts/copy_user_between_envs.py`.

## Solution (direction, needs design pass)

Two complementary pieces; scope decision at design time:

1. **Transfer after the fact (the actual request)**: a "Move to profile…" action on reel cards in My Reels (and probably draft cards). Backend endpoint that materializes the reel into the sibling profile's DB and removes it from the source (move, not copy — same user, so R2 objects can be referenced/re-pointed rather than duplicated; decide copy-vs-repoint per object type). Must carry the full lineage needed for re-edit (project + working_clips + raw_clip + game reference via T2830's helper) OR explicitly transfer as "published reel only" (frozen metadata, no re-edit) — decide in design; the frozen-metadata-only variant is far simpler and satisfies the reported use case (curation/sharing per athlete).
2. **Assign at creation (prevents the problem)**: optional target-profile picker when creating a clip / publishing, defaulting to current profile. Lower priority; only if design shows it falls out cheaply from (1).

Constraints:
- Gesture-based persistence: the move is a single explicit user action → one surgical backend call. No reactive syncing.
- Same-user profiles only (this is NOT team sharing; no email/invite flow).
- Ranking data (`season_rank`, Glicko rating) is per-profile — a moved reel enters the target profile's ranking pool as new/unranked.
- Collections referencing the reel in the source profile must handle its departure gracefully (or block move while referenced — decide in design).
- Both profile DBs must be bumped/synced to R2 in the same operation (version-bump rule in [reference_changing_env_data]).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/materialization.py` — cross-profile game/annotation materialization (T2830); the pattern + helpers to reuse
- `src/backend/app/routers/shares.py` — existing share endpoints (view-only reel shares; game share w/ profile picker)
- `src/backend/app/routers/clips.py` / `projects.py` — reel/draft/project row shapes and write paths
- `src/backend/app/database.py` — profile DB schema (`ensure_database`), PRAGMA user_version
- `src/backend/app/services/user_db.py` — profile enumeration for the same user
- `src/frontend/src/components/` My Reels surfaces (reel card menus) + `ProfileDropdown.jsx` — where the "Move to profile" gesture lives
- `scripts/copy_user_between_envs.py` — reference for column-by-column cross-DB copying

### Related Tasks
- Builds on: T2830 (game + annotation materialization), T2850 (share game w/ profile picker)
- Related: T3600 (frozen collection metadata at publish — the frozen-metadata-only transfer variant leans on this)

### Technical Notes
- Needs the Migration agent if any schema is added (e.g. provenance column `transferred_from_profile_id`); likely L-tier (backend cross-DB service + frontend UI + possibly schema).
- Workaround that exists TODAY (worth telling the reporter): share the game to the other daughter's profile via the game Share flow (profile picker), then clip/publish her plays from within that profile. Doesn't move already-made reels, but covers "clip once for both girls" going forward.

## Implementation

### Steps
1. [ ] Design pass: full-lineage move vs published-reel-only move; collection/ranking edge cases; R2 copy-vs-repoint
2. [ ] Backend: transfer endpoint (surgical, both-DB sync + version bump)
3. [ ] Frontend: "Move to profile…" action on reel (and draft?) cards, only shown when the user has 2+ profiles
4. [ ] Migration file if schema changes
5. [ ] Tests: backend transfer round-trip; frontend E2E move gesture

## Acceptance Criteria

- [ ] A reel in profile A can be moved to profile B of the same user via an explicit gesture, and appears in B's My Reels
- [ ] Source profile no longer lists the reel; no orphaned rows or dangling final_video refs (v021/v022 lesson)
- [ ] Moved reel plays in the target profile (R2 refs valid)
- [ ] Both profile DBs sync durably (survives machine cycle — T4050/T4110 boundary)
- [ ] Users with a single profile never see the affordance
- [ ] Tests pass
