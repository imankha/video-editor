# T3635: Reel Order Editor (manual fix-up after ranking)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-16

## Problem

The ranking game (T3630, built) sorts a collection via pairwise Glicko picks. But **a single
misclick during a session corrupts the order**, and once a collection is fully sorted
(Ranking Progress = 100%) there is no way to fix it: the game stops handing out matchups
(`/api/rank/next` → 204, `eligible=false`), and the only correction today is the **per-pick undo**
(`/api/rank/restore`) which is gone the moment the session ends. Users need to *see* the final
order and *nudge* a clip into the right place.

## Solution

When a ratio is **fully sorted (100% / `caught_up`)**, make the **Ranking Progress banner clickable**
so it opens a **Reel Order Editor**: the ordered list of that ratio's single-clip reels with
**drag (desktop) + up/down nudge buttons (all widths)** to reorder, and tap-to-replay on each row.
Each move is a **manual rating override** that re-anchors the clip's Glicko `rating` between its new
neighbors (twin-synced across ratios), persisted surgically per move (gesture-based, EPIC #5).

This is the "power tool" deferred in [T3630-ranking-game-spec.md](../T3630-ranking-game-spec.md) §10
("only if users ask") — users asked. Scope it to the 100% state per the user's request; the game
remains the primary input below 100%.

See [T3630-ranking-game-spec.md](../T3630-ranking-game-spec.md) for the engine; EPIC.md #3 (one
global per-clip rating), #5 (gesture-only persistence), #14 (mobile-primary).

## Current behavior (built, T3630) — what to build on

- **Order = Glicko `rating DESC`** (`ORDER_BY_RANK` in `services/collection_metadata.py`); rating is
  **per source clip, twin-synced** across ratio renderings via `final_videos.source_clip_id`.
- **Ranking pool** = single-clip (`clip_count==1`), published, latest-version reels of one ratio,
  with same-`source_clip_id` duplicates collapsed — see `_rankable_pool()` in `routers/rank.py`.
- **Progress = sort coverage**; 100% IFF every clip met its matchup target `K=clamp(ceil(log2 N),3,8)`
  (`_target_matchups`, `_fully_sorted`, `_confidence_stats`). At 100%, `eligible=false`.
- **Launcher** = `components/ranking/ConfidenceBanner.jsx`. States: `active` (clickable `<button>` →
  `onRank`), **`caught_up` (100%, currently a NON-clickable `<div>`)**, `locked` (<30s). It aggregates
  both ratios; `GET /api/rank/confidence?aspect_ratio=` per ratio.
- **Device/ratio rule (from the game):** phone = Portrait only; desktop = Portrait or Landscape (tabs).
- **Twin-set pattern already exists:** `_restore_reel()` in `routers/rank.py` SETs `rating/rd/match_count`
  across rows sharing `source_clip_id` — mirror it for the move's rating override.

## Implementation plan

### Backend (`routers/rank.py`)
1. `GET /api/rank/order?aspect_ratio=` → the ranking pool **ordered `rating DESC`**, each row =
   the existing `MatchupSide` shape (id, name, opponent_line, minute, tags, stream_url) **+ `rating`**.
   Reuse `_rankable_pool` + `_games_info` + `_side`; sort by `rating` desc (tiebreak created_at desc to
   match `ORDER_BY_RANK`). Works at any coverage (not gated to 100% server-side — gating is a UI choice).
