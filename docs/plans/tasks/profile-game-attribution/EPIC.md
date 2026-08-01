# Cross-Profile Game Attribution

**Status:** WIP
**Started:** 2026-07-31
**Source:** Prod bug 37p (arshia.kalantari@gmail.com, 2026-07-24) — filed as a bug, actually a feature request.

## Goal

Reels moved from one profile to another keep their "organized by game" grouping in the target
profile's Gallery, and the game shows up in the target profile's Games tab as a **link card**
pointing back at the owning profile. Today the move flow (T4850) deliberately nulls
`final_videos.game_ids` because the target profile has no `games` row to resolve — so every
moved reel falls into the "Mixes & compilations" bucket.

The reporter's use case: he clips for BOTH kids off the same game (game lives in the default
profile), moves each kid's reels into their own profile, and loses by-game organization in both.
Moving the game itself can't fix this — one game, two destination profiles.

## Design Decisions (locked with user, 2026-07-24)

1. **Auto-carry attribution, not folders, not master-select.** Rejected alternatives from the
   reporter's own brainstorm:
   - *Manual "game folders" per profile*: the game IS the folder; we already have the data and
     drop it on move. A parallel manual-folder system is redundant state + ongoing manual filing.
   - *Master profile with per-game visibility checkboxes*: really "games become user-level" — a
     large migration (`raw_clips.game_id` FKs are per-profile), a new UI concept, and still
     manual. Overkill for the need.
   - *Chosen*: on move, materialize a **metadata-only game reference** in the target profile and
     remap `game_ids`. Grouping appears exactly when a reel from that game lives in the profile.
     Zero new user concepts; the existing gallery read path is unchanged.
2. **Reference games are VISIBLE in the target Games tab, rendered as a LINK** (user decision:
   "show it but more as a link since there should only be one source of truth"). The owning
   profile keeps the single real game; the reference card navigates there (profile switch + open
   game). No annotate/edit/delete-video actions on a reference card.
3. **A reference is derived state, not a flag.** `games.source_profile_id IS NOT NULL` ⇒
   reference (columns `source_profile_id`, `source_game_id`, profile_db **v030**). No separate
   `is_reference` boolean (no-redundant-state rule).
4. **No storage refs, no expiry participation.** References never touch `game_storage`,
   `game_storage_refs`, or `game_ref_counts` (the refcount system is a known minefield —
   memory: game_ref_count drift). Video lifecycle stays 100% with the owning profile.
5. **Metadata is frozen at materialization** (name, opponent, date, type, tournament, dims,
   durations). Consistent with the "freeze derived names" principle; no live cross-profile-DB
   reads on the gallery or games-list path. If the owning game is later renamed the reference
   keeps its snapshot; if the owning game is deleted the link degrades (card stays, navigation
   disabled) — grouping still works off the snapshot.
6. **References never chain.** Moving a reel B→C when B holds a reference resolves through the
   source pointer so C's reference also points at the ORIGINAL owning profile/game. Moving a
   reel back into the owning profile remaps `game_ids` straight to the real game id (no
   reference created).
7. **Smart collections are untouched.** Top Plays / Top Goals & Assists are tag-based across
   all games; moved reels keep their tags and keep appearing there (the reporter explicitly
   wants this — "still having them mixed in the Top goals/assists/plays mixes too").
8. **"Assign to game" gesture is DEFERRED** (manual re-attribution UI for arbitrary reels).
   Instead, a one-off heal (T5830) restores attribution for the reporter's already-moved reels.

## Mechanics Recap (for implementing agents)

- Gallery grouping: `GET /api/collections/summary` (`collections.py:292`) routes each published
  reel via `route_collection(final_videos.game_ids, clip_count)`; **only single-clip reels with
  exactly one resolvable game id land in a game group** — multi-clip reels go to Mixes by
  design. Header name via `_generate_game_display_name` from the profile-local `games` row.
- Move flow: `POST /api/downloads/move-to-profile` (`downloads.py:1031`,
  `move_reels_to_profile`). `_build_moved_reel_row` (`downloads.py:987-1011`) currently nulls
  `project_id` / `game_id` / `game_ids` / `source_clip_id`.
- Existing cross-profile game copier to reuse: `materialization.py:_copy_game` (`:152-212`,
  copies `games` + `game_videos`, hash-dedup via `_find_existing_game_by_hashes`).
