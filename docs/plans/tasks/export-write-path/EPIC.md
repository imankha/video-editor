# Export Write-Path Unification Epic

**Status:** TODO
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items F2, E1, E2, B4, E8

## Goal

The export/publish write path — the code behind the T4010, T4020, T4110, and rank-sweep production incidents — gets ONE implementation per operation, protected by a characterization-test harness built BEFORE anything moves. Directives: [DRY] + [SYNC] + [DEP].

Current state (all verified in the audit):
- `export_jobs` has **two competing create-helpers** (exports.py:86 inserts `'pending'`; export_helpers.py:37 inserts `'processing'` and swallows insert failure) and **14 raw status-write sites in 5 modules**; `export_worker.py:28-33` imports helpers FROM the router (inverted layering).
- The 4-statement finalize transaction (insert working_video → point project → complete job → stamp exported_at) is **hand-copied 5×** with drift (exports.py:249-268 omits version/duration columns).
- `final_videos` has **3 writers with different semantics**; the sweep writer (auto_export.py:283, hardcoded `version=1, source_type='brilliant_clip'`, instant publish) caused the raw-clips-in-ranking-pool incident.
- Export is **frontend-authoritative**: the full-state PUT (clips.py:2001-2124) and multi-clip's hook-state payload can clobber DB truth (T4020 class; two-tab clobber).
- `routers/export/` is 5,878 lines containing YOLO inference, FFmpeg pipes, and 6 parallel trigger pipelines — the sweep path fully parallel with no job record.

## Sequencing (STRICT — each task depends on the previous)

| ID | Task | Status |
|----|------|--------|
| T4370 | [Export Golden-Output Test Harness](T4370-export-golden-harness.md) | TODO |
| T4380 | [ExportJobRepository](T4380-export-job-repository.md) | TODO |
| T4390 | [finalize_export + publish_final_video Single Writers](T4390-finalize-publish-single-writers.md) | TODO |
| T4400 | [Backend-Authoritative Export (mark-exported)](T4400-backend-authoritative-export.md) | TODO |
| T4410 | [Export Pipelines → Services + Sweep Unification](T4410-export-pipelines-to-services.md) | TODO |

## Shared design decisions

1. **Characterization first (T4370):** golden tests pin CURRENT behavior of each export type before any consolidation. Strangler-fig after: new implementation runs beside old, compared on identical inputs, then flipped.
2. **Repository owns every status transition.** After T4380, `grep -rn "UPDATE export_jobs" src/backend/app --include=*.py` outside the repository file returns nothing.
3. **The DB is the source of truth at export time (T4400).** Export snapshots backend state; client hook state never crosses the wire as authority. Deliberate semantic differences of the sweep path (auto-publish, source_type) become explicit parameters of the shared writer, not a parallel implementation.
4. **Moves are mechanical commits.** Code motion (router → service) is never mixed with behavior change in one commit (audit F3 rule).

## Completion Criteria

- [ ] One create/transition path for export_jobs; no service→router imports
- [ ] One finalize transaction; one final_videos writer (sweep included)
- [ ] No export type accepts client state as authority over DB blobs
- [ ] Golden tests prove output parity across the consolidation
- [ ] routers/export/ contains routing + validation only
