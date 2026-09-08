# T8990: Upload-failure analysis: which file-size x connection-speed combinations stop users uploading (sets the milestone goal)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

The entire Video Pre-Shrink milestone rests on one claim: uploads fail or get abandoned
because the file is too big for the user's connection, so shrinking the file first turns
a lost user into a successful upload. Nobody has the production number behind that claim.
Every shrink figure so far (T8830, T8832, T8840) was measured on ONE dev laptop against
ONE 50 GB DJI folder; the target audience uploads 1-4 GB Trace/Veo exports and phone
clips from ordinary laptops on ordinary home Wi-Fi. Without the real distribution of
(file size, connection speed, outcome) the later research tasks (T9030 benchmark, T9040
cost model) have no target to hit, and the integration epic could ship a feature that
optimizes the wrong case.

This task defines success for the whole milestone. It runs FIRST.

## Solution

A read-only mining pass over production analytics + per-user upload tables that produces
one matrix (file-size bucket x inferred-bandwidth bucket -> attempts, successes, failures
by reason, abandons) and, from it, ONE concrete goal statement the rest of the milestone
designs toward, in the form:

> "A {X} GB game must become uploadable on a {Y} Mbps connection in under {Z} hours,
> and the output must stay under {C} GB."

No app code ships. No new telemetry is built here: if a dimension cannot be inferred from
what production already records, the deliverable NAMES the one bounded aggregate beacon
that would close the gap and files it as a follow-up for the user to approve, following
the analytics rules (in-house, aggregates-only, counts not events, no new Postgres state).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `FLOW_EVENTS` (`game_created` = upload ATTEMPT,
  `game_upload_succeeded` = durable OUTCOME, `game_upload_failed`, `upload_file_selected`,
  `add_game_opened`), `MILESTONE_REASONS` (`timeout`, `network`, `refused`, `sync_failed`,
  `user_abandoned`, `r2_rejected`, `unknown`), `record_milestone` (writes the
  `user_actions` aggregate as `"{event}:{reason}"` rows with a `platform` column, plus the
  per-user journey trail in `user.sqlite`). READ ONLY.
- `src/backend/app/routers/games_upload.py` - `_record_upload_failure` (~L100, the real
  in-flight failure sites), `_classify_uploading_phase_failure` (~L137, maps the client's
  part-failure text to a reason), the stale-pending reaper (~L753-860) that emits
  `user_abandoned`, and the `pending_uploads` rows it reads (`file_size`, `parts_json`,
  `created_at`). READ ONLY.
- `src/backend/app/routers/admin.py` - `stuck_uploads` (~L901, per-user abandoned
  multipart sessions with live R2 part counts) and the existing upload success-rate query
  (~L1927, `game_upload_succeeded` vs `LIKE 'game_upload_failed:%'`). Reuse these
  shapes; do not add endpoints.
- `src/backend/app/database.py` - `games.video_size` / `video_duration` / `video_width` /
  `video_height` / `video_fps` / `status` (~L1360-1380; `status` can be `upload_failed`,
  see `constants.py` `UPLOAD_FAILED`), `pending_uploads` (~L1607), `game_storage.
  game_size_bytes` (~L1596). These are per-profile SQLite files synced to R2.
- `src/frontend/src/services/uploadManager.js` - `PART_STALL_TIMEOUT_MS` (30 s, ~L112),
  the adaptive-concurrency throughput sampler (~L431-481, logs `[Upload] throughput=...
  MB/s` to the CONSOLE ONLY - it is not telemetry). Read to understand what "stalled"
  and "timed out" mean in the reason taxonomy; do not change.
- `scripts/measure_migration_floor.py` - the existing READ-ONLY fleet walk over every
  user's R2 DBs (orphan-inclusive). Use it as the template for the new script.
- `scripts/analyze_upload_failures.py` - NEW: read-only, `--env dev|staging|prod`, prints
  the matrix. Never writes to R2 or Postgres.
- `docs/plans/analytics-playbook.md` - event taxonomy + "tries vs success must both
  show" convention.

### Related Tasks
- Depends on: none (first task of the Pre-Shrink Research epic; see
  [EPIC.md](EPIC.md))
- Blocks: T9030 (benchmark needs the target bandwidths), T9040 (cost model needs the
  size/speed distribution and the goal statement)