2. `POST /api/rank/move` body `{reel_id, prev_id?, next_id?}` (prev_id = neighbor that should end up
   ABOVE, i.e. higher rating; next_id = below). Compute the new rating:
   - both neighbors → `(prev.rating + next.rating)/2`
   - top (no prev) → `next.rating + STEP` ; bottom (no next) → `prev.rating - STEP` (STEP ≈ 16)
   - if the neighbor gap `< 1e-6` → **re-space** the whole ratio pool to even integer-ish gaps, then
     recompute (mirror T3630's renumber guard).
   Then **SET** the reel's `rating` (and keep `rd` low to reflect a confident manual placement) across
   its `source_clip_id` twins (reuse the `_restore_reel` twin-SET pattern; do NOT touch `match_count`
   so coverage/100% is unaffected). Gesture-only — one POST per drag-drop / nudge. Middleware R2-syncs.
   404 on missing/unpublished/non-single-clip reel; 400 if `reel_id ∈ {prev_id,next_id}`.
3. No new Glicko math — this is a direct rating override, distinct from `/result`.

### Frontend
4. `components/ranking/ConfidenceBanner.jsx`: in the **`caught_up`** branch, render a clickable
   `<button>` (currently a `<div>`) wired to a new `onEditOrder` prop; keep the "Fully sorted" copy but
   add a "View / edit order" affordance (e.g. a ChevronRight + label). `active` stays → `onRank`.
5. `components/ranking/ReelOrderEditor.jsx` (NEW): full-screen modal (no backdrop close — memory
   `no-backdrop-close`). Per-ratio; **phone = Portrait only, desktop = Portrait|Landscape tabs**
   (mirror the game's device rule / `responsiveness` skill). Fetches `GET /api/rank/order`; renders the
   ordered list with **drag handles (desktop) + up/down nudge buttons (all widths, ≥44px)** and
   tap-to-replay. Each reorder → optimistic local move + `POST /api/rank/move` with the new neighbors;
   reconcile/refetch on failure. Reuse `ReelMatchCard`/`ClipVideo` (or extract a compact row) for the
   identity + replay.
6. `hooks/useRanking.js` (or a small `useReelOrder.js`): `fetchOrder(ratio)`, `moveReel(reelId, prevId,
   nextId)` with optimistic reorder via the existing `reelOrder.js` comparator.
7. `components/DownloadsPanel.jsx`: own the editor open state; pass `onEditOrder` to `ConfidenceBanner`
   and render `ReelOrderEditor`; refresh the banner (`refreshKey`) on close.

### Context — Relevant files
- `src/backend/app/routers/rank.py` — add `/order` + `/move` (reuse `_rankable_pool`, `_side`, `_restore_reel`)
- `src/backend/app/services/collection_metadata.py` — `ORDER_BY_RANK`, `route_collection` (reference)
- `src/backend/app/services/glicko.py` — `RD_MIN` for the override RD (reference)
- `src/frontend/src/components/ranking/ConfidenceBanner.jsx` — make `caught_up` clickable
- `src/frontend/src/components/ranking/ReelOrderEditor.jsx` — NEW
- `src/frontend/src/components/ranking/ReelMatchCard.jsx` / `ClipVideo.jsx` — reuse for rows + replay
- `src/frontend/src/components/ranking/RankingGame.jsx` — reference for device/ratio gating + modal shell
- `src/frontend/src/hooks/useRanking.js` — extend (or add `useReelOrder.js`)
- `src/frontend/src/components/DownloadsPanel.jsx` — wire the editor
- `src/frontend/src/utils/reelOrder.js` — comparator for optimistic reorder

### Related tasks
- Depends on: T3630 (ranking game, built — engine, pool, twin-sync, banner)
- Relates to: T3640 (Season Highlights). Per-ratio + single-clip rules unchanged.

### Technical notes
- **Gesture-only (EPIC #5):** every rating write traces to a drag/nudge; no reactive `useEffect` writes.
- **Single-clip + twin-sync:** moves operate on the same pool/identity as the game; write across
  `source_clip_id` twins so a Portrait reorder also moves the Landscape twin.
- **Don't disturb coverage:** the move SETs `rating` only (not `match_count`), so a fully-sorted
  collection stays at 100%.
- **Float exhaustion:** add the re-space guard (mirror T3630's renumber-on-tiny-gap).
- **Not deployed:** T3630 is unmerged/undeployed (don't deploy until all ranking UI is in). This ships
  with it on the same branch `feature/T3630-reel-ranking` (or a child branch).

## Implementation steps
1. [ ] `GET /api/rank/order` (ordered pool + rating) + tests
2. [ ] `POST /api/rank/move` (neighbor-midpoint rating override, twin-set, re-space guard) + tests
3. [ ] `ConfidenceBanner` caught_up → clickable `onEditOrder`
4. [ ] `ReelOrderEditor` (drag + nudge + replay, per-ratio/device) + `DownloadsPanel` wiring
5. [ ] `useReelOrder` optimistic reorder
6. [ ] Vitest (reorder logic, neighbor calc) + E2E (open at 100%, nudge a clip, order persists)

## Acceptance criteria
- [ ] At 100% (`caught_up`), tapping the Ranking Progress banner opens the order editor; below 100% it still opens the game
- [ ] Editor lists the ratio's single-clip reels in current order with identity (name · vs opp · `33'` · tags) and tap-to-replay
- [ ] Drag (desktop) and up/down nudge buttons (all widths) reorder; each move persists via one `/move` call and survives reload
- [ ] A move re-anchors rating between neighbors and twin-syncs (Portrait move also moves the Landscape twin); coverage stays 100%
- [ ] Fully usable at 360–390px (phone = Portrait only; desktop = ratio tabs); no backdrop close
- [ ] No rating write without a user gesture (code-reviewed vs EPIC #5)
- [ ] Tests pass
