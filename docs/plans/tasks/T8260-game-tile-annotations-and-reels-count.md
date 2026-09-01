# T8260: Game tile says "N annotations" (not "N clips") and adds "M reels"

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-31
**Updated:** 2026-08-31

## Problem

Every game tile in the Games grid ends its secondary line with `29 clips`
([GameTile.jsx:306](../../../src/frontend/src/components/GameTile.jsx#L306)). Two things
are wrong with that line.

1. **Wrong noun.** The number is `game.clip_count`, which the backend derives live from
   `raw_clips` rows for that game, i.e. the ANNOTATIONS the user saved while annotating.
   In this app "clip" also names the produced video the user downloads and shares, so
   "29 clips" reads as "29 finished videos are waiting for me" when in fact nothing has
   been produced yet. The word should name what is actually counted: annotations.
2. **The tile says nothing about output.** A game with 29 annotations and 3 published
   reels looks identical to a game with 29 annotations and nothing produced. The user
   wants the produced output visible per game: `3 reels`.

Screenshot at filing (Games grid, desktop): four tiles reading "29 clips", "21 clips",
"22 clips", "36 clips", with no indication that any of them produced a reel.

## Solution

The tile's secondary line becomes date on the left, counts on the right:

```
Sat, May 9                       29 annotations • 3 reels
```

Copy rules:

| Case | Renders |
|---|---|
| 29 annotations, 3 published reels | `29 annotations • 3 reels` |
| 29 annotations, 0 published reels | `29 annotations` (reels segment omitted entirely) |
| 1 annotation, 1 reel | `1 annotation • 1 reel` |
| 0 annotations | `0 annotations` (kept, so a fresh game reads as empty rather than blank) |

Separator is the bullet `•` with spaces, matching the existing precedent in
[ProjectHeader.jsx:60](../../../src/frontend/src/components/ProjectHeader.jsx#L60).

### What each number means (read this before writing code)

**annotations = the existing `clip_count` field. No backend change, LABEL ONLY.**
`_compute_athlete_stats` already counts every `raw_clips` row for the game, including
teammate/shared clips (deliberate, see
[test_game_clip_count.py](../../../src/backend/tests/test_game_clip_count.py)). Do NOT
rename the API field or the DB column: `clip_count` is read in roughly a dozen frontend
and backend places, the rename buys nothing, and the greppability rule in CLAUDE.md is
explicit about not churning identifiers for a copy change.

**reels = a NEW `reel_count` field on the games list payload.** Definition, which the
implementer must not improvise:

- Source rows: `final_videos` filtered by `fv.id IN (latest_final_videos_subquery())`
  AND `fv.published_at IS NOT NULL` AND `exclude_teammate_reels_clause()`. Same three
  filters GET /api/collections/summary uses
  ([collections.py:410-421](../../../src/backend/app/routers/collections.py#L410-L421)).
  Unpublished drafts never count.
- Attribution: a reel counts for game G when
  `route_game_ids(fv.game_ids) == G` (
  [collection_metadata.py:76](../../../src/backend/app/services/collection_metadata.py#L76)),
  i.e. its frozen `game_ids` blob decodes to exactly `[G]`. **Any clip_count.**
- A multi-game mix (`game_ids` length > 1) counts for NO game. Attributing it to each of
  its games would inflate every tile and double count the same reel. A game-less reel
  (`game_ids` NULL) also counts for nothing.

**Do NOT use `route_collection` here.** `route_collection` additionally requires
`clip_count == 1` because Collections and Rankings are a single-clip pool (T3630). A
multi-clip highlight reel built from one game is the most common publish, and
`route_collection` would report it as belonging to no game, so the tile would say
"0 reels" for a game the user has clearly produced from. This is a **deliberate
divergence from the Collections game-bucket count**: the number on the tile can legitimately
be higher than the count shown for the same game in the Collections tab. Put that in a
code comment naming T8260, and do not add UI copy claiming the two numbers are the same.

### Layout (narrow screens are the real constraint)

Today the line is a single `flex justify-between` row
([GameTile.jsx:303-308](../../../src/frontend/src/components/GameTile.jsx#L303-L308)).
At the 2-up 390px breakpoint a tile is roughly 175px wide, and
`Sat, May 9` + `29 annotations • 3 reels` does not fit on one row at `text-xs`. The date
span carries `truncate`, so a naive one-row implementation silently eats the date.

Default implementation: stack on narrow, inline from `sm` up.

```jsx
<div className="mt-0.5 flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-2 text-xs">
  <span className="text-gray-300 truncate">{formatMatchDateLabel(game.game_date)}</span>
  <span className="flex-shrink-0 whitespace-nowrap text-gray-400">{countsLabel}</span>
</div>
```

Verify with real screenshots (below). If the stacked variant crowds the poster too much
at 390px (the tile runs as short as ~90px), stop and get a UI decision rather than
inventing an abbreviation: spawn the `ui-designer` agent with the two screenshots and the
fallback option `29 • 3 reels`, and put the choice to the user.

## Context

### Relevant Files (REQUIRED)

Backend:
- `src/backend/app/routers/games.py` - `_compute_athlete_stats` (~line 882), the
  `_read_games_for_list` reader (~line 1000-1060), `_list_games_impl` (line 1063) and the
  response dict where `clip_count` is set (line 1137). NEW `_compute_reel_counts` goes here.
- `src/backend/app/services/collection_metadata.py` - reuse `route_game_ids` (line 76).
  Do not write a second `decode_data(game_ids)` path.
- `src/backend/app/queries.py` - `latest_final_videos_subquery` (line 131),
  `exclude_teammate_reels_clause` (line 173).
- `src/backend/app/routers/collections.py` lines 410-421 - the read pattern to copy.

Frontend:
- `src/frontend/src/components/GameTile.jsx` - lines 296-309 (secondary line, and the
  failed-upload sentence at 298-299 which also says "clips"), plus the component
  docstring at line 19 ("date + clip count").
- `src/frontend/src/components/ProjectManager.jsx` line 1097 - the Continue card says
  `N clip(s) annotated`. Rename to `annotation(s)` for consistency. No reel count there.
- `src/frontend/src/components/ReferenceGameCard.jsx` - **leave alone.** It deliberately
  renders no count (see its comment at line 79); a cross-profile reference has no local
  clips and no local reels.

Tests to write / update:
- `src/backend/tests/test_game_clip_count.py` - existing sibling; add the reel-count
  cases here (or a new `tests/test_game_reel_count.py` following the same in-memory
  sqlite pattern).
- `src/frontend/src/components/__tests__/GameTile.test.jsx` lines 236-273 - three
  assertions currently expect `'3 clips'`, including an exact `toBe('3 clips')` at line 270.
- `src/frontend/e2e/T5675-home-hero-legibility.spec.js` lines 113-116 - regex
  `/\d+\s+clips?$/` on the scrim spans.
- `src/frontend/e2e/T5681-games-poster-grid.spec.js` line 114 - `getByText(/clip/i)`.

### Related Tasks

- **Vocabulary conflict with [T8130](first-clip-funnel/T8130-annotate-primary-cta-and-naming.md)
  (must be flagged before merge).** T8130's user-approved rename table (same day, 2026-08-31)
  makes the annotate unit a **"Play"** and the published output **"Highlight Reels"**. This
  task's approved copy is "annotations" and "reels". They are not the same words. Default:
  implement this task as specified (it is the later, explicit instruction for this surface)
  and keep the label construction in ONE place in GameTile.jsx so T8130's rename pass can
  update it in a single edit. Whoever implements the second of the two must reconcile, not
  silently overwrite.
- T8240 (admin "Clips" column should say "Published") is the same class of mistake on the
  admin surface: an event/annotation count labeled as if it were published output. Same
  reasoning applies; no shared code.

### Technical Notes

- **No schema change, no migration.** `reel_count` is derived at read time, exactly like
  `clip_count` (which the code comment at games.py:1137 calls out as deliberately derived
  "not the stale stored column"). Do not add a stored column; profile_db v011 already
  dropped the old denormalized game aggregates.
- **No N+1.** One query for the whole list, decoded in Python, then a dict lookup per
  game. The published set is small (the codebase assumes <= ~500 rows, see the comment at
  downloads.py:347). Run it on the SAME cursor inside the existing
  `with get_db_connection()` block in `_read_games_for_list`, which already runs on a
  worker thread via `run_in_context` (T6200). Never open a second connection, never query
  per game.
- Both `GET /api/games` and the bootstrap path (`list_games_metadata`, games.py:947) go
  through `_list_games_impl`, so both pick up `reel_count` for free. Verify the frontend
  bootstrap consumer does not strip unknown fields.
- Frontend stores the API response raw (no transform on store), so `reel_count` reaches
  `GameTile` through `game` with no store change.
- Nothing here writes to the backend. No gesture, no persistence, no `useEffect`.

## Implementation

### Steps

1. [ ] `git checkout -b feature/T8260-game-tile-annotations-and-reels`
2. [ ] Backend: add `_compute_reel_counts(cursor, game_ids) -> dict[int, int]` in
       `games.py` next to `_compute_athlete_stats`:
       ```python
       def _compute_reel_counts(cursor, game_ids):
           """Published reels attributable to each game (T8260).

           A reel counts for a game when its FROZEN game_ids decodes to exactly that
           one game id (route_game_ids), regardless of clip_count. NOT route_collection:
           that also demands clip_count == 1 (the T3630 single-clip Collections pool),
           which would report 0 reels for a multi-clip highlight reel built from one
           game. So this count can exceed the game's Collections bucket count by design.
           Multi-game mixes and game-less reels count for NO game.
           """
           if not game_ids:
               return {}
           wanted = set(game_ids)
           cursor.execute(f"""
               SELECT fv.game_ids
               FROM final_videos fv
               WHERE fv.id IN ({latest_final_videos_subquery()})
                 AND fv.published_at IS NOT NULL
                 {exclude_teammate_reels_clause()}
           """)
           counts = {}
           for row in cursor.fetchall():
               gid = route_game_ids(row["game_ids"])
               if gid in wanted:
                   counts[gid] = counts.get(gid, 0) + 1
           return counts
       ```
3. [ ] Call it in `_read_games_for_list` right after `athlete_stats` is computed (same
       cursor, same `with` block), thread it through the returned tuple, and unpack it in
       `_list_games_impl`.
4. [ ] Add `'reel_count': reel_counts.get(row['id'], 0),` to the games dict immediately
       after `'clip_count'` (games.py:1137).
5. [ ] `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"` (required
       import check after any Python edit).
6. [ ] Frontend `GameTile.jsx`: build the label once, above the JSX, e.g.
       ```jsx
       const annotationsLabel = `${game.clip_count} annotation${game.clip_count !== 1 ? 's' : ''}`;
       const reelCount = game.reel_count || 0;
       const countsLabel = reelCount > 0
         ? `${annotationsLabel} • ${reelCount} reel${reelCount !== 1 ? 's' : ''}`
         : annotationsLabel;
       ```
       Use it in the secondary line, apply the stacked/inline layout above, and update the
       failed-upload sentence at line 299 from `clip${...} saved` to
       `annotation${...} saved`. Update the component docstring line 19.
7. [ ] `ProjectManager.jsx:1097`: `N clip(s) annotated` becomes `N annotation(s)`
       (the word "annotated" becomes redundant once the noun is "annotations").
8. [ ] Update the four test locations listed under Relevant Files.
9. [ ] Screenshot verification (drive-app-as-user skill, `loginAsRealUser` with
       imankh@gmail.com on dev) at 390x844 and 1280x800, on a profile that has at least one
       game with published reels and one with none. Attach both.
10. [ ] Commit with `T8260: ` subject prefix and the co-author line.

### Test Scope (curated, ~10 tests, never the full suite)

```bash
# Backend
cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_game_clip_count.py tests/test_collections_summary.py -v 2>&1 > /tmp/T8260-backend.log; echo "exit: $?"

# Frontend unit
cd src/frontend && npx vitest run src/components/__tests__/GameTile.test.jsx src/components/__tests__/GameTile.posterUrl.test.jsx src/components/__tests__/ReferenceGameCard.test.jsx 2>&1 > /tmp/T8260-vitest.log; echo "exit: $?"

# E2E (the two specs that assert the tile scrim)
cd src/frontend && npx playwright test e2e/T5681-games-poster-grid.spec.js e2e/T5675-home-hero-legibility.spec.js 2>&1 > /tmp/T8260-e2e.log; echo "exit: $?"
```

`test_collections_summary.py` is in the set as the regression guard for the shared
`route_game_ids` / `latest_final_videos_subquery` read path, not because it changes.

### Classification (pre-filled for the implementer)

```
Tier: M
Stack Layers: Frontend + Backend
Files Affected: ~6 (2 backend source, 2 frontend source, 4 test files)
LOC Estimate: ~90
Test Scope: Backend + Frontend Unit + 2 E2E specs
Knowledge Docs: .claude/knowledge/annotate.md (raw_clips / annotations),
                .claude/knowledge/export-pipeline.md (final_videos, published_at, game_ids)
```

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Entry points and line numbers are already named in this file |
| Architect | No | No new abstraction, no schema change, M tier |
| Tester | No | Test set is named above; implementer writes them |
| Reviewer | Yes | M tier default: one fresh-context Reviewer on the diff before commit |
| Migration | No | Derived at read time, no schema change |
| UI Designer | Only if | The stacked 390px layout crowds the tile (see Layout) |

### Progress Log

**2026-08-31**: Filed from a user request against the Games grid screenshot. Backend and
frontend entry points located and recorded; reel attribution rule decided (single-game
reels, any clip_count) with the route_collection trap written up. Not started.

## Acceptance Criteria

- [ ] A game with 29 saved annotations renders `29 annotations`; the word "clips" appears
      nowhere on the tile
- [ ] A game with 3 published single-game reels renders `29 annotations • 3 reels`
- [ ] A game with 0 published reels renders `29 annotations` only (no `0 reels` segment)
- [ ] Singular forms render as `1 annotation` and `1 reel`
- [ ] `reel_count` is present on every game returned by `GET /api/games` AND by the
      bootstrap games payload
- [ ] A MULTI-CLIP reel built from a single game counts for that game (the explicit
      regression against using `route_collection`)
- [ ] A multi-game mix counts for no game; an unpublished draft counts for no game; a
      teammate-only single-clip reel counts for no game (backend unit tests for all three)
- [ ] Exactly one `final_videos` query per games-list request, on the existing connection
      (verified by reading the diff; no per-game query)
- [ ] The failed-upload tile says "annotations saved", and the Continue card says
      "N annotations"
- [ ] `ReferenceGameCard` still renders no counts
- [ ] Screenshots at 390x844 and 1280x800 show the line intact, date not truncated away
- [ ] No schema change, no migration, no new stored column, no reactive persistence
- [ ] Backend + frontend unit tests and both e2e specs pass; Branch CI green
