# Season Highlights & Collections — Epic Handoff (post-T3605)

**Date:** 2026-06-12
**Author:** prior session (T3605 implementation + epic prep)
**Read with:** [EPIC.md](EPIC.md) (decisions 1-14, do not re-litigate), and the per-task files.

This handoff hands the epic to the next implementer(s). T3600 and the **T3605 prerequisite** are
done and migrated on prod; everything from T3610 onward remains. It records (a) what shipped, (b)
the cross-cutting decisions the user locked in that change several task designs, and (c)
per-task handoff notes in dependency order.

---

## 1. What has shipped

| Task | State | Notes |
|------|-------|-------|
| T3600 | DONE, migrated dev/staging/prod (profile_db v007) | Froze `duration`/`aspect_ratio`/`tags` on `final_videos`. |
| **T3605** | **DONE, migrated dev/staging/prod (profile_db v008)** | Froze `game_ids` (msgpack BLOB) on `final_videos`. NEW — not in the original epic task list; created as the Collections prerequisite. See [T3605-freeze-game-ids.md](T3605-freeze-game-ids.md). |

### T3605 facts the rest of the epic depends on
- `final_videos.game_ids` = msgpack BLOB of **sorted distinct game ids**. `len==1` -> that game's
  collection; `len>1` -> "Mixes & compilations"; NULL/`[]` -> game-less (mixes). Decode via
  `app.utils.encoding.decode_data`.
- Stamped at all 3 export-finalize INSERT sites (`overlay.py` x2, `auto_export.py` brilliant clip)
  via `compute_project_game_ids` / `encode_game_ids` in `app/services/collection_metadata.py`.
- Backfilled by `app/migrations/profile_db/v008_freeze_game_ids.py`, which recovers game ids for
  already-published custom reels from the R2 archive (`archive/{project_id}.msgpack` -> archived
  `working_clips.raw_clip_id` -> live `raw_clips.game_id`; raw_clips survive archival).
- **Verified on prod:** 100% coverage, 0 NULL, custom_project reels correctly attributed.
- **Additive only:** `GET /api/downloads` still resolves games live today; T3610 switches the read
  path to the frozen column.
- Deploy/migrate mechanics learned: prod deploys via `scripts/deploy_production.sh --backend-only`
  (its built-in migrate step is a no-op — `scripts/migrate-schema.py` does not exist). Migrations
  run separately via `fly ssh console -a <app> -C "python -c '...run_all_migrations()...'"`
  (app = `reel-ballers-api` prod, `reel-ballers-api-staging` staging). Staging auto-deploys on push
  to master; prod is manual.

---

## 2. Cross-cutting decisions locked in (apply to ALL remaining tasks)

These came from the user on 2026-06-12 and override earlier assumptions. They touch T3610, T3620,
T3640, T3670, T3680.

