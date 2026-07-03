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
