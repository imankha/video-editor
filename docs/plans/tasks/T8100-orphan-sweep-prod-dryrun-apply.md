# T8100: Run the orphan-sweep dry-run + apply cleanup pass against prod

**Split off T8100 from [T7830](T7830-sweep-orphan-audit-rankpool-question.md) at the 2026-08-29 deploy reconciliation.** T7830's Phase 1 (merged PR #288) fixed a data-loss false-positive in the T7600 audit script (was missing `working_clips.uploaded_filename` from the reference set) and answered the rank-pool question (already fixed by T4175/v021, no code change needed). What remained was running the now-corrected audit for real: a read-only dry-run against prod for the reclaimable-bytes total, followed by a separate `--apply` cleanup pass after user sign-off.

## RESOLVED 2026-08-29 — superseded by v048, verified clean

**Finding:** the same 2026-08-29 deploy that this task was split off from also shipped `src/backend/app/migrations/profile_db/v048_cleanup_sweep_orphan_raw_clips.py` — a migration nobody had connected back to this task at filing time. Its docstring says explicitly: it "packages the SAME reviewed logic [as `scripts/cleanup_orphan_raw_clips.py`, T7830's standalone tool] to run through the normal migration system ... so cleanup lands wherever the admin triggers migrations instead of requiring a separate manual script run." It imports the identical `classify_objects`/`referenced_raw_clip_filenames`/`is_sweep_orphan_name` helpers from `app/services/orphan_raw_clips.py` that the standalone script also uses — one reviewed implementation, two entry points.

Running `POST /api/admin/migrate`-equivalent (`run_all_migrations()` via `fly ssh`) as part of this same deploy's routine migration step **already executed v048 for every registered profile** (47 users / 53 profiles, `errors: []`). v048 has no confirmation gate by design (documented as deliberate in the migration file, given how narrow the sweep-signature match is) — so the reclaim already happened as a side effect, without the separate report/sign-off/apply flow this task was scoped around.

**Verification performed:** ran a read-only scan (same `classify_objects` + `referenced_raw_clip_filenames` helpers, via a one-off script over `fly ssh` — the standalone `scripts/cleanup_orphan_raw_clips.py` isn't present on the deployed image, only the `app/` package is) across all 47 users / 53 profiles on prod:

```
profiles scanned: 53   errors: 0
sweep-signature orphans remaining: 0   bytes: 0
other unreferenced (non-sweep, not deleted by design): 0
```

Zero sweep-signature orphans remain and zero errors — consistent with v048 having already reclaimed whatever was there (the standalone script's dry-run on 2026-08-28, referenced in T7830, is the only record of the original count and wasn't re-checked before v048 ran).

**Outcome:** no separate dry-run/sign-off/apply pass is needed — the acceptance criteria below are satisfied by v048 having already run. Closing as DONE (superseded), not deleting the file, since it records the actual mechanism (a migration silently doing what this task assumed would need a manual gate) — that mismatch is the real learning, captured below.

## Learnings for future migration + admin-sweep work

- **A migration that performs live deletes can retroactively satisfy a "run this script manually with sign-off" task, and nothing will flag the overlap.** v048 and T8100 were authored independently in the same deploy batch, targeting the exact same objects, with no cross-reference between them until this reconciliation. When a migration is added in the same PR/deploy range as a task describing a manual cleanup pass over the same domain, check whether the migration already subsumes it before scheduling the manual pass.
- **The "gated apply, human sign-off" data-safety pattern (CLAUDE.md § Data Safety Rules) does not automatically extend to migrations.** `scripts/cleanup_orphan_raw_clips.py` requires `--apply` + a typed `yes` confirmation; v048, doing the identical deletion, runs unconditionally as part of the standard migrate step with no equivalent gate. This was a deliberate, reviewed choice (documented in the migration's own DATA SAFETY section, justified by how narrow the sweep-signature match is) — but it means the safety property lives in "how narrow is the match," not in a human confirmation step, for any future migration that follows this precedent.
- **The standalone script isn't deployed** (`scripts/` is outside the Docker build context for `src/backend`; only `app/` ships) — a read-only recheck after the fact needs a one-off inline script piped via `fly ssh console -a <app> -C "python3"` stdin, reusing the same `app.services.*` helpers. Useful pattern for verifying migration side effects without shipping ops tooling to prod.

## Acceptance Criteria

- [x] Read-only dry-run executed against prod, reclaimable-bytes total reported to user (0 remaining, via v048 + post-hoc verification scan)
- [x] `--apply`-equivalent cleanup already executed (by v048, as part of the routine migrate step)
- [x] Post-apply verification: 0 sweep-signature orphans, 0 errors, across all 47 users / 53 profiles
- [ ] ~~User signs off on the specific set of objects to delete~~ — moot, nothing left to sign off on

## Context

T7830 itself already found and fixed a would-be data-loss bug in the audit script before this task runs it for real — the corrected reference set (including `uploaded_filename`) must be used, not the original T7600 script. v048 imports from the same corrected `app/services/orphan_raw_clips.py` module, so it inherits that fix.
