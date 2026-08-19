# T5520: Upload Binding + Feed Propagation + Rent Enforcement + Live Sync

**Status:** TODO
**Impact:** 8
**Complexity:** 8
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

Pool members upload footage into their own accounts, but nobody can see anyone else's
camera. This task makes an upload to a pool game (a) register in the Postgres feed
registry and (b) appear in every other member's local game — **by reference, never by
copy** (sources are globally content-addressed `games/{blake3}.mp4`; [EPIC.md](EPIC.md)
decisions 2, 5). It also enforces the rent model at the media path and delivers the §6
live-sync freshness contract.

## Solution

### A. Local schema: the `feed_id` axis (profile_db migration)

`game_videos` gains `feed_id INTEGER NOT NULL DEFAULT 0` (0 = the game's own/legacy
feed); uniqueness becomes `(game_id, feed_id, sequence)` (SQLite: new unique index; the
old `UNIQUE(game_id, sequence)` table constraint needs the rebuild-or-index approach —
Migration agent decides; existing rows keep `feed_id = 0`). Update `ensure_database()`
AND the versioned migration (carries `games.shared_game_id` if T5500's file hasn't —
one file, coordinated versions, checked against sibling branches).

Column mapping for a propagated remote video (`shared_game_feed_videos` row → local
`game_videos` insert):

| local column | value |
|---|---|
| `game_id` | member's local game (`games.shared_game_id` lookup) |
| `feed_id` | the pool `shared_game_feeds.id` (global feed identity, greppable across accounts) |
| `sequence` | `shared_game_feed_videos.sequence` |
| `blake3_hash` / `duration` / `video_width` / `video_height` / `fps` | copied from the registry row |
| `video_size` | omitted (NULL — not carried in the coordination row) |

Plus a `game_storage` ref per remote blake3 via the T2830/T2850 game-reference helper,
**expiry copied from the uploader's initial window** (EPIC decision 5 — the uploader's
first 30 days cover the whole pool; teammate-share precedent), head-guarded (T4820: never
resurrect a reclaimed source).

### B. Upload binding (uploader side)

An upload entered from a pool entry point (§4 chip / §4b panel / §5 modal) finalizes into
the member's EXISTING local game with their own feed identity — a genuine `upload_game`
(EPIC decision 2), one full-camera feed per member, clips unlimited (§5 duplicate rule).
After finalize (ffprobe metadata authoritative, T4260), the backend registers the feed +
videos in the registry (incl. `creation_time` from T5495's parse) and dispatches T5530's
`align_feed`. Registration is server-side in the finalize path — one write path, gesture =
the "Add Camera"/"Add Clips" click.

### C. Propagation (every other member)

Refresh-on-load + **live-sync poll (§6 states):** while a pool game is open, the registry
(`GET /api/pools/{id}`) is re-read on a **~60s interval, on window focus, and after the
member's own pool writes** — read-only polling, no push, no reactive writes. New registry
rows materialize local `game_videos` + refs (mapping above, `shared_by` provenance,
quest-blind T5330) in place: the lane/chip appears and the arrival toast fires without a
reload. The same read heals on plain `/load`. This is load-time materialization of
references (the `handleLoadGame` back-fill class) — it never touches annotations.

### D. Rent enforcement at the media path

Access = the member's OWN live refs (today's `storage_status` semantics), **enforced at
the presign/stream path, not just UI** (EPIC decision 5): a presign for `games/{blake3}`
requires a live ref on that hash in the requesting member's profile. UI derivation of
per-feed status is T7300's; this task makes the server refuse.

### E. Sweep cross-ACCOUNT recount audit

Object reclaim only when NO live refs remain anywhere + grace. The sweep's authoritative
recount must provably cover refs across ALL accounts/profiles (memory: game-video
ref_count drift was the ready-game/video-404 root cause — the recount is load-bearing).
Audit + regression test with refs split across two users.

### F. Cancel-at-every-stage rails (§5b table)

