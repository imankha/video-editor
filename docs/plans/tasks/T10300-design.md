# T10300 Design — Link a directly uploaded clip to a game later

**Status:** AWAITING APPROVAL (Architect gate, Stage 2)
**Task:** `docs/plans/tasks/T10300-link-uploaded-clip-to-game.md`
**Branch:** `feature/T10300-link-uploaded-clip-to-game`

## Summary of decisions (the 3 open questions + the gesture shape)

| # | Question | Decision |
|---|----------|----------|
| D1 | How is a linked upload clip represented without colliding with the game-cut natural key? | Add a `raw_clips.source` discriminator (`'game'` default \| `'upload'`). A linked upload clip keeps `game_id != NULL` **plus its own source span** (`start_time=0`, `end_time=duration`, `video_sequence=NULL`) — attribution only, no fake timeline position. The game-cut natural key lookup is **scoped to `source='game'`**, so the two clip kinds occupy separate keyspaces inside one game. |
| D2 | New idempotency discriminator (replace `filename AND game_id IS NULL`) | `filename = ? AND source = 'upload'`. `filename` already IS the blake3 content hash (`{blake3}.mp4`); swapping the *mutable* `game_id IS NULL` predicate for the *immutable* `source='upload'` makes re-uploads idempotent whether or not the clip has since been linked/unlinked. No separate `blake3_hash` column (would duplicate `filename`). |
| D3 | FK cascade fix | Keep the FK `ON DELETE CASCADE` for game-cut clips; **explicitly unlink upload clips before the cascade** in `_delete_game_cascade` (`UPDATE raw_clips SET game_id=NULL WHERE game_id=? AND source='upload'`). A blanket `ON DELETE SET NULL` is rejected — it can't discriminate by source and would strand game-cut clips as sourceless orphans. |
| D4 | Surgical gesture shape | New dedicated endpoint `POST /api/clips/raw/{clip_id}/link` with body `{ "game_id": int \| null }` (non-null = link, null = unlink). One gesture, one field, `null` unambiguous. `durable_sync`-gated. **Not** folded into `PUT /clips/raw/{clip_id}` — that model can't distinguish "field omitted" from "set to null". |

---

## Current state (traced 2026-09-18)

- **Upload insert** (`clips.py:2083-2087`): every direct upload lands `game_id = NULL`, `start_time = 0`, `end_time = probed_duration`, `video_sequence = NULL`. No `games` row created.
- **Idempotency** (`clips.py:1964-1967`): `SELECT id, auto_project_id FROM raw_clips WHERE filename = ? AND game_id IS NULL`. Keys on `game_id IS NULL` — so once a clip is linked, a re-upload no longer matches → duplicate row + a **second credit charge**.
- **Game-cut natural key** (`clips.py:1240-1250`, `save_raw_clip`): `game_id + end_time + video_sequence`. An upload clip linked into a game (`game_id` set, `end_time=duration`, `video_sequence=NULL`) could be **falsely matched** by an annotate save whose cut happens to end at the same `end_time` with `video_sequence IS NULL` → the annotate path would UPDATE the upload clip instead of creating its game cut.
- **Schema** (`database.py:1178-1208`): `raw_clips.game_id INTEGER`, `FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE`. No `source` column. FKs are enforced (`PRAGMA foreign_keys=ON` in every profile-opening path — `database.py:1748`, `user_db.py:246,440`, `materialization.py:63`).
- **Game delete** (`games.py:2250-2294`, `_delete_game_cascade`): relies on `ON DELETE CASCADE` to remove `raw_clips` (→ `working_clips`), then prunes now-empty projects. An attributed upload clip would be **deleted**, violating the AC.
- **Project → game attribution** (`collection_metadata.py:87-106`, `compute_project_game_ids`): resolves a project's `game_ids[]` from `raw_clips.game_id WHERE game_id IS NOT NULL`, including the auto-project link. **Already correct** — linking an upload clip makes its project surface under the game with **no change here**.
- **No `POST /api/clips/{id}/actions`** raw-clip endpoint exists today; the only `.../actions` route is project-scoped framing (`clips.py:435`). Raw-clip metadata edits go through `PUT /clips/raw/{clip_id}` (`clips.py:1359`).
- **Notice copy** (`displayNames.js:212+`, `CLIP_UPLOAD.NOTICE_TITLE/BODY`) tells the user uploads "won't be linked to a game."

**Invariant that makes the backfill sound:** direct uploads are the *only* clips created with `game_id IS NULL` — `save_raw_clip` 404s a save whose game doesn't exist (`clips.py:1232-1238`), so game-cut clips always carry a `game_id`. (Shared/materialized clips are copied *with* their `game_id`; pending clips carry `game_id` too. To be **confirmed by the migration author** before shipping — see Risks.)

## Target state

### Schema (D1) — profile_db track, migration **v053**
Add to `raw_clips`:
```sql
source TEXT NOT NULL DEFAULT 'game'   -- 'game' = annotate-cut; 'upload' = direct upload
```
- Fresh DBs: add the column to the `CREATE TABLE raw_clips` DDL in `database.py:1178`.
- Existing DBs: `v053_raw_clips_source.py` — `ALTER TABLE raw_clips ADD COLUMN source TEXT NOT NULL DEFAULT 'game'` then `UPDATE raw_clips SET source='upload' WHERE game_id IS NULL`. Self-sufficient (no reliance on raw R2 data; makes existing data correct). FK unchanged (cascade fix is code-only).
- `'upload'` already exists as vocabulary in `get_working_clip_url(source_type)` — same word, same meaning.

