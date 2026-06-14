# Season Highlights & Collections — Epic Handoff (post-T3610)

**Date:** 2026-06-13
**Author:** T3610 implementation session
**Read with:** [EPIC.md](EPIC.md) (decisions 1-14), [HANDOFF.md](../HANDOFF.md) (post-T3605), and
[T3610-design.md](../T3610-design.md) — **§0 and §0B are authoritative**; sections 1-8 are rationale only.

This hands the epic to the next implementer(s). **T3610 is implemented but NOT merged**
(branch `feature/T3610-collections-tab`, 14 commits). During this session T3610 grew well beyond
its original scope by user direction: it pulled forward **T3670** (smart collections) and the
**T3640 time-budget mechanic**, collapsed My Reels into a **single view**, and unified the reel +
collection **card and player** code. Those pull-forwards change what's left of several downstream
tasks — read §3 carefully before starting any of them.

---

## 1. What shipped (branch `feature/T3610-collections-tab`, unmerged)

| Area | State |
|------|-------|
| **T3610 core** | DONE. `GET /api/collections/summary` (JSON) + `GET /api/downloads` `game_id`/`mixes`/`aspect_ratio`/`tags` filters. Reads the frozen `final_videos.game_ids` BLOB (T3605) via `collection_metadata.route_game_ids` — no working-clips resolution. Ratio-as-identity, ≥30s eligibility (`COLLECTION_MIN_DURATION_SEC=30`). **No migration** (read-only). |
| **Single My Reels view** | DONE. Removed the Collections/All switcher AND the source-type filter pills. One scrollable view: **smart collections → game-by-game → multi-game mixes**. The word "Collection" is never shown. |
| **T3670 smart collections (pulled forward)** | DONE (UI + data). `summary.smart_collections` = Top Plays (all) / Top Goals & Assists (`{Goal,Assist}`) / Top Dribbles (`{Dribble}`), per-reel-boolean membership (multi-tag reels dedup), per ratio, `ratio_eligible` at ≥30s. Below-30s → amber **locked card** (EPIC #6). Member fetch via `?tags=`. |
| **T3640 time-budget mechanic (pulled forward)** | DONE (the slider/membership only). Per-collection duration budget: **default = all clips**, slider 30s→full duration (no 5m cap), **15s steps**, hidden under **"Set Duration"** in the card "..." menu; **greedy-with-skip** membership; the card shows the **actual selected duration**. |
| **Unified card** | DONE. Shared `MediaCard` / `CardMedia` / `CardIconButton` (in `components/shared/MediaCard.jsx`). Reel cards and collection cards share the icon box, 44px action buttons, and chrome. Ratio shown as a **glyph only** (▯/▭, no word) on every card. |
| **Unified player** | DONE. ONE `CollectionPlayer` (story player) plays both single reels and collections, rendered at the **panel top level** so it fills the viewport. The old `MediaPlayer`/`playingVideo` modal is removed. Single-reel play keeps a Download button (`onDownload`). |
| **Mutation sync** | DONE. `useCollections` lifted into `DownloadsPanel`; delete → `removeMember` + summary refetch; rename/watched → `patchMember`. |

### Verification (all green on the branch)
Backend `tests/test_collections_summary.py` (26) + `test_collection_metadata.py`; frontend Vitest
`useCollections` + `budget` (12); Vite build; Playwright `e2e/collections.spec.js` (single-view
shell + 360px). No live data-render e2e (needs seeded published reels — manual Test & Fix item).

---

## 2. Decisions locked this session (OVERRIDE the original epic/post-T3605 handoff)

These came from the user 2026-06-12/13 and supersede earlier assumptions. Apply to ALL remaining tasks.

1. **JSON over the wire. msgpack-over-HTTP is REJECTED** (reverses post-T3605 handoff decision #4).
   Every endpoint stays JSON. On-disk msgpack (`game_ids`/`tags` BLOBs) is unaffected — storage only.
   See [[project_collections_json_not_msgpack_wire]]. T3640/T3670 endpoints: JSON.
2. **No All tab / no switcher / no source-type filter.** One My Reels view; "Collection" never surfaced.
3. **Section order:** smart collections → game-by-game → multi-game mixes (mixes also holds game-less reels).
4. **Ratio = glyph only** (▯ portrait / ▭ landscape), the word never shown on a card. Ratio is still
   collection identity (mono-ratio, ≥30s gate).
5. **Game collection title = "Highlights"** (the group header already shows the game name); the player
   title is the full "{game} Highlights".
6. **Duration budget:** default = all clips; 15s steps; **no 5m cap** (all clips always reachable);
   slider hidden behind "Set Duration"; greedy-with-skip; card shows actual selected duration.
7. **"Top"/budget ordering = recency (newest-first) until T3630.** There is **no frozen quality
   scalar** today; member order is `list_downloads` `created_at DESC`. T3630 makes ordering real.
8. **Collection-level Share / Copy link / Download are DEFERRED** to T3620 (share/copy link) and T3680
   (download). They appear **disabled ("Coming soon")** in the card "..." menu + a disabled standalone
   Copy link button. Per-REEL share/copy-link/download work today.
9. **One shared player** for reels + collections. Single-reel playback now uses the **story player**
   (tap-to-pause, X to close, Download button) — it has **no native scrub bar** (open question, §4).
10. **Smart collections are server-defined** (`SMART_COLLECTIONS` in `collections.py`). A reel joins a
    group iff the group is tag-less or the reel has ANY of the group's tags (per-reel boolean → dedup).
    The summary includes each group's `tags` list so the client builds `?tags=` without duplicating the map.

---

## 3. Per-task handoff (dependency order — do not start N+1 before N)

> **Reusable artifacts to build on** (all on the branch):
> - `components/collections/CollectionPlayer.jsx` — story player, presentational (URLs + metadata via
>   props; `onDownload`/`onReelChange`/`onEnded` hooks). T3620 feeds **presigned** URLs here.
> - `components/shared/MediaCard.jsx` — `MediaCard` / `CardMedia` / `CardIconButton`.
> - `components/collections/CollectionCard.jsx` + `CollectionHeader.jsx` — the collection card; the
>   "..." menu already has the disabled Share/Copy/Download slots to wire up.
> - `components/collections/budget.js` — `budgetCap` / `defaultBudget` / `snapToStep` (15s) /
>   `selectWithinBudget` (greedy) / `sumDuration`. **The ordering input is recency today; T3630 swaps it.**
> - `components/collections/playerReels.js` — `toPlayerReel(s)` (one reel→player map).
> - Backend `routers/collections.py` summary already returns `season_totals` and `tag_totals` (raw
>   feeds) in addition to `smart_collections` — T3640/T3670 can consume these.

### T3620 — Collection Share Links + Public Viewer (NEXT)
- Postgres **v016** (shares.share_type CHECK adds `'collection'`, `collection_definition JSONB`; update
  `_SCHEMA_DDL`). A collection link is a stored `(scope, filter, ratio, budget?)` definition, evaluated
  live (EPIC #1/#9), honoring the ≥30s identity (EPIC #3).
- **Wire the disabled Share + Copy link** in `CollectionHeader`'s "..." menu and the standalone Copy
  link button (remove the "Coming soon" state for these two).
- Reuse `CollectionPlayer` for the public viewer with **presigned** URLs (public pages use presigned,
  not the `/stream` proxy — EPIC + tech-notes §6). The player is already presentational.
- Decide whether the shared budget is part of the link (a collection link could carry a fixed duration).

### T3630 — Reel Ranking Model + Insertion UX
- profile_db **v009** (`final_videos.season_rank REAL NULL` + `collection_settings` table). (v008 was
  taken by T3605; EPIC Migration Inventory still needs this corrected to v009.)
- **This makes "Top" real.** Today smart/game/season ordering + the budget greedy-fit use recency.
  T3630 must thread the canonical order (user `season_rank` where set, else frozen quality score, ranked
  above unranked — EPIC #3) into: (a) the member fetch order (`list_downloads`), and (b)
  `budget.selectWithinBudget`'s input order. There is currently **no frozen quality score column** — if
  EPIC #3's "frozen quality score" is required, this task must add/stamp it (see §4 open question).
- Gesture-based rank writes only (EPIC #3/#5); rank suggestions are memory-only until confirmed.

### T3640 — Season Highlights + Unlock Moment
- The **time-budget MECHANIC is already done** (slider + greedy + actual-duration). What's LEFT:
  - A **Season Highlights collection** (season scope) card driven by `summary.season_totals`
    (already shaped per `(season, ratio)` with `eligible`). Reuse `CollectionCard` (it's scope-agnostic;
    it just needs a member fetch — add a `?season=` filter to `list_downloads`, same decode-and-filter
    pattern as `?tags=`, OR derive season membership server-side).
  - The **unlock gate modal** (fanfare, no backdrop close) when a profile crosses 30s published
    duration; `pref.seasonHighlightsChoice` ('enabled'|'declined'|unset); declined → quiet locked card.
  - Where Season Highlights sits in the section order (likely a top section near smart collections).

### T3650 — Custom Mix Demotion + Rename
- Display-only rename of `source_type` "New Reel" → "Custom Mix" (EPIC #10). No DB value change. Note the
  reel card already shows source-type as part of its meta line.

### T3660 — Quest 4 Rework
- Derived steps on frozen data: `publish_30s = SUM(duration) WHERE published_at IS NOT NULL >= 30`;
  `rank_first_reel = EXISTS(season_rank IS NOT NULL)` (needs T3630). Three definition sites must stay in
  sync (tech-notes §7).

### T3670 — Smart Collections
- **Largely DONE this session** (summary `smart_collections` + UI cards + locked near-miss + `?tags=`).
  What may remain: the **"Video" verb** (stitched smart collection → T3680), copy/refinement, and any
  near-miss copy the user wants. Treat this as a polish/verify pass, not a build-from-scratch.

### T3680 — Stitched Collection Videos
- Server-side stitch over a collection's live (budgeted) membership; filename carries the ratio word
  ("Top Goals (Portrait) - Spring 2026.mp4"). **Wire the disabled Download** in the collection "..."
  menu (remove "Coming soon"). Slots into the existing player's Download affordance for collections.

---

## 4. Open questions / risks for the next session

- **Single-reel scrub bar.** Single reels now play in the story player (no native seek). If users miss
  scrubbing, add a draggable seek on the active progress segment (`useStoryPlayback` already tracks the
  video element). User was informed; not yet requested.
- **Frozen quality score (T3630).** EPIC #3 assumes a frozen quality score for unranked ordering, but no
  such column exists on `final_videos` today (only `rating_counts` for annotated games). T3630 must
  decide: stamp a quality scalar at export-finalize (like T3600/T3605) or order unranked by recency.
- **Section placement of Season Highlights (T3640)** relative to smart collections.
- **Mixes vs game-less.** `route_game_ids` collapses multi-game and game-less to the Mixes bucket; if a
  product distinction is ever wanted, it needs a `len==0` vs `len>1` split (not done).
- **PLAN.md / EPIC.md not yet updated** to reflect the T3670 + T3640-mechanic pull-forward. The user
  applies status changes; flag this when picking up the epic.

## 5. Migration inventory (corrected)

| Task | Track | Version | Status |
|------|-------|---------|--------|
| T3600 | profile_db | v007 | DONE (dev/staging/prod) |
| T3605 | profile_db | v008 | DONE (dev/staging/prod) |
| **T3610** | — | **none** | read-only; needs no migration |
| T3620 | postgres | v016 | pending |
| T3630 | profile_db | **v009** | pending (was listed v008; T3605 took v008) |

## 6. Merge / deploy for T3610
Branch `feature/T3610-collections-tab` is unmerged. T3610 has **no migration** (it only reads frozen
columns from v007/v008, already on all envs). Standard flow: review → merge to master → staging
auto-deploys → verify → prod deploy. No `POST /api/admin/migrate` step needed for T3610 itself.
