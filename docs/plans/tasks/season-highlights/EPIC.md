# Season Highlights & Collections

**Status:** TODO
**Started:** -
**Impact:** 9 | **Complexity:** 6 | **Priority:** 1.5

## Goal

Replace the *editing* mental model ("build a video from clips") with a *curation* mental model: rank your moments, the product assembles the video. My Reels becomes the home of all end products and end-product actions. The core loop becomes **annotate -> publish -> rank -> share**.

Full product spec: [docs/plans/season-highlights-spec.md](../../season-highlights-spec.md)
Implementation facts (sync, msgpack, migrations, pipeline, sharing, frontend): [docs/plans/season-highlights-tech-notes.md](../../season-highlights-tech-notes.md)

## Shared Design Decisions (reference these, do not re-litigate)

1. **Collection = (scope, filter, aspect_ratio)** -- a stored *definition* (query), never a membership list. Scope: game(id) | season(label) | all-time. Membership is evaluated live everywhere (panel, share links, stitch input).
2. **Ratio is part of collection identity.** Collections are always mono-ratio; a (scope, filter) with content in both ratios yields two collections, each qualifying independently. Ratio appears in names as glyph + word ("Top Goals - Portrait"), never "9:16".
3. **One global rank per profile** (`final_videos.season_rank`, sparse REAL). Ordering rule used by EVERY collection: user rank where set, frozen quality score where not; ranked above unranked. Rank is set by insertion gestures, never bulk sorting.
4. **Freeze at export-finalize, not publish.** Publish archives + deletes working data, so duration/aspect_ratio/tags are stamped onto final_videos when the export completes. Snapshots are never re-derived (existing convention).
5. **Gesture-based persistence only.** Rank suggestions shown in UI are memory-only until the user confirms; the confirm/drag gesture fires a surgical endpoint. No reactive writes, no full-state saves.
6. **Smart collection eligibility**: per (tag, ratio), exists when matching published reels total >= 30s. Near-misses render locked with progress ("0:22 / 0:30 - almost!").
7. **Season Highlights time budget**: slider detents 30s/1m/2m/3m/5m/Max; membership = rank order, greedy-with-skip; playback order = rank order (best first).
8. **Unlock gate**: Season Highlights paradigm introduced via full-screen modal (fanfare sound, no backdrop close) when a profile crosses 30s published duration. Opt in/out persisted as `pref.seasonHighlightsChoice` ('enabled'|'declined'|unset). Declined -> quiet locked card in Collections, no ranking prompts.
9. **Temporal personality is deliberate**: season/smart links always show the *current best* (live membership); game links are stable by nature. Share UI states this.
10. **"New Reel" becomes "Custom Mix"** -- demoted to a quiet entry point, never removed. DB `source_type` values unchanged (display-only rename).
11. **Multi-game reels** (clips from >1 game) live in a "Mixes & compilations" group and are excluded from game collections and Season Highlights.
12. **Release grouping**: T3600 -> T3610 -> T3620 ship independently. T3630 + T3640 + T3650 + T3660 ship together (the paradigm release). T3670 fast-follows. T3680 last; the "Video" verb stays hidden until it ships.

## Tasks (dependency order -- do not start N+1 before N is complete)

| ID | Task | Status |
|----|------|--------|
| T3600 | [Freeze Collection Metadata at Export](T3600-freeze-collection-metadata.md) | TODO |
| T3610 | [Collections Tab + Game Collections](T3610-collections-tab-game-collections.md) | TODO |
| T3620 | [Collection Share Links + Public Viewer](T3620-collection-share-links.md) | TODO |
| T3630 | [Reel Ranking Model + Insertion UX](T3630-reel-ranking.md) | TODO |
| T3640 | [Season Highlights + Unlock Moment](T3640-season-highlights-unlock.md) | TODO |
| T3650 | [Custom Mix Demotion + Rename](T3650-custom-mix-demotion.md) | TODO |
| T3660 | [Quest 4 Rework: Season Highlights Funnel](T3660-quest-rework.md) | TODO |
| T3670 | [Smart Collections: Top Goals / Assists / Dribbles](T3670-smart-collections.md) | TODO |
| T3680 | [Stitched Collection Videos](T3680-stitched-collection-videos.md) | TODO |

## Migration Inventory (explicitly triggered post-deploy, never auto-run)

| Task | Track | Version | What |
|------|-------|---------|------|
| T3600 | profile_db | v007 | `final_videos` + duration/aspect_ratio/tags columns + backfill (incl. R2 archive reads) |
| T3620 | postgres | v016 | shares.share_type CHECK adds 'collection'; `collection_definition JSONB` column; `_SCHEMA_DDL` update |
| T3630 | profile_db | v008 | `final_videos.season_rank REAL NULL` + `collection_settings` table |

Deploy checklist for each: merge -> staging auto-deploy -> `POST /api/admin/migrate` on staging -> verify -> prod deploy -> `POST /api/admin/migrate` on prod.

## Completion Criteria

- [ ] All 9 tasks complete
- [ ] A parent can: see reels grouped by game, play a game's reels as a story, share a live game link, rank reels at publish, set a season time budget, share Season Highlights, see Top Goals unlock, download a stitched MP4
- [ ] New-user flow (quests 1-4) lands users in the curation paradigm end-to-end
- [ ] All three migrations run on staging + prod
- [ ] e2e new-user-flow spec updated and green
