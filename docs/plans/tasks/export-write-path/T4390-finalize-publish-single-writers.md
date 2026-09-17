# T4390: finalize_export + publish_final_video — Single Writers

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-07-03
**Epic:** [export-write-path](EPIC.md) · Audit items E2 + E4-adjacent · Depends on T4380

## Problem

The write path behind the T4010/T4020/rank-sweep incidents:

1. **Finalize transaction copied 5×** (insert working_video → point project → complete job → stamp exported_at): `export_worker.py:259-339`, `export/framing.py:227-269` (+ fallback variant :282-288), `export/multi_clip.py:1398-1435` (Modal) and :1660-1727 (local), `exports.py:249-268` — the last **omits version and duration columns** (recovered exports create schema-drifted rows).
2. **final_videos has 3 writers with different semantics:** `overlay.py:152` (`_finalize_overlay_export`), `overlay.py:1262` (inside `export_final` — re-implements the helper defined 1,100 lines above in the same file), `auto_export.py:283` (sweep: hardcoded `version=1, source_type='brilliant_clip'`, instant `published_at`). The sweep writer caused the raw-1080p-in-the-9:16-ranking-pool prod incident (T4160 patched the symptom; this removes the class).

## Solution

1. `finalize_export(cursor, *, project_id, filename, job_id, version, duration, ...)` in a service — the ONE transaction. All five sites call it; exports.py's missing columns get fixed BY the consolidation (documented behavior change: recovered exports now carry version/duration).
2. `publish_final_video(cursor, *, source, aspect_ratio, version, publish_now: bool, source_type, ...)` — one writer where the sweep's deliberate differences (auto-publish, source_type, naming via `derive_clip_name` per T4160) are **explicit parameters with validation** (e.g., aspect_ratio must come from the actual output file — T4160's rule — enforced here for ALL callers, not just the sweep).
3. T4010's hardening (no speculative NULL of final_video_id, delete-old-R2-after-new-pointer-commits) must be preserved and become properties OF the shared writer — read T4010's task file + diff first.

## Context

- Files: `services/export_helpers.py` (or a new `services/export_finalize.py`), `export_worker.py`, `export/framing.py`, `export/multi_clip.py`, `exports.py`, `export/overlay.py`, `services/auto_export.py`
- T4370 snapshots are the parity oracle; T4200 (sync-then-announce) ordering must be preserved — finalize commits BEFORE sync BEFORE announce.
- Risk: publish semantics differ deliberately today (user vs sweep). The consolidation must encode differences as parameters, NEVER guess a unification — where semantics genuinely conflict, surface the question in the Progress Log and ask before choosing.

## Steps

1. [ ] Side-by-side table of the 5 finalize copies (columns written, ordering, error handling) + 3 publish writers — in the Progress Log. Flag every divergence as intended-difference vs drift.
2. [ ] Implement both writers + unit tests; strangler-fig: migrate one call site per commit against T4370 snapshots.
3. [ ] Delete the inline copies (overlay.py:1262 first — same-file duplication).
4. [ ] Full backend tests + one real dev export per trigger type (drive-app-as-user).

## Acceptance Criteria

- [ ] One finalize transaction; one final_videos INSERT site (grep-verified)
- [ ] Recovered exports write complete rows (version + duration)
- [ ] aspect_ratio-from-actual-file enforced for every publish path
- [ ] T4010/T4160 protections asserted by tests against the shared writers
- [ ] Snapshot parity across all six triggers

## Progress Log

**2026-09-17 — Step 1 divergence table (Code Expert pass + independent verification against
current `master`, re-verified line numbers).** The task file's site inventory is STALE: T5630
(`export_finalize.py`), T4175 (sweep redesign) and T4380 (`export_job_repository`) already
consolidated 3 of the 5 claimed finalize copies and 1 of the 3 claimed publish writers since this
task file was written (2026-07-03). Remaining real scope is smaller than the task file describes.

### A. Finalize transaction (`working_videos` INSERT -> repoint -> complete job -> stamp
`working_clips.exported_at`)

