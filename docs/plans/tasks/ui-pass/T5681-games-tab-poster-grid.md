# T5681: Games tab — poster tiles for games (season-scale layout)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-24
**Epic:** [UI Pass](EPIC.md) — added mid-epic from user testing feedback

## Problem

Games render as text rows while every other home surface now has poster imagery (T5672
drafts tiles, T5673 My Reels tiles). A full season is ~30 games; the layout must scan well
at that scale. User explored month-grouped carousel rows (~10 rows x 2-4 games) — rejected
as too sparse (header overhead beats content).

## Direction (from 2026-07-23 discussion; UI Designer gate confirms)

- **Poster source exists:** T5180 recap posters, R2 `recaps/posters/{game_id}.jpg`
  (clearest-frame, generate-on-demand). Surfacing may need a small owner-facing serving
  route following the T5671/T5673 poster-proxy pattern (read-only, no schema, no migration).
- **Primary layout: chronological poster GRID with month/season captions flowing inside the
  grid** (not separate carousel rows) — 6-up desktop / 2-up mobile, ~5 desktop rows per
  30-game season. Alternate to present at the gate: episode-style list (small poster left,
  rich meta right) if the tab is treated as manage-first.
- **Landscape tiles** (game footage is 16:9) — intentionally distinct from portrait reel tiles.
- Card overlay stays minimal: date + expiry chip + clip count; rich meta (ratings, quality)
  on hover/detail per T5675 legibility patterns. Expired games keep their compact
  single-row treatment or a grayed tile variant — UI Designer decides.
- All existing GameCard actions (load/annotate, recap, share, extend, edit, delete) remain
  reachable; expiry badges stay prominent (games are working assets that expire).

## Context

- `src/frontend/src/components/ProjectManager.jsx` — Games tab render + `GameCard`
  (post-T5675 restyle + compact expired card)
- `src/backend/app/services/poster.py` + recap poster route (T5180) — reuse, don't fork
- Poster-proxy precedents: `projects.py` draft poster (T5671), `downloads.py` reel poster (T5673)

## Acceptance Criteria

- [ ] Games render with poster imagery in the approved layout at 390 and 1280+
- [ ] Layout stays scannable with 30+ games (verify with synthetic season if needed)
- [ ] Poster-less/expired-source games show a branded fallback, never a broken image
- [ ] Expiry chips + all card actions preserved; no behavior/persistence changes beyond the
      read-only poster route
- [ ] Real-browser evidence at both widths; unit + e2e green; style guide updated
