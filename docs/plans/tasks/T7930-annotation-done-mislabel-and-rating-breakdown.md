# T7930: "Annotation Done" analytics mislabel + star-rating breakdown report

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Problem

User report (2026-08-27): the analytics dashboard shows "Annotation Done" for users like
`lincdyn.j19@gmail.com`, but their account has no visible annotation (no `raw_clips` row / no
clip in the Annotate screen). Two more examples surfaced in the same report:
- `mostafaali452010@gmail.com` — already has a dedicated open task, **T7920**, which independently
  found "opened Add Clip 37s after upload landed, saved nothing, left." Same shape as this task's
  hypothesis; T7920 owns driving/fixing that account's flow, this task should not duplicate it —
  just fold the finding in as corroboration once T7920 reports back.
- `ojedalucas19@gmail.com` — **doesn't even have the game anymore**, yet the account was granted
  "new user flow" (onboarding quest) credit tied to annotation. This account already has a
  dedicated open task, **T7870**, whose own forensics (2026-08-26 22:03-22:05 UTC) found
  `game_created` -> R2 object landed durably -> credits debited -> `annotation_completed` x2 ->
  **then the `games` row was deleted**. That is a distinct, already-tracked bug (a hole in the
  upload-failure-cleanup guard or an unguarded delete path) — T7930 should NOT re-investigate the
  deletion itself. What T7930 SHOULD do: explain the "got credit anyway" half, which is a real,
  separate mechanism (see below), and make sure T7870's eventual writeup and this task's label fix
  agree on the story.

**Why credit survives even after the content is gone (ojedalucas19's "got credit" half):**
`quests.py`'s onboarding step computation (`_check_all_steps` et al., ~L140-211) marks steps like
`add_clip` / `rate_clip` complete from a persistent **achievements** table (`achieved` set, e.g.
`add_clip_opened`, `clip_rated`) that is deliberately never revoked — the code comment at L155-159
states quest steps are "LIFETIME achievements" and a step "auto-completes" and stays complete even
if the underlying content is later deleted (that comment is about archival, but the mechanism is
identical for deletion: nothing in `_check_all_steps` re-derives from CURRENT `raw_clips`/`games`
rows once an achievement key is recorded, except the OR-backfill fallback `rc["reels"] >= 1` /
`rc["total"] >= 1`, which itself only strengthens a step, never weakens one). Reward claiming is
separately idempotent ("credits are only granted once per quest," `quests.py:6`). So: user opens
Add Clip and/or rates+tags a clip (fires the achievement, quest step completes, credit claimed) —
later, T7870's bug deletes the `games` row — the achievement row and the already-granted credit
are untouched, because nothing in the credit/achievement path re-checks live content. This is
consistent with the quest system's own design intent (achievements as permanent progress markers,
not live content mirrors) — flag it as a real but SEPARATE finding from T7870's deletion bug, not
something to "fix" by revoking credits. If the user wants that changed, it's a product-policy
question for a different task, not this one.

