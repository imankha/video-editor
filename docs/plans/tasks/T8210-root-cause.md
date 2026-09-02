# T8210 — Root-cause investigation: bknoto's reel poster missing (final_video id=3)

## TL;DR

The poster miss on `final_videos.id=3` (profile e1e28f91, prod) was a **transient
runtime failure of the best-effort poster step at overlay-export time**, not a
reproducible code defect. The exact failure line is **unrecoverable** (logged at
INFO; prod retains ~2 days of file logs; the export was 4 days ago). No production
code change is warranted. The reel is remediated by the **already-existing** poster
backfill sweep (`backfill_posters` / `POST /api/admin/backfill-share-posters`) — an
ops action, not a diff.

## How the reel was finalized (proof by elimination)

`final_videos.id=3` exists in prod with a valid `filename` (`final_2_8ba1a403.mp4`)
**and it synced to R2** (it is readable in the prod DB pulled for the task file).

A `final_videos` row for an overlay export can only be written by (knowledge doc
"final_videos writers — FOUR"):
1. `_finalize_overlay_export` (overlay.py) — real Modal/local render completion;
   caller awaits `generate_poster_at_export` immediately after
   (overlay.py:2790, and the no-keyframes/test completion paths at :3086 / :3161).
2. `export_final` (overlay.py) — frontend-rendered save; poster awaited at :2026.
3. `move_reels_to_profile` (downloads.py) — cross-profile move; deliberately lands
   `poster_filename=NULL` (per-profile, backfilled later). Not applicable: bknoto's
   is their one *published* reel, not a moved copy.
4. `test_seams.py` — test only.

The shared **recovery** finalizer (`exports.py finalize_modal_export` →
`export_finalize.finalize_export` → `upsert_working_video`) writes a
**working_videos** row and never calls `generate_poster_at_export`. Had the reel
been recovered that way it would have **no `final_videos` row at all** — it has one.

⇒ The reel went through the **inline overlay path**
(`_run_overlay_export_background` → `_finalize_overlay_export` writes `final_videos`
→ `generate_poster_at_export` at overlay.py:2790 → R2 sync barrier at :2803). Since
the row reached R2, the inline task ran **past** the post-poster sync barrier, i.e.
`generate_poster_at_export` **did execute** and returned `None`.

## Why it returned None (and why the exact reason is gone)

`generate_poster_at_export` is best-effort / never-raises (poster failure must never
fail export, T4110 barrier). On failure it only logs at **INFO**
(`[Poster] fv=... no poster stored` or `[Poster] fv=... generation error: ...`).

- **The pure selection math is provably correct for this reel shape.** With the
  task file's frozen values `section=(3.22522, 5.904092)`, `duration=10.7`:
  `open_play_window` → `(5.22522, 5.904092)` (window ≥ MIN_WINDOW_SECONDS),
  `select_poster_frame(..., None, section)` → `t=5.22522` — comfortably inside the
  10.7s video. Evidence: `qa/T8210-poster-math.txt`. So the miss was **not** a
  window/seek-math bug and **not** an exception in `open_play_window`/
  `select_poster_frame` (that class is exhaustively covered — 26/26 pass in
  `qa/T8210-poster-tests.log`, including a real-ffmpeg end-to-end extraction and the
  grab-failure never-raises contract).
- The only remaining failure surface is the single side-effecting step
  `_grab_and_store_poster_frame`: one ffmpeg remote-seek frame grab over a presigned
  URL (60s subprocess timeout) + one `upload_bytes_to_r2`. A transient hiccup in
  either (a slow/failed R2 ranged read, an upload blip) yields exactly this
  outcome: export/publish succeed, `poster_filename` stays NULL, one INFO line.
- **Log retention makes the specific line unrecoverable.** `app/main.py` uses
  `TimedRotatingFileHandler(when="midnight", backupCount=1)` → today + one rotated
  day (~2 days). The export completed 2026-08-29 (`published_at 18:53:49`); today is
  2026-09-02 (4 days). The INFO line has been rotated away. No flyctl / no log files
  are reachable from the task container, so a prod grep is impossible here anyway.

**Conclusion:** transient infra failure of the best-effort poster grab/upload. Not
reproducible; no genuine code bug to fix. Per the kickoff ("fix only if a genuine
reproducible bug; an infra hiccup does not warrant a defensive change to a
never-raises path") no production code change is made.

## Remediation for bknoto (ops action — worker cannot run against prod)

The fix already exists and must not be duplicated (kickoff step 5): `backfill_posters`
(poster.py:1447) sweeps published rows with `poster_filename IS NULL`, healing the
column when the poster object already exists and generating+storing it (same
open-play window policy as live export, via the SAME `_grab_and_store_poster_frame`
core) when it doesn't. Admin trigger: `POST /api/admin/backfill-share-posters`
(admin.py:1130, `limit` 1–500). Run it (admin session) to give fv=3 a real cover.

## Discoverability signal (considered; not built — reasoning)

The task asks whether a counter/metric should make silent poster misses discoverable
in aggregate. **A durable signal already exists and is redundant to duplicate:** a
published `final_videos` row with `poster_filename IS NULL` is directly queryable
(that is precisely how this reel was found) and is exactly the candidate set
`backfill_posters` already sweeps. The right operational answer is to run that
existing sweep periodically (it is idempotent and skip-if-poster-exists), not to
build a new metrics surface for a small task. A raise from INFO→WARNING would **not**
help: the retention limit is the file-rotation window, not the level filter (INFO is
captured), so a WARNING line on the same handler would rotate away just as fast.
Recommendation: rely on the durable DB-state signal + scheduled backfill.

## Out-of-scope observation (NOT bknoto's cause; candidate follow-up task)

The shared Modal **recovery** finalizer `finalize_modal_export` → `finalize_export`
runs for *every* job type — including `type='overlay'` (render_overlay inserts an
`export_jobs` row with `type='overlay'` and stores a `modal_call_id`, overlay.py:2930
/ :2743, so an overlay job is recoverable). That path writes a **working_videos** row
via `upsert_working_video` and never calls `generate_poster_at_export`. A genuinely
recovery-finalized overlay export would therefore land without a `final_videos` row
or a poster. This is **not** what happened to fv=3 (it has a proper `final_videos`
row ⇒ inline path), and fixing it is out of scope here per the kickoff, but it is
worth its own task: overlay recovery does not appear to reconstruct the overlay
final-video + poster the way the inline path does.

## Acceptance-criteria mapping

- "bknoto's published reel (fv=3) has a real poster image" → remediation path is the
  existing backfill sweep (admin endpoint above). Cannot be run/verified from this
  permission-free container (no prod DB, no admin session, no Modal/dev server, no
  bknoto account) — handed to the supervisor/ops as an action, per kickoff step 5.
- "Root cause documented; if a genuine bug, fixed with a regression test" → root
  cause documented above; no genuine reproducible bug ⇒ no fix/test (existing 26
  tests already lock the math + never-raises contract).
- "Considered (not necessarily built) a discoverability signal" → considered and
  argued against building a new one (durable NULL signal + existing sweep suffice).
