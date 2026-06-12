# Season Highlights & Collections — Product Spec

**Status:** Draft for review
**Date:** 2026-06-12
**Scope:** My Reels redesign around live-membership collections, reel ranking, Season Highlights as the flagship product, demotion of the manual reel path, quest rework, and the unlock moment.

---

## 1. Vision

Replace the *editing* mental model ("build a video from clips") with a *curation* mental model ("rank your moments; the product assembles the video"). My Reels becomes the home of all end products and end-product actions (play, share, download/stitch). The core loop becomes:

```
annotate → publish → rank → share
```

A **collection** is the unifying abstraction:

```
collection = (scope, filter, aspect_ratio)
  scope:   game(id) | season(label) | all-time
  filter:  tags ⊆ {Goal, Assist, Dribble, ...} · min quality
  ratio:   9:16 | 16:9   (part of identity — collections are always mono-ratio)
  + for Season Highlights: time budget (30s–5min | max)
```

Collections are **definitions (queries), not membership lists**. Membership is evaluated live: in the panel, behind share links, and as stitch input. The only stored artifacts are share records, the user's rank, and stitched videos.

**Ordering rule (used by every collection):** user rank where set, frozen quality score where not; ranked above unranked. The rank is a single global signal per profile — expressed once, consumed by Season Highlights, smart collections, and game "Play all".

---

## 2. Data model changes

### 2.1 Freeze collection metadata at export-finalize (profile_db migration v007)

**Stamping location matters:** publishing ([downloads.py:789-829](../../src/backend/app/routers/downloads.py)) archives the project to R2 (`archive/{project_id}.msgpack` via `services/project_archive.py`) and deletes working data — so metadata must be frozen **at export-finalize time**, while working_clips still exist: `_finalize_overlay_export` ([overlay.py:58-108](../../src/backend/app/routers/export/overlay.py)) and the annotated-game path ([auto_export.py:197-204](../../src/backend/app/services/auto_export.py), which already writes `duration`).

`final_videos` gains three columns:

| Column | Type | Source at export-finalize | Why |
|---|---|---|---|
| `duration` | REAL | The existing on-the-fly chain ([downloads.py:462-470](../../src/backend/app/routers/downloads.py)) moved to write-time | 30s thresholds, time budgets, unlock gate |
| `aspect_ratio` | TEXT | `projects.aspect_ratio` | ratio-scoped collections; stitch grouping |
| `tags` | BLOB (msgpack array, via `utils/encoding.py` — same convention as `rating_counts`) | Distinct tags of constituent clips (`working_clips → raw_clips`) | smart collections (Top Goals, ...) |

**Backfill migration (v007, profile_db track — current latest is v006):** for rows whose project/working data still exists, compute all three with the live logic. For **published rows whose working data was archived**, read the R2 project archive (`archive/{project_id}.msgpack`) for aspect_ratio/tags/duration. Rows that still resolve to nothing remain NULL — **excluded from time-budget math and smart-collection matching, with a visible log line** (no silent fallback). They still render in the gallery and game groups. Follow the v004 pattern for msgpack-touching migrations (validate before re-pack).

Consistent with the freeze-at-publish convention: these are snapshots, never re-derived.

### 2.2 Rank (profile_db migration)