**Fourth example, `finneganscudder@gmail.com`** (also reports "Annotation Done" with no visible
annotation, AND a missing video thumbnail): this account is **already tracked in T7880**
("Reconcile stranded prod uploads for absent users") — its `Timberline vs Boise JV Boys
Lacrosse.mp4` upload has an 8-part/209 MB multipart open since 2026-08-26 (double-UploadId
anomaly), game stuck `pending`-invisible, never finalized. The user's screenshot confirms the
account-visible symptom: an "8 / 127 parts" stuck upload card with a "Resume" prompt and no
poster/thumbnail — expected, since a poster can't be generated until the durable video object
exists (`activate_game`'s finalize path), which this stuck upload never reached. This is the SAME
underlying story as T7880, not a new bug: don't re-diagnose the stuck-multipart cause here. What IS
new and worth folding into Part A: `annotation_completed` apparently fired for this account despite
the durable upload never completing. That is explained by the SAME mechanism as the other three
examples plus one more piece — `annotate.md`'s T1540/`uploadStore` "annotate-during-upload"
allowance lets a user scrub/watch the LOCAL blob while a game is still mid-upload (a real `game_id`
exists from `onGameCreated`, well before finalize). `finish-annotation` doesn't check upload state
at all, only `viewed_duration > 0` — so watching the local blob during a since-abandoned/stuck
upload is enough to fire "Annotation Done," even though the game never durably finished uploading,
let alone got annotated. Confirms Part A's fix (relabel, since the event never meant "content
exists") generalizes across all four examples; no per-account root-causing needed beyond what T7870
and T7880 already own.

**Root cause (found by reading code, not yet confirmed against this specific user's live data):**
`annotation_completed` — labeled `"Annotation Done"` in `analytics.py` — does **not** require a
clip to exist. It fires from `POST /{game_id}/finish-annotation`
(`src/backend/app/routers/games.py:1937-1972`) purely on `body.viewed_duration > 0`: a user opens
a game in the Annotate screen, the video plays for any nonzero duration, and they leave/switch
mode — `finishAnnotation` fires on `AnnotateScreen.jsx` mode-change/unmount
(`src/screens/AnnotateScreen.jsx:150-189`) — with zero raw_clips ever saved. No annotation
(clip) is created; the user just watched some video.

This is **partially by design**, not a fresh bug: `UserDetailPanel.jsx:4-9` already carries a
comment stating `annotation_completed` "tracks watched-video, not clips" and deliberately renders
it in a separate "Engagement" band, not the content-outcome pipeline
(`ENGAGEMENT_STEPS`, `PIPELINE_STEPS` in that file). But the backend's event label
(`"Annotation Done"`, `analytics.py:143`) and the daily-counter column name
(`annotations_completed`) both say "annotation," which reads to anyone outside that one file's
comment — including this user, checking a specific account — as "a clip/annotation was created."
The mismatch between the internal semantics (watched video) and the label everyone sees
(dashboards, `PlatformBreakdown.jsx:14`, `daily_counters.annotations_completed`) is the actual bug
to fix, unless investigation turns up a second, genuine data-loss cause for this specific user
(see Steps below — rule that out first).

**Second ask:** a breakdown of how many annotations (raw_clips) exist at each star rating
(1-5, `raw_clips.rating`, default 4 — see `.claude/knowledge/annotate.md` § Data flow). No such
aggregate exists today — `rating` lives only in each user's per-user SQLite
(`raw_clips` table), not in the aggregate Postgres analytics tables (`user_actions`,
`daily_counters`). Producing this requires a read-only script that iterates every account's
`profile.sqlite` (pattern: `scripts/audit_clip_dimensions.py`, which already downloads
`auth.sqlite` + every profile DB from R2 for dev/staging/prod and aggregates a per-clip stat).

## Solution

**Part A — fix the mislabel** (do this first; it's the smaller, higher-confidence fix):
1. Confirm against `lincdyn.j19@gmail.com`'s real data that this is the explanation and not a
   second bug: query Postgres `user_actions` for `action = 'annotation_completed'` for this
   user's `user_id` (look up via `users` table by email — see
   [reference_user_lookup_postgres.md] memory: never `auth.sqlite`), and separately check their
   `profile.sqlite` `raw_clips` row count (0 confirms the hypothesis; >0 with the clips since
   deleted, or a raw_clips insert that silently failed, points to a real second bug instead —
   escalate to the expert agent if so, per CLAUDE.md's "one failed fix attempt" rule doesn't apply
   here since this is investigation, but a genuine unexplained data-loss finding should still get
   Opus root-causing before a fix is attempted).
2. If confirmed as a pure labeling issue: rename the **label only** (not the event key —
   `annotation_completed` / `annotations_completed` are historical column/event names baked into
   `daily_counters` and `user_actions`; renaming the key would fracture the time series). Suggested
   label: `"Watched Annotate Video"` or `"Annotate Session"` in `analytics.py:143` and
   `PlatformBreakdown.jsx:14`. Verify `UserDetailPanel.jsx`'s `ENGAGEMENT_STEPS` label
   (`"Annotate"`, line 28) is still accurate/consistent once the primary label changes.
3. Sweep for any other admin-facing surface that renders `annotation_completed` as if it means
   "clip created" (grep `annotation_completed` across `src/frontend/src/components/admin/`) and
   apply the same relabel.

**Part B — star-rating breakdown:**
1. New read-only script (or extend `scripts/audit_clip_dimensions.py`'s pattern rather than
   duplicating its env-loading/R2-download boilerplate) that iterates every profile's
   `raw_clips` table and tallies `COUNT(*) GROUP BY rating` across the whole environment.
   `rating` is `1-5`, default `4`, `NOT NULL` per the schema in `user_db.py` — no NULL bucket
   expected, but the script should still report an `unrated`/NULL count if found (schema drift
   signal, don't silently drop it).
   `--env dev|staging|prod` like the existing audit scripts.
2. Run it (or hand the runnable script to the user, since this is a data question, not a
   deliverable feature) and report the distribution.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — `FLOW_EVENTS["annotation_completed"]` label (L143),
  `daily_col: "annotations_completed"`
- `src/backend/app/routers/games.py` — `finish_annotation` (L1937-1972), the actual fire site;
  already has the T7500 zero-row guard (no milestone on a deleted/missing game) — do not touch
  that guard, it is correct and unrelated to this mislabel
- `src/frontend/src/components/admin/PlatformBreakdown.jsx` — `annotation_completed: 'Annotations'`
  label (L14), likely also needs the relabel
- `src/frontend/src/components/admin/UserDetailPanel.jsx` — already correctly scopes
  `annotation_completed` to `ENGAGEMENT_STEPS`, not `PIPELINE_STEPS` (L4-29); confirm the label
  text there stays consistent with whatever Part A picks
- `src/frontend/src/components/admin/FunnelChart.jsx`, `UserTable.jsx` — grep for
  `annotation_completed`/`annotations_completed` before assuming these two are the only surfaces
- `scripts/audit_clip_dimensions.py` — pattern to follow/reuse for the Part B script (env loading,
  R2 download of every profile DB, read-only, tempdir cleanup)
- `src/backend/app/services/user_db.py` — `_USER_DB_SCHEMA`, confirms `raw_clips.rating` shape
- `src/backend/app/routers/quests.py` — `_check_all_steps` (~L140-211), the lifetime-achievement
  mechanism that explains ojedalucas19's "credit survived content deletion" half
- New file: `scripts/audit_rating_distribution.py` (or similar name) for Part B

### Related Tasks
- **Not blocking, but read before writing the label fix — three of the four reported accounts
  already have dedicated open tasks that own their account-specific root cause:**
  - **T7870** (`ojedalucas19@gmail.com`) — game row deleted after a successful, credited upload.
    T7930 only explains the "credit survived" half (see Problem); T7870 owns the deletion bug.
  - **T7880** (`finneganscudder@gmail.com`, and others) — stranded/stuck multipart uploads,
    `pending`-invisible games. Explains this account's missing thumbnail AND (via the T1540
    annotate-during-upload allowance) why `annotation_completed` could fire with no durable
    content at all.
  - **T7920** (`mostafaali452010@gmail.com`) — live-drive audit of the mobile clip-save path;
    corroborates Part A's "opened Add Clip, saved nothing" pattern.
  - This task (T7930) is the umbrella fix for the SIGNAL, not any individual account: once T7870/
    T7880/T7920 land, re-verify their accounts' `annotation_completed` history reads sanely under
    the new label.
  - Loosely related to the T7510 attempt/outcome/failure taxonomy work (the engagement-vs-pipeline
    split `annotation_completed` already lives under) and the shipped T7515 frustration
    instrumentation — no dependency either direction.

### Technical Notes
- Do NOT rename the `annotation_completed` event key or the `annotations_completed` daily-counter
  column — that is stored history across `user_actions` and `daily_counters`; a rename would sever
  the time series (or require a backfill migration this task doesn't need). Fix display labels
  only.
- This is a good candidate for the M tier: bug-fix-shaped (Part A), plus one small new read-only
  script (Part B), no schema change, well under 6 files.

## Implementation

### Steps
1. [ ] Look up `lincdyn.j19@gmail.com`'s `user_id` via Postgres `users` table (never
   `auth.sqlite` — see reference memory on user lookup); repeat for the other three accounts if
   T7870/T7880/T7920 haven't already produced this evidence by the time this task is picked up
2. [ ] Query `user_actions` for `annotation_completed` count vs. `clip_created` count per account;
   spot-check `profile.sqlite` `raw_clips` row count via existing account-inspection tooling (e.g.
   `scripts/edit-user-db.py` in dry-run/read mode, or `copy_user_between_envs.py`'s read path) to
   confirm 0 clips. For `lincdyn.j19@gmail.com` specifically (the one account with no dedicated
   task yet) this is the only remaining unconfirmed case — do it first.
3. [ ] If confirmed pure mislabel across the board: update the label strings (Part A.2/A.3 above)
4. [ ] Write `scripts/audit_rating_distribution.py` per Part B, run against the target env, report
   the 1-5 (+ any NULL) breakdown to the user
5. [ ] Update `.claude/knowledge/annotate.md` or the analytics doc if this uncovers anything not
   already captured there (e.g. explicitly note the lifetime-achievement-survives-deletion
   mechanism in quests.py if it isn't documented elsewhere)

### Progress Log

**2026-08-27**: Task filed from user report. Root cause for Part A identified by reading
`finish_annotation` + the pre-existing `UserDetailPanel.jsx` comment acknowledging the same
semantic gap — high confidence, not yet confirmed against the specific reported user. Part B
confirmed to require a new script; no existing aggregate covers `raw_clips.rating`.

**2026-08-28 (M-tier, branch `feature/T7930-...`)**: Implemented in a permission-free container
worker (NO backend venv, NO R2/PG creds in-container — see handoff below).

Part A — mislabel fix (DONE, code):
- Confirmed by code read that `annotation_completed` requires no clip: `finish_annotation`
  (games.py) fires `record_milestone("annotation_completed")` on `viewed_duration > 0` alone; the
  engagement-not-content semantics are already documented (backend-services.md rule 10 / T7510,
  `UserDetailPanel.jsx` Engagement band). Treated as a pure mislabel.
- Renamed the LABEL only, "Annotation Done" -> "Watched Annotate Video", on every admin surface:
  `analytics.FLOW_EVENTS["annotation_completed"].label`, `FunnelChart.jsx` (STAGES key derived from
  the label also moved `annotation_done` -> `watched_annotate_video`), `UserTable.jsx` STEP_STYLES
  map key (kept cyan), `PlatformBreakdown.jsx` ACTION_LABELS. Event KEY + `annotations_completed`
  daily_col UNCHANGED (stored history). `UserDetailPanel.jsx` "Annotate" (Engagement) left as-is
  (already correctly scoped; guarded by its test).
- Cross-checked the four reported accounts against their owning tasks: `lincdyn.j19` (no owning task
  — explained by watched-video mislabel; live-data confirmation deferred to supervisor, see below),
  `mostafaali452010`/T7920, `ojedalucas19`/T7870, `finneganscudder`/T7880. The "credit survived
  content deletion" half (ojedalucas19) is the quests.py LIFETIME-achievement mechanism — a real but
  SEPARATE finding from T7870's delete bug, documented in annotate.md, not "fixed" (product policy).
- Tests: added a FunnelChart regression asserting "Watched Annotate Video" renders and "Annotation
  Done" does not. Full admin vitest folder green (20/20). Grep-verified no live surface renders the
  old label.

Part B — rating breakdown script (DONE, code; RUN pending):
- Wrote `scripts/audit_rating_distribution.py` (read-only, `--env dev|staging|prod`, mirrors
  `audit_clip_dimensions.py` env-load/R2-download/tempdir-cleanup). Tallies `COUNT(*) GROUP BY
  rating` over every profile's `raw_clips`; reports the env-wide 1-5 distribution + a per-account
  breakdown; counts NULL/out-of-range ratings SEPARATELY as schema-drift (exit 1 on drift).
- Core SQL/aggregation logic smoke-tested against synthetic profile DBs (normal dist, legacy
  no-`raw_clips`-table, NULL/out-of-range drift) — all correct. Could NOT run against a live env
  in-container (no R2 creds).

Knowledge: annotate.md updated (two Landmines: the watched-video mislabel + the lifetime-achievement
mechanism; rating-audit script pointer).

**SUPERVISOR HANDOFF (needs an env with creds — cannot run in the worker container):**
1. Confirm `lincdyn.j19@gmail.com`: look up `user_id` via Postgres `users` (never `auth.sqlite`),
   check `user_actions` `annotation_completed` count vs. that profile's `raw_clips` row count
   (expect >0 milestone, 0 clips). Fold the result into the first acceptance criterion.
2. Run `scripts/audit_rating_distribution.py --env <dev|staging|prod>` and report the 1-5 (+ any
   NULL) distribution to the user (Part B's actual data deliverable).

## Acceptance Criteria

- [ ] Confirmed (or ruled out) that `lincdyn.j19@gmail.com`'s case is explained by the
      watched-video-not-clip semantics, with the actual query/lookup evidence recorded here
- [ ] The other three examples (`mostafaali452010`, `ojedalucas19`, `finneganscudder`) are
      cross-checked against their owning tasks (T7920/T7870/T7880) and confirmed consistent with
      this task's explanation, not left as open loose ends
- [ ] If mislabel confirmed: label updated everywhere `annotation_completed`/
      `annotations_completed` renders as a user-facing string, event key and column name
      unchanged
- [ ] Star-rating breakdown script exists, runs read-only, and its output has been shared with
      the user for at least one environment
