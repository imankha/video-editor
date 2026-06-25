# T3940 Design — "Re-edit This Reel" From Any Player

## Task Classification

**Stack Layers:** Frontend + Backend
**Files Affected:** ~8 files (6 frontend, 1 backend, + tests)
**LOC Estimate:** ~120 lines (excluding tests)
**Test Scope:** Frontend Unit + Frontend E2E + Backend

### Agent Workflow
| Agent | Include | Justification |
|-------|---------|---------------|
| Code Expert | Yes | Cross-layer, touches 3 player surfaces + shared/public component |
| Architect | Yes | Designs the shared helper + prop-gating contract (this doc) |
| Tester | Yes | Behavior change across 3 surfaces; mapping + gating + nav |
| Reviewer | Yes | Cross-layer, shared/public component gating, reused-but-extracted helper |
| Migration | No | No schema change — `final_videos.project_id` already exists |

### Skipped Stages
None — full workflow (design approval gate → test-first → implement → review → test).

---

## Current State

The restore-then-navigate path already exists for the My Reels **card** folder button:

```
DownloadsPanel.handleOpenProject(e, download)
  guard: onOpenProject && download.project_id && download.project_id !== 0
  setRestoringProjectId(download.id)
  POST /api/downloads/{download.id}/restore-project   // re-materializes archived project
  onOpenProject(result.project_id)                     // navigate
  close()                                              // close gallery
  finally setRestoringProjectId(null)
```

`onOpenProject` is supplied by `ProjectsScreen` as
`(projectId) => handleSelectProjectWithMode(projectId, { mode: 'framing' })`, i.e. it opens the editor
in Framing.

The three player surfaces:
- **Single-clip player** — `DownloadsPanel.handlePlay` → `setStoryPlayer({ reels: [toPlayerReel(download)] })` → `<CollectionPlayer>`.
- **Collection player** — `onPlayCollection(reels)` → `<CollectionPlayer>`; `activeReel` advances with the story.
- **Ranker replay** — `RankingGame` → `setReplayReel(toReplayReel(side))` → `<CollectionPlayer reels={[replayReel]}>`.

All three render the SAME `CollectionPlayer`. `SharedCollectionView` (public) also mounts `CollectionPlayer`.

Gaps:
- `toPlayerReel(d)` does not carry `project_id` (it's on `DownloadItem`, just not mapped).
- `toReplayReel(side)` does not carry `project_id`, and `/api/rank/next`'s `MatchupSide` doesn't expose it.

## Target State

One shared hook owns restore-then-navigate + loading state; all surfaces feed it.

### `useReEditReel` hook (new, `src/frontend/src/hooks/useReEditReel.js`)

`useReEditReel(navigateToProject)` → `{ openReelAsProject, restoringId }`. `openReelAsProject(reel)`
gates on `reel.project_id`, sets `restoringId`, POSTs `restore-project`, then calls `navigateToProject`.
`reel` needs only `{ id, project_id }` (id = download/final_video id, the restore key).

### DownloadsPanel wiring

```js
const navigateToProject = useCallback((projectId) => {
  onOpenProject?.(projectId);   // navigate to editor (Framing)
  close();                      // close gallery
  closeStoryPlayer();           // tear down the story player if open
}, [onOpenProject, close]);
const { openReelAsProject, restoringId } = useReEditReel(navigateToProject);

const handleOpenProject = (e, download) => { e.stopPropagation(); if (onOpenProject) openReelAsProject(download); };
```

- `<CollectionPlayer ... onReEdit={onOpenProject ? openReelAsProject : undefined} reEditLoadingId={restoringId} />`
- `<RankingGame onClose={closeRankingGame} onReEdit={onOpenProject ? openReelAsProject : undefined} />`

### CollectionPlayer (shared, prop-gated)

New optional props `onReEdit` and `reEditLoadingId`. Header Pencil button next to Download/X, acting on
`activeReel`, rendered only when `onReEdit && activeReel.project_id` (covers null/0). `SharedCollectionView`
omits `onReEdit` → button absent (locked by a unit test).

### RankingGame

Optional `onReEdit` prop; `toReplayReel(side)` adds `project_id`; export `toReplayReel` for tests. Replay
`<CollectionPlayer>` gets `onReEdit={onReEdit ? (reel) => { onClose(); onReEdit(reel); } : undefined}` —
close the ranker, then navigate. The hook state lives in `DownloadsPanel`, so the unmount is safe.

### Backend — `/api/rank/next`

- `MatchupSide`: add `project_id: Optional[int] = None`.
- `_rankable_pool` SELECT: add `fv.project_id`.
- `_side(row, ...)`: add `project_id=row["project_id"]`.

No migration: `final_videos.project_id` already exists (database.py:823 index).

---

## DECISION (mode) — RESOLVED: land in Framing

**Decision (user, 2026-06-24):** Re-edit lands in **Framing**, not "last mode" — because a reel's last
mode is effectively always Overlay (export happens from Overlay), so resuming would always reopen
Overlay. Keep the existing `{ mode: 'framing' }` hardcode in `ProjectsScreen.onOpenProject`.

Consequence: **no change to `ProjectsScreen.jsx`.** The re-edit button reuses `onOpenProject` exactly as
it is, landing the user in Framing for re-cropping. No mode picker, no `current_mode` read.

---

## Files to Change

| File | Change |
|------|--------|
| `src/backend/app/routers/rank.py` | `project_id` in SELECT + `MatchupSide` + `_side` |
| `src/frontend/src/hooks/useReEditReel.js` | NEW shared hook |
| `src/frontend/src/components/collections/playerReels.js` | `toPlayerReel` adds `project_id` |
| `src/frontend/src/components/collections/CollectionPlayer.jsx` | `onReEdit` + `reEditLoadingId` props + header button |
| `src/frontend/src/components/DownloadsPanel.jsx` | use hook; pass `onReEdit`/`reEditLoadingId`; pass `onReEdit` to RankingGame |
| `src/frontend/src/components/ranking/RankingGame.jsx` | `onReEdit` prop; `toReplayReel` adds `project_id`; export `toReplayReel` for tests |
| `src/frontend/src/components/SharedCollectionView.jsx` | No change (verify no `onReEdit`); locked by test |

(`ProjectsScreen.jsx` — NO change; re-edit lands in Framing per the resolved decision above.)

## Tests

- **Frontend unit:** `playerReels.test.js` (toPlayerReel carries project_id); `RankingGame` mapper test (toReplayReel carries project_id); `CollectionPlayer.test.jsx` (button present with onReEdit+project_id, absent without onReEdit, hidden when project_id null/0).
- **Frontend E2E:** player → Pencil → lands in editor.
- **Backend:** `test_reel_ranking.py` — `/api/rank/next` MatchupSide exposes `project_id`.

## Risks & Open Questions

- **Ranker mid-game re-edit** abandons the ranking session — **decided: just close + navigate** (ranking
  state is server-side and resumable; no confirm dialog).
- **Mobile header crowding** — Pencil is `iconOnly`, ghost, same size as the existing X/Download icons.
- **No new persistence** — pure navigation off a click; the only POST is the existing `restore-project`.
