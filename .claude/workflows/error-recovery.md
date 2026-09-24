# Error Recovery

Use CLAUDE.md policy and the shared agent contract. Preserve existing work and
failure evidence; a retry must address a specific missing fact, not repeat a guess.

| Failure | Recovery | Stop/escalation condition |
|---|---|---|
| Focused fix failed | Give the expert the observed failure, attempted fix, relevant knowledge and file paths | Consult expert before another speculative correction |
| Design rejected or material design error discovered | Preserve assigned edits; revise design and record new approval before dependent implementation | Never assume approval survives a substantive redesign |
| Incorrect agent output | Retain evidence, supply missing context, retry one bounded request | Unresolved issue returns to orchestrator for re-scope/expert |
| Test failure | Distinguish implementation, test, environment, or evidenced known failure; rerun the affected set after correction | Do not weaken assertions or treat collection errors as behavioral proof |
| Auth/quota/infrastructure failure | Use spawn-worker diagnostics and resume rules; distinguish AUTH_DEAD from BLOCKED | Do not spend further model turns probing a known unavailable service |
| Merge conflict | Resolve on the task branch using both changes' intent; refresh affected checks and CI | No blanket preference for either side; unresolved product conflict goes to user |
| Human gate | Record question, artifact/revision, and WAITING ON USER in tracked task files | Resume WIP when answered; no duplicate request for already granted approval |
| Lost context | For a wave, read WAVE.md, container state, and worker status files; for inline work read task/design plus git status/log | Validate current revision and existing edits before resuming |
| Scope growth | Reclassify, split or revise the task with the orchestrator | Do not silently bypass an L-tier design gate |

## Safe checkpoints

- Stage explicit assigned paths only. Never `git add -A`, reset a shared tree, or
  drop a stash without checking its ownership and contents.
- Intentional red test-first commits are allowed; label them. Checkpoint commits
  do not imply verification or readiness to land.
- Use `T{id}:` subjects for tracked tasks and truthful agent attribution.
- Preserve test output and acceptance evidence before any cleanup. Retention
  automation is not yet implemented; do not claim disposable checkout data is archived.

## State ownership

PLAN.md uses TODO, WIP, WAITING ON USER, STAGING, DONE as defined in CLAUDE.md.
BLOCKED/AUTH_DEAD/PUSHREADY are worker protocol signals, not additional PLAN.md
statuses. For an infrastructure stall, record the blocker in operational state;
use WAITING ON USER only if a user action is actually required. If work is parked
with no active worker and no user action needed, return it to TODO with a resume
note rather than leaving an idle WIP. DONE still requires the specified user gesture.