1. **Frozen columns are the only read path.** Read `game_ids`/`aspect_ratio`/`duration`/`tags`
   off `final_videos`. No live working_clips resolution, no fallbacks, no CTEs reconstructing
   associations. (EPIC #4, T3600/T3605.)

2. **No legacy data, no legacy code.** Everything is migrated; every published reel has valid
   frozen columns. Do NOT write defensive handling for NULL aspect_ratio / NULL game_ids / an
   `unknown` ratio bucket. If such a value appears for a published reel, surface it as a bug
   (log), per CLAUDE.md "no silent fallbacks / no defensive fixes for internal bugs."

3. **Ratio is collection identity, gated at >=30s.** A (scope, filter) with content in a ratio
   becomes a collection only when that ratio has **>=30s** of published content. Game, season, and
   smart collections all follow this. A game with 40s portrait + 10s landscape -> Portrait
   collection only. Both >=30s -> two independent collections. Eligibility =
   `ratio_durations[ratio] >= 30` (threshold compare on a server-provided sum; allowed under
   EPIC #13). Surface a per-(scope,ratio) `eligible` boolean server-side so clients stay dumb.
   Ratio appears in names as glyph + word ("Top Goals - Portrait"), never "9:16" (EPIC #2).

4. **msgpack on disk AND over the wire.** On-disk msgpack is done (game_ids, tags). Over-the-wire
   msgpack is NEW infra: today all endpoints are JSON, frontend `utils/apiFetch.js` does
   `res.json()`, `@msgpack/msgpack` is not a frontend dep. **OPEN: scope** — global content
   negotiation in apiFetch vs collections-endpoints-only. Recommendation: collections-only first
   (one backend `Response(content=packb(...), media_type="application/x-msgpack")` + a targeted
   decode), generalize later. **Get the user's answer before T3610 implementation.**

5. **Summary-first, O(games).** The Collections tab reads one aggregate endpoint
   (`GET /api/collections/summary`); members load per group on expand. The All tab is the only
   full-list consumer. Clients never reduce over the reel list to compute aggregates. (EPIC #13.)

6. **Mixes group silent; gallery badge stays `galleryStore.fetchCount`.**

7. **Persistence: gesture-based only; UI state (tab/ratio/expanded) transient.** No reactive
   writes, no new stored state in T3610. (CLAUDE.md persistence rules.)

---

## 3. Per-task handoff (dependency order — do not start N+1 before N)

### T3610 — Collections Tab + Game Collections (NEXT)
- Design doc: [T3610-design.md](../T3610-design.md). **Section 0 (Amendments) is authoritative**;
  sections 1-8 keep rationale but their data-layer specifics (resolution CTE, working-clips
  fallback, `unknown` ratio, dominant-ratio default) are obsolete after T3605 + the decisions.
- The summary endpoint is now simple: one `SELECT` of published latest-version rows
  (mirror `list_downloads`' WHERE + `queries.latest_final_videos_subquery()`), then one Python
  pass decoding `game_ids`/`tags`/reading `aspect_ratio`/`duration` to build per-game buckets,
  season totals, and per-tag sums. No CTE.
- Member filter: `GET /api/downloads?game_id=N` / `?mixes=true`. With `game_ids` a BLOB, SQLite
  can't index it; decode-and-filter in Python over the published set is acceptable at scale
  (<=500 rows; same cost as today's full list). A derived scalar column is the escape hatch if
  profiling demands — deferred.
- Ratio-as-identity (decision #3): each qualifying (game, ratio) is its own collection card. The
  `CollectionHeader`/`CollectionPlayer` contracts in the design still hold; the container now
  renders one header per qualifying ratio rather than one header with a ratio toggle.
- Resolve the msgpack-over-wire scope question (decision #4) with the user first.
- Components `CollectionHeader` + `CollectionPlayer` are reused by T3620/T3640/T3670/T3680 — keep
  `CollectionPlayer` presentational (URLs + metadata in via props; no store, no fetch).

### T3620 — Collection Share Links + Public Viewer
- Reuses `CollectionPlayer` with **presigned** URLs (public pages use presigned, not the
  `/stream` proxy — see EPIC + tech-notes section 6). Postgres migration v016 (shares.share_type
  CHECK adds 'collection' + `collection_definition JSONB`; update `_SCHEMA_DDL` too).
- Collections are stored definitions (scope, filter, ratio), evaluated live (EPIC #1, #9). A
  collection link is `(scope, filter, ratio)` and must honor the >=30s identity (decision #3).

### T3630 — Reel Ranking Model + Insertion UX
- profile_db v008 is now TAKEN by T3605. **T3630's migration must become v009** (it adds
  `final_videos.season_rank REAL NULL` + `collection_settings` table). Update the EPIC Migration
  Inventory accordingly (it currently says v008 for T3630).
- Gesture-based rank writes only (EPIC #3, #5).

### T3640 — Season Highlights + Unlock Moment
- Reuses `CollectionHeader`; consumes the summary's `season_totals` (already shaped per ratio in
  the T3610 design). Time-budget slider + greedy-with-skip membership (EPIC #7). Unlock modal,
  no backdrop close (EPIC #8). Ratio-as-identity >=30s applies to the season scope too.

### T3650 — Custom Mix Demotion + Rename
- Display-only rename of `source_type` "New Reel" -> "Custom Mix" (EPIC #10). No DB value change.

### T3660 — Quest 4 Rework
- New derived steps depend on frozen data: `publish_30s` = `SUM(duration) WHERE published_at
  IS NOT NULL >= 30`; `rank_first_reel` = `EXISTS(season_rank IS NOT NULL)` (needs T3630).
  Three definition sites must stay in sync (tech-notes section 7).

### T3670 — Smart Collections (Top Goals/Assists/Dribbles)
- Reuses `CollectionHeader` + `CollectionPlayer`; consumes the summary's per-tag duration sums
  per ratio. Same >=30s identity gate (EPIC #6 — this is where the threshold originated; the user
  extended it to game + season collections in decision #3). Locked near-miss cards show progress.

### T3680 — Stitched Collection Videos
- Server-side stitch over a collection's live membership; filename carries ratio word
  ("Top Goals (Portrait) - Spring 2026.mp4"). Slots into the `CollectionHeader` "Video" verb.

---

## 4. Release grouping (EPIC #12, unchanged)
T3600 -> T3605 -> T3610 -> T3620 ship independently (T3605/T3610 now). T3630+T3640+T3650+T3660 ship
together (paradigm release). T3670 fast-follows. T3680 last.

## 5. Migration inventory correction
EPIC.md's Migration Inventory lists T3630 as profile_db **v008**. T3605 took v008. **T3630 is now
v009.** (T3620 stays postgres v016.) Update EPIC.md when starting T3630.
