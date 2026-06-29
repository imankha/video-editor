# T4110 — Design: Durable re-export/publish + lost-publish heal migration

**Status:** DESIGN — awaiting approval (do not implement)
**Stage:** 2 (Architecture)
**Step-1 repro:** confirmed (see commit `7a57d09e`). Root cause refined below.

---

## 0. Root cause (refined from Step-1 code reading — supersedes the kickoff's "pure fire-and-forget" wording)

The export-finalize background workers **already** do an explicit R2 sync. Commit
`40f40aa8` (2026-06-12) added a `finally:` block to both background workers that calls
`sync_export_db_to_r2(user_id, profile_id)`:

- overlay: `_run_overlay_export_background` → `overlay.py:1920-1924` (finally)
- framing: `_run_render_background` → `framing.py:719-722` (finally)
- multi-clip: `multi_clip.py:2289`

And `sync_export_db_to_r2` (`export_helpers.py:333`) calls `sync_db_to_r2_explicit(user_id, profile_id)`,
whose `lock_timeout` **defaults to `None`** (`database.py:1207`) — i.e. it does NOT silently
defer on the 0.5s upload-lock. So the finalize sync is *already lock-durable*.

So why did prod still lose project 46 / strand project 41? **Three residual gaps, not "no sync at all":**

1. **Ordering — completion is announced before durability.** Both workers send the
   `status=COMPLETE` ("Export complete!") WebSocket event **before** the `finally` sync runs
   (overlay: `send_progress(complete)` at `1892`, sync at `1924`). The client shows
   "Export complete → Move to My Reels" against state that is not yet in R2.

2. **Failure is swallowed.** `sync_export_db_to_r2` returns `None`; on failure it just
   `mark_sync_pending(user_id)` and logs a warning. The worker can't know it failed and the
   client is never told. Durability then depends on a *later* write request retrying the
   pending sync. On a single Fly machine that autostops/redeploys before that next write,
   the locally-committed `final_videos`/`export_jobs` rows die with the machine → silent loss
   with a misleading "complete". This is project 46.