- Cross-profile durable-write ordering (invariant 6b, persistence-sync.md): target written +
  synced first via `sync_db_to_r2_explicit(user_id, target_profile_id)` (T5340 keys off the
  arg), source second under `durable_sync`.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T5800 | [Game-reference primitive + schema (profile_db v030)](T5800-game-reference-primitive.md) | WAITING ON USER — pushed, CI green |
| T5810 | [Move-reels carries game attribution](T5810-move-carries-attribution.md) | WAITING ON USER — pushed, CI green (same branch as T5800) |
| T5820 | [Games tab: reference game link cards](T5820-reference-game-link-cards.md) | WAITING ON USER — pushed, CI green |
| T5830 | [Heal arshia's already-moved reels](T5830-heal-arshia-moved-reels.md) | TODO — hard-blocked on 1-3 reaching prod + user sign-off on the dry-run mapping |

Order is dependency order: schema/primitive → move flow → UI → heal (heal reuses the primitive
and the remap logic, and must land after both are on prod).

**2026-07-31 wave.** T5800 + T5810 were implemented in ONE container worker (hard dependency plus
shared ownership of `materialization.py`) and pushed together as
`feature/T5800-game-reference-attribution` — Branch CI green, awaiting the user's merge. T5820 is a
second worker based on that unmerged branch so it builds against the real `is_reference` API. One
design question the task files left open was decided by the user during the wave: a reference card
click lands on the owning profile's **Games tab** (game scrolled-to + highlighted), **not** Annotate
— which means a new consumed-once breadcrumb rather than reusing `setPendingGame`. T5830 was not
started; it needs 1-3 on prod plus sign-off on a dry-run mapping table before touching his data, and
its migration is now **v031** since T5800 took v030.

**Both branches are pushed and CI-green, awaiting merge.** T5820's branch is based on T5800's, so
merging T5820 brings all three tasks; merging T5800's branch first is equally fine.

One cross-task defect surfaced and was fixed inside the wave: `list_games` SELECTed
`source_game_id` but never returned it, forcing T5820 to match the owning game on `blake3_hash`,
which is NULL for **multi-video** games — those references would have landed without a highlight,
partially undoing the user's own decision. Fixed on T5800's branch, then T5820 rebased onto it and
switched to exact-id matching. Worth remembering as an epic-level lesson: a field that exists in the
query is not a field that exists in the API, and the consuming task is where that gap shows up.

## Completion Criteria

- [ ] Moving reels to a sibling profile groups them under the correct game header in the
      target Gallery (single-clip reels), with the same header text as the source profile.
- [ ] Moving reels from the same game twice (or for two kids into two profiles) creates exactly
      one reference row per target profile (dedup proven by test).
- [ ] Target Games tab shows the reference as a link card; clicking navigates to the game in
      the owning profile; no storage/expiry chips or edit actions on reference cards.
- [ ] Moving a reel back to the owning profile re-points `game_ids` at the real game; no
      reference row is created in the owning profile.
- [ ] Orphaned references are cleaned up by the gestures that orphan them (reel delete /
      move-away), never by a reactive sweep.
- [ ] Arshia's moved reels on prod are re-attributed (T5830 executed, verified in his gallery).
- [ ] Knowledge docs updated (persistence-sync.md cross-profile section + a new note in the
      export-pipeline/collections area touched).

## Feedback re-review (2026-07-25) — design stands

The reporter followed up asking for **playlists with sub-lists** (tournament / league / month, then
sub-categorized by game) with manual folders as a fallback. Re-examined; **the epic does not change.**

- His stated preference — *"refer or link back to the game it was taken from to auto-populate or
  auto-categorize clips into their associated game"* — **is this epic** (T5800-T5820). The manual
  folders were his fallback, offered because he assumed auto was infeasible.
- Every axis he named is already a column on `games` (`tournament_name`, `game_type`, `game_date`,
  `opponent_name` — `database.py:840-843`), so tournament/league/month grouping is **derivable with
  zero filing**. Design Decision 1 (reject manual folders) therefore still holds, and adding a
  folder tree would be redundant state against data we already have.
- The hierarchy he describes — **tournament -> game -> clips** — only completes once this epic
  lands, since this epic is what carries game attribution across profiles. **This epic is the
  prerequisite for his own idea.**
- The smart version is filed as [T5880](../T5880-smart-grouping-tournament-month.md) (auto-grouping
  by tournament/month/opponent, extending the existing smart-collections mechanism), sequenced
  AFTER T5800-T5820.
- Idiosyncratic curation ("clips for the recruiter", "highlights for grandma") is a different need
  already served by Collections + shares; it is not a filing-hierarchy problem.

**What would reopen this:** users asking for groupings that are NOT derivable from game metadata.
