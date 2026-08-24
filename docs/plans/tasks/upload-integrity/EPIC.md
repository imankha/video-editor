# Upload Failure Integrity

**Status:** TODO
**Started:** 2026-08-24
**Impact:** 9 | **Complexity:** 5 | **Priority:** 1.8

## Origin

Filed from the 2026-08-24 prod investigation of two accounts (bigajosue@gmail.com,
roooooooooom1h@gmail.com) whose admin activity view showed annotated clips and game uploads
while impersonation showed an empty app. The investigation (read-only, prod Postgres + R2 +
live machine) proved impersonation was truthful: both accounts genuinely had zero durable
content. Every failure traced back to one shared upstream event, **a game-video upload that
never completed**, which the app then handled in ways that destroyed work, hid state, and
manufactured a false activity trail.

Key evidence (full detail in each child task):

- bigajosue (PAYING user, $3.99 / 88 credits, signed up 2026-08-24): 4 upload attempts, all
  failed. Each failure ran the frontend cleanup path that `DELETE`s the pending game, which
  cascades to raw_clips -> working_clips and prunes projects. The user annotated against
  attempt #4 while it uploaded (by design, T1540); the cleanup destroyed that work.
  `sqlite_sequence.games=4` with 0 rows is the forensic proof.
- roooooooooom1h (signed up 2026-08-23): 1 upload attempt (17.8 MB, single part), failed with
  the multipart still open in R2 holding 0 parts. The game row survives at `status='pending'`
  but pending games are filtered out of every UI surface, so the account looks empty. The
  stale resume record will eventually be silently reaped by `list_pending_uploads` without
  aborting the R2 multipart.
- Zero game videos have landed in prod R2 since 2026-08-20 22:49 UTC (5 attempts across these
  two users, 0 successes). Root cause of the transfer failure itself is NOT yet established
  (CORS, credits, backend/frontend regressions, machine restart, and R2 outage were all ruled
  out with evidence).
- The `annotation_completed` milestones that made the dashboard look busy fired AFTER the
  game row was deleted: `finish_annotation` does not check `cursor.rowcount`, so an UPDATE
  matching zero rows still returned success and still recorded the milestone.

## Goal

An upload failure must never destroy user work, never hide state from the user or an
impersonating admin, and must be observable server-side. Concretely, after this epic:

1. A failed upload never deletes a game that has acquired user content (T7470).
2. Prod game-video uploads work again, and the upload lifecycle (prepare -> parts ->
   finalize) is observable server-side without needing the user's browser console (T7480).
3. A pending/failed upload is visible in the UI with a retry/resume affordance, and stale
   resume records are reaped honestly (R2 multipart aborted, state surfaced) (T7490).
4. Write handlers fail loudly when their target row is missing instead of reporting success
   and recording milestones against deleted rows (T7500).

## Tasks

Ordered by dependency and urgency. T7480 is the active outage; T7470 is the destructive bug.
They touch overlapping files (uploadManager.js, games_upload.py, games.py), so they are NOT
parallel-safe under the dotask file-disjoint rule.

| ID | Task | Status |
|----|------|--------|
| T7480 | [Prod game uploads failing since Aug 20: investigate + lifecycle observability](T7480-prod-upload-failures-observability.md) | WAITING ON USER |
| T7470 | [Upload-failure cleanup cascade-deletes user annotation work](T7470-upload-failure-cascade-delete.md) | TODO |
| T7490 | [Pending uploads invisible; stale resume records silently reaped](T7490-pending-uploads-invisible.md) | TODO |
| T7500 | [Write handlers report success on zero-row UPDATE](T7500-zero-row-update-silent-success.md) | TODO |

Related but filed separately (different surface): T7510, attempted-vs-successful activity
tracking, which fixes the dashboard side of the same incident.

## Completion Criteria

- [ ] All four tasks complete and deployed to prod
- [ ] A deliberately failed upload on staging leaves annotation work intact, shows a visible
      retry affordance, and produces a server-side log trail an admin can read
- [ ] The two affected accounts re-checked: rooom1h's orphaned pending game resolved
      (honest state, R2 multipart aborted)

## User Outreach Note

bigajosue is a paying user who lost real work within minutes of paying. Consider direct
outreach (win-back email precedent, memory `project_winback_campaign_2026_08`) once the fix
ships; lead with "tell us where you got stuck" per the support framing rule.