3. **Inline (request-scoped) finalize branches don't use the durable finally-sync at all.**
   `render_overlay`'s no-keyframes-copy / no-GPU / test branches (`overlay.py:~2100/2084/2142`),
   plus `export_final` (`/final`) and `export_overlay_only` (`/overlay`), finalize *inside the
   request handler* and return 200, relying on the middleware's **fire-and-forget** sync
   (0.5s defer, `db_sync.py:687`). These are the literal "fire-and-forget" paths. (In prod with
   Modal enabled the reel re-edit takes the background path, so #1/#2 are the live failure;
   #3 is a latent hole to close for the legacy/no-projectId paths.)

Project 41's stuck half-state (`published_at`/`archived_at` lost) is the *publish* gesture's
pre-T4050 fire-and-forget loss (06-27), which T4050 already fixed going forward. T4110's
migration heals that existing artifact.

**Answer to the kickoff's key question:** background render workers have **no request scope**
when finalize runs — the 202 already returned and `clear_request_context()` ran, so
`request.state.durable_sync` / the middleware sync cannot cover them. They **must** sync
directly (they do; we harden it). `Depends(durable_sync)` is only viable for the *inline*
request-scoped finalize endpoints.

---

## 1. Durable-export boundary

### Principle
Make **export-complete a true durable boundary**, exactly mirroring T4050's gesture durability:
the user's Export click is the gesture; "complete" is announced **only after** the new
`final_videos`/`export_jobs` rows are durably in R2. No reactive/`useEffect` persistence —
this is a one-shot, gesture-aligned sync at the finalize boundary. ✔ gesture-aligned.

### Mechanism per path

| Path | Endpoint | Context | Change |
|------|----------|---------|--------|
| Overlay render (prod reel re-edit) | `/render-overlay` → `_run_overlay_export_background` | **background task** (202) | sync-then-announce (below) |
| Framing render (prod reel re-edit step 1) | `/render` → `_run_render_background` | **background task** (202) | sync-then-announce |
| Multi-clip | `/multi-clip` background | **background task** | sync-then-announce |
| Final upload (legacy/no-projectId) | `/final` `export_final` | request handler (200) | add `Depends(durable_sync)` |
| Overlay blob (legacy/no-projectId) | `/overlay` `export_overlay_only` | request handler (200) | add `Depends(durable_sync)` |
| Inline branches in `render_overlay` (no-keyframes copy / no-GPU / test) | `/render-overlay` (200 branches) | request handler | add `Depends(durable_sync)` to `render_overlay` |

### Background workers (the live fix): "sync, then announce"
1. Promote the durable sync to a **status-returning** helper. Add to `export_helpers.py`:
   `durable_export_sync(user_id, profile_id, label) -> bool` — calls
   `sync_db_to_r2_explicit(user_id, profile_id, lock_timeout=None)` +
   `sync_user_db_to_r2_explicit(user_id, lock_timeout=None)`, logs
   `[SYNC] EXPORT {label} -> R2 sync OK/FAILED`, on failure `mark_sync_pending(user_id)`,
   returns success bool. (`sync_export_db_to_r2` stays as the error-path/finally fallback.)
2. On the **success path**, after `_finalize_overlay_export(...)` (which already does the
   atomic DB commit) and **before** `send_progress(complete)`:
   ```
   synced = await asyncio.to_thread(durable_export_sync, user_id, profile_id, f"overlay project={project_id}")
   if synced:
       await manager.send_progress(export_id, complete_data)          # status=COMPLETE
   else:
       await manager.send_progress(export_id, sync_failed_data)        # status=error/degraded, retryable=True
   ```
3. Keep a `finally` sync as the error-path safety net (unchanged behavior for exceptions).

### 503 / retry UX implication
There is no HTTP response to turn into a 503 on the 202 path, so the **WebSocket completion
event carries the failure** instead. Add a completion variant (e.g.
`status='sync_failed'` / reuse `phase='error'` with `retryable: true` + the same copy as
`DURABLE_SYNC_FAILED_RESPONSE`: "Could not save to the cloud… please try again"). Frontend
(`ExportButtonContainer` WebSocket handler) treats it like the T4050 503: do **not** show
"Export complete / Move to My Reels"; surface a retry. *(Frontend wiring is a small follow-on;
flagged in Open Questions — confirm the WS completion handler + which store flag gates the
"Move to My Reels" affordance.)*

For the **inline** endpoints (`/final`, `/overlay`, `render_overlay` 200 branches),
`Depends(durable_sync)` gives the existing middleware behavior for free: it awaits the sync
inside the held write lock and returns **503** (`DURABLE_SYNC_FAILED_RESPONSE`) on failure —
the frontend already handles that 503 (see `useReEditReel.js:37`). Prereq to verify: the
finalize runs via `asyncio.to_thread` inside the handler — confirm `get_request_has_writes()`
sees those writes (the write-tracking dict is shared by reference across the `to_thread`
context, so it should; add a test).

### Belt-and-suspenders (no code change)
`publish_to_my_reels` is already durable (T4050). With finalize now durable, by the time the
user clicks "Move to My Reels" the `final_videos` row is in R2; publish then durably persists
`published_at`. The two gates compose; we rely on finalize-side durability as primary.

---

## 2. Lost-publish heal migration (`profile_db` **v018**) — TARGETED, project 41 ONLY

**Decision (user):** a *general* heal is unsafe and would not even fire — project 41 has **no**
archive msgpack and its DB signature equals a normal unpublished draft (Step-1 proved
`archived_at NULL` + latest-final `published_at NULL` also matches drafts and mid-edit restores;
the only dev match was project 12, which my own Step-1 `restore-project` call created). So v018
heals **exactly one known row** by an exact unique signature and is a strict no-op everywhere else.

`app/migrations/profile_db/v018_heal_lost_publish_proj41.py`,
`class V018HealLostPublishProj41(BaseMigration)`, `version = 18` (current max v017). No schema
change → do **not** touch `ensure_database()`/DDL. The runner
(`migrations/__init__.py:_migrate_profile_db`) opens the per-user profile DB and sets the
`user_id`/`profile_id` context vars, so the migration can read `get_current_user_id()` and call
R2 helpers (`archive_project`) for the heal.

### Exact match signature (ALL required)
- `get_current_user_id() == '3ed03fb5-949d-4cfd-b708-0c758ea68ef3'` (imankh) — *if* the framework
  exposes it (it sets the context var → yes); used as a fast gate, NOT the safety mechanism; AND
- a `final_videos` row with: `id = 36` AND `project_id = 41` AND `version = 1` AND
  `filename = 'final_41_997d773b.mp4'` AND `published_at IS NULL`; AND
- `projects.id = 41` with `archived_at IS NULL`.

The **filename tuple `(id=36, project_id=41, version=1, filename='final_41_997d773b.mp4')` is the
real safety discriminator**: no other user's DB has that exact row, so even without the user_id
gate the migration cannot touch anyone else. The `user_id` gate is belt-and-suspenders.

### Heal action (mirror `publish_to_my_reels`)
When (and only when) the signature matches, in the migration:
```
UPDATE final_videos SET published_at = CURRENT_TIMESTAMP WHERE id = 36;   -- re-publish
archive_project(41, user_id)   -- mirror publish: creates archive/41.msgpack in R2 + removes
                               -- working data + sets projects.archived_at
```
i.e. reproduce exactly what the lost publish gesture would have done (`downloads.py:857-868`):
set `published_at` on final 36 and archive the project so the msgpack exists and working data is
removed. (`archive_project` itself sets `archived_at`.)

### Idempotency & safety
- **Idempotent:** the `published_at IS NULL` clause in the match guard. After the heal,
  final 36 is published → the signature no longer matches → re-runs are no-ops. `archive_project`
  is itself safe to skip if already archived (guard on `archived_at IS NULL` before calling).
- **Strict no-op for all other users/DBs:** no other profile.sqlite contains the
  `(36, 41, 1, 'final_41_997d773b.mp4')` row, so the `UPDATE … WHERE` matches 0 rows and the
  archive step is gated behind the same match. Guard for a missing `final_videos`/`projects`
  table (per v017 pattern) so brand-new/empty DBs short-circuit.

### Verification note
The dev snapshot was bulk re-published at copy time (every project shows
`published_at='2026-06-28 21:46:1x'`), so it does **not** carry project 41's stuck row — the
migration test seeds the exact `(36,41,1,filename)` row synthetically and asserts heal + no-op.
A final sanity check against true prod (does final 36 still match before deploy?) is the
supervisor's call via `scripts/edit-user-db.py`.

---

## 3. Test plan

**Backend (test-first, `bug-reproduction` skill; model on `tests/test_t4050_durable_sync.py` —
ASGITransport + in-memory boto3-shaped R2):**
- `test_export_finalize_durably_syncs` — drive a background overlay finalize with a **failing**
  R2 stub; assert the WS completion is the `sync_failed` variant (NOT `COMPLETE`) and
  `sync_pending` is marked; with a **healthy** stub, assert `COMPLETE` is emitted only *after*
  the profile DB is durably uploaded (final_videos row present in the R2-backed copy).
- `test_inline_export_endpoints_durable` — `/final` & `/overlay` with `durable_sync`: failing
  R2 → **503** `DURABLE_SYNC_FAILED_RESPONSE`; healthy → 200 and row in R2 copy.
- `test_v018_heals_stuck_publish` — seed a project with the stuck signature **+ a stub msgpack**;
  run v018; assert `published_at`/`archived_at` set; **re-run → no-op** (idempotent).
- `test_v018_skips_drafts_and_midedit` — seed (a) a draft (no msgpack), (b) a restored mid-edit
  (msgpack per restore behavior + working data), (c) an in-progress export; assert v018 touches
  **none**.

**Frontend:** the Step-1 repro spec stays. Add (Step-2 verify) a unit/E2E check that a
`sync_failed` export completion does **not** surface "Move to My Reels" and shows retry.

---

## 4. Open questions (need answers before/at implementation)
1. **Restore vs msgpack:** does `restore_project` delete `archive/{project_id}.msgpack`? Decides
   whether predicate (5) alone excludes mid-edit, or we also need `working_video_id IS NULL`.
2. **Prod project-41 fingerprint:** confirm (via `scripts/edit-user-db.py` on prod) that 41 has
   the msgpack and matches the predicate, and that **no** legitimate draft matches.
3. **WS sync-failed UX:** confirm the `ExportButtonContainer` WebSocket completion handler +
   which store flag gates "Move to My Reels", so a `sync_failed` completion blocks it and offers
   retry (mirror the existing 503 handling).
4. **Inline write-tracking:** confirm `get_request_has_writes()` observes the `to_thread`
   finalize writes so `durable_sync` on `/final`,`/overlay` actually awaits a real sync (test).
5. **Archive-or-publish-only heal:** is setting `archived_at` (without re-running
   `archive_project`'s working-data delete) acceptable, or should v018 fully re-archive? (Leaning
   minimal: set the two timestamps; msgpack already present.)
