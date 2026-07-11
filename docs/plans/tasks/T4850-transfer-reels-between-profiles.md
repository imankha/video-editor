# T4850: Transfer Reels/Clips Between Profiles (Multi-Athlete Accounts)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
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

## Solution (decisions locked with user 2026-07-10)

User settled the four open design questions:

1. **Semantics: published-reel-only MOVE.** Transfer the `final_videos` row + frozen metadata (name, aspect_ratio, duration, game_ids — T3600 freeze) to the sibling profile and remove it from the source. The reel plays, ranks, and shares in the target profile but is NOT re-editable there; editing lineage (raw_clip/project/working_clips) stays behind in the source profile. No full-lineage materialization, no copy-in-both-profiles.
2. **UI surface: reel card overflow menu + bulk select.** "Move to profile…" action on My Reels cards, visible only when the account has 2+ profiles. No publish-time profile picker in this task. **Mass migration is in scope (user, 2026-07-10):** a multi-select mode in My Reels ("Select" → check reels → "Move to profile…") so a parent can move a whole batch of one athlete's reels at once.
3. **Scope: published reels only.** Drafts are not movable in v1.
4. **Collections: auto-remove on move.** Moving a reel silently removes it from source-profile collections and vacates its ranking slot (`season_rank`, Glicko row) as part of the single move operation. Design pass must enumerate every source-profile reference cleaned up (collections, rank rows, watched state) and what happens to existing share links for the moved video (share snapshots are per sharer_profile in Postgres — decide invalidate vs leave-working).

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
1. [ ] Design pass: enumerate every source-profile reference the move must clean up (collections, season_rank/Glicko, watched state, share links); R2 copy-vs-repoint per object type
2. [ ] Backend: batch transfer endpoint `POST /api/reels/move-to-profile {video_ids: [...], target_profile_id}` — moves N reels atomically in ONE operation, one durable sync + version bump per profile DB (not per reel); partial-failure semantics decided in design (all-or-nothing preferred)
3. [ ] Frontend: "Move to profile…" on the reel card overflow menu + multi-select mode in My Reels with a bulk "Move to profile…" action; both only shown when the user has 2+ profiles
4. [ ] Migration file if schema changes
5. [ ] Tests: backend single + batch transfer round-trip (incl. collection auto-remove and rank-row cleanup); frontend E2E single move + bulk move gestures

## Acceptance Criteria

- [ ] A reel in profile A can be moved to profile B of the same user via an explicit gesture, and appears in B's My Reels
- [ ] Multiple reels can be selected and moved in one gesture (mass migration), with one sync per profile DB
- [ ] Source profile no longer lists moved reels; collections auto-updated, rank rows vacated; no orphaned rows or dangling final_video refs (v021/v022 lesson)
- [ ] Moved reels play in the target profile (R2 refs valid)
- [ ] Both profile DBs sync durably (survives machine cycle — T4050/T4110 boundary)
- [ ] Users with a single profile never see the affordance
- [ ] Tests pass