`final_videos.season_rank REAL NULL` — sparse/fractional index (insert between 3 and 4 → 3.5), so insertion never rewrites other rows. Scoped per season (rank comparisons only happen within a season's reels; a new season starts fresh by construction since new reels arrive unranked).

Persistence is **gesture-based and surgical**: the confirm/drag gesture fires `POST /api/downloads/{final_video_id}/rank {rank: 3.5}`. No reactive writes; the "suggested position" shown in the UI is memory-only until confirmed.

### 2.3 Collection shares (Postgres migration + `_SCHEMA_DDL`)

`shares` gains `collection_definition JSONB NULL`; new `share_type = 'collection'`. The definition stores scope/filter/ratio (+ frozen display title incl. ratio word, per the explicit-names convention). The public resolver evaluates the definition against the **sharer's** profile DB (same cross-user read pattern as game-share materialization) and presigns each current member file. Revocation via existing `revoked_at`.

### 2.4 Per-profile collection settings (profile_db)

Small `collection_settings (key TEXT PRIMARY KEY, value TEXT)` table for the Season Highlights time budget and future per-collection knobs. Per-profile because different athletes have different content volume. Written only from the slider gesture.

### 2.5 User-level flags (existing `user_settings`, no migration)

`pref.seasonHighlightsChoice = 'enabled' | 'declined'` (absent = not yet offered) via the existing settings store/endpoints ([settingsStore.js](../../src/frontend/src/stores/settingsStore.js), [settings.py](../../src/backend/app/routers/settings.py)).

---

## 3. My Reels redesign

Tabs become **Collections (default) · All** (All = today's date-grouped flat view, kept as-is for recency lookups, including the existing source-type filter pills — note the current "star" tab is a Brilliant Clips *filter*, not user favorites; it stays a pill inside All).

```
┌─ My Reels ────────────────────────────────────────┐
│  [Collections]  [★]  [All]                  21    │
├───────────────────────────────────────────────────┤
│ SEASON                                            │
│  ⭐ Season Highlights ▮ Portrait   12 reels 2:10  │
│     best 2:00 ▸ [––––●––] 30s ↔ Max               │
│     [▶ Play] [🔗 Share] [⬇ Video]                 │
│                                                   │
│ SMART COLLECTIONS                                 │
│  🥅 Top Goals ▮          5 reels · 0:52  [▶][🔗][⬇]│
│  🔒 Top Assists ▮        0:22 / 0:30 — almost!    │
│                                                   │
│ GAMES                                             │
│  ▾ Vs LA Rebels May 2 ▮5 ▭2      7 reels · 1:12  │
│     [▶ Play all] [🔗 Share] [⬇ Game video]        │
│     │ ▸ Brilliant Chance Creation         0:06 │  │
│  ▸ at Legends Mar 28              9 reels · 1:40  │
│  ▸ Mixes & compilations           2 reels         │
└───────────────────────────────────────────────────┘
```

- **One header component** for all collection types with the same three verbs: **Play** (in-app story player — identical to what share recipients see), **Share** (live link), **Video** (stitch).
- **Ratio is part of identity and name**: glyph + word ("Season Highlights ▮ Portrait"), shown on headers, share pages, and stitched filenames (`Top Goals (Portrait) - Spring 2026.mp4`). A (scope, filter) with content in both ratios yields two collections, each qualifying independently.
- **Game groups** derive from the existing `group_key` / game association plumbing ([downloads.py:117-164](../../src/backend/app/routers/downloads.py)); ratio pills on the header filter cards and scope the verbs.
- **Mixes & compilations**: reels spanning >1 game, plus reels with no resolvable game. Excluded from game collections by default.
- **Season** uses the existing server-side season helper ([downloads.py:65-72](../../src/backend/app/routers/downloads.py)).
- Per-card actions (play, copy link, kebab) unchanged.

### Smart collections

Per (tag, ratio): exists when matching published reels total **≥ 30s**. Near-misses render **locked with progress** ("Top Assists ▮ — 0:22 / 0:30 · almost!") — a goal to chase, not hidden. Ordering: rank-hybrid; capped at ~2min of content. Initial set: Goal, Assist, Dribble; data-driven from whatever stamped tags clear the threshold.

### Season Highlights

`scope = current season`, no tag filter, per-ratio. **Time budget slider**: detents 30s / 1m / 2m / 3m / 5m / Max. Membership = take reels in rank order until the budget is spent, **greedy with skip** (if the next reel doesn't fit, try the following ones). Playback order = rank order (best first — hook in the first 3 seconds). Moving the slider is a gesture → writes `collection_settings`, and marks any stitched artifact stale.

---

## 4. Ranking UX

**Insertion, not sorting.** Nobody ranks 40 reels; they rank one reel 40 times across a season.

1. **At publish** ("Move to My Reels", [ProjectManager.jsx:1762-1799](../../src/frontend/src/components/ProjectManager.jsx)): show the new reel slotted at a suggested position (from frozen quality data) with 1–2 neighbors visible; `[▲][▼]` to adjust, **[Looks right]** to confirm. Confirm persists the rank surgically.
2. **Batch guard:** if the user publishes ≥3 reels in one session, suppress per-reel prompts and offer one "Rank your N new reels" swipe-through instead.
3. **Repair tool:** "Edit ranking" on the Season Highlights header opens a full drag list (fallback, not the path).
4. **Cold start:** unranked reels order by frozen quality score, so every collection works at zero effort and sharpens with investment. (Product default, not a data fallback — unset rank is a legitimate state.)

Only shown when `pref.seasonHighlightsChoice = 'enabled'`.

---

## 5. The unlock moment

**Trigger:** total published duration for the active profile crosses **30s** (sum of stamped `duration` over published `final_videos`), checked client-side after each publish success and once on app load (so existing users over the threshold get it on their first session after release). Shown only when `pref.seasonHighlightsChoice` is unset.

**Experience:** full-screen modal (standard pattern, **no backdrop close**), reusing the quest fanfare + celebration treatment (extract `playSound` from [QuestPanel.jsx:81-113](../../src/frontend/src/components/QuestPanel.jsx) into a shared `utils/sounds.js`; reuse `quest-celebrate` glow from [index.css](../../src/frontend/src/index.css)).

> 🏆 **Season Highlights Unlocked!**
> You've published 30 seconds of highlights — enough for a season reel.
> From now on, every reel you publish can be **ranked** against your best. Your Season Highlights video builds itself from your top moments — set how long you want it, and share one link that always shows your athlete's current best.
> **[Build my Season Highlights]**   ·   [Not now]

- **Accept** → `pref.seasonHighlightsChoice = 'enabled'`, record achievement `season_highlights_optin`, open My Reels → Collections with Season Highlights expanded, run the batch ranking swipe-through seeded by quality order.
- **Not now** → `'declined'`. No prompts, no ranking UI. A quiet locked card remains at the top of Collections ("Season Highlights — Enable") so opting in later is one click.
- **Autoplay caveat:** browsers block audio without a recent user gesture. Publish-triggered popups can play the fanfare immediately; load-triggered popups play it on the accept click instead.

---

## 6. Demoting "New Reel" → "Custom Mix"

The manual multi-clip path stays (themed multi-game mixes, recruiting videos with dictated order) but stops being a primary CTA, and is renamed — "reel" now means a published output, and manual compilations are **mixes** (matching the "Mixes & compilations" group).

Specific changes:

1. **Remove the primary button** — cyan `size="lg"` "New Reel" at [ProjectManager.jsx:707-717](../../src/frontend/src/components/ProjectManager.jsx). The Reel Drafts tab gets **no** primary action button (drafts originate from annotation; the Games tab keeps "Add Game").
2. **Add a quiet entry point**: small ghost/secondary button `+ Custom Mix` (icon `Plus`, `size="sm"`) right-aligned on the "YOUR REEL DRAFTS" header row. Same `disabled={!hasClips}` behavior, same `GameClipSelectorModal` flow; retitle the modal "New Custom Mix".
3. **Rename surfaces**: My Reels "All" filter pill "Custom Reels" → "Custom Mixes" ([DownloadsPanel.jsx:648-667](../../src/frontend/src/components/DownloadsPanel.jsx)); source-type display labels likewise. `source_type` enum values in the DB are **unchanged** (`custom_project`) — display-only rename.
4. **Timing**: ships in the same release as Season Highlights (don't remove the prominent path before its replacement exists).

---

## 7. Quest rework

Quest 4 ("Highlight Reel", 45 credits) currently teaches the multi-clip custom flow ([quest_config.py:9-62](../../src/backend/app/quest_config.py), detection [quests.py:188-199](../../src/backend/app/routers/quests.py)). It is replaced — the funnel now leads into the curation paradigm, and the 30s unlock threshold becomes a quest milestone.

**Quests 1–3: unchanged.** (They already drive annotate → frame → overlay → publish, which is exactly the content-production engine Season Highlights needs.)

**New Quest 4 — "Season Highlights" (45 credits):**

| Step | Title | Detection |
|---|---|---|
| `upload_game_2` | Add a Second Game | existing (derived) |
| `annotate_game_2` | Annotate a Good or Great Play | existing (derived) |
| `publish_30s` | Publish 30s of Highlights | derived: `SUM(duration)` over published final_videos ≥ 30 (needs §2.1 stamping + backfill) |
| `unlock_season_highlights` | Unlock Season Highlights | achievement `season_highlights_optin` (accept in unlock modal) |
| `rank_first_reel` | Rank a Highlight | derived: any `season_rank IS NOT NULL` |
| `share_season_highlights` | Share Your Season | achievement `copied_collection_link` (Share verb on any collection header) |

Files: [quest_config.py](../../src/backend/app/quest_config.py), `_check_all_steps` in [quests.py](../../src/backend/app/routers/quests.py), both frontend definition files ([data/questDefinitions.js](../../src/frontend/src/data/questDefinitions.js), [config/questDefinitions.jsx](../../src/frontend/src/config/questDefinitions.jsx)), quest-4 completion modal copy in [QuestPanel.jsx:204-225](../../src/frontend/src/components/QuestPanel.jsx) (drop the multi-clip messaging; celebrate the live link).

**Rollout notes:** users who already claimed quest_4 keep it (`completed_quest_ids` is persisted, steps backfilled as complete). Users mid-quest-4 lose old-step progress and see the new steps — acceptable; steps are derived, and the new path is shorter. A user who declines the unlock stalls at step 4 — acceptable; the locked Collections card re-opens the path, and the quest panel keeps showing the quest without nagging.

---

## 8. Sharing & stitching (carried design, summarized)

- **Share** = live link: `share_type='collection'` + definition JSONB (§2.3). Public viewer renders the frozen title (with ratio word), context line, segmented story player for 9:16 / filmstrip player for 16:9, evaluated fresh per visit. Empty membership → header + "no highlights yet", not 404. Reuses `ShareModal` public/email duality and the token/revoke lifecycle ([shares.py](../../src/backend/app/routers/shares.py)).
- **Temporal personality is deliberate**: Season/smart links always show the *current best* (membership shifts as ranks change); game links are stable by nature. Share UI says so: "this link always shows the current best of the season."
- **Stitch** ("⬇ Video") = new export job type in the existing pipeline (Modal/local FFmpeg): probe members → **stream-copy concat** when codec/resolution/fps match, else normalize to the ratio's canonical resolution (1080×1920 / 1920×1080) and encode. Output is a normal `final_video` + collection ref + member-ID snapshot; snapshot diff powers the staleness badge ("2 new reels since this video — Regenerate"). Renders as a pinned artifact card atop its collection.

---

## 9. Rollout: ordered user-facing capabilities (Impact / Complexity)

Build order optimizes impact-per-complexity and dependency flow. Estimates grounded in the files cited above.

| # | Capability (user-facing) | Impact | Complexity | Grounding |
|---|---|---|---|---|
| 1 | **Game collections in My Reels** — Collections tab, game headers with Play-all story player, ratio pills. Carries the §2.1 stamping + backfill migration. | High — gallery becomes game-organized; "watch the whole game's reels" exists | **M** (~10 files, ~700 LOC: DownloadsPanel/useDownloads restructure, header + story-player components, overlay.py stamping, 1 profile_db migration) | Game grouping plumbing already exists (`group_key`, `game_ids`); story player is new |
| 2 | **Share a game's reels** — live collection link + public playlist viewer | High — the original ask; first outward-facing win | **M-H** (~8 files, ~600 LOC: pg migration, shares.py resolver evaluating sharer profile DB + multi-presign, viewer page, header Share verb) | Cross-user profile-DB read pattern exists in game-share materialization; viewer reuses SharedVideoOverlay patterns |
| 3 | **Season Highlights + ranking + unlock moment** — rank model, insertion-at-publish, batch flow, slider, unlock modal w/ sound, opt-in/out. *Two tasks: (a) rank model + insertion UX, (b) season collection + slider + unlock.* | Very High — the paradigm shift; the product's flagship artifact | **H** (~14 files, ~1100 LOC: rank migration + surgical endpoint, prompt/batch/drag-list UI, collection_settings, unlock modal, sound util extraction, settings flag) | Audio/celebration reusable from QuestPanel:81-113; settings store pattern ready; publish hook at ProjectManager:1762 |
| 4 | **"Custom Mix" demotion/rename** | Medium — coherence of the new model | **VL** (~4 files, ~60 LOC) | Button at ProjectManager.jsx:707-717; label maps display-only |
| 5 | **Quest 4 rework** — onboarding funnels into curation | Medium — every new user lands in the paradigm | **L-M** (~6 files, ~250 LOC) | §7; two detections derived, two achievement keys |
| 6 | **Smart collections** (Top Goals / Assists / Dribbles, locked-progress states) | Med-High — repeat-visit driver, motivates publishing | **L-M** (~5 files, ~300 LOC) | Pure derivation once tags stamped (#1) + rank (#3); header component reused |
| 7 | **Stitched downloads** — one MP4 per collection, staleness + regenerate | High — the takeaway artifact (Insta, team chat) | **H** (~10 files, ~800 LOC, backend-heavy: new job type both GPU paths, probe/normalize/concat, artifact card) | Rides existing export/WebSocket/credits pipeline |

**Release grouping:** #1 → #2 ship independently as soon as ready. #3, #4, #5 ship together (the paradigm release — don't demote the old path or re-quest before/after separately). #6 fast-follows. #7 ships last; until then "⬇ Video" is hidden (not disabled).

**Dependencies:** #2 needs #1's stamping. #3 needs #1's duration (unlock gate). #5 needs #3 (achievement keys). #6 needs #1 (tags) + #3 (rank). #7 needs #1; benefits from all.

---

## 10. Risks & open questions

1. **NULL durations after backfill** (deleted source rows): excluded from budgets/thresholds with a visible log. Could slightly undercount the 30s gate for old accounts — acceptable; gate errs late, not early.
2. **Live share evaluation — sharer DB availability**: the existing cross-user helper (`materialization.py::_open_profile_db`) only opens *locally cached* profile DBs and does NOT download from R2 — after a machine restart the sharer's DB may be absent. The collection resolver needs a read-only "ensure sharer profile DB" helper with an R2 download fallback (reusing `sync_database_from_r2_if_newer` machinery), plus short-TTL caching of evaluated membership if view traffic warrants.
3. **Rank-prompt fatigue**: mitigated by the batch guard; tune threshold (≥3) with usage.
4. **Declined opt-in + quest 4**: quest stalls visibly. Accepted; revisit if decline rate is meaningful (analytics event on the modal choice).
5. **Aspect ratios beyond 9:16/16:9**: GameClipSelectorModal historically offered 1:1/4:3. Collections handle any distinct ratio value generically; only 9:16/16:9 get curated viewer layouts (others fall back to the filmstrip player).
6. **Multi-game reels in Season Highlights?** Current call: single-game reels only (they carry one game's context cleanly). Custom Mixes stay shareable individually. Revisit if users rank mixes highly.
7. **Season boundary UX**: when a new season starts, Season Highlights resets to empty (correct), and last season's collection + link remain reachable under a "Past seasons" group. Confirm copy at design time for #3.