- Related: T7510 (attempted vs successful everywhere), T7970 (real failure sites),
  T7890 (pre-upload funnel beacons), T8950 (pricing audit for high-res sources), the
  2026-08 upload-failure incident epic (T7470-T7510), T8160/T8170 (`r2_rejected` exists
  because an R2 self-abort was mislabeled `network` for two days - read failure reasons
  with that history in mind)

### Technical Notes
- **Bandwidth is not recorded anywhere server-side.** Parts go straight to R2 via
  presigned URLs, so the API never sees per-part timing. Infer it two ways and report
  both: (a) for SUCCESSFUL uploads, `file_size / (finalize_time - prepare_time)` using the
  `pending_uploads.created_at` -> `games.created_at` (or the journey-trail timestamps for
  `game_created` -> `game_upload_succeeded`) pair; (b) for ABANDONED uploads, bytes landed
  (`parts_json` part count x part size, or the live R2 part list the `stuck_uploads`
  endpoint already fetches) over the session's age. Bucket the result (e.g. <5, 5-10,
  10-25, 25-50, >50 Mbps) - a bucket is honest, a decimal is not.
- **Pair tries and successes in every cell** (project rule): attempts = `game_created`,
  successes = `game_upload_succeeded`, failures = `game_upload_failed:*` by reason. Never
  collapse to one number. Include the `platform` column - a mobile-vs-desktop split is
  likely the single most useful cut.
- **Filter test accounts**: `imankh` on prod is a live payment test (flagged, filter it),
  `e2e@test.local` on staging, the prod-derived fixture clones (`arshia+stg`, `bknoto+stg`)
  on dev/staging. Aggregates only; no filenames, no emails in the output.
- **Reading prod data**: Postgres for `user_actions`/`user_segments`; per-user SQLite
  via read-only R2 download (never touch a live machine's DB; never re-upload). Follow
  the read-only recipes in `scripts/measure_migration_floor.py`, and the standing rule
  that a below-head profile DB is opened read-only without migrating.
- **Sizes to expect**: the epic's own evidence puts a DJI 8K game at ~50 GB (97 Mbps),
  a Trace/Legends two-half export at ~3.1 GB (4.67 Mbps), phone clips at MBs. The matrix
  should say how much of production is each shape - the upload distribution IS the
  input T9030's file-type survey extends with codec/resolution.
- If the data is too thin for a cell, say so in the cell rather than interpolating.

## Implementation

### Steps
1. [ ] Read the analytics taxonomy (`FLOW_EVENTS`, `MILESTONE_REASONS`) and the two
   failure emitters; write down in the Progress Log exactly which events map to
   attempt / success / failure / abandon so the matrix's denominators are defensible.
2. [ ] Write `scripts/analyze_upload_failures.py` (read-only, templated on
   `measure_migration_floor.py`): walk profile DBs for `games` (size, duration, dims,
   status) and `pending_uploads` (size, parts, age); join `user_actions` per user for
   outcome + reason + platform.
3. [ ] Infer bandwidth per (a)/(b) above; bucket it; produce the size x speed matrix
   with tries / successes / failures-by-reason / abandons per cell, plus the platform
   split. Run on staging first, then prod.
4. [ ] Derive the goal statement (X GB on Y Mbps in Z hours, output under C GB) from
   where the success rate collapses; state the reasoning and the cells it rests on.
5. [ ] Record the matrix + goal in the Progress Log AND in
   [EPIC.md](EPIC.md) "Milestone goal" (the one place later tasks read it from).
6. [ ] List what could NOT be inferred and the single bounded beacon that would close
   each gap (name, bucket vocabulary, where it would fire from - a gesture, never a
   reactive watch). File nothing without the user's approval.

### Progress Log

**2026-09-08**: Filed as the first task of the Pre-Shrink Research epic (Video Pre-Shrink
milestone). Ordered first on purpose: it defines success for everything after it.

## Acceptance Criteria

- [ ] A size x inferred-speed matrix exists for production with tries AND successes AND
      failures-by-reason per cell, platform split included, test accounts excluded
- [ ] One concrete goal statement (X GB / Y Mbps / Z hours / output cap C GB) is
      written into this epic's EPIC.md with the cells it rests on
- [ ] The production distribution of upload sizes (and durations/dimensions where
      present) is recorded for T9030 to extend
- [ ] Every non-inferable dimension is named with its would-be beacon; none built
- [ ] No app code changed; script is read-only (no R2 or Postgres writes) and lives in
      `scripts/`
