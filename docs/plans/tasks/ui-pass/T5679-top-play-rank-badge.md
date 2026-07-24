# T5679: "Top Play" rank badge on My Reels tiles

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-23
**Epic:** [UI Pass](EPIC.md) — added mid-epic from user testing feedback (wave-3 integration test)

## Problem

Ranked reels (T3630 Glicko ranking game) carry a `season_rank`, but nothing on the My Reels
tiles shows it. The celebration surface should celebrate: a reel that ranked top-20 deserves
a visible badge with its exact rank.

## Solution (user-specified, 2026-07-23)

- Tiles in the My Reels drawer whose reel ranks in the **top 20** get a **"Top Play" badge
  showing the exact rank** (e.g. `#7`).
- Rank source: T3630's per-reel rating/rank (rank-where-set ordering already exists in the
  collections queries). If the member DTO lacks the rank, add it there (read-only response
  field — NO schema change, no migration).
- Badge style: high-contrast chip consistent with the tile scrim/status chips; `title` +
  `aria-label` ("Ranked #7 of your reels this season").
- Applies to ReelTile in the drawer (collections + game groups). Out of scope: home drafts
  tiles (drafts are unranked).

## Context

- `src/frontend/src/components/collections/ReelTile.jsx` (T5673)
- Collections member DTOs: `src/backend/app/routers/collections.py` (rank-where-set ordering)
- T3630 ranking model: pairwise Glicko, `season_rank` sparse REAL — see project memory/PLAN

## Acceptance Criteria

- [ ] Reel ranked <= 20 shows a badge with its exact rank on its My Reels tile
- [ ] Unranked / rank > 20 reels show no badge
- [ ] Badge has tooltip + aria-label; legible at 390px; no layout shift on poster load
- [ ] Real-browser evidence at 390 + 1280; unit test for badge threshold logic