| # | Task-file claim | Current reality | Verdict |
|---|---|---|---|
| 1 | `export_worker.py:259-339` raw copy | STILL RAW. `process_framing_export` INSERT at `export_worker.py:345`. Does **NOT** stamp `working_clips.exported_at`/`raw_clip_version` (no other writer omits this). | **Drift (DV4)** — no documented reason; T4200's own analysis warns an unset `exported_at` weakens the T4020 shadow-version guard. Migrate onto the shared writer. |
| 2 | `framing.py:227-269` `/framing` raw copy | STILL RAW (`framing.py:236-321`) but the **endpoint is dead** — confirmed zero callers (`grep` frontend `src/`, backend `app/`, `tests/`; the string `export_framing` elsewhere is an unrelated quest-step key in `quests.py`, not this route). Per the T4350 finding already in the knowledge doc. | **Delete, don't migrate.** Migrating a route nobody calls is wasted surface; deleting it is what "one finalize transaction" actually requires. |
| 3 | `multi_clip.py:1398-1435` Modal branch | **GONE.** Delegates to `export_finalize.finalize_export` (`multi_clip.py:1578`). | Already consolidated (T5630). No action. |
| 4 | `multi_clip.py:1660-1727` local branch | **GONE.** Delegates to `export_finalize.upsert_working_video` (`multi_clip.py:1885`). | Already consolidated (T5630). No action. |
| 5 | `exports.py:249-268` recovery, "omits version/duration" | **GONE.** `finalize_modal_export` (`exports.py:182-227`) is a thin adapter to `finalize_export`, which writes both `version` (MAX+1) and `duration`. The claimed schema drift no longer exists. | Already consolidated (T5630); AC "recovered exports write complete rows" already satisfied — lock with a test, no code change. |
| — | (not in task file — didn't exist yet) | `export_finalize.upsert_working_video`/`finalize_export` (T5630) is the canonical shared writer 3/4/5 already call. | This is the writer copies #1/#2 must join. |

**Gap found (not a conflict, a missing parameter):** `upsert_working_video` has no `effect_type`
param. Copies #1 and #2 both carry `effect_type` forward from the project's current working
video (`normalize_effect_type(existing['effect_type'])`); multi-clip callers never set it (schema
`DEFAULT 'original'` applies). **Resolution:** add `effect_type: str | None = None` to
`upsert_working_video` — omitted (None) preserves exact current multi-clip behavior (relies on
schema default, byte-identical), supplied threads it into the INSERT for the migrated single-clip
worker path. Not a semantic conflict — the two caller classes want different (but each internally
consistent) values for an optional field a parameter cleanly expresses.

**T4350 carry-forward (DV3, single-clip paths):** copies #1/#2 do a *verbatim* `highlights_data`
carry; the shared writer runs T4350's `resolve_carried_highlights` transform when given
`new_framing_snapshot`. Copies #1/#2 never built a framing snapshot to pass — wiring T4350 carry
into the single-clip worker path is a separate, larger feature NOT in this task's Solution section
(which only lists `project_id, filename, job_id, version, duration`). **Decision: migrate onto the
shared writer passing `new_framing_snapshot=None`** (same as today — the shared writer's
`None`-snapshot branch seeds fresh detected regions exactly like the current verbatim-carry copies
do, since single-clip framing has no detected regions to seed either — net behavior unchanged for
this task). Flagged for a future task, not attempted here (scope discipline per Key Rules).

### B. `final_videos` publish writers

| # | Task-file claim | Current reality | Verdict |
|---|---|---|---|
| 1 | `overlay.py:152` `_finalize_overlay_export` | Present, shifted to `overlay.py:122-300`. Full T4010 (atomic swap)/T5215 (intro_card_id carry)/T6030 (slowmo, column-guarded)/T8070 (raw_clips refresh) writer. Calls `export_job_repository.complete()` (has a job). `aspect_ratio` sourced from `compute_project_metadata` -> `projects.aspect_ratio` (project SETTING, not the file). | Base writer to extract. |
| 2 | `overlay.py:1262` inline copy in `export_final` | Present, shifted to `overlay.py:1778-2032` (INSERT `:1926`). Near-identical to #1 EXCEPT: slowmo columns written **unconditionally** (`:1929`, no `_has_slowmo` guard — DV7, drift, no documented reason); additionally writes `before_after_tracks` (`:1949-1993`, intended — `/final`-only feature, a different table, not a `final_videos` column); has **no** `export_job_id` (this path never had a job — intended, not a conflict). Same `aspect_ratio`-from-project-setting sourcing. | Second writer to fold into #1; the `before_after_tracks` block stays a caller-side step (see below). |
| 3 | `auto_export.py:283` sweep, hardcoded `version=1, source_type='brilliant_clip'`, instant publish | **GONE.** T4175 redesigned the sweep: `_export_brilliant_clip` no longer writes `final_videos` at all (confirmed: `grep -n final_videos app/services/auto_export.py` shows only a pre-export SELECT-to-skip check, no INSERT). The hardcoded-values concern this task worried about is moot — there is no sweep publish caller to unify against. | No sweep caller exists. `publish_now`/instant-publish params from the task's proposed signature have no live caller; keep them for signature-completeness/future callers but both real call sites pass `publish_now=False`. |

**DV9 — `aspect_ratio` sourced from project settings, not the actual file, in BOTH remaining
writers.** This is exactly what Solution #2 / T4160's rule targets, extended past the
(now-removed) sweep path. **Resolution (evidence-based, not guessed):** the frontend only ever
offers `'16:9'`/`'9:16'` (confirmed: `grep` for aspect-ratio constants in
`src/frontend/src/constants/`), and for the framed pipeline the working video's actual pixel
dimensions are produced BY the crop/framing step targeting `projects.aspect_ratio` — so file-derived
and project-setting-derived values coincide for every normally-framed export today; deriving from
the file is a **safety hardening**, not a fix for an active incident in the overlay path (the
active incident T4160 fixed was the sweep's *unframed* stream-copy, which no longer writes
`final_videos` at all per the row above). Implementation: probe actual output dimensions where
available (`export_final` has the raw video bytes in memory -> `ffprobe_bytes`; the 3
`_finalize_overlay_export` call sites are R2-only -> presigned-URL ffprobe, new
`video_probe.probe_dimensions_via_url`), map to `'16:9'`/`'9:16'` via the same ratio bands
`ai_upscaler/utils.py::detect_aspect_ratio` uses; **on any probe failure (R2 disabled in
dev/test, ffprobe failure, non-standard ratio) fall back to `projects.aspect_ratio` with a WARNING
log** — this is the CLAUDE.md-sanctioned "fallback for an external dependency" (ffprobe/R2
network access), not a silent internal-data fallback, and it means the T4370 goldens (which run
with `R2_ENABLED=False`test bytes that don't ffprobe) need **no re-bless** for this change — the
probe fails in every test environment today and falls back to the exact value already pinned.
Behavior only changes in a real deployment where R2 is live, which is precisely where the
incident class lives.

### Verdict on Step 2 (genuine semantic conflict check)

**No genuine, currently-necessary two-way semantic conflict found** — independently confirmed
(Code Expert pass + my own re-verification of every citation above). Every real divergence is
either already resolved (writers 3/4/5 and publish writer 3 no longer exist as claimed), a
one-line parameter gap (`effect_type`), or resolvable with hard evidence (aspect_ratio: frontend
only offers two ratios, framed-pipeline file dims already match project setting today, so
file-derivation is additive hardening with a documented, test-inert fallback). Proceeding to
implementation — no BLOCKED.

**2026-09-17 — Pushed + PR opened.** Branch was fully committed (7 commits) but never pushed
after the last quota interrupt; pushed and opened [PR #457](https://github.com/imankha/video-editor/pull/457).
One uncommitted change surfaced at push time (`.claude/knowledge/export-pipeline.md`, the Stage-7
knowledge-doc update called for by CLAUDE.md) — committed separately (824476cc) and pushed. Branch
CI running on the PR head. Remaining before STAGING: CI green, then merge. Live dev export
(drive-app-as-user) stays SKIPPED-WITH-REASON per the 16:33 note — no dev Postgres reachable from
the container; recommend a live re-check post-merge if desired, otherwise evidence base is golden
harness + unit tests per kickoff fallback.

**2026-09-17 — Branch CI + Reviewer verdict: NOT MERGED, WAITING ON USER.**

*CI (run 35244363045, head 9ebeee0c):* backend job FAILED — `test_t6200_concurrency.py::test_authed_burst_larger_than_pool_does_not_503`
(`sqlite3.OperationalError: database is locked`), 1 failed / 4014 passed. Matches the documented
flake in `docs/testing/known-failures.md:29` (same test/error, confirmed non-reproducing via
same-SHA rerun on T7910's unrelated branch); this diff touches no SQLite locking/pool code. Not
currently deselected in `branch-ci.yml`, so the job reads red regardless. Reran via
`gh run rerun 35244363045 --failed`; outcome not yet confirmed in this log entry — check the run
before treating CI as green.

*Reviewer (fresh-context, full diff `origin/master...HEAD` + task file + knowledge doc):* **BLOCKING ISSUES FOUND** — the red CI (above) plus 3 MAJOR:
- **M1** — `publish_final_video.py:143-155`: when the probed file aspect ratio disagrees with
  `projects.aspect_ratio` (the exact event T4160 exists to catch), the override is applied
  silently — both `logger.warning` calls cover probe *failure*, not probe-succeeds-and-disagrees.
  Since this path is only live in a real R2 environment (goldens are inert here by design and this
  task's live-export check was skipped), there is currently no log evidence the probe path has
  ever fired in production, and no way to distinguish "rule working" from "probe always fails,
  silently falling back to master's old behavior." Fix: log on `label != project_aspect_ratio`
  with both values + project id.
- **M2** — the shared writer's slow-mo segment read (`publish_final_video.py:254`) uses
  `read_clip_segments_for_project` (raises on decode failure) where the old
  `_finalize_overlay_export` used `load_project_clip_segments` (never raises, empty-list fallback).
  Not in the divergence table. A corrupt `segments_data` blob or missing table now aborts the
  whole finalize transaction *after* a completed Modal render — the user loses the export and
  re-pays GPU seconds on retry. Needs either the tolerant read restored, or documented as a 4th
  deliberate behavior change with that tradeoff spelled out (and `poster.py:463`'s docstring fixed).
- **M3** — `overlay.py`'s `export_final` now calls the new `resolve_output_aspect_ratio` /
  `ffprobe_bytes` synchronously inside `async def export_final`, un-threaded (up to 60s blocking
  the event loop on a hang) — unlike the other 3 call sites, which correctly
  `await asyncio.to_thread(...)`. One-line fix.
- Two MINORs the reviewer flagged as "should ride this PR": the deleted `/framing` endpoint still
  has a live caller in `tests/integration/test_persistence.py` (a manual script outside
  `run_tests.py`'s glob, invisible to CI — will 404 at "TEST 4"); and stale prose in
  `test_export_golden_overlay.py:12-14` about slowmo-column guarding (superseded by the DV7 fix).
- Everything the task was asked to scrutinize came back clean: the "mechanical extraction, zero
  behavior change" claim holds line-for-line against both prior copies; T4010's atomic-swap /
  no-speculative-NULL protections and T4200's finalize-before-sync-before-announce ordering both
  survived untouched; `effect_type=None` truly preserves multi-clip behavior; the
  goldens-can't-catch-it reasoning for the aspect_ratio fallback checks out structurally (same
  source column as `compute_project_metadata`); all 5 acceptance criteria grep-verified.

**Not provably verified — PLAN.md row set to WAITING ON USER.** Needed before this can merge:
fix M1/M2/M3 + the two MINORs, confirm the CI rerun is clean (or deselect the documented flake),
then a follow-up review pass on the delta. Branch/PR/container left in place, nothing deleted.

**2026-09-17 — Fixed, re-reviewed, provably verified.**

*CI rerun (run 35246013931, `gh run rerun --failed`):* went GREEN with no code changes, confirming
`test_t6200_concurrency` was the documented flake, not a real regression.

*Fix commit `386c421f`:* M1 (log line on probed-aspect-ratio override, additional to the two
failure-path warnings), M2 (slow-mo segment read wrapped in the same tolerant
try/log/fall-back-to-None pattern the old `load_project_clip_segments` had, using the caller's
own transaction cursor instead of opening a new connection — `poster.py` docstring corrected to
match), M3 (`export_final`'s `resolve_output_aspect_ratio` call now runs via
`await asyncio.to_thread(...)`, matching the other 3 call sites), plus both MINORs (dead
`/export/framing`'s last caller removed from the manual integration script; stale
slowmo-column-guarding claim in `test_export_golden_overlay.py` corrected). Verified locally:
golden harness 9/9, T4390's own T4010/T4390 suites 21/21, broader curated regression around
`publish_final_video`'s absorbed properties (T5090/T5215/T6030/T8070/T4200/T4210/T5280/T5410)
149/151 (2 pre-existing Postgres-unreachable errors, same known infra gap, unrelated to this
diff), ruff clean, import clean.

*Fresh-context Reviewer, delta-only pass on `386c421f`:* **APPROVED WITH MINOR NOTES.** All 3
MAJOR + both MINOR findings independently confirmed resolved (log format checked against
`projects.aspect_ratio`'s actual stored literals; the M2 swallow confirmed to not poison the
sqlite transaction and to leave `KeyboardInterrupt`/`SystemExit` uncaught; the M3
`asyncio.to_thread` kwarg-forwarding confirmed correct against `resolve_output_aspect_ratio`'s
keyword-only signature). No scope creep, no new bugs. Two non-blocking notes, explicitly flagged
as not worth holding the branch for: (1) neither M1's log line nor M2's tolerance path is pinned
by a test yet — worth adding later, M2 especially since it guards a paid Modal render; (2) two
trivially-stale docstring/comment phrasings (`poster.py:462-465` says `export_final` calls
`read_clip_segments_for_project` "directly", now transitive through `publish_final_video`;
`test_persistence.py`'s module docstring still lists working-video version tracking after TEST 4's
removal). Filed as low-priority follow-up, not blocking.

**Provably verified per the merge bar (red/green evidence + CI green + Reviewer approval).
Proceeding to merge.**
