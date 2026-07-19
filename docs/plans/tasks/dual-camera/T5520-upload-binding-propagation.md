# T5520: Upload Binding + Cross-Account Camera Propagation

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

A shared game's members each upload footage into their own account, but neither side can see
the other's camera. This task makes an upload to a shared game (a) register in the Postgres
coordination object and (b) appear in the OTHER member's local game as a second camera —
by reference, never by copy (sources are globally content-addressed `games/{blake3}.mp4`;
see [EPIC.md](EPIC.md) decisions 2-3).

## Solution

### A. Local schema: the `camera` axis (profile_db migration)

`game_videos` gains `camera INTEGER NOT NULL DEFAULT 0`; uniqueness becomes
`(game_id, camera, sequence)` (SQLite: new unique index; the old `UNIQUE(game_id,
sequence)` table constraint requires the standard rebuild-or-index approach — Migration
agent decides, existing rows keep `camera = 0`). Update `ensure_database()` in
`database.py` AND write the versioned migration (include `games.shared_game_id` here if
T5500 hasn't already added it — one file, coordinated versions).

Column mapping for a propagated remote video (`shared_game_videos` row → local
`game_videos` insert):

| local column | value |
|---|---|
| `game_id` | member's local game (`games.shared_game_id` lookup) |
| `blake3_hash` | `shared_game_videos.blake3_hash` |
| `sequence` | `shared_game_videos.sequence` |
| `camera` | `shared_game_videos.member_index` (the uploader's slot) |
| `duration`/`video_width`/`video_height`/`fps` | copied from `shared_game_videos` |
| `video_size` | omitted (NULL — not carried in coordination row) |

Plus a `game_storage_refs` insertion per remote blake3 via the T2830/T2850 game-reference
helper, guarded by R2 `head_object` (T4820 rule: never resurrect a reclaimed source).

### B. Upload binding (uploader side)

When the Add Game upload is entered from a shared-game slot CTA (T5510), the upload
finalizes into the member's EXISTING local game (`shared_game_id` known) instead of
creating a new game, with `camera = own member_index`. After finalize (duration/fps/dims
known — ffprobe at finalize is authoritative, T4260), the backend registers the video:
INSERT `shared_game_videos` with the same metadata. Registration happens server-side in
the finalize path (one write path), not from the client.

### C. Propagation (other member's side)

Refresh-on-load: when a game with `shared_game_id` loads (`GET /api/games/{id}/load`) —
and on a lighter trigger when the games list renders shared cards — the backend compares
local `game_videos` (camera != own slot) against `GET shared_game_videos` and inserts any
missing rows + storage refs (mapping above). This is a read-triggered *materialization of
references*, the same class of load-time healing as `handleLoadGame`'s back-fill — it is
NOT user-data mutation and does NOT touch annotations. Playback of remote-camera videos
rides the existing per-blake3 streaming path untouched.

### D. Expiry

Both members hold refs; the sweep must only reclaim `games/{blake3}.mp4` when NO live refs
remain across ALL users. Audit the current sweep for multi-user ref semantics (teammate
shares already create this situation) and add a regression test; fix the sweep if it
assumes single-owner.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — `ensure_database()` game_videos/games schema (~L895)
- `src/backend/app/migrations/profile_db/` — NEW migration (camera + unique index [+ shared_game_id])
- `src/backend/app/routers/games_upload.py` — finalize path: bind-to-existing-game + `shared_game_videos` registration
- `src/backend/app/routers/games.py` — `/load` (~L2178) propagation hook; T2830/T2850 game-reference helper; `_ensure_game_storage_refs` head-guard pattern
- `src/backend/app/routers/shared_games.py` — `GET /{id}` consumed here (from T5500)
- `src/backend/app/services/auto_export.py` / `sweep_scheduler.py` — multi-user ref audit
- `src/frontend/src/containers/AnnotateContainer.jsx` — `applyGameData` must tolerate `camera` on videos (filter to camera 0/primary until T5540)
- `src/backend/tests/test_shared_game_propagation.py` — NEW

### Related Tasks
- Depends on: T5500 (coordination tables), T5510 (slot CTA entry)
- Blocks: T5530 (needs both cameras' videos), T5540
- Reuses: T2830/T2850 game reference helper; T4820 head-guard; blake3 finalize metadata (T4260)

### Technical Notes
- Knowledge docs: [backend-services.md](../../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../../.claude/knowledge/persistence-sync.md), [annotate.md](../../../.claude/knowledge/annotate.md)
- L-tier (schema + cross-account flow) → Architect design gate. Design settles: exact
  propagation trigger (in `/load` synchronously vs a `Depends` refresh), and the sweep
  multi-ref semantics.
- **Until T5540 lands, everything downstream of `/load` must behave exactly as today**:
  virtual timeline, annotations, export all see only the member's primary camera. The
  simplest guard: `/load` returns all videos with `camera`, and `applyGameData` filters to
  the primary camera. Do not let camera-1 rows leak into `buildFullVideoTimeline` yet.
- Migration row-factory gotcha: `up(conn)` gets TUPLE rows — positional indexing only.
- Tests: two real test users against dev Postgres (conftest truncates — warn user before
  running suite).

## Implementation

### Steps
1. [ ] Architect design doc (propagation trigger, sweep semantics, migration shape) — user approval gate
2. [ ] profile_db migration + `ensure_database()` (camera, unique index, shared_game_id if pending)
3. [ ] Upload binding: finalize into existing shared game + `shared_game_videos` registration
4. [ ] Propagation on `/load` + storage-ref insertion with head-guard
5. [ ] `applyGameData` primary-camera filter (temporary until T5540)
6. [ ] Sweep multi-user ref audit + regression test
7. [ ] Tests: upload A visible to B after load; refs present for both; expired-source guard; no annotation/timeline behavior change

## Acceptance Criteria

- [ ] Member A's upload appears (as `camera` A rows + storage refs) in member B's local game after B loads it, and vice versa
- [ ] No source bytes are copied — both accounts reference the same `games/{blake3}.mp4`
- [ ] Sweep never reclaims a source while the other member's refs are live (test proves it)
- [ ] Annotate/export behavior is UNCHANGED for both members until T5540 (primary-camera filter verified)
- [ ] Migration runs via admin endpoint; existing games untouched (`camera = 0`)
- [ ] Backend tests pass
