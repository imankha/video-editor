# T5678: Remove batch Select flow from My Reels (per-reel move instead)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-23
**Epic:** [UI Pass](EPIC.md) — added mid-epic from user testing feedback (wave-1 integration test, 2026-07-23)

## Problem

User feedback while testing wave 1: the **Select** button in the My Reels drawer is confusing
for the ~99% of users who will never batch-move reels between profiles. Batch move
(T4850: `selectMode` + checkboxes + batch action bar in `DownloadsPanel.jsx`, wired to
`useMoveReels` → `POST /api/downloads/move-to-profile`) is a rare-use power feature occupying
first-class UI on the celebration surface.

## Decision (user, 2026-07-23)

1. **Remove the Select mode entirely** — Select button, checkbox overlays, batch action bar,
   `selectMode`/selection state.
2. **Keep move-to-profile as a per-reel action**: add "Move to profile…" to each reel's
   existing overflow/actions menu, calling the same `useMoveReels` hook with a single ID.
   The rare user keeps the capability, one reel at a time; no mode.
3. Backend endpoint unchanged (it already takes a list; a single-ID list is fine — surgical
   gesture persistence preserved).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DownloadsPanel.jsx` — `selectMode:208`, item rendering
  `:418-503`, select toggle `:704`, batch bar `:723` (line numbers pre-T5673 re-skin)
- `src/frontend/src/hooks/useMoveReels.js` — KEEP (reused by the per-reel action); T4850
  durable-fail UX title is shared with `useRawClipSave.js:16` — don't break that coupling
- `src/frontend/src/hooks/__tests__/useMoveReels.test.js` — keep green; add single-ID case if
  not covered

### Related Tasks
- Bundled with: **T5673** (My Reels visual tiles) — SAME worker, SAME branch, sequential
  commits: T5678 removal first (own commit), then the T5673 re-skin on the cleaned surface.
  The per-reel "Move to profile…" action must appear in the tile's action pattern T5673
  introduces (hover-actions desktop / long-press sheet mobile).
- Reverses the UI (not the backend) of: T4850.

### Technical Notes
- No persistence changes; the move gesture stays surgical (one POST per explicit action).
- Confirm-before-move: moving a reel to another profile is hard to notice/undo for a parent —
  keep/add a small confirm step in the per-reel flow (match existing confirm patterns).
- No persisted view state; drawer behavior otherwise unchanged (no backdrop-close).

## Implementation

### Steps
1. [ ] Remove Select button, `selectMode` state, checkbox overlays, batch bar from
   `DownloadsPanel.jsx` (own commit)
2. [ ] Add "Move to profile…" per-reel action (existing overflow/menu pattern) → profile
   picker → confirm → `moveReels([id], targetProfile)`
3. [ ] Update/keep `useMoveReels` tests; unit test the per-reel action wiring
4. [ ] E2E: per-reel move reachable; no Select button rendered

## Acceptance Criteria

- [ ] No Select button / selection mode anywhere in My Reels
- [ ] Each reel exposes "Move to profile…" in its actions; flow completes with a confirm and
      the reel appears under the target profile
- [ ] `useMoveReels` tests green; no orphaned selection code (grep `selectMode` in
      DownloadsPanel = 0 hits)
- [ ] Real-browser evidence: drawer at 390px and 1315px, action menu open, post-move state