Pre-upload: local only. Mid-upload: `Cancel upload` rides the existing
`DELETE /api/games/upload/{sid}` pending_uploads rail — for a pool feed it also removes
the feed registration so the §2 "uploading now" row disappears on the next poll; no
charge (charge is at activation). Post-activation: remove/withdraw (§10 rails, T5500).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — `ensure_database()` game_videos schema; `src/backend/app/migrations/profile_db/` — NEW migration (feed_id + unique index [+ shared_game_id])
- `src/backend/app/routers/games_upload.py` — finalize: bind-to-existing + registry registration + align dispatch; cancel rail extension
- `src/backend/app/routers/games.py` — `/load` propagation hook; T2830/T2850 reference helper; head-guard; **presign/stream rent check**
- `src/backend/app/routers/pools.py` — `GET /{id}` (T5500) consumed by the poll
- `src/backend/app/services/sweep_scheduler.py` — cross-account recount audit
- `src/frontend/src/containers/AnnotateContainer.jsx` — poll wiring while a pool game is open; `applyGameData` filters to `feed_id = 0`/own feed until T5540
- `src/backend/tests/test_pool_propagation.py` — NEW

### Related Tasks
- Depends on: T5500 (registry tables + `GET /{id}`), T5510 (entry points), T5495 (creation_time at finalize)
- Blocks: T5530 (needs registered feeds), T5540 (lanes read propagated rows), T7300 (per-feed refs + enforcement point), T7310 (proxy presign uses the same rent check)
- Reuses: T2830/T2850 helper; T4820 head-guard; T4260 finalize metadata; `_insert_game_with_videos` (EPIC decision 7)

### Technical Notes
- Knowledge docs: [backend-services.md](../../../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md), [annotate.md](../../../../.claude/knowledge/annotate.md)
- L-tier → Architect design gate: poll transport (reuse `GET /api/pools/{id}` vs a lean
  delta endpoint), propagation trigger placement, rent-check location (one seam), sweep
  recount coverage proof
- **Until T5540 lands, everything downstream of `/load` behaves exactly as today**: the
  `applyGameData` own-feed filter keeps other feeds out of `buildFullVideoTimeline`
- The poll is read-only; materialization it triggers is reference healing, never
  user-data mutation and never a write-back of loaded state (restore-is-read-only rule)
- Migration row-factory gotcha: `up(conn)` gets TUPLE rows — positional indexing.
  Migrations never auto-run (`POST /api/admin/migrate`)
- Tests hit dev Postgres (conftest truncates — warn user before running)

## Implementation

### Steps
1. [ ] Architect design doc (poll shape, rent-check seam, sweep proof, migration shape) — user approval gate
2. [ ] profile_db migration + `ensure_database()` (feed_id, unique index)
3. [ ] Upload binding: finalize into existing game + registry registration + align dispatch; cancel rail removes registration
4. [ ] Propagation on `/load` + poll (60s/focus/after-own-writes) + refs with copied expiry, head-guarded
5. [ ] Rent enforcement at presign/stream
6. [ ] Sweep cross-account recount audit + regression test
7. [ ] `applyGameData` own-feed filter (temporary until T5540)
8. [ ] Tests: A's upload appears for B on poll without reload; refs carry the uploader's expiry; presign refused without own live ref; sweep never reclaims with any live ref anywhere; cancel mid-upload cleans registration; no behavior change for plain games

## Acceptance Criteria

- [ ] Another member's upload appears (feed rows + refs) while a pool game is open — poll, focus, or own-write triggered — never requiring a reload
- [ ] No source bytes are copied; every account references the same `games/{blake3}.mp4`; initial refs carry the uploader's expiry
- [ ] Media presign fails without the requester's own live ref (test proves the server refuses, not just UI)
- [ ] Sweep reclaims only at zero live refs across ALL accounts + grace (cross-account regression test)
- [ ] Mid-upload cancel discards parts, removes the feed registration, charges nothing
- [ ] Annotate/export unchanged for everyone until T5540; migration runs via admin endpoint; existing games untouched (`feed_id = 0`); tests pass
