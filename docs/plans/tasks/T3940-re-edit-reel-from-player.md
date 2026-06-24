# T3940: "Re-edit This Reel" — 1-Click to the Editor From Any Player

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-06-24
**Updated:** 2026-06-24

## Problem

While watching a reel, there's no way to jump straight back into editing it. The
user has to close the player, return to Reel Drafts, hunt for the reel, and
reopen it. They want a **single click from the player itself** that takes them
back into that reel's editor (Framing/Overlay).

Three watching contexts must all support it:
1. **Single clip** — playing one reel from a My Reels card ("Play").
2. **Collection** — "Play all" of a Game Highlights collection (the button acts
   on the **currently-shown** reel, which changes as the story advances).
3. **Ranker** — the replay player opened from inside the ranking game.

## Solution

Add a **"Re-edit" affordance** (edit/pencil icon) to the player chrome and to
the ranker replay. On click it resolves the **active reel's** `project_id`,
restores the project if it was archived, and navigates into the editor.

**Key reuse — the path already exists.** [`DownloadsPanel.handleOpenProject`](../../../src/frontend/src/components/DownloadsPanel.jsx#L229)
already does exactly this for the My Reels card's folder button:
`POST /api/downloads/{id}/restore-project` → `onOpenProject(result.project_id)`.
And [`onOpenProject` → `loadProject`](../../../src/frontend/src/screens/ProjectsScreen.jsx#L401)
already does `setEditorMode(result.mode)`, so it **resumes the project's last
mode (Framing OR Overlay)** automatically — no mode picker needed. This task is
mostly about (a) surfacing that action inside the players and (b) threading
`project_id` to the reels that don't carry it yet.

## Context

### Relevant Files (REQUIRED)

**Frontend**
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — add a re-edit
  button to the header (next to Download/X, [line ~116-133](../../../src/frontend/src/components/collections/CollectionPlayer.jsx#L116)),
  invoked with `activeReel`. New optional `onReEdit` prop. Shared component, so
  gate on the prop (see SharedCollectionView below).
- `src/frontend/src/components/collections/playerReels.js` — `toPlayerReel(d)`
  must add `project_id: d.project_id` (and it already returns `id` = the
  download/final_video id, needed for the restore call). `DownloadItem` already
  exposes `project_id`.
- `src/frontend/src/components/DownloadsPanel.jsx` — pass `onReEdit` into the
  `<CollectionPlayer>` render ([line ~676](../../../src/frontend/src/components/DownloadsPanel.jsx#L676)).
  Reuse/extract the restore-then-navigate logic from `handleOpenProject` so the
  player and the card share one code path.
- `src/frontend/src/components/ranking/RankingGame.jsx` — the replay player is
  opened via `setReplayReel(toReplayReel(side))` ([line ~17, ~87](../../../src/frontend/src/components/ranking/RankingGame.jsx#L17)).
  Add a re-edit affordance to that replay surface and thread `project_id` through
  `toReplayReel`. Re-editing closes the ranker (`onClose`) then navigates.
- `src/frontend/src/components/SharedCollectionView.jsx` — public viewer that
  also mounts `CollectionPlayer`. It must **NOT** pass `onReEdit` (no ownership /
  no editor). Gating-by-prop keeps the shared viewer clean.
- (New, optional) a small shared helper/hook — e.g. `openReelAsProject(reel)` —
  that encapsulates `restore-project` + navigate so DownloadsPanel and
  RankingGame don't duplicate it.

**Backend**
- `src/backend/app/routers/rank.py` — `/api/rank/next` ([SELECT ~line 106-113](../../../src/backend/app/routers/rank.py#L106))
  selects `fv.id, source_clip_id, clip_start_time, …` but **not `fv.project_id`**.
  Add `fv.project_id` to the SELECT and to the reel/`RankSide` response model so
  the ranker reel carries the project to open. (The CollectionPlayer path needs
  no backend change — `project_id` is already on `DownloadItem`.)

### Related Tasks
- Builds on T3920 (player reel plumbing: `toPlayerReel`, `CollectionPlayer`
  header, ranker reels — all touched there).
- Same player surfaces as T3610 (collections player) and T3630 (ranking game).
- Reuses the existing `restore-project` flow (T66).

### Technical Notes
- **Active reel, not the whole collection.** In a collection the button must act
  on `activeReel` (the reel currently on screen), which advances with the story.
- **Mode resumes automatically.** `loadProject` sets `setEditorMode(result.mode)`
  from the project's `current_mode`, so re-edit lands in Framing or Overlay
  wherever the user left off. Do not hardcode a mode.
- **Archived projects.** `restore-project` (keyed by the download/final_video
  `id`) handles re-materializing an archived reel before navigation. Show a
  loading state during restore (the card path already does — `restoringProjectId`).
- **Non-editable reels.** Hide/disable the button when the reel has no editable
  project (e.g. annotated-game exports, or `project_id` null/0). The card path
  already gates on `download.project_id && project_id !== 0`.
- **No reactive persistence.** This is pure navigation off a user gesture — no
  new writes, no `useEffect`-driven persistence.

### Open Questions
- Ranker mid-game: re-editing abandons the current ranking session. Just close +
  navigate, or confirm first? (Lean: just navigate; ranking state is server-side
  and resumable.)
- Icon + placement on mobile (CollectionPlayer header is tight on small screens).
- Should the button also appear on the static My Reels card, or is the existing
  folder button enough? (Existing card folder button already covers the card;
  this task is specifically the *in-player* affordance.)

## Implementation

### Steps
1. [ ] Backend: add `fv.project_id` to `/api/rank/next` SELECT + reel model.
2. [ ] `toPlayerReel`: add `project_id`; `toReplayReel`: add `project_id`.
3. [ ] Extract `openReelAsProject(reel)` helper (restore-project + onOpenProject),
       reused by DownloadsPanel + RankingGame.
4. [ ] CollectionPlayer: optional `onReEdit` prop + header button on `activeReel`.
5. [ ] DownloadsPanel: pass `onReEdit`; SharedCollectionView: do not.
6. [ ] RankingGame replay: re-edit affordance; close ranker then navigate.
7. [ ] Gate button when reel has no editable project.

### Progress Log

**2026-06-24**: Task created. Confirmed the building blocks exist
(`handleOpenProject` restore flow + `onOpenProject`→`loadProject` resumes mode).
Confirmed gap: `/api/rank/next` reels lack `project_id`; CollectionPlayer reels
lack `project_id` in `toPlayerReel`. CollectionPlayer is shared with the public
SharedCollectionView, so the button must be prop-gated.

## Acceptance Criteria

- [ ] Re-edit button appears in the single-clip player, collection player (acting
      on the active reel), and the ranker replay.
- [ ] Clicking it lands in the reel's project editor in its last mode (Framing or
      Overlay), restoring the project first if archived.
- [ ] Button is absent in the public SharedCollectionView.
- [ ] Button is hidden/disabled for reels with no editable project.
- [ ] No new persistence; navigation only.
- [ ] Tests pass (frontend unit for reel mapping + gating; E2E player→editor;
      backend for `/rank/next` exposing `project_id`).
