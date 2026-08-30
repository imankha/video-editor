# T8100: Run the orphan-sweep dry-run + apply cleanup pass against prod

**Split off T8100 from [T7830](T7830-sweep-orphan-audit-rankpool-question.md) at the 2026-08-29 deploy reconciliation.** T7830's Phase 1 (merged PR #288) fixed a data-loss false-positive in the T7600 audit script (was missing `working_clips.uploaded_filename` from the reference set) and answered the rank-pool question (already fixed by T4175/v021, no code change needed). What remains is running the now-corrected audit for real: a read-only dry-run against prod for the reclaimable-bytes total, followed by a separate `--apply` cleanup pass after user sign-off.

## Scope

No new code expected — this is executing the already-fixed T7830 audit script against prod and acting on its output.

## Acceptance Criteria

- [ ] Read-only dry-run executed against prod, reclaimable-bytes total reported to user
- [ ] User signs off on the specific set of objects to delete
- [ ] `--apply` cleanup pass executed
- [ ] Post-apply verification: no live user data (raw_clips/working_clips references) was touched

## Context

T7830 itself already found and fixed a would-be data-loss bug in the audit script before this task runs it for real — the corrected reference set (including `uploaded_filename`) must be used, not the original T7600 script.
