# T10270: Upload-failure observability: a durable record, a since-deploy listing, and no silent classes

**Status:** WAITING ON USER (design gate: [T10270-design.md](T10270-design.md), decision artifact
https://claude.ai/artifact/3DsuRvsHf9GtpZ2sxeA4AP)
**Impact:** 9
**Complexity:** 5
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17: "Look into any failed upload since the last deployment. Do we have enough
logging to understand and diagnose? Uploads are the top of the funnel so making them robust is a
top priority."

**Audit result (2026-09-17, read-only, HEAD `54032435`): no, we do not.** The only durable
failure writes are `record_milestone("game_upload_failed"|"clip_upload_failed", reason)` ->
Postgres `user_actions` (cumulative count + `first_at` only, no `last_at`), `daily_counters.
game_uploads_failed` (per day, all reasons collapsed, GAME only: `clip_upload_failed` has
`daily_col: None`), and the per-user `user.sqlite` `user_action_log` (the only timestamped trail,
one user at a time). Concretely, "which uploads failed since 2026-09-13 and why" cannot be
answered today: daily counts have no user or reason; `user_actions` cannot be date-scoped
reliably; the per-event trail requires opening each user's SQLite; and the richest channel
(`[UPLOAD_BEACON]` / `[UPLOAD_LIFECYCLE]` stdout lines) has **no log drain** in
`fly.production.toml`, so four days back is gone.

Failure classes that leave NO durable trace (ranked):
1. Pre-prepare client death: hash timeout (`uploadManager.js:103,611-612`), faststart analyze
   throw, `Unexpected status` (`:755`).
2. `can_afford === false` after a SUCCESSFUL prepare (`uploadManager.js:727-733`): the server has
   already inserted `pending_uploads` and opened an R2 multipart; the client throws with no beacon.
   Later misattributed as `user_abandoned` by the reaper.
3. Beacon phase gate (`games_upload.py:736`) drops `preparing`/`finalizing`/`creating` on the
   premise the server saw them; false for `reason:'fetch_rejected'` (`uploadManager.js:194-199`).
4. The whole clip batch endpoint `POST /api/clips/upload`: `source_missing` (`clips.py:1953`),
   `probe_failed` (`:1973`), `duration_exceeds_cap` (`:1978`), `insufficient_credits` (`:2027`)
   log nothing and record nothing, while `clip_uploaded` success IS recorded, so clip-upload
   success is 100% by construction (the T7970 defect, reintroduced on the clip path).
5. `clip_upload_failed` is write-only: no daily column, no admin read surface.
6. Game-video attach / activate 400/402/409 (`games.py:354-361,726-732,760-767,949-955`): silent.
7. `finalize` `session_not_found` (`games_upload.py:507-512`) and `PATCH parts` 404 (`:653`):
   warning-only.
8. No filename and no file size appear in ANY failure log line (the beacon carries `file_size` but
   the client never sends the filename).
9. Bonus bug: `GET /admin/users/{id}/stuck-uploads` (`admin.py:975`) hardcodes the `games/` R2 key
   for `kind='clip'` rows, misreporting live clip uploads as dead (the shape T8370 fixed elsewhere).

What an operator CAN do today: `daily_counters` totals per day (coarse), `user_actions` by
`first_at` (undercounts repeats), per-user `/admin/analytics/user/{id}/actions`,
`scripts/scan_stranded_uploads_sweep.py --env prod --hours N` (stranded multiparts still open now),
and `bug_reports` (only when a user files one).

## Solution

Design-gated (Architect): this adds a bounded event table, which touches the "aggregates-only
Postgres" analytics rule (`feedback_analytics_in_house_aggregates_only`). The rule's purpose was
to avoid an unbounded per-event firehose; an append-only `upload_failures` table with a TTL
(90 days) and a closed reason vocabulary is a bounded operational record, not analytics. State
that tradeoff in the design doc and let the user rule on it.

1. **`upload_failures` (Postgres, TTL)** with: `occurred_at`, `user_id`, `profile_id`, `kind`
   (game|clip), `stage` (hashing|preparing|uploading|finalizing|activating|attaching|batching),
   `reason` (closed vocabulary = `MILESTONE_REASONS` + `insufficient_credits`, `hash_timeout`,
   `probe_failed`, `source_missing`, `duration_exceeds_cap`, `size_over_cap`), `http_status`,
   `error_text` (capped 300), `blake3_hash`, `upload_session_id`, `r2_upload_id`, `file_size`,
   `original_filename`, `parts_total`, `parts_completed`, `attempt_no`, `elapsed_ms`, `origin`
   (server|beacon), `platform`, `user_agent` (capped), `build_sha`. Every field is already
   computed at the failure sites; this persists instead of formatting into a log line.
2. **One writer** (`record_upload_failure(...)` in `analytics.py`) called from every branch in the
   Problem list; the beacon phase gate goes away (the beacon always writes, tagged `origin=beacon`);
   the client beacon gains `original_filename` and fires for classes 1 and 2.
3. **Admin: "Upload failures" list**, date-scoped (default: since the last deploy `build_sha`),
   cross-user, with reason/stage filters, next to the existing Pulse "Upload Success" card;
   `clip` and `game` rates shown SEPARATELY and each as attempts vs successes
   (`feedback_tries_vs_success_must_both_show`). Fix the `stuck-uploads` clip-key bug.
4. **Log drain**: add a Fly log shipper (Fly's built-in `fly logs` has hours of retention; a
   drain to a cheap sink, e.g. Axiom/Better Stack free tier, or at minimum the `[UPLOAD_*]` lines
   into the table above) so the next incident is diagnosable four days later.
5. Migration: Postgres track (`_SCHEMA_DDL` + `POST /api/admin/migrate-postgres` after deploy);
   check unmerged siblings for a version collision.

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py` (prepare/finalize/beacon/reaper), `routers/clips.py:1908-2090`,
  `routers/games.py` (attach/activate), `analytics.py:206-230,353-368,606-651`, `services/pg.py`,
  `routers/admin.py:904-1002,1627-1652,1937-2114`
- `src/frontend/src/services/uploadManager.js:141-199,701-841`, `hooks/useClipUpload.js`,
  `stores/uploadStore.js:118-141`, `components/admin/PulseCards.jsx`, `UserTable.jsx`
- `src/backend/fly.production.toml` (no drain today)
- `scripts/scan_stranded_uploads_sweep.py` (reuse its R2 cross-reference)

### Related Tasks
- Absorbs the "look into failed uploads since last deploy" investigation (findings above)
- T10250 feeds `size_over_cap`; Upload Failure Integrity epic (T7470-T7510) is the prior art

## Acceptance Criteria

- [ ] A single query answers "which uploads failed since build X, for whom, at what stage, why"
- [ ] Every failure branch listed above writes a row (test each with a forced failure)
- [ ] Admin list is date-scoped and cross-user; clip and game rates are separate and paired
- [ ] `[UPLOAD_*]` log lines survive a deploy and are readable 7 days later
- [ ] Migration file + `_SCHEMA_DDL`; Migration agent included