### Backend

1. **Upload insert** (`clips.py:2083`): write `source='upload'` on the new `raw_clips` row (`game_id` stays NULL at creation — linking is always a later gesture).

2. **Idempotency** (`clips.py:1964`): change predicate to `WHERE filename = ? AND source = 'upload'`.

3. **Game-cut natural key** (`clips.py:1242,1247`): add `AND source = 'game'` to both branches of the `save_raw_clip` existence lookup, so an annotate cut never matches a linked upload clip.

4. **New endpoint** `POST /api/clips/raw/{clip_id}/link` (`clips.py`, near `update_raw_clip`):
   - Body: `{ "game_id": int | null }`.
   - `durable_sync` dependency (sync to R2 before 200), consistent with `update_raw_clip`.
   - Guards: clip exists (404); `clip.source == 'upload'` else 400/409 (**never re-attribute a game-cut clip**); when `game_id` non-null, game exists (404 — mirror the ghost guard at `clips.py:1232`).
   - Effect: `UPDATE raw_clips SET game_id = ? WHERE id = ?` (surgical, single field). `null` → unlink.

5. **Game delete** (`games.py`, `_delete_game_cascade`): **before** `DELETE FROM games`, run `UPDATE raw_clips SET game_id = NULL WHERE game_id = ? AND source = 'upload'`. Sequenced so the pre-delete project-orphan collection (JOIN on `rc.game_id = ?`) no longer sees the unlinked uploads → their projects survive; only `source='game'` clips cascade.

6. **`RawClipResponse`** (`clips.py:131`): add `source: str` so the frontend can gate the link/unlink affordance to upload clips and thread it into the projects list.

7. **`collection_metadata.py`**: **no change** — verified `compute_project_game_ids` already attributes via `game_id IS NOT NULL`.

### Frontend

1. **Notice copy** (`displayNames.js` `CLIP_UPLOAD.NOTICE_BODY`) → exact task wording, routed through `displayNames.js` (no JSX literal):
   > "Heads up: these clips start out unlinked from a game. Uploading here adds videos straight to your clips, ready for Framing and publish. You can link a clip to a game at any time from the Clips tab so it shows up with that game's highlights."

2. **"Link to game" gesture** on an upload clip's tile menu (`DraftTile.jsx` / `ClipListItem.jsx`, Clips tab) and the editor header — opens a picker over the profile's existing games list (reuse the bootstrap games source; game-picker UI details deferred to ui-designer/implementor). On select → `POST /clips/raw/{id}/link {game_id}` → refetch projects. A linked upload clip also gets an **Unlink** action (`{game_id: null}`). Affordance shown only when `clip.source === 'upload'`. New copy lives in `displayNames.js` (`LIBRARY_ACTIONS` / `CLIP_UPLOAD`).
3. Gesture-based only — the link/unlink call fires from the click handler, never a reactive `useEffect`.

## Implementation plan (post-approval order)
1. Tester Phase 1 — failing tests: (a) re-upload idempotent after link, (b) game-delete unlinks (not deletes) an upload clip while cascading game-cut clips, (c) linked upload clip's project resolves the game in `compute_project_game_ids`, (d) annotate cut into a game with a same-`end_time` linked upload clip creates a new row (no false natural-key match).
2. Migration v053 (verify version un-collided at implement time — see Risks).
3. Backend: schema DDL + upload `source` + idempotency predicate + natural-key scope + link endpoint + `_delete_game_cascade` unlink + `RawClipResponse.source`.
4. Frontend: notice copy + link/unlink action + game picker wiring.
5. Reviewer (fresh context) → Stage 5 relevant tests → QA live-drive.

## Risks / edge cases
- **Migration version collision.** v053 is free on `master` and the only local branches; dotask waves spawn parallel branches, so **re-confirm `git log --all` / open PRs before finalizing the number** (recurring `project_migration_version_collision_across_branches` gotcha).
- **Backfill soundness.** `source='upload' WHERE game_id IS NULL` assumes uploads are the sole NULL-`game_id` clips. Migration author must confirm no shared/materialized/pending clip lands with NULL `game_id` before shipping; if any do, refine the predicate (e.g. also require `shared_by IS NULL`).
- **linked → unlinked → re-uploaded:** idempotency keys on `filename + source='upload'`, both immutable across (un)link → always dedups to the one row. ✓
- **game deleted while upload in flight:** uploads always insert `game_id=NULL`; link validates game existence at gesture time (404 on ghost). No orphan. ✓
- **Title/clip-count inheritance:** satisfied by existing `game_ids[]` resolution; QA verifies the linked clip counts toward the game and its reel title inherits opponent/date. No code beyond attribution.
- **Below-floor DBs** unaffected (floor=0, inert).

## Open questions for the user (approval gate)
1. **D4 endpoint shape** — the task file sketched `POST /api/clips/{id}/actions { set_game_id }`; this design refines it to a dedicated `POST /api/clips/raw/{clip_id}/link { game_id }` (no raw-clip actions endpoint exists today, and a null-sentinel on the shared update model is ambiguous). OK to proceed with the dedicated endpoint?
2. **Unlink affordance** — confirm we expose an explicit **Unlink** action on a linked upload clip (design assumes yes; AC says "and unlinked").
3. **D1 `source` column name/values** — `source TEXT` with `'game'`/`'upload'`. OK, or prefer a boolean like `is_upload`? (`source` chosen for extensibility + it matches existing `source_type` vocabulary.)
